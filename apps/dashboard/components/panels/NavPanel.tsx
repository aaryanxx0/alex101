'use client';

import { useState } from 'react';
import type { BotSnapshot } from '@alex101/shared';

interface Props {
  snapshot: BotSnapshot | null;
  onGoto: (x: number, y: number, z: number) => void;
  onCancel: () => void;
  disabled: boolean;
  expanded?: boolean;
}

export function NavPanel({ snapshot, onGoto, onCancel, disabled, expanded }: Props) {
  const [x, setX] = useState('0');
  const [y, setY] = useState('64');
  const [z, setZ] = useState('0');
  if (!snapshot) return <div className="panel"><h3>Navigation</h3><div className="muted">Loading…</div></div>;
  const n = snapshot.navigation;
  const dist = n.target && snapshot.position ? Math.hypot(
    snapshot.position.x - n.target.x,
    snapshot.position.y - n.target.y,
    snapshot.position.z - n.target.z,
  ) : null;
  return (
    <div className="panel">
      <h3>Navigation</h3>
      <div className="col" style={{ gap: 8 }}>
        <div className="row"><span className="muted">Status</span><strong>{n.status}</strong></div>
        <div className="row"><span className="muted">Mode</span><span>{n.mode}</span></div>
        {n.targetPlayer && <div className="row"><span className="muted">Target player</span><span>{n.targetPlayer}</span></div>}
        {dist !== null && <div className="row"><span className="muted">Distance</span><span>{dist.toFixed(1)} blocks</span></div>}
        <hr style={{ width: '100%', borderColor: 'var(--border)' }} />
        <label>Go to coordinates</label>
        <div className="grid-3">
          <input value={x} onChange={(e) => setX(e.target.value)} placeholder="X" />
          <input value={y} onChange={(e) => setY(e.target.value)} placeholder="Y" />
          <input value={z} onChange={(e) => setZ(e.target.value)} placeholder="Z" />
        </div>
        <div className="row" style={{ gap: 6 }}>
          <button
            disabled={disabled}
            onClick={() => {
              const xv = Number(x); const yv = Number(y); const zv = Number(z);
              if (!Number.isFinite(xv) || !Number.isFinite(yv) || !Number.isFinite(zv)) return;
              onGoto(xv, yv, zv);
            }}
          >GO</button>
          <button disabled={disabled || n.status === 'IDLE'} onClick={onCancel}>Cancel</button>
        </div>
        {expanded && (
          <>
            <hr style={{ width: '100%', borderColor: 'var(--border)' }} />
            <div className="muted tiny">
              Pathfinder avoids lava and large drops. Block breaking is disabled.
              Use the Players tab to FOLLOW or LOOK AT a specific player.
            </div>
          </>
        )}
      </div>
    </div>
  );
}