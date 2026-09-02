import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Dashboard } from '../../components/Dashboard';

export const dynamic = 'force-dynamic';

const COOKIE_NAME = 'alex101_session';

async function isAuthed(): Promise<boolean> {
  const secret = process.env.JWT_SIGNING_SECRET || process.env.DASHBOARD_SESSION_SECRET || '';
  if (!secret) return false;
  const c = cookies().get(COOKIE_NAME);
  if (!c) return false;
  const parts = c.value.split('.');
  if (parts.length !== 2) return false;
  const [expStr, sig] = parts;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || Date.now() > exp) return false;
  const expected = createHmac('sha256', secret).update(`dashboard.${expStr}`).digest('hex');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export default async function DashboardPage() {
  if (!(await isAuthed())) {
    redirect('/login');
  }
  const workerUrl = process.env.BOT_WORKER_URL || '';
  return <Dashboard workerUrl={workerUrl} />;
}