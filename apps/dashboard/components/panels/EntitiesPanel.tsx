'use client';

import type { BotSnapshot } from '@alex101/shared';

export function EntitiesPanel({ snapshot }: { snapshot: BotSnapshot | null }) {
  if (!snapshot) return null;
  const ents = snapshot.nearbyEntities;
  return (
    <div className="panel" style={{ marginTop: 12 }}>
      <h3>Nearby Entities</h3>
      {ents.length === 0 ? <div className="muted">No entities in view.</div> : (
        <div className="col">
          {ents.map((e) => (
            <div key={e.id} className="entity-row">
              <div>
                <strong>{e.name}</strong>
                <div className="muted tiny">kind: {e.kind} · id: {String(e.typeId ?? '?')}</div>
              </div>
              <div className="muted">{e.distance.toFixed(1)}m</div>
            </div>
          ))}
        </div>
      )}
      <Radar entities={ents} center={{ x: snapshot.position.x, z: snapshot.position.z }} yaw={snapshot.position.yaw} />
    </div>
  );
}

interface RadarProps {
  entities: Array<{ id: string; name: string; position: { x: number; z: number }; distance: number }>;
  center: { x: number; z: number };
  yaw: number;
}

function Radar({ entities, center, yaw }: RadarProps) {
  const RADIUS = 32; // show 32-block radius
  const size = 240;
  const half = size / 2;
  return (
    <div className="radar">
      <div className="label">Radar · {RADIUS * 2}m</div>
      <div className="dot center" title="Alex101" />
      {entities.slice(0, 60).map((e) => {
        const dx = e.position.x - center.x;
        const dz = e.position.z - center.z;
        if (Math.abs(dx) > RADIUS || Math.abs(dz) > RADIUS) return null;
        const x = half + (dx / RADIUS) * half;
        const y = half + (dz / RADIUS) * half;
        return (
          <div key={e.id} className="dot" style={{
            left: `${x - 3}px`, top: `${y - 3}px`,
            background: e.name === 'player' ? '#1f6feb' : '#d29922',
          }} />
        );
      })}
      <div className="dot" style={{
        left: `${half - 3}px`, top: `${half - 12}px`,
        width: 0, height: 0, background: 'transparent',
        borderLeft: '6px solid transparent',
        borderRight: '6px solid transparent',
        borderBottom: '12px solid var(--good)',
      }} title={`yaw ${yaw.toFixed(0)}°`} />
    </div>
  );
}