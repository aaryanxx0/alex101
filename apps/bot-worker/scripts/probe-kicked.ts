import { createBot } from 'mineflayer';

const bot = createBot({
  host: 'mc.238458.xyz',
  port: 25565,
  username: 'Alex101',
  version: '1.21.11',
  auth: 'offline',
});

bot.on('kicked', (reason: any) => {
  console.log(`TYPE=${typeof reason}`);
  console.log(`CTOR=${reason?.constructor?.name}`);
  console.log(`RAW=${reason}`);
  if (typeof reason === 'object') {
    console.log(`KEYS=${Object.keys(reason).join(',')}`);
    console.log(`JSON=${JSON.stringify(reason).slice(0, 500)}`);
    console.log(`toString=${String(reason)}`);
  }
  process.exit(0);
});

bot.on('error', (err) => { console.log(`ERR=${err.message}`); process.exit(0); });

setTimeout(() => process.exit(0), 25000);