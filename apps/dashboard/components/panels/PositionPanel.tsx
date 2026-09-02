'use client';

import type { BotSnapshot } from '@alex101/shared';

export function PositionPanel({ snapshot }: { snapshot: BotSnapshot | null }) {
  if (!snapshot) return <div className="panel"><h3>Position</h3><div className="muted">Loading…</div></div>;
  const p = snapshot.position;
  return (
    <div className="panel">
      <h3>Position</h3>
      <div className="col" style={{ gap: 6 }}>
        <div className="row"><span className="muted" style={{ width: 110 }}>Exact</span><span>{p.x.toFixed(2)}, {p.y.toFixed(2)}, {p.z.toFixed(2)}</span></div>
        <div className="row"><span className="muted" style={{ width: 110 }}>Block</span><span>{p.blockX}, {p.blockY}, {p.blockZ}</span></div>
        <div className="row"><span className="muted" style={{ width: 110 }}>Yaw / Pitch</span><span>{p.yaw.toFixed(1)}° / {p.pitch.toFixed(1)}°</span></div>
        <div className="row"><span className="muted" style={{ width: 110 }}>Velocity</span><span>{p.velocity.x.toFixed(2)}, {p.velocity.y.toFixed(2)}, {p.velocity.z.toFixed(2)}</span></div>
        <div className="row"><span className="muted" style={{ width: 110 }}>On ground</span><span>{p.onGround ? 'yes' : 'no'}</span></div>
        <div className="row"><span className="muted" style={{ width: 110 }}>Dimension</span><span>{p.dimension}</span></div>
        <div className="row"><span className="muted" style={{ width: 110 }}>Health</span><span>{snapshot.player.health.toFixed(0)} / 20</span></div>
        <div className="row"><span className="muted" style={{ width: 110 }}>Food</span><span>{snapshot.player.food.toFixed(0)} / 20</span></div>
        <div className="row"><span className="muted" style={{ width: 110 }}>XP level</span><span>{snapshot.player.xpLevel}</span></div>
      </div>
    </div>
  );
}