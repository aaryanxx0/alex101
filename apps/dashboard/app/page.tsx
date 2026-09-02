import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

const COOKIE_NAME = 'alex101_session';
const SESSION_SECRET = process.env.JWT_SIGNING_SECRET || process.env.DASHBOARD_SESSION_SECRET || '';
const COOKIE_TTL_SECONDS = 60 * 60 * 12;

async function verifyCookie(token: string): Promise<boolean> {
  if (!SESSION_SECRET) return false;
  const { createHmac, timingSafeEqual } = await import('node:crypto');
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

async function isAuthenticated(): Promise<boolean> {
  const c = cookies().get(COOKIE_NAME);
  if (!c) return false;
  return verifyCookie(c.value);
}

export async function GET() {
  if (await isAuthenticated()) {
    redirect('/dashboard');
  }
  redirect('/login');
}