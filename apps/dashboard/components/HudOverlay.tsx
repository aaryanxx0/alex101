'use client';

import type { BotSnapshot } from '@alex101/shared';

interface HudOverlayProps {
  snapshot: BotSnapshot | null;
  isController: boolean;
}

export function HudOverlay({ snapshot, isController }: HudOverlayProps) {
  if (!snapshot) return null;
  const { position, player, control, connection, inventory, nearbyPlayers } = snapshot;
  const health = Math.max(0, Math.min(20, player.health));
  const food = Math.max(0, Math.min(20, player.food));
  const xpPct = Math.max(0, Math.min(1, player.xpProgress));
  return (
    <>
      <div className="hud-overlay hud-top-left">
        <div className="hud-bar"><span>♥</span>
          <div className="mc-health-bar"><div style={{ width: `${(health / 20) * 100}%` }} /></div>
          <span>{health.toFixed(0)}</span>
        </div>
        <div className="hud-bar"><span>🍗</span>
          <div className="mc-food-bar"><div style={{ width: `${(food / 20) * 100}%` }} /></div>
          <span>{food.toFixed(0)}</span>
        </div>
        <div className="hud-bar"><span>XP</span>
          <div className="hud-xp"><div style={{ width: `${xpPct * 100}%` }} /></div>
          <span>Lv {player.xpLevel}</span>
        </div>
      </div>
      <div className="hud-overlay hud-top-right">
        <div className="hud-bar">{position.blockX.toFixed(0)}, {position.blockY.toFixed(0)}, {position.blockZ.toFixed(0)}</div>
        <div className="hud-bar">{position.dimension}</div>
        <div className="hud-bar">Yaw {position.yaw.toFixed(0)}° · Pitch {position.pitch.toFixed(0)}°</div>
        <div className="hud-bar">{connection.actualUsername ?? connection.configuredUsername} · {connection.state}</div>
        {nearbyPlayers.length > 0 && <div className="hud-bar">Players nearby: {nearbyPlayers.length}</div>}
        {isController && <div className="hud-bar" style={{ background: 'rgba(46,160,67,0.7)' }}>CONTROLLER</div>}
      </div>
      <div className="crosshair"><span /></div>
      <div className="hotbar">
        {inventory.hotbar.map((h, i) => (
          <div key={i} className={`hotbar-slot${player.selectedHotbarSlot === i ? ' selected' : ''}`}>
            <div className="count">{h.count > 0 ? h.count : ''}</div>
            <div className="name">{h.displayName ?? h.itemName ?? ''}</div>
          </div>
        ))}
      </div>
    </>
  );
}