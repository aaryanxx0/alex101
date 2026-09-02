import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const COOKIE_NAME = 'alex101_session';

export async function POST() {
  const res = NextResponse.json({ ok: true });
  cookies().delete(COOKIE_NAME);
  return res;
}