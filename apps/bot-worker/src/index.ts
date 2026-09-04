import express, { type Request, type Response } from 'express';
import compression from 'compression';
import { createServer, request as httpRequest } from 'node:http';
import net from 'node:net';
import { WebSocketServer } from 'ws';
import { LogManager } from './LogManager.js';
import { ConfigManager } from './ConfigManager.js';
import { BotStateStore } from './BotStateStore.js';
import { AuthManager } from './AuthManager.js';
import { MinecraftBotManager } from './MinecraftBotManager.js';
import { ViewerManager } from './ViewerManager.js';
import { PathfinderController } from './PathfinderController.js';
import { ControlSessionManager } from './ControlSessionManager.js';
import { RealtimeGateway, createTokenIssuer } from './RealtimeGateway.js';
import { refreshInventory } from './InventoryManager.js';
import { classifyError } from './errorClassifier.js';
import dns from 'node:dns';
import { DEFAULT_SETTINGS, makeId } from '@alex101/shared';

const HOST = process.env.BOT_WORKER_HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || process.env.BOT_WORKER_PORT || 4000);
const VIEWER_PORT = Number(process.env.BOT_WORKER_VIEWER_PORT || 4001);
// prismarine-viewer binds only to loopback; browsers reach it through the
// same public port via /viewer and /socket.io proxies below.
const VIEWER_INTERNAL_HOST = '127.0.0.1';
const DASHBOARD_ORIGIN = process.env.DASHBOARD_ORIGIN || '';
const SECRET = process.env.BOT_WORKER_SECRET || '';

if (!SECRET) {
  console.error('FATAL: BOT_WORKER_SECRET is required to issue WebSocket tokens.');
  process.exit(1);
}

async function main() {
  const WORKER_INSTANCE_ID = `w-${Math.random().toString(16).slice(2, 6)}`;
  const log = new LogManager();
  log.setPrefix(WORKER_INSTANCE_ID);
  log.info('worker', `Worker instance starting id=${WORKER_INSTANCE_ID} pid=${process.pid} AUTO_CONNECT=${process.env.AUTO_CONNECT ?? '1'}`);
  const config = new ConfigManager(process.env.BOT_WORKER_CONFIG || './data/settings.json');
  const store = new BotStateStore();
  const auth = new AuthManager(log);
  const viewer = new ViewerManager(log, { host: VIEWER_INTERNAL_HOST, port: VIEWER_PORT });
  const control = new ControlSessionManager(log, store);
  const pathfinder = new PathfinderController(log, store);
  const bot = new MinecraftBotManager(log, store, config, auth, viewer, pathfinder, control);

  // token issuer
  const issuer = createTokenIssuer(SECRET);

  // Wss server attached to express
  const app = express();
  app.use(compression());
  app.use(express.json({ limit: '64kb' }));

  /**
 * Public health route. Used by:
 *  - UptimeRobot / cron-job.org keepalive pingers (no auth required)
 *  - Vercel /api/keepalive proxy
 *  - The dashboard's "Heartbeat" indicator
 *
 * Only exposes non-sensitive information.
 */
app.get('/health', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      uptimeMs: process.uptime() * 1000,
      connection: store.get().connection.state,
      viewerBaseUrl: viewer.baseUrl(),
      viewerReady: store.get().viewer.ready,
    });
  });

  /**
 * Token-protected routes — require x-bot-worker-secret to match SECRET.
 */
  app.post('/auth/token', (req: Request, res: Response) => {
    const provided = req.headers['x-bot-worker-secret'];
    if (typeof provided !== 'string' || provided !== SECRET) {
      res.status(401).json({ error: 'invalid shared secret' });
      return;
    }
    const controllerId = String(req.body?.controllerId || makeId('ctrl'));
    const token = issuer.issue(controllerId);
    // Build the public same-origin viewer URL from the request host so the
    // dashboard iframe always targets https://<worker>/viewer (single port).
    const xfHost = String(req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`);
    const xfProto = String(req.headers['x-forwarded-proto'] || (xfHost.includes('localhost') ? 'http' : 'https'));
    res.json({ token, controllerId, viewerBaseUrl: `${xfProto}://${xfHost}/viewer` });
  });

  app.get('/snapshot', (req: Request, res: Response) => {
    const provided = req.headers['x-bot-worker-secret'];
    if (typeof provided !== 'string' || provided !== SECRET) {
      res.status(401).json({ error: 'invalid shared secret' });
      return;
    }
    res.json(bot.snapshot());
  });

  app.get('/debug/last-disconnect', (req: Request, res: Response) => {
    const provided = req.headers['x-bot-worker-secret'];
    if (typeof provided !== 'string' || provided !== SECRET) {
      res.status(401).json({ error: 'invalid shared secret' });
      return;
    }
    const conn = store.get().connection;
    res.json({
      state: conn.state,
      lastDisconnect: conn.lastDisconnect,
      lastDisconnectMessage: conn.lastDisconnectMessage,
      lastDisconnectAt: conn.lastDisconnectAt,
      reconnectAttempts: conn.reconnectAttempts,
      recentLogs: log.recent().slice(-30),
    });
  });

  /**
   * Network diagnostic (Phase 13): DNS A/AAAA/SRV + raw TCP reachability from
   * the worker's own environment. Controlled — performs one TCP test per call.
   */
  app.get('/debug/network', async (req: Request, res: Response) => {
    const provided = req.headers['x-bot-worker-secret'];
    if (typeof provided !== 'string' || provided !== SECRET) {
      res.status(401).json({ error: 'invalid shared secret' });
      return;
    }
    const host = String(req.query.host || config.get().host || 'mc.238458.xyz');
    const port = Number(req.query.port || config.get().port || 25565);
    const tcpTest = (targetHost: string, targetPort: number, timeoutMs = 12_000) => new Promise<{ result: string; elapsedMs: number; ip?: string }>((resolve) => {
      const started = Date.now();
      const socket = new net.Socket();
      const done = (result: string, ip?: string) => {
        socket.destroy();
        resolve({ result, elapsedMs: Date.now() - started, ip });
      };
      socket.setTimeout(timeoutMs);
      socket.once('connect', () => done('TCP_CONNECTED'));
      socket.once('timeout', () => done('TCP_TIMEOUT'));
      socket.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'ECONNREFUSED') done('TCP_REFUSED', undefined);
        else if (err.code === 'ETIMEDOUT') done('TCP_TIMEOUT');
        else done(`TCP_ERROR:${err.code ?? err.message}`);
      });
      socket.connect(targetPort, targetHost);
    });
    const r4 = dns.promises.resolve4(host).catch((e) => [`DNS_ERROR:${e.code ?? e.message}`]);
    const r6 = dns.promises.resolve6(host).catch((e) => [`DNS_ERROR:${e.code ?? e.message}`]);
    const srv = dns.promises.resolveSrv(`_minecraft._tcp.${host}`).catch((e) => [{ error: `DNS_ERROR:${e.code ?? e.message}` }]);
    const [a, aaaa, srvRecords] = await Promise.all([r4, r6, srv]);
    const tcpHostname = await tcpTest(host, port);
    const firstA = Array.isArray(a) && a.length > 0 && !String(a[0]).startsWith('DNS_ERROR') ? (a[0] as string) : null;
    const tcpIpv4 = firstA ? await tcpTest(firstA, port) : null;
    res.json({ host, port, dnsA: a, dnsAAAA: aaaa, dnsSrv: srvRecords, tcpHostname, tcpIpv4, testedAt: new Date().toISOString() });
  });

  // Catch-all error handler
  app.use((err: Error, _req: Request, res: Response, _next: any) => {
    log.error('http', err.message);
    res.status(500).json({ error: err.message });
  });

  const httpServer = createServer(app);

  // --- Same-origin viewer proxy (single public port) ---
  // HTTP: /viewer/* and /socket.io/* → 127.0.0.1:VIEWER_PORT
  const proxyViewerHttp = (req: Request, res: Response) => {
    const proxyReq = httpRequest(
      {
        host: VIEWER_INTERNAL_HOST,
        port: VIEWER_PORT,
        path: req.url,
        method: req.method,
        headers: { ...req.headers, host: `${VIEWER_INTERNAL_HOST}:${VIEWER_PORT}` },
      },
      (pres) => {
        if (!pres.statusCode) { res.status(502).end(); return; }
        res.writeHead(pres.statusCode, pres.headers);
        pres.pipe(res);
      },
    );
    proxyReq.on('error', (err) => {
      log.warn('viewer', `proxy error: ${err.message}`);
      if (!res.headersSent) res.status(502).json({ error: 'viewer not running' });
      else res.end();
    });
    req.pipe(proxyReq);
  };
  app.use(['/viewer', '/socket.io'], proxyViewerHttp);

  // --- Manual upgrade routing ---
  const wss = new WebSocketServer({ noServer: true });
  httpServer.on('upgrade', (req, socket, head) => {
    let pathname = '';
    try { pathname = new URL(req.url || '/', 'http://internal').pathname; } catch {}
    if (pathname === '/ws') {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    } else if (pathname.startsWith('/socket.io')) {
      const upstream = net.connect(VIEWER_PORT, VIEWER_INTERNAL_HOST, () => {
        const headerLines = [`GET ${req.url} HTTP/1.1`];
        for (let i = 0; i < req.rawHeaders.length; i += 2) {
          headerLines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
        }
        upstream.write(headerLines.join('\r\n') + '\r\n\r\n');
        if (head?.length) upstream.write(head);
        socket.pipe(upstream);
        upstream.pipe(socket);
      });
      upstream.on('error', () => socket.destroy());
      socket.on('error', () => upstream.destroy());
    } else {
      socket.destroy();
    }
  });

  const gateway = new RealtimeGateway({ log, store, config, bot, control, pathfinder, viewerBaseUrl: () => `${VIEWER_INTERNAL_HOST}:${VIEWER_PORT}` });
  gateway.setTokenIssuer(issuer);
  if (DASHBOARD_ORIGIN) {
    for (const origin of DASHBOARD_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean)) {
      gateway.allowOrigin(origin);
    }
  }
  gateway.allowOrigin('null'); // file:// debug
  gateway.start(wss);

  // Wire manager events → gateway push
  bot.on('chat', (msg: any) => {
    gateway.pushChat(msg);
  });
  bot.on('viewer', (state: any) => {
    gateway.pushViewerState(state);
  });

  // Expose whether an AuthMe password is configured (value never leaves worker).
  {
    const settings = config.get();
    store.patchConnection({ authPasswordSet: !!settings.authPassword || !!process.env.BOT_PASSWORD });
  }

  // Patch bot to refresh inventory & nearby on relevant events
  bot.on('snapshot', () => {
    const liveBot = bot.getBot();
    if (liveBot) refreshInventory(liveBot, store);
  });

  // Pathfinding status updates
  pathfinder.on('status', (status: any) => {
    log.debug('pathfinder', `status=${status}`);
  });

  // Ping sampling
  setInterval(() => {
    const liveBot = bot.getBot();
    if (!liveBot || !liveBot.player) return;
    const ping = liveBot.player.ping;
    store.setPing({ ts: Date.now(), ms: typeof ping === 'number' ? ping : null });
  }, 3000).unref?.();

  httpServer.listen(PORT, HOST, () => {
    log.success('worker', `Alex101 bot-worker listening on ${HOST}:${PORT}`);
    log.info('worker', `prismarine-viewer will attach at ${viewer.baseUrl()} when a bot connects`);
    log.info('worker', `Dashboard origin allowed: ${DASHBOARD_ORIGIN || '* (all)'}`);
    if (process.env.AUTO_CONNECT !== '0') {
      const settings = config.get();
      if (settings.host && settings.username) {
        log.info('worker', `AUTO_CONNECT enabled — connecting to ${settings.host}:${settings.port} as ${settings.username}`);
        bot.connect({
          host: settings.host,
          port: settings.port,
          username: settings.username,
          version: settings.version,
          authMode: settings.authMode,
          autoReconnect: settings.autoReconnect,
          reconnectDelayMs: settings.reconnectDelayMs,
          viewDistance: settings.viewDistance,
          authPassword: settings.authPassword ?? '',
        }).catch((err) => log.error('worker', `AUTO_CONNECT failed: ${err.message}`));
      } else {
        log.warn('worker', 'No settings found; open the dashboard to configure and click Connect.');
      }
    }
  });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    log.warn('worker', `Received ${signal} — shutting down`);
    try {
      await bot.disconnect(`shutdown (${signal})`);
    } catch {}
    control.dispose();
    gateway.stop();
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Avoid surprises
  process.on('unhandledRejection', (err) => {
    log.error('worker', `unhandledRejection: ${(err as Error)?.message ?? String(err)}`);
  });
  process.on('uncaughtException', (err) => {
    log.error('worker', `uncaughtException: ${err.message}\n${err.stack ?? ''}`);
  });

  // Expose classifyError for quick debug logging
  void classifyError;
  void DEFAULT_SETTINGS;
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});