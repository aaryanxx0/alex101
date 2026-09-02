import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createHmac, timingSafeEqual } from 'node:crypto';

export const dynamic = 'force-dynamic';

const COOKIE_NAME = 'alex101_session';
const SESSION_SECRET = process.env.JWT_SIGNING_SECRET || process.env.DASHBOARD_SESSION_SECRET || '';
const BOT_WORKER_URL = process.env.BOT_WORKER_URL || '';
const BOT_WORKER_SECRET = process.env.BOT_WORKER_SECRET || '';

async function verifyCookie(token: string): Promise<boolean> {
  if (!SESSION_SECRET) return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [expStr, sig] = parts;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || Date.now() > exp) return false;
  const expected = createHmac('sha256', SESSION_SECRET).update(`dashboard.${expStr}`).digest('hex');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

async function isLoggedIn(): Promise<boolean> {
  const c = cookies().get(COOKIE_NAME);
  if (!c) return false;
  return verifyCookie(c.value);
}

/**
 * Health route that external pinger services (UptimeRobot, cron-job.org, etc.)
 * can hit on a schedule. This route is intentionally cookie-free so external
 * services can ping it. It forwards a GET to the worker's /health endpoint.
 *
 * Set up UptimeRobot (free plan) with this URL and a 10-minute interval to
 * keep the Render free plan worker awake (Render spins down after 15 min of
 * no incoming HTTP traffic).
 *
 * Alternative: Vercel Pro users can also use the cron entry in vercel.json
 * (Hobby accounts don't support cron jobs).
 *
 * The /api/keepalive route is deliberately open to anonymous pings because
 * it only forwards a HEAD/GET to a /health endpoint that only reveals:
 *   - whether the worker process is alive (boolean)
 *   - the viewer base URL
 *   - the connection state
 * No secrets or tokens are returned.
 */
async function handle() {
  if (!BOT_WORKER_URL) {
    return NextResponse.json({ error: 'BOT_WORKER_URL not set' }, { status: 500 });
  }
  try {
    const url = `${BOT_WORKER_URL.replace(/\/$/, '')}/health`;
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'x-bot-worker-secret': BOT_WORKER_SECRET },
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    const text = await res.text();
    return new NextResponse(text, {
      status: res.ok ? 200 : 503,
      headers: {
        'content-type': res.headers.get('content-type') ?? 'application/json',
        'cache-control': 'no-store',
      },
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 503 });
  }
}

export const GET = handle;
export const HEAD = handle;
export const POST = handle;