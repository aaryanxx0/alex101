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
import dns from 'node:dns';

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
  /** Idempotent bot-ready latch (mineflayer spawn OR first play position packet). */
  private readyDone = false;
  /** Per-connection session id (mc-1, mc-2, ...) so logs never mix attempts. */
  private sessionCounter = 0;
  private sessionId = 'mc-0';
  /** Millisecond timeline for the current session (Phase 14 correlation). */
  private timeline: { create: number; spawn: number; firstAuthMsg: number; authSent: number; end: number } = { create: 0, spawn: 0, firstAuthMsg: 0, authSent: 0, end: 0 };
  /** Ring of recent packet names/states for disconnect diagnosis. */
  private packetRing: string[] = [];
  /** Keep-alive counters for the current session (inbound = server-sent). */
  private keepAliveIn = 0;
  private keepAliveOut = 0;

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
    this.sessionCounter++;
    this.sessionId = `mc-${this.sessionCounter}`;
    this.timeline = { create: 0, spawn: 0, firstAuthMsg: 0, authSent: 0, end: 0 };
    this.log.info('connection', `CONNECT_REQUEST session=${this.sessionId} requestId=${requestId ?? 'n/a'} host=${options.host}:${options.port} user=${options.username} autoReconnect=${options.autoReconnect}`);
    if (this.connecting) {
      this.log.warn('connection', `Connect requested while a connection attempt is already in flight session=${this.sessionId} — ignoring (idempotent)`);
      return;
    }
    if (this.bot) {
      this.log.warn('connection', `Connect requested while already connected session=${this.sessionId} — ignoring (idempotent)`);
      return;
    }
    // A manual START BOT cancels any scheduled reconnect so exactly one
    // attempt runs (reconnect logic itself is unchanged).
    if (this.backoff.timer) {
      clearTimeout(this.backoff.timer);
      this.backoff.timer = null;
      this.backoff.attempt = 0;
      this.log.info('connection', `Cancelled pending reconnect timer session=${this.sessionId} (manual start)`);
    }
    this.connecting = true;
    this.disconnectHandled = false;
    this.readyDone = false;
    this.resetAuthSession();
    this.backoff.stopped = false;
    // Password priority: 1) explicitly saved protected setting (worker config
    // or freshly typed in the dashboard), 2) BOT_PASSWORD env, 3) none.
    // NEVER any dashboard/JWT/worker secret.
    const savedPassword = this.config.get().authPassword || '';
    const resolvedPassword = options.authPassword || savedPassword || process.env.BOT_PASSWORD || '';
    const pwSource: 'dashboard' | 'dashboard(saved)' | 'environment' | 'missing' = options.authPassword
      ? 'dashboard'
      : savedPassword
        ? 'dashboard(saved)'
        : (process.env.BOT_PASSWORD ? 'environment' : 'missing');
    const pwLen = resolvedPassword.length;
    const effectiveOptions: ConnectOptions = {
      ...options,
      authPassword: resolvedPassword,
    };
    this.log.info('auth', `AUTH_PASSWORD_SOURCE=${pwSource} AUTH_PASSWORD_LENGTH=${pwLen} session=${this.sessionId}`);
    this.currentAuthPassword = effectiveOptions.authPassword ?? '';
    this.store.patchConnection({
      host: effectiveOptions.host,
      port: effectiveOptions.port,
      configuredUsername: effectiveOptions.username,
      minecraftVersion: effectiveOptions.version,
      authMode: effectiveOptions.authMode,
      autoReconnect: effectiveOptions.autoReconnect,
      authPasswordSet: pwSource !== 'missing',
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
    this.log.info('connection', `STOP BOT requested — manualDisconnect=true session=${this.sessionId} reason=${reason}`);
    if (this.backoff.timer) {
      clearTimeout(this.backoff.timer);
      this.backoff.timer = null;
    }
    this.control.releaseAllMovement();
    this.pathfinder.cancel('manual disconnect');
    await this.destroyBot(`disconnect (${reason})`, 'disconnect()');
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
    // IPv4 resolution: this server resolves to both A and AAAA. Render has no
    // working IPv6 route (TCP_TIMEOUT ~300ms via hostname), so resolve A first.
    // Purely a transport fix — no behavior/packet changes.
    let connectHost: string = options.host;
    try {
      const resolved = await dns.promises.lookup(options.host, { family: 4, all: false });
      if (resolved?.address) {
        connectHost = resolved.address;
        this.log.info('connection', `DNS_RESULT session=${this.sessionId} ${options.host} → ${connectHost} (IPv4)`);
      }
    } catch (err) {
      this.log.warn('connection', `DNS_RESULT session=${this.sessionId} IPv4 lookup failed (${(err as Error).message}) — using hostname`);
    }
    const createOpts: Record<string, unknown> = {
      host: connectHost,
      port: options.port,
      username: actualUsername,
      version: options.version,
      viewDistance: options.viewDistance,
      auth: options.authMode,
      hideErrors: false,
      connectTimeout: 60_000,
      // Render's free tier drops idle TCP sessions after ~30s. Keep the socket
      // busy with very frequent keep-alives.
      keepAliveInterval: 2000,
      closeTimeout: 5_000,
      respawn: true,
      // Vanilla clients never self-terminate on keep-alive silence — the
      // server is the authority. A 30s self-kill here murdered healthy
      // sessions ("client timed out after 30000 milliseconds"). Use a long,
      // bounded tolerance instead.
      checkTimeoutInterval: 180_000,
      // mc.238458.xyz is a proxy — make the bot handle the "already
      // connected" backoff gracefully.
      kickTimeout: 60_000,
    };
    if (token) createOpts.accessToken = token;
    if (options.authMode === 'offline') createOpts.auth = 'offline';

    this.log.info('connection', `Connecting to ${options.host}:${options.port} as ${actualUsername} (mc ${options.version}, ${options.authMode})`);

    const mineflayer = await import('mineflayer');
    let bot: any;
    this.timeline.create = Date.now();
    this.log.info('connection', `CREATE_BOT session=${this.sessionId} ts=${new Date().toISOString()}`);
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

    // ---- Packet tracing (name + state only; payload for interesting packets) ----
    this.packetRing = [];
    this.keepAliveIn = 0;
    this.keepAliveOut = 0;
    // Payloads are logged for low-frequency protocol events only. High-rate
    // packets (position/entity/keepalive) stay out so the log ring isn't flooded.
    const INTEREST = /^(open_sign_editor|open_window|open_screen|block_entity_data|block_update|block_action|update_sign|open_book|close_window|close_container|custom_payload|client_command|disconnect|kick_disconnect|chat_command|chat_message|select_known_packs|feature_flags|registry_data|login|success|set_compression)$/i;
    const trace = (dir: 'IN' | 'OUT', name: string, state: string, data?: any) => {
      const entry = `${new Date().toISOString()} ${dir} ${state}/${name}`;
      this.packetRing.push(entry);
      if (this.packetRing.length > 200) this.packetRing.shift();
      if (/keep_alive/i.test(name)) {
        if (dir === 'IN') this.keepAliveIn++; else this.keepAliveOut++;
      }
      // Mineflayer 4.38.0 does not always emit its own 'spawn' on newer
      // protocols (774). The first play-state position packet IS the spawn
      // signal — trigger the same idempotent ready path.
      if (dir === 'IN' && name === 'position' && state === 'play') {
        this.markBotReady(bot, options);
      }
      if (INTEREST.test(name)) {
        let detail = '';
        if (data) { try { detail = JSON.stringify(data); } catch { detail = '(unserializable)'; } }
        this.log.info('packet', `RAW_${dir}_PACKET session=${this.sessionId} name=${name} state=${state}${detail ? ` payload=${detail.slice(0, 300)}` : ''}`);
      }
    };
    try {
      bot._client.on('packet', (data: any, meta: any) => {
        trace('IN', meta?.name ?? '?', meta?.state ?? '?', data);
      });
      const origWrite = bot._client.write.bind(bot._client);
      bot._client.write = (name: string, data: any) => {
        trace('OUT', name, bot._client.state, data);
        return origWrite(name, data);
      };
    } catch (err) {
      this.log.warn('connection', `Packet trace hook failed: ${(err as Error).message}`);
    }

    bot.once('spawn', async () => {
      this.log.info('connection', `SPAWN event (mineflayer) session=${this.sessionId}`);
      await this.markBotReady(bot, options);
    });

    // Raw message preservation (Phase 2): log raw JSON + plain text.
    const logRawMessage = (label: string, jsonMsg: any, text: string) => {
      let rawJson = '';
      try { rawJson = typeof jsonMsg === 'string' ? jsonMsg : JSON.stringify(jsonMsg); } catch { rawJson = String(jsonMsg); }
      this.log.debug('chat', `RAW_${label} session=${this.sessionId} raw=${rawJson.slice(0, 400)} plain="${text.slice(0, 300)}"`);
    };

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
      logRawMessage('MESSAGE', jsonMsg, text);
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
      this.handleChatForAuth(bot, text);
      this.emit('snapshot');
    });

    bot.on('messagestr', (messageStr: string, _pos: any, jsonMsg: any) => {
      logRawMessage('MESSAGESTR', jsonMsg, messageStr);
      this.handleChatForAuth(bot, messageStr);
    });

    bot.on('systemChat', (jsonMsg: any, _pos: any) => {
      const text = jsonMsg?.toString ? jsonMsg.toString() : String(jsonMsg);
      logRawMessage('SYSTEMCHAT', jsonMsg, text);
      this.handleChatForAuth(bot, text);
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
      this.handleChatForAuth(bot, message);
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
      this.log.warn('connection', `KICKED session=${this.sessionId} raw type=${typeof reason} plain="${text}" raw=${rawJson.slice(0, 500)}`);
      this.handleDisconnect('SERVER_KICK', text, options);
    });
    bot.on('error', (err: Error & { code?: string }) => {
      this.log.error('connection', `ERROR session=${this.sessionId} message="${err.message}" code=${err.code ?? 'none'}`);
      this.handleDisconnect('ERROR', err.message, options, err.code);
    });
    bot.on('end', (reason: string) => {
      this.log.warn('connection', `END session=${this.sessionId} reason="${reason || 'disconnected (no reason given)'}"`);
      this.handleDisconnect('REMOTE_CLOSE', reason || 'disconnected', options);
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
      this.log.info('connection', `Duplicate disconnect event ignored session=${this.sessionId} (${kindRaw}: ${rawMessage}) — already handled`);
      return;
    }
    this.disconnectHandled = true;
    this.timeline.end = Date.now();

    // Phase 10: classify WHO caused the disconnect.
    const preSpawn = this.timeline.spawn === 0;
    let disconnectSource = 'REMOTE_CLOSE';
    if (kindRaw === 'SERVER_KICK') disconnectSource = 'SERVER_KICK';
    else if (['WAITING_FOR_PROMPT', 'LOGIN_REQUIRED', 'LOGIN_SENT', 'REGISTER_REQUIRED', 'REGISTER_SENT', 'AUTH_TIMEOUT', 'AUTH_FAILED'].includes(this.authState) && !preSpawn) disconnectSource = 'AUTH_PLUGIN';
    else if (preSpawn && (code === 'ETIMEDOUT' || code === 'ECONNRESET' || code === 'ECONNREFUSED' || code === 'EHOSTUNREACH')) disconnectSource = 'NETWORK';
    const combined = `${kindRaw} ${rawMessage}`;
    const reason = classifyError(combined, code);
    this.log.warn('connection', `Disconnected session=${this.sessionId} source=${disconnectSource} reason=${reason} raw="${rawMessage}" authState=${this.authState}`);
    this.log.warn('connection', `LAST_20_PACKETS session=${this.sessionId} [${this.packetRing.slice(-20).join(' | ')}]`);
    this.log.warn('connection', `KEEPALIVE_STATS session=${this.sessionId} serverSent(keepAliveIn)=${this.keepAliveIn} clientSent(keepAliveOut)=${this.keepAliveOut}`);
    if (this.timeline.spawn) {
      this.log.warn('connection', `TIMELINE session=${this.sessionId} CREATE→SPAWN=${this.timeline.spawn - this.timeline.create}ms SPAWN→END=${this.timeline.end - this.timeline.spawn}ms firstAuthMsg=${this.timeline.firstAuthMsg ? `${this.timeline.firstAuthMsg - this.timeline.spawn}ms after SPAWN` : 'never'} authSent=${this.timeline.authSent ? `${this.timeline.authSent - this.timeline.spawn}ms after SPAWN` : 'never'}`);
    }
    this.store.patchConnection({
      state: 'ERROR',
      lastDisconnect: disconnectSource === 'AUTH_PLUGIN' ? 'AUTH_REQUIRED' : reason,
      lastDisconnectMessage: `${disconnectSource}: ${rawMessage}`,
      lastDisconnectAt: Date.now(),
    });
    this.emit('snapshot');
    await this.destroyBot('disconnect cleanup', 'handleDisconnect');
    // Clear stale player/position/health/inventory/nearby data so the
    // dashboard shows offline state, not leftovers from the previous session.
    this.store.resetRuntime();
    this.emit('snapshot');
    // Auth failures/timeout are permanent — never loop on them.
    if (disconnectSource === 'AUTH_PLUGIN' || this.authState === 'AUTH_FAILED' || this.authState === 'AUTH_TIMEOUT') {
      this.log.error('connection', `AUTH_PLUGIN disconnect session=${this.sessionId} — not auto-reconnecting. Fix the in-game password, then press START BOT.`);
      this.store.patchConnection({ state: 'ERROR' });
      this.backoff.attempt = 0;
      this.emit('snapshot');
      return;
    }
    if (isPermanent(reason)) {
      this.log.error('connection', `Permanent disconnect session=${this.sessionId} — not auto-reconnecting. Update settings and click Connect.`);
      this.store.patchConnection({ state: 'ERROR' });
      this.backoff.attempt = 0;
      this.emit('snapshot');
      return;
    }
    // Proxy/server says another Alex101 session is active. Retrying can never
    // succeed until the stale session is cleared — STOP, no auto-reconnect.
    if (reason === 'CONFLICTING_CONNECTION') {
      this.log.error('connection', `CONNECTION_CONFLICT session=${this.sessionId} — "You are already connected to this proxy!" A stale/duplicate Alex101 session exists. Auto-reconnect STOPPED. Clear the session (wait, or ask the server owner), then START BOT.`);
      this.backoff.stopped = true;
      if (this.backoff.timer) { clearTimeout(this.backoff.timer); this.backoff.timer = null; }
      this.backoff.attempt = 0;
      this.store.patchConnection({
        state: 'CONNECTION_CONFLICT',
        lastDisconnect: 'CONFLICTING_CONNECTION',
        lastDisconnectMessage: 'Alex101 is already connected to the server/proxy. Stop the existing session or ask the server owner to clear the stale connection, then press START BOT.',
      });
      this.emit('snapshot');
      return;
    }
    // "keepAliveError" from a proxy: don't compound the backoff — reset
    // attempt counter so we don't wait an hour between retries.
    if (/keepalive|client timed out/i.test(reason)) {
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

  /* ------------------------------------------------------------------ */
  /* AuthMe state machine (the ONLY code path that sends /login //register) */
  /*
   * AUTH_UNKNOWN → WAITING_FOR_PROMPT → LOGIN_REQUIRED/REGISTER_REQUIRED
   *   → LOGIN_SENT/REGISTER_SENT → AUTHENTICATED
   *   → AUTH_FAILED | AUTH_TIMEOUT | AUTH_MISSING_PASSWORD
   */
  private authState = 'AUTH_UNKNOWN';
  private authTimer: NodeJS.Timeout | null = null;
  private lastAuthCommand: string | null = null;
  private lastAuthCommandAt = 0;
  private authAttemptCount = 0;
  private authRegisterCount = 0;
  private authLoginCount = 0;
  private static readonly AUTH_TIMEOUT_MS = 45_000;
  private static readonly AUTH_COMMAND_COOLDOWN_MS = 6_000;
  private static readonly MAX_AUTH_ATTEMPTS = 3;

  private resetAuthSession() {
    this.authState = 'AUTH_UNKNOWN';
    if (this.authTimer) { clearTimeout(this.authTimer); this.authTimer = null; }
    this.lastAuthCommand = null;
    this.lastAuthCommandAt = 0;
    this.authAttemptCount = 0;
    this.authRegisterCount = 0;
    this.authLoginCount = 0;
  }

  /** Persist the in-game auth state (visible separately in the dashboard). */
  private setAuthState(next: string) {
    if (this.authState === next) return; // no duplicate state-change logs
    this.authState = next;
    this.store.patchConnection({ authState: next });
  }

  /** Called on SPAWN. Waits for the server's AuthMe prompt — never blind-fires. */
  private startAuthFlow(bot: any, options: ConnectOptions) {
    this.resetAuthSession();
    this.setAuthState('WAITING_FOR_PROMPT');
    this.log.info('auth', `AUTH_STATE_CHANGE → WAITING_FOR_PROMPT session=${this.sessionId} (password source: ${options.authPassword ? 'configured' : 'MISSING'})`);
    // Single authentication timeout. Reset/cancelled by AUTHENTICATED or failure.
    this.authTimer = setTimeout(() => {
      if (this.authState !== 'AUTHENTICATED' && this.authState !== 'AUTH_FAILED' && this.authState !== 'AUTH_PASSWORD_REQUIRED') {
        this.setAuthState('AUTH_TIMEOUT');
        this.log.error('auth', `AUTH_STATE_CHANGE → AUTH_TIMEOUT session=${this.sessionId} after ${MinecraftBotManager.AUTH_TIMEOUT_MS}ms without authentication success. Stopping (no reconnect).`);
        this.authTimer = null;
        this.emit('snapshot');
      }
    }, MinecraftBotManager.AUTH_TIMEOUT_MS);
    this.authTimer.unref?.();
  }

  /** Missing password + server demands auth → clean stop, no reconnect loop. */
  private stopForMissingPassword(text: string) {
    this.setAuthState('AUTH_PASSWORD_REQUIRED');
    if (this.authTimer) { clearTimeout(this.authTimer); this.authTimer = null; }
    this.backoff.stopped = true;
    this.log.error('auth', `AUTH_PASSWORD_REQUIRED session=${this.sessionId} — server demands authentication but BOT_PASSWORD is not configured. Disconnecting cleanly (no reconnect loop). Set the password in Dashboard → Settings → "Minecraft server / AuthMe password", then START BOT.`);
    this.store.patchConnection({
      state: 'ERROR',
      lastDisconnect: 'AUTH_REQUIRED',
      lastDisconnectMessage: 'Alex101 requires an in-game server password. Open Settings → Minecraft server / AuthMe password, save it, then press START BOT.',
    });
    this.emit('snapshot');
    void this.destroyBot('auth password required', 'stopForMissingPassword').then(() => {
      this.store.resetRuntime();
      this.store.patchConnection({ state: 'OFFLINE' });
      this.emit('snapshot');
    });
  }

  /**
   * The single controller for EasyAuth/AuthMe. Classifies the prompt and sends
   * at most ONE command per type (register = exactly 1 per session, login ≤ 3),
   * with a cooldown so repeated server prompts never spam commands.
   */
  private handleChatForAuth(bot: any, text: string) {
    if (this.authState === 'AUTHENTICATED' || this.authState === 'AUTH_FAILED' || this.authState === 'AUTH_PASSWORD_REQUIRED') return;
    if (!text) return;
    const t = text.toLowerCase();
    if (this.timeline.firstAuthMsg === 0 && /(login|register|authenticat)/.test(t)) {
      this.timeline.firstAuthMsg = Date.now();
      this.log.info('auth', `AUTH_MESSAGE_RECEIVED session=${this.sessionId} (${this.timeline.spawn ? `${this.timeline.firstAuthMsg - this.timeline.spawn}ms after SPAWN` : 'pre-spawn'}) raw="${text.slice(0, 200)}"`);
    }

    // Success (register success also counts — EasyAuth usually auto-logs-in)
    if (/you are now authenticated|successfully logged in|login successful|logged in successfully|you are now logged in|successfully registered|registration successful|account registered/.test(t)) {
      if (this.authState !== 'AUTHENTICATED') {
        const wasRegister = /register/i.test(t);
        this.setAuthState('AUTHENTICATED');
        if (this.authTimer) { clearTimeout(this.authTimer); this.authTimer = null; }
        if (wasRegister) this.log.success('auth', `REGISTER_SUCCESS session=${this.sessionId} raw="${text.slice(0, 200)}"`);
        this.log.success('auth', `AUTHENTICATED_CONFIRMED session=${this.sessionId} raw="${text.slice(0, 200)}"`);
        this.emit('snapshot');
      }
      return;
    }

    // Incorrect password — critical, hard stop (never hammer the same password).
    if (/incorrect password|wrong password|invalid password/.test(t)) {
      this.setAuthState('AUTH_FAILED');
      if (this.authTimer) { clearTimeout(this.authTimer); this.authTimer = null; }
      this.backoff.stopped = true; // never retry the same wrong password
      this.log.error('auth', `AUTH_STATE_CHANGE → AUTH_FAILED session=${this.sessionId} server said: "${text.slice(0, 200)}". Server authentication rejected BOT_PASSWORD for Alex101. Auto-reconnect STOPPED — update the password and press START BOT.`);
      this.store.patchConnection({ state: 'ERROR', lastDisconnect: 'AUTH_REQUIRED', lastDisconnectMessage: 'Server authentication rejected BOT_PASSWORD for Alex101. Update the password in Settings, then START BOT.' });
      this.emit('snapshot');
      return;
    }

    // Registration explicitly requested
    if (/not registered|register (with|using)|use \/register/.test(t) && /register/.test(t)) {
      this.setAuthState('REGISTER_REQUIRED');
      if (!this.currentAuthPassword) {
        this.stopForMissingPassword(text);
        return;
      }
      this.sendAuthCommand(bot, 'register');
      return;
    }

    // Login requested
    if (/not authenticated|not logged in|please (log ?in|authenticate)|use \/login|use \/l\b|log ?in to authenticate|authentication timeout/.test(t)) {
      this.setAuthState('LOGIN_REQUIRED');
      if (!this.currentAuthPassword) {
        this.stopForMissingPassword(text);
        return;
      }
      this.sendAuthCommand(bot, 'login');
      return;
    }
  }

  /** Cooldown + per-type attempt-capped single-command sender. */
  private sendAuthCommand(bot: any, type: 'login' | 'register') {
    const pw = this.currentAuthPassword;
    if (!pw) { this.log.warn('auth', `AUTH_COMMAND_SKIPPED type=${type} session=${this.sessionId} — no password configured`); return; }
    const typeCap = type === 'register' ? 1 : 3; // register EXACTLY once per session
    const typeCount = type === 'register' ? this.authRegisterCount : this.authLoginCount;
    if (typeCount >= typeCap) {
      this.log.info('auth', `AUTH_COMMAND_SUPPRESSED type=${type} session=${this.sessionId} — already sent ${typeCount}× this session, waiting for server response`);
      return;
    }
    const since = Date.now() - this.lastAuthCommandAt;
    if (this.lastAuthCommand && since < MinecraftBotManager.AUTH_COMMAND_COOLDOWN_MS) {
      this.log.info('auth', `AUTH_COMMAND_SUPPRESSED type=${type} session=${this.sessionId} — last command ${this.lastAuthCommand} sent ${since}ms ago, waiting for result`);
      return;
    }
    const cmd = type === 'login' ? `/login ${pw}` : `/register ${pw} ${pw}`;
    this.authAttemptCount++;
    if (type === 'register') this.authRegisterCount++; else this.authLoginCount++;
    this.lastAuthCommand = type;
    this.lastAuthCommandAt = Date.now();
    this.timeline.authSent = Date.now();
    this.setAuthState(type === 'login' ? 'LOGIN_SENT' : 'REGISTER_SENT');
    this.log.info('auth', `AUTH_COMMAND_SENT session=${this.sessionId} type=${type} count=${type === 'register' ? this.authRegisterCount : this.authLoginCount} ts=${new Date().toISOString()} (contents redacted)`);
    try {
      bot.chat(cmd);
    } catch (err) {
      this.log.warn('auth', `AUTH_COMMAND_FAILED type=${type} session=${this.sessionId} error=${(err as Error).message}`);
    }
    // After a successful registration, log in once.
    if (type === 'register') {
      setTimeout(() => {
        if (this.authState === 'REGISTER_SENT' || this.authState === 'REGISTER_REQUIRED') {
          this.setAuthState('LOGIN_REQUIRED');
          this.sendAuthCommand(bot, 'login');
        }
      }, 2000);
    }
  }

  /** The one resolved password for the CURRENT connection (set in connect()). */
  private currentAuthPassword = '';

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

  /**
   * Idempotent "bot is in the world" path — driven by mineflayer's spawn event
   * OR the first play-state position packet (mineflayer 4.38.0 doesn't always
   * emit spawn on newer protocols like 774).
   */
  private async markBotReady(bot: any, options: ConnectOptions) {
    if (this.readyDone) return;
    this.readyDone = true;
    this.timeline.spawn = Date.now();
    this.log.success('connection', `SPAWN session=${this.sessionId} (${this.timeline.spawn - this.timeline.create}ms after CREATE_BOT, position=${bot.entity ? `${bot.entity.position.x.toFixed(1)},${bot.entity.position.y.toFixed(1)},${bot.entity.position.z.toFixed(1)}` : 'n/a'})`);
    this.store.patchConnection({ state: 'SPAWNED', actualUsername: bot.username ?? options.username });
    this.store.patchConnection({ serverVersion: bot.version ?? null });
    this.store.patchPosition({
      x: bot.entity?.position?.x ?? 0,
      y: bot.entity?.position?.y ?? 0,
      z: bot.entity?.position?.z ?? 0,
      yaw: bot.entity?.yaw ?? 0,
      pitch: bot.entity?.pitch ?? 0,
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
    // AuthMe state machine: wait for the server's prompt, classify it, then
    // send exactly ONE appropriate command. Never blind-fire /login on spawn.
    this.startAuthFlow(bot, options);
    this.emit('snapshot');
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

  async destroyBot(reason: string, caller = 'unknown'): Promise<void> {
    this.log.info('connection', `DESTROY_BOT session=${this.sessionId} reason=${reason} caller=${caller}`);
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