'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error || 'Invalid credentials');
        setLoading(false);
        return;
      }
      router.push('/dashboard');
    } catch (err) {
      setError(`Network error: ${(err as Error).message}`);
      setLoading(false);
    }
  }

  return (
    <div className="login-shell">
      <div className="login-card">
        <h1>Alex101</h1>
        <p className="subtitle">Browser-controlled Minecraft Java bot.</p>
        <form onSubmit={handleSubmit} className="col">
          <div>
            <label htmlFor="password">Dashboard password</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              autoFocus
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Set via DASHBOARD_PASSWORD_HASH env"
            />
          </div>
          {error && <div className="toast error">{error}</div>}
          <button type="submit" className="primary" disabled={loading}>
            {loading ? 'Verifying…' : 'Unlock dashboard'}
          </button>
        </form>
        <p className="muted tiny" style={{ marginTop: 16 }}>
          This dashboard issues a short-lived signed access token to the bot worker. Passwords and tokens are never shared in client JavaScript.
        </p>
      </div>
    </div>
  );
}