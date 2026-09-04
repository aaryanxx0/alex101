import type { ConnectOptions, MovementStateMap } from '@alex101/shared';
import { clampPitch, clampYaw, normalizeHotbarSlot } from '@alex101/shared';
import type { LogManager } from './LogManager.js';
import type { BotStateStore } from './BotStateStore.js';
import type { ConfigManager } from './ConfigManager.js';
import type { AuthManager } from './AuthManager.js';
import type { ViewerManager } from './ViewerManager.js';
import { movementToMap } from './BotStateStore.js';
import { classifyError, isPermanent } from './errorClassifier.js';
import type { PathfinderController } from './PathfinderController.js';
import type { ControlSessionManager } from './ControlSessionManager.js';
import { EventEmitter } from 'node:events';

const BACKOFF_BASE_MS = 5000;
const BACKOFF_MAX_MS = 60_000;

interface BackoffState {
  attempt: number;
  timer: NodeJS.Timeout | null;
  stopped: boolean;
}

export interface MinecraftBotEvents {
  snapshot: () => void;
  chat: (msg: import('@alex101/shared').ChatMessage) => void;
  viewer: (v: import('@alex101/shared').ViewerState) => void;
  log: () => void;
}

export declare interface MinecraftBotManager {
  on<E extends keyof MinecraftBotEvents>(event: E, listener: MinecraftBotEvents[E]): this;
  emit<E extends keyof MinecraftBotEvents>(event: E, ...args: Parameters<MinecraftBotEvents[E]>): boolean;
}

/**
 * Owns the live Mineflayer instance and the lifecycle around it.
 */
function extractChatText(reason: any): string {
  try {
    let parsed = reason;
    if (typeof parsed === 'string') {
      try { parsed = JSON.parse(parsed); } catch {}
    }
    if (!parsed || typeof parsed !== 'object') return '';
    // Mineflayer 'kicked' reason can be:
    //  - A Prismarine chat object: { text, extra: [...] }
    //  - A Prismarine chat object NBT-wrapped: { type:'compound', value:{ text, extra:{type:'list', value:{type:'compound', value:[...]}} } }
    //  - A vanilla JSON chat: ["", { text: '...', extra: [...] }]
    const unwrap = (n: any): any => {
      while (n && typeof n === 'object' && (n as any).type && 'value' in n) {
        n = (n as any).value;
      }
      return n;
    };
    const unwrapScalar = (s: any): string => {
      const u = unwrap(s);
      if (typeof u === 'string') return u;
      if (u && typeof u === 'object' && typeof (u as any).translate === 'string') return (u as any).translate;
      return '';
    };
    let v: any = unwrap(parsed);
    if (Array.isArray(v)) {
      let s = '';
      for (const c of v) s += extractChatText(c);
      return s;
    }
    if (!v || typeof v !== 'object') return unwrapScalar(v);
    let out = '';
    if ('text' in v) out += unwrapScalar(v.text);
    if (Array.isArray(v.extra)) {
      for (const c of v.extra) out += extractChatText(c);
    } else if (v.extra && typeof v.extra === 'object') {
      out += extractChatText(v.extra);
    }
    return out;
  } catch { return ''; }
}

// Keep the function so scripts can import it for debugging.
export { extractChatText };

export class MinecraftBotManager extends EventEmitter {
  private bot: any = null;
  private view: any = null;
  private viewCleanup: (() => Promise<void>) | null = null;
  private readonly backoff: BackoffState = { attempt: 0, timer: null, stopped: false };
  /** Guards against kicked+end both invoking handleDisconnect for one disconnect. */
  private disconnectHandled = false;
  /** Guards concurrent connect() calls while a connection attempt is in flight. */
  private connecting = false;

  constructor(
    private readonly log: LogManager,
    private readonly store: BotStateStore,
    private readonly config: ConfigManager,
    private readonly auth: AuthManager,
    private readonly viewerMgr: ViewerManager,
    private readonly pathfinder: PathfinderController,
    private readonly control: ControlSessionManager,
  ) {
    super();
  }

  isRunning(): boolean {
    return !!this.bot;
  }

  getBot() {
    return this.bot;
  }

  /** Snapshot of the current internal state. */
  snapshot() {
    return this.store.snapshot();
  }

  async connect(options: ConnectOptions, requestId?: string): Promise<void> {
    this.log.info('connection', `CONNECT_REQUEST received (requestId=${requestId ?? 'n/a'}, host=${options.host}:${options.port}, user=${options.username}, autoReconnect=${options.autoReconnect}, password=${options.authPassword ? 'set' : 'NOT SET'})`);
    if (this.connecting) {
      this.log.warn('connection', 'Connect requested while a connection attempt is already in flight — ignoring (idempotent)');
      return;
    }
    if (this.bot) {
      this.log.warn('connection', 'Connect requested while already connected — ignoring (idempotent)');
      return;
    }
    this.connecting = true;
    this.disconnectHandled = false;
    this.backoff.stopped = false;
    // Fall back to the protected BOT_PASSWORD env var when no dashboard
    // password is configured. Never logged.
    const effectiveOptions: ConnectOptions = {
      ...options,
      authPassword: options.authPassword || process.env.BOT_PASSWORD || '',
    };
    if (!effectiveOptions.authPassword) {
      this.log.warn('auth', 'No in-game password available (neither dashboard setting nor BOT_PASSWORD env) — AuthMe-protected servers will kick the bot');
    }
    this.store.patchConnection({
      host: effectiveOptions.host,
      port: effectiveOptions.port,
      configuredUsername: effectiveOptions.username,
      minecraftVersion: effectiveOptions.version,
      authMode: effectiveOptions.authMode,
      autoReconnect: effectiveOptions.autoReconnect,
    });
    this.store.patchViewer({ renderDistance: effectiveOptions.viewDistance, ready: false });
    this.config.update({
      host: effectiveOptions.host,
      port: effectiveOptions.port,
      username: effectiveOptions.username,
      version: effectiveOptions.version,
      authMode: effectiveOptions.authMode,
      autoReconnect: effectiveOptions.autoReconnect,
      reconnectDelayMs: effectiveOptions.reconnectDelayMs,
      viewDistance: effectiveOptions.viewDistance,
      authPassword: effectiveOptions.authPassword,
    });
    try {
      await this.attempt(effectiveOptions, /* manual */ false);
    } finally {
      this.connecting = false;
    }
  }

  async disconnect(reason = 'manual'): Promise<void> {
    this.backoff.stopped = true;
    if (this.backoff.timer) {
      clearTimeout(this.backoff.timer);
      this.backoff.timer = null;
    }
    this.control.releaseAllMovement();
    this.pathfinder.cancel('manual disconnect');
    await this.destroyBot(`disconnect (${reason})`);
    this.store.patchConnection({ state: 'OFFLINE' });
    this.store.resetRuntime();
    this.emit('snapshot');
  }

  private scheduleReconnect(options: ConnectOptions, reason: string = 'unknown') {
    if (!options.autoReconnect) return;
    if (this.backoff.stopped) return;
    // Exactly ONE reconnect timer may exist at any time.
    if (this.backoff.timer) {
      clearTimeout(this.backoff.timer);
      this.backoff.timer = null;
      this.log.warn('connection', 'RECONNECT_SCHEDULED — cleared a pre-existing reconnect timer first');
    }
    this.backoff.attempt++;
    const base = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (this.backoff.attempt - 1));
    const jitter = Math.random() * 500;
    const proxyAlreadyConnected = /already connected/i.test(reason);
    const keepAliveFailure = /keepalive|client timed out|client.*timeout/i.test(reason);
    const extraDelay = proxyAlreadyConnected
      ? 30_000
      : keepAliveFailure
        ? 15_000
        : 0;
    const delay = Math.max(options.reconnectDelayMs ?? 5000, base + jitter) + extraDelay;
    this.store.patchConnection({ reconnectAttempts: this.backoff.attempt });
    this.log.warn('connection', `RECONNECT_SCHEDULED attempt #${this.backoff.attempt} in ${(delay / 1000).toFixed(1)}s (reason: ${reason})${proxyAlreadyConnected ? ' [proxy already connected]' : keepAliveFailure ? ' [keepalive timeout]' : ''}`);
    this.store.patchConnection({ state: 'RECONNECTING' });
    this.emit('snapshot');
    this.backoff.timer = setTimeout(() => {
      this.backoff.timer = null;
      this.log.info('connection', `RECONNECT_ATTEMPT #${this.backoff.attempt} starting now`);
      this.attempt(options, false).catch((err) => {
        this.log.error('connection', `Reconnect attempt failed: ${(err as Error).message}`);
      });
    }, delay);
  }

  private async attempt(options: ConnectOptions, manual: boolean): Promise<void> {
    if (this.bot) return;
    this.disconnectHandled = false; // fresh lifecycle for this connection
    this.store.patchConnection({ state: 'CONNECTING' });
    this.emit('snapshot');

    let actualUsername = options.username;
    try {
      const result = await this.auth.authenticate(options.authMode, options.username);
      if (result) actualUsername = result.username;
    } catch (err) {
      this.store.patchConnection({ state: 'ERROR' });
      this.log.error('auth', `Microsoft auth failed: ${(err as Error).message}`);
      this.emit('snapshot');
      if (!manual) this.scheduleReconnect(options, (err as Error).message);
      return;
    }

    this.store.patchConnection({ state: 'AUTHENTICATING' });
    this.emit('snapshot');

    const token = this.auth.tokenFor(options.username);
    const createOpts: Record<string, unknown> = {
      host: options.host,
      port: options.port,
      username: actualUsername,
      version: options.version,
      viewDistance: options.viewDistance,
      auth: options.authMode,
      hideErrors: false,
      connectTimeout: 60_000,
      // Render's free tier drops idle TCP sessions after ~30s. Keep the socket
      // busy with very frequent keep-alives and force Minecraft's keep-alive
      // timeout to be much higher than the network's.
      keepAliveInterval: 2000,
      closeTimeout: 5_000,
      respawn: true,
      // Force our packet queue to be aggressive
      checkTimeoutInterval: 30_000,
      // mc.238458.xyz is a proxy — make the bot handle the "already
      // connected" backoff gracefully.
      kickTimeout: 60_000,
    };
    if (token) createOpts.accessToken = token;
    if (options.authMode === 'offline') createOpts.auth = 'offline';

    this.log.info('connection', `Connecting to ${options.host}:${options.port} as ${actualUsername} (mc ${options.version}, ${options.authMode})`);

    const mineflayer = await import('mineflayer');
    let bot: any;
    this.log.info('connection', 'CREATE_BOT — instantiating mineflayer client');
    try {
      bot = mineflayer.createBot(createOpts as any);
    } catch (err) {
      this.store.patchConnection({ state: 'ERROR' });
      this.log.error('connection', `Failed to create bot: ${(err as Error).message}`);
      if (!manual) this.scheduleReconnect(options, (err as Error).message);
      return;
    }

    this.bot = bot;
    this.store.patchConnection({ actualUsername });
    this.store.setStartedAt(Date.now());

    bot.once('spawn', async () => {
      this.log.success('connection', 'SPAWN — bot spawned into the world');
      this.store.patchConnection({ state: 'SPAWNED', actualUsername: bot.username ?? actualUsername });
      this.store.patchConnection({ serverVersion: bot.version ?? null });
      this.log.success('connection', `Spawned as ${bot.username} on version ${bot.version}`);
      this.store.patchPosition({
        x: bot.entity.position.x,
        y: bot.entity.position.y,
        z: bot.entity.position.z,
        yaw: bot.entity.yaw ?? 0,
        pitch: bot.entity.pitch ?? 0,
      });
      await this.startViewer(options);
      this.startKeepAliveLoop(bot);
      // Immediately nudge the bot so the proxy sees fresh position packets.
      try {
        bot.setControlState('jump', true);
        setTimeout(() => bot.setControlState('jump', false), 200);
        this.lastMoveAt = Date.now();
      } catch (err) {
        this.log.debug('connection', `post-spawn nudge failed: ${(err as Error).message}`);
      }
      // AuthMe-style servers kick unauthenticated players after ~30s.
      // Log in automatically if a password is configured.
      this.runInGameAuth(bot, options);
      this.emit('snapshot');
    });

    bot.on('move', () => {
      if (!bot.entity) return;
      const p = bot.entity.position;
      this.store.patchPosition({
        x: p.x,
        y: p.y,
        z: p.z,
        yaw: bot.entity.yaw ?? 0,
        pitch: bot.entity.pitch ?? 0,
        velocity: bot.entity.velocity
          ? { x: bot.entity.velocity.x, y: bot.entity.velocity.y, z: bot.entity.velocity.z }
          : { x: 0, y: 0, z: 0 },
        onGround: !!bot.entity.onGround,
      });
      this.lastMoveAt = Date.now();
      this.emit('snapshot');
    });

    bot.on('health', () => {
      this.store.patchPlayer({
        health: bot.health ?? 20,
        food: bot.food ?? 20,
        foodSaturation: bot.foodSaturation ?? 0,
      });
      this.emit('snapshot');
    });

    bot.on('experience', () => {
      this.store.patchPlayer({
        xpLevel: bot.experience.level ?? 0,
        xpProgress: bot.experience.progress ?? 0,
        xpTotal: bot.experience.points ?? 0,
      });
      this.emit('snapshot');
    });

    bot.on('game', () => {
      this.store.patchPlayer({ gamemode: (bot.game?.gameMode ?? 'unknown').toLowerCase() as any });
      this.store.patchPosition({ dimension: bot.game?.dimension ?? 'unknown' });
      this.emit('snapshot');
    });

    bot.on('message', (jsonMsg: any, _pos: any) => {
      const text = jsonMsg?.toString ? jsonMsg.toString() : String(jsonMsg);
      const sender = jsonMsg?.jsonMsg?.sender ?? 'Server';
      const id = String(Math.random()).slice(2, 10);
      const msg = {
        id: `srv-${Date.now()}-${id}`,
        ts: Date.now(),
        sender,
        raw: text,
        text,
        isSystem: sender === 'Server' || sender === 'System',
        isWhisper: /^\s*[\w_]+\s+whispers/i.test(text),
      };
      this.store.pushChat(msg);
      this.emit('chat', msg);
      this.handleAuthPrompt(bot, text, options);
      this.emit('snapshot');
    });

    bot.on('chat', (username: string, message: string) => {
      const msg = {
        id: `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        ts: Date.now(),
        sender: username,
        raw: message,
        text: message,
        isSystem: false,
        isWhisper: false,
      };
      this.store.pushChat(msg);
      this.emit('chat', msg);
      this.handleAuthPrompt(bot, message, options);
      this.emit('snapshot');
    });

    bot.on('whisper', (username: string, message: string) => {
      const msg = {
        id: `w-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        ts: Date.now(),
        sender: username,
        raw: message,
        text: message,
        isSystem: false,
        isWhisper: true,
      };
      this.store.pushChat(msg);
      this.emit('chat', msg);
      this.emit('snapshot');
    });

    bot.on('kicked', (reason: any) => {
      const text = extractChatText(reason) || (typeof reason === 'string' ? reason : (reason != null ? String(reason) : 'kicked'));
      let rawJson = '';
      try { rawJson = typeof reason === 'string' ? reason : JSON.stringify(reason); } catch { rawJson = String(reason); }
      this.log.warn('connection', `KICKED — raw type=${typeof reason} text="${text}" raw=${rawJson.slice(0, 500)}`);
      this.handleDisconnect('KICKED', text, options);
    });
    bot.on('error', (err: Error & { code?: string }) => {
      this.log.error('connection', `ERROR — ${err.message}${err.code ? ` (code=${err.code})` : ''}`);
      this.handleDisconnect('LOST_CONNECTION', err.message, options, err.code);
    });
    bot.on('end', (reason: string) => {
      this.log.warn('connection', `END — ${reason || 'disconnected (no reason given)'}`);
      this.handleDisconnect('LOST_CONNECTION', reason || 'disconnected', options);
    });
    bot.on('death', () => {
      this.log.warn('player', 'Bot died');
      this.store.patchPlayer({ health: 0 });
      this.emit('snapshot');
    });
    bot.on('respawn', () => {
      this.log.info('player', 'Bot respawned');
      this.pathfinder.cancel('respawn');
      this.control.releaseAllMovement();
      this.emit('snapshot');
    });
  }

  private async handleDisconnect(kindRaw: string, rawMessage: string, options: ConnectOptions, code?: string) {
    // Mineflayer emits kicked → end (and sometimes error) for a single
    // disconnect. Only the FIRST event may drive the lifecycle, otherwise
    // duplicate reconnect timers stack up and the bot join/leave-loops.
    if (this.disconnectHandled) {
      this.log.info('connection', `Duplicate disconnect event ignored (${kindRaw}: ${rawMessage}) — already handled`);
      return;
    }
    this.disconnectHandled = true;
    const combined = `${kindRaw} ${rawMessage}`;
    const reason = classifyError(combined, code);
    this.log.warn('connection', `Disconnected: ${reason} (${rawMessage})`);
    this.store.patchConnection({
      state: 'ERROR',
      lastDisconnect: reason,
      lastDisconnectMessage: rawMessage,
      lastDisconnectAt: Date.now(),
    });
    this.emit('snapshot');
    await this.destroyBot('disconnected');
    // AuthMe-style kick with no password configured: retrying cannot ever
    // succeed, so stop the loop and surface an actionable message instead.
    const looksLikeAuthKick = /not\s+authenticated|not\s+logged\s+in|please\s+(log\s?in|authenticate)|use\s+\/login|authentication\s+timeout|register/i.test(rawMessage);
    if (looksLikeAuthKick && !options.authPassword) {
      this.log.error('auth', 'Server kicked the bot for not authenticating (AuthMe-style plugin) and no in-game password is configured. Set "In-game password" in the dashboard or BOT_PASSWORD env, then Connect. Auto-reconnect stopped.');
      this.store.patchConnection({ state: 'ERROR', lastDisconnect: 'AUTH_REQUIRED' });
      this.backoff.attempt = 0;
      this.emit('snapshot');
      return;
    }
    if (isPermanent(reason)) {
      this.log.error('connection', 'Permanent disconnect — not auto-reconnecting. Update settings and click Connect.');
      this.store.patchConnection({ state: 'ERROR' });
      this.backoff.attempt = 0;
      this.emit('snapshot');
      return;
    }
    // "Already connected" or "keepAliveError" from a proxy: don't compound
    // the backoff — reset attempt counter so we don't wait an hour between
    // retries.
    if (reason === 'CONFLICTING_CONNECTION' || /keepalive|client timed out/i.test(reason)) {
      this.backoff.attempt = 1;
    }
    if (options.autoReconnect) {
      this.scheduleReconnect(options, rawMessage);
    } else {
      this.store.patchConnection({ state: 'OFFLINE' });
      this.emit('snapshot');
    }
  }

  private keepAliveTimer: NodeJS.Timeout | null = null;
  private lastMoveAt = 0;
  private positionWatchdog: NodeJS.Timeout | null = null;

  /**
   * Servers protected by AuthMe-style plugins kick players that never run
   * /login. If the user configured a password, authenticate right after
   * spawn. Never logs the password itself.
   */
  private runInGameAuth(bot: any, options: ConnectOptions) {
    const pw = options.authPassword ?? '';
    if (!pw) {
      this.log.info('auth', 'No in-game password configured — if the server requires /login, set "In-game password" in Settings');
      return;
    }
    const sendLogin = () => {
      try {
        bot.chat(`/login ${pw}`);
        this.log.success('auth', 'Sent in-game /login command');
      } catch (err) {
        this.log.warn('auth', `in-game login failed: ${(err as Error).message}`);
      }
    };
    setTimeout(sendLogin, 1200);
  }

  /**
   * Detect "not registered" / "not authenticated" prompts in chat and react
   * with /register or /login using the configured password.
   */
  private handleAuthPrompt(bot: any, text: string, options: ConnectOptions) {
    const pw = options.authPassword ?? '';
    if (!pw) return;
    const t = text.toLowerCase();
    if (/not\s+registered|register.*with|\/register/.test(t) && /register/.test(t)) {
      this.log.warn('auth', 'Server reports bot is not registered — sending /register');
      try {
        bot.chat(`/register ${pw} ${pw}`);
        this.log.success('auth', 'Sent in-game /register command');
        setTimeout(() => {
          try {
            bot.chat(`/login ${pw}`);
            this.log.success('auth', 'Sent in-game /login command after register');
          } catch {}
        }, 1500);
      } catch (err) {
        this.log.warn('auth', `in-game register failed: ${(err as Error).message}`);
      }
    } else if (/not\s+authenticated|not\s+logged\s+in|please (log ?in|authenticate)|use \/login|authentication\s+timeout/.test(t)) {
      this.log.warn('auth', 'Server reports bot is not authenticated — re-sending /login');
      try {
        bot.chat(`/login ${pw}`);
        this.log.success('auth', 'Sent in-game /login command (retry)');
      } catch {}
    }
  }

  /**
   * mc.238458.xyz is a proxy that aggressively times out clients that look
   * idle. The mineflayer `keepAliveInterval` only sends a tiny packet — some
   * proxies still consider the client idle. We re-send a small look packet
   * plus a position update to keep the socket warm.
   */
  private startKeepAliveLoop(bot: any) {
    if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
    this.lastMoveAt = Date.now();
    this.keepAliveTimer = setInterval(() => {
      if (!bot || !bot.entity) return;
      try {
        const yaw = bot.entity.yaw ?? 0;
        const pitch = bot.entity.pitch ?? 0;
        // Re-emit the look — this sends a small packet downstream.
        bot.look(yaw, pitch, true);
        // Force a position ack.
        if (typeof bot._client?.write === 'function' && bot._client?.state === 'PLAY') {
          // Some proxies drop the client if it stops sending the position
          // telemetry. The cleanest way to nudge the client is a no-op look
          // (above) plus an entity-action packet, which mineflayer emits on
          // jump / sneak. The simplest universal packet is the "look"
          // rotation, which we just did.
        }
      } catch (err) {
        this.log.debug('connection', `keepAlive look failed: ${(err as Error).message}`);
      }
    }, 4_000);
    this.keepAliveTimer.unref?.();

    // Watchdog: if the bot hasn't moved in 15s and we haven't manually
    // reconnected, force a tiny movement to keep the proxy happy.
    if (this.positionWatchdog) clearInterval(this.positionWatchdog);
    this.positionWatchdog = setInterval(() => {
      if (!bot || !bot.entity) return;
      const idle = Date.now() - this.lastMoveAt;
      if (idle > 15_000) {
        // Trigger a small jump — sends a position+rotation packet.
        try {
          const wasOnGround = !!bot.entity.onGround;
          if (wasOnGround) {
            bot.setControlState('jump', true);
            setTimeout(() => bot.setControlState('jump', false), 250);
            this.log.debug('connection', 'idle watchdog: triggered jump to keep socket warm');
          }
        } catch (err) {
          this.log.debug('connection', `idle watchdog failed: ${(err as Error).message}`);
        }
      }
    }, 5_000);
    this.positionWatchdog.unref?.();
  }

  private stopKeepAliveLoop() {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
    if (this.positionWatchdog) {
      clearInterval(this.positionWatchdog);
      this.positionWatchdog = null;
    }
  }

  private async startViewer(options: ConnectOptions): Promise<void> {
    if (!options.viewDistance || options.viewDistance <= 0) {
      this.store.patchViewer({ renderDistance: 0, ready: false });
      return;
    }
    try {
      const view = await this.viewerMgr.start(this.bot, options.viewDistance);
      this.view = view;
      const url = this.viewerMgr.baseUrl();
      this.store.patchViewer({ ready: true, socketConnected: true, viewerBaseUrl: url });
      this.log.success('viewer', `prismarine-viewer started at ${url}`);
      this.emit('viewer', this.store.get().viewer);
      this.emit('snapshot');
    } catch (err) {
      this.log.error('viewer', `Viewer failed to start: ${(err as Error).message}`);
      this.store.patchViewer({ lastError: (err as Error).message });
      this.emit('snapshot');
    }
  }

  async destroyBot(reason: string): Promise<void> {
    this.log.info('connection', `DESTROY_BOT — tearing down bot (${reason})`);
    this.stopKeepAliveLoop();
    if (this.viewCleanup) {
      try {
        await this.viewCleanup();
      } catch (err) {
        this.log.warn('viewer', `Viewer cleanup error: ${(err as Error).message}`);
      }
      this.viewCleanup = null;
      this.view = null;
    }
    if (this.bot) {
      try {
        this.bot.quit(reason);
      } catch (err) {
        this.log.warn('connection', `Bot quit error: ${(err as Error).message}`);
      }
      // Give the proxy server time to fully release our previous session
      // before a new connection attempt. mc.238458.xyz returns
      // "You are already connected to this proxy!" if we reconnect too fast.
      const b = this.bot;
      this.bot = null;
      try {
        await new Promise<void>((resolve) => {
          let done = false;
          const finish = () => { if (!done) { done = true; resolve(); } };
          b.once('end', finish);
          setTimeout(finish, 4000);
        });
      } catch {}
      try {
        b.removeAllListeners();
      } catch (err) {
        this.log.warn('connection', `Bot removeListeners error: ${(err as Error).message}`);
      }
    }
    this.store.patchViewer({ ready: false, socketConnected: false });
  }

  /** Apply control state from a browser session. */
  applyControl(partial: Partial<MovementStateMap>): void {
    if (!this.bot) return;
    for (const [k, v] of Object.entries(partial)) {
      if (typeof v !== 'boolean') continue;
      try {
        this.bot.setControlState(k, v);
      } catch (err) {
        this.log.warn('control', `setControlState(${k}) failed: ${(err as Error).message}`);
      }
    }
    this.store.patchControl({ movement: movementToMap(this.bot) });
    this.emit('snapshot');
  }

  emergencyStop(): void {
    this.log.warn('control', 'EMERGENCY STOP triggered');
    this.control.releaseAllMovement();
    if (this.bot) {
      try {
        this.bot.clearControlStates();
      } catch (err) {
        this.log.warn('control', `clearControlStates failed: ${(err as Error).message}`);
      }
    }
    this.pathfinder.cancel('emergency stop');
    this.store.patchControl({ movement: movementToMap(this.bot) });
    this.emit('snapshot');
  }

  setLook(yaw: number, pitch: number): void {
    if (!this.bot) return;
    const safeYaw = clampYaw(yaw);
    const safePitch = clampPitch(pitch);
    try {
      this.bot.look(safeYaw, safePitch, true);
    } catch (err) {
      this.log.warn('control', `look failed: ${(err as Error).message}`);
    }
    this.store.patchControl({ yaw: safeYaw, pitch: safePitch });
    this.emit('snapshot');
  }

  setHotbar(slot: number): void {
    if (!this.bot) return;
    const safe = normalizeHotbarSlot(slot);
    try {
      this.bot.setQuickBarSlot(safe);
    } catch (err) {
      this.log.warn('inventory', `setQuickBarSlot failed: ${(err as Error).message}`);
    }
    this.store.patchPlayer({ selectedHotbarSlot: safe });
    this.emit('snapshot');
  }

  chat(message: string): void {
    if (!this.bot) return;
    if (!message || typeof message !== 'string') return;
    try {
      this.bot.chat(message);
      // Never log the raw command if it carries the in-game password.
      if (/^\/(login|register|l)\s/i.test(message)) {
        this.log.info('chat', 'Sent auth command (contents redacted)');
      } else {
        this.log.info('chat', `Sent: ${message}`);
      }
    } catch (err) {
      this.log.warn('chat', `chat failed: ${(err as Error).message}`);
    }
  }

  respawn(): void {
    if (!this.bot) return;
    try {
      this.bot.respawn();
      this.log.info('player', 'Respawn requested');
    } catch (err) {
      this.log.warn('player', `Respawn failed: ${(err as Error).message}`);
    }
  }
}