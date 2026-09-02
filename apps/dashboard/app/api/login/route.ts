import { NextRequest, NextResponse } from 'next/server';
import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';

const COOKIE_NAME = 'alex101_session';
const SESSION_SECRET = process.env.JWT_SIGNING_SECRET || process.env.DASHBOARD_SESSION_SECRET || '';
const PASSWORD_HASH = process.env.DASHBOARD_PASSWORD_HASH || '';
const PLAIN_PASSWORD = process.env.DASHBOARD_PASSWORD || '';
const COOKIE_TTL_SECONDS = 60 * 60 * 12;

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 8;
const attempts = new Map<string, { count: number; firstAt: number }>();

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return req.headers.get('x-real-ip') || 'unknown';
}

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry) {
    attempts.set(ip, { count: 1, firstAt: now });
    return true;
  }
  if (now - entry.firstAt > RATE_LIMIT_WINDOW_MS) {
    attempts.set(ip, { count: 1, firstAt: now });
    return true;
  }
  entry.count++;
  return entry.count <= RATE_LIMIT_MAX;
}

async function passwordValid(provided: string): Promise<boolean> {
  if (PLAIN_PASSWORD && provided === PLAIN_PASSWORD) return true;
  if (PASSWORD_HASH) {
    const hashed = createHmac('sha256', SESSION_SECRET || 'salt').update(provided).digest('hex');
    const expected = createHmac('sha256', SESSION_SECRET || 'salt').update(PASSWORD_HASH).digest('hex');
    const a = Buffer.from(hashed);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }
  return false;
}

export async function POST(req: NextRequest) {
  if (!SESSION_SECRET) {
    return NextResponse.json({ error: 'server misconfigured' }, { status: 500 });
  }
  const ip = clientIp(req);
  if (!checkRateLimit(ip)) {
    return NextResponse.json({ error: 'too many attempts, slow down' }, { status: 429 });
  }
  const body = await req.json().catch(() => ({}));
  const password = String(body?.password ?? '');
  if (!password) return NextResponse.json({ error: 'password required' }, { status: 400 });
  if (!(await passwordValid(password))) {
    return NextResponse.json({ error: 'invalid credentials' }, { status: 401 });
  }
  const exp = Date.now() + COOKIE_TTL_SECONDS * 1000;
  const sig = createHmac('sha256', SESSION_SECRET).update(`dashboard.${exp}`).digest('hex');
  const value = `${exp}.${sig}`;
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: COOKIE_TTL_SECONDS,
  });
  return res;
}