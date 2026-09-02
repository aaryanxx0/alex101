# Alex101 — Browser-controlled Minecraft Java Bot

A real **Mineflayer** bot called **Alex101** that connects to a Minecraft Java
server (`mc.238458.xyz`) and streams its world to your browser as a live
first-person WebGL canvas. You control it with **WASD + mouse + Space/Shift/Ctrl**
exactly like Minecraft.

The dashboard is a **Next.js** app deployed on **Vercel**. The persistent
Mineflayer process lives on a separate worker (Docker-ready for **Railway /
Render / Fly.io / Koyeb / VPS / your PC**) — Vercel Functions cannot host the
long-lived Minecraft TCP connection.

```
Browser ── HTTPS ──▶ Vercel (dashboard, auth, settings)
   │                         │
   │                       (short-lived signed token)
   │                         ▼
   └──── WebSocket ──▶  Bot Worker (Node.js)
                              │
                              ▼
                         Mineflayer
                              │
                              ▼
                       mc.238458.xyz (1.21.11)
```

---

## Highlights

- **Live first-person 3D viewport** via the official
  [`prismarine-viewer`](https://github.com/PrismarineJS/prismarine-viewer) WebGL
  renderer running inside the worker. The dashboard embeds the canvas in an
  iframe and overlays an in-game HUD (crosshair, health, food, XP, hotbar,
  coordinates, ping, dimension, etc.).
- **Real WASD + mouse control** — keyboard and pointer-lock events on the
  dashboard are forwarded through the worker to the Mineflayer
  `setControlState()` and `look()` APIs.
- **Movement safety** — heartbeat timeout, focus / visibility loss clears
  every key, dedicated **EMERGENCY STOP** button, never lets the bot walk
  forever if a keyup is missed.
- **Minecraft 1.21.11 connection** — the worker uses the latest `mineflayer@4.38.0`,
  `minecraft-data@3.115.0`, `minecraft-protocol@1.67.0` which already include the
  1.21.11 protocol definition. The version is pinned in `apps/bot-worker/package.json`
  so a future npm update cannot silently break protocol negotiation.
- **Pathfinding** with `mineflayer-pathfinder` 2.4.5 — *Go to X/Y/Z*, *Follow
  player*, *Look at player/coordinates*, with a navigable state machine
  (`IDLE → CALCULATING → MOVING → ARRIVED/FAILED/UNREACHABLE/CANCELLED`).
  Block breaking is disabled for safety.
- **Auth modes** — `offline` (works when the server permits), or
  `microsoft` using the official **device-code flow** via `prismarine-auth`.
  Passwords are never collected through the website.
- **Whitelist detection** — if the Minecraft server's whitelist rejects the
  bot, the dashboard surfaces the actual server message and stops reconnecting.
  No bypass is attempted.
- **Logs** — structured, ring-buffered, filterable, downloadable, with
  automatic redaction of access/refresh tokens and passwords.
- **Dashboard auth** — password protected with a HttpOnly + Secure + SameSite
  session cookie signed by HMAC-SHA256.
- **Worker security** — the WebSocket accepts only HMAC-signed short-lived
  (10-minute) tokens minted by the dashboard's server-side route.

---

## 1.21.11 viewer compatibility — what was done

`prismarine-viewer` 1.33.0 (latest release, Feb 2025) is the only viewer that
ships first-person WebGL out of the box. Two upstream issues affect the master
branch:

1. webpack 5.110.x + the bundled `three@0.128.0`'s incorrect
   `sideEffects: false` cause `OrbitControls` to be tree-shaken out of the
   browser bundle (see `PrismarineJS/prismarine-viewer` PR #489).
2. The renderer's `worker.js` and `models.js` hardcode the pre-1.18
   `[0, 256)` Y range, so any world below y=0 is culled (PR #488).

**What this repo does**

- Installs `prismarine-viewer@1.33.0` and uses its published assets, which
  avoid the unmerged webpack master issue.
- Calls `mineflayerViewer(bot, { port: BOT_WORKER_VIEWER_PORT, viewDistance,
  firstPerson: true })` from inside the worker; the viewer attaches its
  Express + socket.io server on a separate port.
- The dashboard embeds the viewer URL in an iframe (`viewer-iframe`),
  letting the renderer's existing socket.io/WebGL pipeline stream chunks.
- If the upstream PRs (#488, #489) eventually land we just bump the version
  in `apps/bot-worker/package.json`; nothing custom is in our way.

If a particular block/entity fails to render (e.g. a new 1.21.11 mob),
`prismarine-viewer` falls back gracefully to a missing-texture cube and the
dashboard keeps running — no crash.

---

## Project layout

```
alex101/
├── apps/
│   ├── dashboard/        Next.js 14 dashboard (Vercel-ready)
│   └── bot-worker/       Persistent Mineflayer process (Docker-ready)
├── packages/
│   └── shared/           Cross-process TypeScript types + helpers
├── Dockerfile            Bot worker container
├── docker-compose.yml    Local Docker compose
├── railway.json          Railway deploy
├── render.yaml           Render deploy
├── fly.toml              Fly.io deploy
├── package.json          Workspaces (npm workspaces)
├── tsconfig.base.json
├── .env.example
└── README.md
```

---

## Environment variables

Copy `.env.example` to `.env` for local development.

### Dashboard (Vercel)

| Var | Purpose |
| --- | --- |
| `JWT_SIGNING_SECRET` | ≥32 random chars. Signs the dashboard session cookie **and** is used by the worker to mint WebSocket tokens. |
| `DASHBOARD_PASSWORD` / `DASHBOARD_PASSWORD_HASH` | Login password. Prefer the hash in production. |
| `BOT_WORKER_URL` | Public URL of the bot worker (e.g. `https://alex101-bot.example.com`). |
| `BOT_WORKER_SECRET` | Shared secret. **Must match the worker `BOT_WORKER_SECRET`.** |
| `DASHBOARD_ORIGIN` | Allowed browser origin for the worker WebSocket. |

### Bot worker (Railway / Render / Fly.io / VPS)

| Var | Purpose |
| --- | --- |
| `BOT_WORKER_HOST` | Bind address (use `0.0.0.0` for Docker/Railway/Render). |
| `BOT_WORKER_PORT` | HTTP + WebSocket port (default `4000`). |
| `BOT_WORKER_VIEWER_PORT` | prismarine-viewer port (default `4001`). |
| `BOT_WORKER_SECRET` | Shared secret. **Must match the dashboard.** |
| `BOT_WORKER_CONFIG` | Path to persistent settings file (volume-mount in containers). |
| `AUTO_CONNECT` | `1` to auto-connect on boot, `0` to wait for the dashboard. |
| `DASHBOARD_ORIGIN` | Browser origin allowed to open the WebSocket. |
| `DEFAULT_MC_HOST` / `DEFAULT_MC_PORT` / `DEFAULT_MC_USERNAME` / `DEFAULT_MC_VERSION` / `DEFAULT_MC_AUTH` / `VIEW_DISTANCE` | Defaults for the first auto-connect. |

---

## Local development

```bash
# 1) install everything
npm install --workspaces=false
npm install --workspaces

# 2) build the shared package once
npm run build:shared

# 3) start the worker (terminal A)
BOT_WORKER_SECRET=devsecret \
JWT_SIGNING_SECRET=dev-session-secret-dev-session-secret \
BOT_WORKER_CONFIG=./data/settings.json \
DEFAULT_MC_HOST=mc.238458.xyz \
npm run dev:worker

# 4) start the dashboard (terminal B)
BOT_WORKER_URL=http://localhost:4000 \
BOT_WORKER_SECRET=devsecret \
JWT_SIGNING_SECRET=dev-session-secret-dev-session-secret \
DASHBOARD_PASSWORD=alex101 \
npm run dev:dashboard
```

Then open <http://localhost:3000/login>, enter `alex101`, and you should land on
the dashboard.

> The viewer (port 4001) is opened in an iframe from the dashboard once a bot
> is connected. If you want to see it standalone, visit
> <http://localhost:4001>.

---

## Production deploy

### Dashboard → Vercel

```bash
cd apps/dashboard
vercel --prod
```

Set these environment variables in the Vercel project:

```
JWT_SIGNING_SECRET = <32+ random chars>
DASHBOARD_PASSWORD = alex101   # (or DASHBOARD_PASSWORD_HASH in production)
BOT_WORKER_URL     = https://alex101-bot.example.com
BOT_WORKER_SECRET  = <the same secret the worker uses>
DASHBOARD_ORIGIN   = https://alex101.vercel.app
```

> Vercel free/hobby plans **can** run the dashboard, but the persistent bot
> must live elsewhere (Vercel Functions are short-lived and time out).

### Bot worker → Render (free plan, kept awake)

The included `render.yaml` deploys the worker as a Render Web Service. Render's
free tier **spins down the container after 15 minutes of no incoming HTTP
traffic**, which would disconnect Alex101 from `mc.238458.xyz`. To prevent
that, point an external keepalive pinger at the dashboard so the worker
receives an HTTP request at least once every 10 minutes.

Two options, both free:

**Option A — UptimeRobot (recommended, easiest)**

1. Sign up at <https://uptimerobot.com> (free plan).
2. Add a new monitor:
   - **Type**: HTTP(s)
   - **Friendly name**: Alex101 worker keepalive
   - **URL**: `https://<your-vercel-app>.vercel.app/api/keepalive`
     (the Vercel dashboard URL, NOT the Render URL — this keeps the cookie-auth
     gate from blocking the ping and the Vercel route in turn forwards to the worker).
   - **Monitoring interval**: 10 minutes
3. UptimeRobot will hit the URL every 10 minutes. Render sees the
   resulting traffic (via the Vercel → Render hop), the container stays awake,
   and Alex101's Minecraft TCP session stays open 24/7.

**Option B — Vercel Pro Cron**

`apps/dashboard/vercel.json` includes a cron entry that hits
`/api/keepalive` every 10 minutes:

```json
{
  "crons": [
    { "path": "/api/keepalive", "schedule": "*/10 * * * *" }
  ]
}
```

This is a **Vercel Pro / Enterprise** feature. Free Hobby accounts can't use
Vercel Cron — go with Option A instead.

Set these env vars in the Render Web Service:

```
BOT_WORKER_SECRET = <32+ random chars, identical to the dashboard>
AUTO_CONNECT      = 1
DEFAULT_MC_HOST   = mc.238458.xyz
DEFAULT_MC_USERNAME = Alex101
DEFAULT_MC_VERSION  = 1.21.11
DEFAULT_MC_AUTH     = offline
```

Expose **port 4000** (realtime WebSocket + `/health`) and **port 4001**
(prismarine-viewer WebGL canvas). Render auto-detects the port from the
exposed `PORT` env var, but our worker binds explicitly to 4000 — set
`PORT=4000` in the Render env if Render complains.

### Bot worker → Docker / Compose

```bash
docker compose up -d --build
```

The settings file is persisted on a `alex101-data` volume. The default target
server is `mc.238458.xyz` and the bot will auto-connect on boot.

### Bot worker → local Node

```bash
npm install
npm run build:shared
npm run build:worker
BOT_WORKER_SECRET=... JWT_SIGNING_SECRET=... node apps/bot-worker/dist/index.js
```

---

## Whitelisting Alex101

If `mc.238458.xyz` has the whitelist enabled, the server owner needs to add
`Alex101` (or whatever username you configured) to `whitelist.json`:

```
/whitelist add Alex101
```

If the bot is not whitelisted:

- The dashboard shows the actual kick reason from the server (e.g.
  *"You are not on the whitelist of this server!"*).
- The connection state goes to `ERROR`.
- Auto-reconnect is disabled for permanent rejections — no spam loop.

The dashboard will not attempt to bypass the whitelist.

---

## Using the dashboard

1. **Login** at `/login` with `DASHBOARD_PASSWORD` (default `alex101`).
2. Open the **Settings** tab and verify `mc.238458.xyz`, `Alex101`,
   `1.21.11`, `offline`.
3. Click **Connect**.
4. Wait for the **PLAY** tab — the WebGL viewer (iframe from port 4001) lights
   up.
5. Click the viewport → **pointer lock** activates.
6. Hold **W** — Alex101 walks forward on the Minecraft server; the camera in
   the iframe follows.
7. **A / S / D / Space / Shift / Ctrl** do exactly what they do in Minecraft.
8. Release all keys → Alex101 stops immediately (focus loss / ESC / tab
   changes all clear movement defensively).
9. The **EMERGENCY STOP** button clears all bot motion immediately.
10. The **Navigation** tab lets you *Go to X/Y/Z* (real pathfinding, no
    teleport) or *Follow a player*. The **Players** tab lists nearby players
    with **Look** and **Follow** buttons.
11. The **Chat** tab mirrors live Minecraft chat and lets you send lines
    (press T / Enter to focus, Enter to send).
12. The **Inventory** tab shows armor, offhand, hotbar and the main inventory.
13. The **Logs** tab shows structured worker logs with search, level filter,
    pause and download.

---

## Mobile / tablet

Landscape works best. The dashboard overlays an optional on-screen joystick,
jump, sprint and sneak buttons (touch-friendly). Pointer lock isn't possible on
mobile; use the camera drag in the viewer iframe for look direction.

---

## Security

- Dashboard requires **HttpOnly + Secure + SameSite=Lax** session cookie
  signed with HMAC-SHA256.
- Login route is rate-limited (8 attempts / minute / IP).
- The worker WebSocket requires a token that expires in **10 minutes** and is
  signed with `BOT_WORKER_SECRET`.
- The viewer WebSocket on port 4001 is **NOT** authenticated — anyone who
  knows the URL can view the world. If you expose the worker publicly, place
  it behind a reverse proxy that requires auth on `/ws` and `/` while
  leaving `/health` open.
- Microsoft auth uses the official **device-code** flow. Passwords are never
  collected through the dashboard.
- The bot never tries to bypass authentication, anti-cheat, whitelisting or
  operator permissions.
- Secrets are redacted from logs.

---

## Tests & builds

```bash
npm run typecheck        # tsc on every workspace
npm run test             # node:test suites for shared + bot-worker
npm run build            # builds every workspace
```

Both unit-test files and a full `npm install` are part of the CI.

---

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| *You are not on the whitelist* | Server whitelist; ask the admin to `/whitelist add Alex101`. |
| `ECONNREFUSED` | Server is offline / firewall blocking port 25565. |
| `ENOTFOUND` | DNS cannot resolve the hostname. |
| `Incompatible protocol version` | Update `mineflayer` / `minecraft-data`; the worker pins them. |
| Viewer shows black | The bot is in an unloaded chunk; move with WASD. |
| Viewer iframe blank | Verify port 4001 is exposed and reachable. |
| Login always fails | `JWT_SIGNING_SECRET` differs between dashboard and worker. |
| Worker spins down on Render free | Set up UptimeRobot on `https://<your-vercel-app>.vercel.app/api/keepalive` every 10 min. |
| Worker `/api/keepalive` returns 401 | Open the dashboard once to establish the session cookie before pointing UptimeRobot at it. |

---

## License

MIT. The official PrismarineJS modules used here (MIT) are listed in
`apps/bot-worker/package.json`.