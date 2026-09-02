/**
 * Smoke test: initiate a TCP connection to mc.238458.xyz and read the server
 * status ping (no authentication, no join). This validates DNS, network and
 * that the server is online. We do NOT join the Minecraft server from this
 * test (that requires whitelist).
 */
import * as mc from 'minecraft-protocol';
import { Client } from 'minecraft-protocol';

const HOST = process.env.SMOKE_HOST || 'mc.238458.xyz';
const PORT = Number(process.env.SMOKE_PORT || 25565);
const TIMEOUT = Number(process.env.SMOKE_TIMEOUT || 8000);

console.log(`[smoke] status ping ${HOST}:${PORT} (timeout ${TIMEOUT}ms)…`);
const start = Date.now();
const timer = setTimeout(() => {
  console.error('[smoke] timeout — server unreachable or slow');
  process.exit(2);
}, TIMEOUT);

const client: Client = mc.createClient({
  host: HOST,
  port: PORT,
  username: 'Alex101_smoke',
  connectTimeout: TIMEOUT,
  keepAlive: false,
  version: false, // status-only; version negotiation skipped
});

client.on('error', (err) => {
  clearTimeout(timer);
  console.error(`[smoke] error: ${err.message}`);
  process.exit(3);
});

client.on('response', (data: any) => {
  clearTimeout(timer);
  const latency = Date.now() - start;
  console.log(`[smoke] latency=${latency}ms version=${data.version?.name} protocol=${data.version?.protocol} online=${data.players?.online}/${data.players?.max}`);
  console.log(`[smoke] motd=${(data.description?.text ?? JSON.stringify(data.description)).slice(0, 200)}`);
  client.end();
  process.exit(0);
});