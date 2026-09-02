/**
 * End-to-end smoke: connect Alex101 to mc.238458.xyz using mineflayer.
 * Expected outcomes:
 *   - DNS resolves and TCP completes -> we see "connected" / "spawn"
 *   - Server reports a version, possibly incompatible -> we see "UnsupportedProtocolVersion"
 *   - Server rejects (whitelist) -> we see "kicked"
 *   - Network timeout -> we see "error"
 * All paths are acceptable — this test only validates the pipeline.
 */
import { createBot } from 'mineflayer';

const HOST = process.env.SMOKE_HOST || 'mc.238458.xyz';
const PORT = Number(process.env.SMOKE_PORT || 25565);
const VERSION = process.env.SMOKE_VERSION || '1.21.11';

console.log(`[smoke] connecting ${HOST}:${PORT} as Alex101 (mc ${VERSION})…`);
const start = Date.now();
const timer = setTimeout(() => {
  console.error('[smoke] hard timeout (30s) — exiting');
  process.exit(4);
}, 30000);

const bot = createBot({
  host: HOST,
  port: PORT,
  username: 'Alex101',
  version: VERSION,
  auth: 'offline',
  connectTimeout: 15000,
  hideErrors: false,
});

bot.on('login', () => {
  console.log(`[smoke] login packet received in ${Date.now() - start}ms`);
});

bot.on('spawn', () => {
  clearTimeout(timer);
  console.log(`[smoke] SPAWNED at ${bot.entity.position.x.toFixed(2)}, ${bot.entity.position.y.toFixed(2)}, ${bot.entity.position.z.toFixed(2)}`);
  bot.quit('smoke done');
  setTimeout(() => process.exit(0), 500);
});

bot.on('kicked', (reason: any) => {
  clearTimeout(timer);
  const out = typeof reason === 'string' ? reason : JSON.stringify(reason);
  console.log(`[smoke] KICKED: ${out}`);
  process.exit(0);
});

bot.on('disconnect', (packet: any) => {
  clearTimeout(timer);
  console.log(`[smoke] DISCONNECT packet: ${JSON.stringify(packet)}`);
  process.exit(0);
});

bot.on('end', (reason: string) => {
  clearTimeout(timer);
  console.log(`[smoke] END: ${reason}`);
  process.exit(0);
});

bot.on('error', (err: Error & { code?: string }) => {
  clearTimeout(timer);
  console.log(`[smoke] ERROR: ${err.message} code=${err.code ?? ''}`);
  process.exit(0);
});

bot.on('error', (err: Error) => {
  clearTimeout(timer);
  console.log(`[smoke] ERROR: ${err.message}`);
  process.exit(0);
});

bot.on('end', (reason: string) => {
  clearTimeout(timer);
  console.log(`[smoke] END: ${reason}`);
  process.exit(0);
});