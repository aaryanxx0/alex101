import { IncomingMessage } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type {
  ChatMessage,
  ClientCommand,
  ConnectOptions,
  ServerEvent,
  ViewerState,
} from '@alex101/shared';
import { isValidMovementState, makeId } from '@alex101/shared';
import type { LogManager } from './LogManager.js';
import type { BotStateStore } from './BotStateStore.js';
import type { ConfigManager } from './ConfigManager.js';
import type { MinecraftBotManager } from './MinecraftBotManager.js';
import type { ControlSessionManager } from './ControlSessionManager.js';
import type { PathfinderController } from './PathfinderController.js';
import { refreshInventory } from './InventoryManager.js';
import { refreshNearby } from './EntityTracker.js';

const TOKEN_TTL_MS = 1000 * 60 * 10;

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

function verifyToken(token: string, secret: string): { ok: boolean; exp: number; jti: string } {
  if (!token || !secret) return { ok: false, exp: 0, jti: '' };
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, exp: 0, jti: '' };
  const [jti, expStr, sig] = parts;
  const expected = sign(`${jti}.${expStr}`, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return { ok: false, exp: 0, jti: '' };
  const match = timingSafeEqual(a, b);
  if (!match) return { ok: false, exp: 0, jti: '' };
  const exp = Number(expStr);
  if (!Number.isFinite(exp)) return { ok: false, exp: 0, jti };
  if (Date.now() > exp) return { ok: false, exp, jti };
  return { ok: true, exp, jti };
}

export interface TokenIssuer {
  issue(controllerId: string): string;
  verify(token: string): boolean;
}

export function createTokenIssuer(secret: string): TokenIssuer {
  return {
    issue(controllerId: string) {
      const jti = randomBytes(8).toString('hex');
      const exp = Date.now() + TOKEN_TTL_MS;
      const sig = sign(`${jti}.${exp}`, secret);
      return `${jti}.${exp}.${sig}`;
    },
    verify(token: string) {
      const r = verifyToken(token, secret);
      return r.ok;
    },
  };
}

interface ClientSocket {
  ws: WebSocket;
  controllerId: string | null;
  controllerName: string | null;
  authenticated: boolean;
}

export interface RealtimeGatewayDeps {
  log: LogManager;
  store: BotStateStore;
  config: ConfigManager;
  bot: MinecraftBotManager;
  control: ControlSessionManager;
  pathfinder: PathfinderController;
  viewerBaseUrl: () => string;
}

/**
 * ws-based realtime gateway. Single dashboard <-> worker channel.
 * Auth is enforced by short-lived HMAC tokens issued by the dashboard.
 */
export class RealtimeGateway {
  private wss: WebSocketServer | null = null;
  private readonly clients = new Set<ClientSocket>();
  private readonly allowedOrigins = new Set<string>();
  private tokenIssuer: TokenIssuer | null = null;
  private throttlePositionTimer: NodeJS.Timeout | null = null;
  private throttleEntityTimer: NodeJS.Timeout | null = null;
  private lastBroadcastAt = 0;

  constructor(private readonly deps: RealtimeGatewayDeps) {}

  setTokenIssuer(issuer: TokenIssuer) {
    this.tokenIssuer = issuer;
  }

  allowOrigin(origin: string) {
    this.allowedOrigins.add(origin);
  }

  start(wss: WebSocketServer) {
    this.wss = wss;
    wss.on('connection', (ws: WebSocket, req: IncomingMessage) => this.handleConnection(ws, req));
    // Broadcast throttled snapshots.
    this.throttlePositionTimer = setInterval(() => {
      this.broadcastSnapshot();
    }, 100);
    this.throttlePositionTimer.unref?.();
    this.throttleEntityTimer = setInterval(() => {
      const bot = this.deps.bot.getBot();
      if (bot) refreshNearby(bot, this.deps.store);
    }, 2000);
    this.throttleEntityTimer.unref?.();
  }

  stop() {
    if (this.throttlePositionTimer) clearInterval(this.throttlePositionTimer);
    if (this.throttleEntityTimer) clearInterval(this.throttleEntityTimer);
    this.clients.forEach((c) => c.ws.close(1001, 'shutdown'));
    this.clients.clear();
    this.wss = null;
  }

  private handleConnection(ws: WebSocket, req: IncomingMessage) {
    const origin = req.headers.origin ?? '';
    if (!this.isOriginAllowed(origin)) {
      this.deps.log.warn('gateway', `WS_UPGRADE rejected — origin ${origin || '(none)'} not allowed (allowed: ${[...this.allowedOrigins].join(', ')})`);
      ws.close(1008, 'origin not allowed');
      return;
    }
    this.deps.log.info('gateway', `WS_UPGRADE accepted — origin=${origin || '(none)'}`);
    const client: ClientSocket = { ws, controllerId: null, controllerName: null, authenticated: false };
    this.clients.add(client);
    this.deps.log.info('gateway', `WS_CONNECTED (origin=${origin || 'none'}, clients=${this.clients.size})`);
    ws.on('message', (raw: Buffer | ArrayBuffer | Buffer[]) => {
      const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : Array.isArray(raw) ? Buffer.concat(raw).toString('utf8') : Buffer.from(raw as ArrayBuffer).toString('utf8');
      let msg: ClientCommand;
      try {
        msg = JSON.parse(text);
      } catch (err) {
        this.sendError(ws, 'BAD_JSON', 'Could not parse message as JSON.');
        return;
      }
      this.handleMessage(client, msg);
    });
    ws.on('close', (code: number, reason: Buffer) => {
      this.deps.log.info('gateway', `WS_CLOSED code=${code} reason=${reason?.toString?.() || 'none'}`);
      if (client.controllerId) this.deps.control.release(client.controllerId);
      this.clients.delete(client);
    });
    ws.on('error', (err) => {
      this.deps.log.warn('gateway', `WebSocket error: ${(err as Error).message}`);
    });
  }

  /**
   * Origin policy for the private dashboard:
   *  - exact matches from DASHBOARD_ORIGIN always allowed
   *  - any *.vercel.app dashboard deployment of this team allowed (single-user product;
   *    real authorization is the HMAC token, not the origin)
   *  - missing origin (server-to-server, curl) allowed
   */
  private isOriginAllowed(origin: string): boolean {
    if (!origin || origin === 'null') return true;
    if (this.allowedOrigins.has(origin) || this.allowedOrigins.has('*')) return true;
    try {
      const hostname = new URL(origin).hostname;
      if (hostname.endsWith('.vercel.app')) return true;
    } catch {}
    return false;
  }

  private handleMessage(client: ClientSocket, msg: ClientCommand) {
    if (!client.authenticated && msg.type !== 'hello') {
      this.sendError(client.ws, 'UNAUTHENTICATED', 'Send a hello message first.');
      return;
    }

    switch (msg.type) {
      case 'hello': {
        if (!this.tokenIssuer) {
          this.sendError(client.ws, 'NO_TOKEN_ISSUER', 'Token issuer is not configured.');
          return;
        }
        if (!this.tokenIssuer.verify(msg.token)) {
          this.sendError(client.ws, 'BAD_TOKEN', 'Token is invalid or expired.');
          return;
        }
        client.authenticated = true;
        client.controllerId = msg.controllerId;
        client.controllerName = msg.controllerName;
        const acquired = this.deps.control.acquire(client.controllerId, client.controllerName);
        this.deps.log.info('gateway', `WS_AUTHENTICATED controller=${client.controllerName} (${client.controllerId}) control=${acquired ? 'GRANTED' : 'read-only (held by another session)'}`);
        if (!acquired) {
          // Another browser owns control — still authenticate them as read-only.
        }
        this.sendWelcome(client);
        return;
      }
      case 'request-control': {
        if (!client.authenticated || !client.controllerId) {
          this.sendTo(client, { type: 'control-status', status: 'CONTROL_AUTH_REQUIRED', message: 'Authenticate first.' });
          return;
        }
        const controllerId = client.controllerId as string;
        const controllerName = client.controllerName as string;
        const current = this.deps.store.get().control;
        if (msg.take && current.controllerId && current.controllerId !== controllerId) {
          const heldById = current.controllerId;
          this.deps.log.warn('control', `Force takeover requested by ${controllerName} — releasing ${current.controllerName}`);
          this.deps.control.release(heldById);
        }
        const acquired = this.deps.control.acquire(controllerId, controllerName);
        if (acquired) {
          this.deps.log.info('control', `CONTROL_GRANTED → ${controllerName}`);
          this.sendTo(client, { type: 'control-status', status: 'CONTROL_GRANTED' });
        } else {
          this.deps.log.info('control', `CONTROL_DENIED → ${controllerName} (held by ${current.controllerName})`);
          this.sendTo(client, { type: 'control-status', status: 'CONTROL_DENIED', message: `Alex101 is controlled by another session${current.controllerName ? ` (${current.controllerName})` : ''}.` });
        }
        return;
      }
      case 'heartbeat': {
        if (client.controllerId === msg.controllerId && client.controllerId) {
          this.deps.control.heartbeat(client.controllerId);
        }
        return;
      }
      case 'request-snapshot': {
        this.sendSnapshot(client);
        return;
      }
      case 'connect': {
        if (!this.deps.control.isOwner(client.controllerId ?? '')) {
          this.sendError(client.ws, 'NOT_CONTROLLER', 'You must hold the control lock to connect.');
          return;
        }
        this.deps.log.info('gateway', `CONNECT command received from dashboard (requestId=${msg.requestId ?? 'n/a'})`);
        this.deps.bot.connect(msg.options, msg.requestId).catch((err) => {
          this.deps.log.error('gateway', `Connect failed: ${(err as Error).message}`);
        });
        return;
      }
      case 'disconnect': {
        if (!this.deps.control.isOwner(client.controllerId ?? '')) {
          this.sendError(client.ws, 'NOT_CONTROLLER', 'You must hold the control lock to disconnect.');
          return;
        }
        this.deps.bot.disconnect('browser requested').catch(() => undefined);
        return;
      }
      case 'reconnect': {
        const settings = this.deps.config.get();
        const options: ConnectOptions = {
          host: settings.host,
          port: settings.port,
          username: settings.username,
          version: settings.version,
          authMode: settings.authMode,
          autoReconnect: settings.autoReconnect,
          reconnectDelayMs: settings.reconnectDelayMs,
          viewDistance: settings.viewDistance,
          authPassword: settings.authPassword ?? '',
        };
        this.deps.bot.connect(options).catch(() => undefined);
        return;
      }
      case 'respawn': {
        this.deps.bot.respawn();
        return;
      }
      case 'movement': {
        if (!this.deps.control.isOwner(client.controllerId ?? '')) return;
        if (!isValidMovementState(msg.state)) {
          this.sendError(client.ws, 'BAD_MOVEMENT', 'Invalid movement payload.');
          return;
        }
        this.deps.bot.applyControl(msg.state);
        return;
      }
      case 'look': {
        if (!this.deps.control.isOwner(client.controllerId ?? '')) return;
        this.deps.bot.setLook(msg.yaw, msg.pitch);
        return;
      }
      case 'clear-movement': {
        if (!this.deps.control.isOwner(client.controllerId ?? '')) return;
        this.deps.bot.applyControl({ forward: false, back: false, left: false, right: false, jump: false, sprint: false, sneak: false });
        return;
      }
      case 'emergency-stop': {
        if (!this.deps.control.isOwner(client.controllerId ?? '')) return;
        this.deps.bot.emergencyStop();
        return;
      }
      case 'select-hotbar': {
        if (!this.deps.control.isOwner(client.controllerId ?? '')) return;
        this.deps.bot.setHotbar(msg.slot);
        return;
      }
      case 'chat': {
        if (!this.deps.control.isOwner(client.controllerId ?? '')) return;
        this.deps.bot.chat(msg.message);
        return;
      }
      case 'goto': {
        if (!this.deps.control.isOwner(client.controllerId ?? '')) return;
        const bot = this.deps.bot.getBot();
        this.deps.pathfinder.goto(bot, { x: msg.x, y: msg.y, z: msg.z });
        return;
      }
      case 'follow-player': {
        if (!this.deps.control.isOwner(client.controllerId ?? '')) return;
        const bot = this.deps.bot.getBot();
        this.deps.pathfinder.followPlayer(bot, msg.username, msg.distance);
        return;
      }
      case 'stop-follow': {
        this.deps.pathfinder.cancel('stopped by browser');
        return;
      }
      case 'come-to-player': {
        if (!this.deps.control.isOwner(client.controllerId ?? '')) return;
        const bot = this.deps.bot.getBot();
        if (!bot) return;
        const target = bot.players[msg.username];
        if (!target || !target.entity) {
          this.deps.log.warn('gateway', `Player ${msg.username} not found for come-to`);
          return;
        }
        const p = target.entity.position;
        this.deps.pathfinder.goto(bot, { x: p.x, y: p.y, z: p.z });
        return;
      }
      case 'look-at-player': {
        if (!this.deps.control.isOwner(client.controllerId ?? '')) return;
        const bot = this.deps.bot.getBot();
        this.deps.pathfinder.lookAtPlayer(bot, msg.username);
        return;
      }
      case 'look-at-coords': {
        if (!this.deps.control.isOwner(client.controllerId ?? '')) return;
        const bot = this.deps.bot.getBot();
        this.deps.pathfinder.lookAt(bot, { x: msg.x, y: msg.y, z: msg.z });
        return;
      }
      case 'cancel-navigation': {
        this.deps.pathfinder.cancel('browser cancel');
        return;
      }
      case 'set-settings': {
        const settings = this.deps.config.update(msg.settings);
        const bot = this.deps.bot.getBot();
        if (settings.viewDistance && bot?.viewer) {
          try { bot.viewer.setViewDistance(settings.viewDistance); } catch (err) {
            this.deps.log.warn('gateway', `setViewDistance failed: ${(err as Error).message}`);
          }
        }
        return;
      }
      case 'request-server-status': {
        this.deps.bot.snapshot(); // touch
        const conn = this.deps.store.get().connection;
        // Send a basic echo with current connection info (lightweight status ping)
        const status = {
          ts: Date.now(),
          host: conn.host,
          port: conn.port,
          online: !!this.deps.bot.getBot() && conn.state === 'SPAWNED',
          latencyMs: null as number | null,
          motd: null as string | null,
          versionName: conn.serverVersion,
          versionProtocol: null as number | null,
          playersOnline: null as number | null,
          playersMax: null as number | null,
          favicon: null as string | null,
          error: conn.state === 'OFFLINE' ? 'Bot is offline' : null,
        };
        this.sendTo(client, { type: 'snapshot', snapshot: { ...this.deps.bot.snapshot() } } as ServerEvent);
        this.deps.log.info('gateway', 'server-status sent (worker-only echo)');
        return;
      }
    }
  }

  private sendWelcome(client: ClientSocket) {
    const snapshot = this.deps.bot.snapshot();
    const recentLogs = this.deps.log.recent().slice(-50);
    const recentChat = this.deps.store.recentChat(50);
    const welcome: ServerEvent = {
      type: 'welcome',
      snapshot,
      recentLogs,
      recentChat,
    };
    this.sendTo(client, welcome);
    // The initial full snapshot is sent immediately on authentication — even
    // while the bot is OFFLINE — so the dashboard never waits on events.
    this.deps.log.info('gateway', `INITIAL_SNAPSHOT_SENT (bot state=${snapshot.connection.state}, logs=${recentLogs.length}, chat=${recentChat.length})`);
  }

  private sendSnapshot(client: ClientSocket) {
    this.sendTo(client, { type: 'snapshot', snapshot: this.deps.bot.snapshot() });
  }

  private sendError(ws: WebSocket, code: string, message: string) {
    this.sendTo({ ws } as any, { type: 'error', code, message });
  }

  private sendTo(client: ClientSocket, event: ServerEvent | { type: 'error'; code: string; message: string }) {
    if (client.ws.readyState !== WebSocket.OPEN) return;
    try {
      client.ws.send(JSON.stringify(event));
    } catch (err) {
      this.deps.log.warn('gateway', `send error: ${(err as Error).message}`);
    }
  }

  private broadcastSnapshot() {
    if (this.clients.size === 0) return;
    const now = Date.now();
    if (now - this.lastBroadcastAt < 90) return; // ~10fps max
    this.lastBroadcastAt = now;
    const event: ServerEvent = { type: 'snapshot', snapshot: this.deps.bot.snapshot() };
    const payload = JSON.stringify(event);
    for (const c of this.clients) {
      if (c.ws.readyState === WebSocket.OPEN) {
        try {
          c.ws.send(payload);
        } catch (err) {
          this.deps.log.warn('gateway', `broadcast error: ${(err as Error).message}`);
        }
      }
    }
  }

  /** Called by manager subscribers whenever a chat/log/snapshot event occurs. */
  pushChat(msg: ChatMessage) {
    const event: ServerEvent = { type: 'chat', message: msg };
    const payload = JSON.stringify(event);
    for (const c of this.clients) {
      if (c.ws.readyState === WebSocket.OPEN) {
        try { c.ws.send(payload); } catch {}
      }
    }
  }

  pushViewerState(state: ViewerState) {
    const event: ServerEvent = { type: 'viewer-status', viewer: state };
    const payload = JSON.stringify(event);
    for (const c of this.clients) {
      if (c.ws.readyState === WebSocket.OPEN) {
        try { c.ws.send(payload); } catch {}
      }
    }
  }
}