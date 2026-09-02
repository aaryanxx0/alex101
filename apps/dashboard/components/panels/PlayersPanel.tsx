'use client';

import { useState } from 'react';
import type { BotSnapshot } from '@alex101/shared';

interface Props {
  snapshot: BotSnapshot | null;
  onFollow: (username: string, distance: number) => void;
  onLookAt: (username: string) => void;
  disabled: boolean;
}

export function PlayersPanel({ snapshot, onFollow, onLookAt, disabled }: Props) {
  const [followDistance, setFollowDistance] = useState(3);
  if (!snapshot) return <div className="panel"><h3>Nearby Players</h3><div className="muted">Loading…</div></div>;
  const players = snapshot.nearbyPlayers;
  return (
    <div className="panel">
      <h3>Nearby Players</h3>
      {players.length === 0 ? (
        <div className="muted">No players visible.</div>
      ) : (
        <div className="col" style={{ gap: 4 }}>
          <label>Follow distance (blocks)</label>
          <input
            type="number"
            value={followDistance}
            min={1}
            max={16}
            onChange={(e) => setFollowDistance(Math.max(1, Math.min(16, Number(e.target.value) || 3)))}
          />
          {players.map((p) => (
            <div key={p.id} className="entity-row">
              <div>
                <strong>{p.username}</strong>
                <div className="muted tiny">
                  {p.position ? `${p.position.x.toFixed(0)}, ${p.position.y.toFixed(0)}, ${p.position.z.toFixed(0)}` : 'no position'}
                </div>
              </div>
              <div className="row" style={{ gap: 6 }}>
                <span className="muted">{p.distance !== null ? `${p.distance.toFixed(1)}m` : ''}</span>
                <button disabled={disabled} onClick={() => onLookAt(p.username)}>Look</button>
                <button className="primary" disabled={disabled} onClick={() => onFollow(p.username, followDistance)}>Follow</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}