'use client';

import { useEffect, useState } from 'react';

/**
 * Tiny indicator that pings the Vercel `/api/keepalive` route while the
 * dashboard is open. This complements the external UptimeRobot pinger:
 *  - UptimeRobot keeps the Render worker alive while you're NOT in the dashboard
 *  - This component keeps it warm while the dashboard IS open
 *
 * It also serves as a visible cue that the dashboard<->worker link is alive.
 */
export function HeartbeatIndicator() {
  const [last, setLast] = useState<number | null>(null);
  const [status, setStatus] = useState<'idle' | 'ok' | 'error'>('idle');
  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const r = await fetch('/api/keepalive', { method: 'GET', cache: 'no-store' });
        if (cancelled) return;
        setLast(Date.now());
        setStatus(r.ok ? 'ok' : 'error');
      } catch {
        if (cancelled) return;
        setStatus('error');
      }
    }
    tick();
    const id = window.setInterval(tick, 60_000); // every minute while open
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);
  if (status === 'idle') return null;
  const color = status === 'ok' ? 'var(--good)' : 'var(--bad)';
  return (
    <span style={{ fontSize: 11, color: 'var(--fg-2)' }} title={`Worker heartbeat ${status === 'ok' ? 'OK' : 'FAILING'} ${last ? new Date(last).toLocaleTimeString() : ''}`}>
      <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: color, marginRight: 4 }} />
      worker {status}
    </span>
  );
}