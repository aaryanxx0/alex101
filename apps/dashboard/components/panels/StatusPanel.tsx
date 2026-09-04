'use client';

import type { BotSnapshot } from '@alex101/shared';

export function StatusPanel({ snapshot }: { snapshot: BotSnapshot | null }) {
  if (!snapshot) return <div className="panel"><h3>Status</h3><div className="muted">Loading…</div></div>;
  const c = snapshot.connection;
  return (
    <div className="panel">
      <h3>Status</h3>
      <div className="col" style={{ gap: 6 }}>
        <div className="row"><span className="muted" style={{ width: 110 }}>State</span><strong>{c.state}</strong></div>
        <div className="row"><span className="muted" style={{ width: 110 }}>Server auth</span><strong style={{ color: c.authState === 'AUTHENTICATED' ? 'var(--good)' : c.authState && c.authState !== 'AUTHENTICATED' && c.state === 'SPAWNED' ? 'var(--warn)' : undefined }}>{c.authState ?? '—'}</strong></div>
        <div className="row"><span className="muted" style={{ width: 110 }}>Host</span><span>{c.host}:{c.port}</span></div>
        <div className="row"><span className="muted" style={{ width: 110 }}>MC version</span><span>{c.minecraftVersion}{c.serverVersion ? ` / ${c.serverVersion}` : ''}</span></div>
        <div className="row"><span className="muted" style={{ width: 110 }}>Username</span><span>{c.actualUsername ?? c.configuredUsername}</span></div>
        <div className="row"><span className="muted" style={{ width: 110 }}>Auth</span><span>{c.authMode}</span></div>
        <div className="row"><span className="muted" style={{ width: 110 }}>Reconnect #</span><span>{c.reconnectAttempts}</span></div>
        <div className="row"><span className="muted" style={{ width: 110 }}>Uptime</span><span>{formatUptime(c.uptimeMs)}</span></div>
        <div className="row"><span className="muted" style={{ width: 110 }}>Ping</span><span>{snapshot.ping.ms !== null ? `${snapshot.ping.ms}ms` : '—'}</span></div>
        <div className="row"><span className="muted" style={{ width: 110 }}>Gamemode</span><span>{snapshot.player.gamemode}</span></div>
        <div className="row"><span className="muted" style={{ width: 110 }}>Viewer</span><span>{snapshot.viewer.ready ? 'ready' : 'idle'}</span></div>
      </div>
    </div>
  );
}

function formatUptime(ms: number): string {
  if (ms <= 0) return '0s';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}h ${m}m ${sec}s`;
}