import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createHmac, timingSafeEqual } from 'node:crypto';

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

async function ensureAuth(): Promise<boolean> {
  const c = cookies().get(COOKIE_NAME);
  if (!c) return false;
  return verifyCookie(c.value);
}

export async function POST(req: NextRequest) {
  if (!(await ensureAuth())) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  if (!BOT_WORKER_URL || !BOT_WORKER_SECRET) {
    return NextResponse.json({ error: 'bot-worker not configured' }, { status: 500 });
  }
  const body = await req.json().catch(() => ({}));
  const controllerId = String(body?.controllerId || '');
  if (!controllerId) {
    return NextResponse.json({ error: 'controllerId required' }, { status: 400 });
  }
  const url = `${BOT_WORKER_URL.replace(/\/$/, '')}/auth/token`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-bot-worker-secret': BOT_WORKER_SECRET },
      body: JSON.stringify({ controllerId }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return NextResponse.json({ error: `worker error: ${text}` }, { status: 502 });
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: `worker unreachable: ${(err as Error).message}` }, { status: 502 });
  }
}