'use client';

import type { BotSnapshot } from '@alex101/shared';

interface HudOverlayProps {
  snapshot: BotSnapshot | null;
  isController: boolean;
}

/** Number of full/half hearts & drumsticks from 0..20 scale values. */
function iconsFor(value: number): { full: number; half: boolean } {
  const v = Math.max(0, Math.min(20, value));
  const full = Math.floor(v / 2);
  const half = v % 2 === 1;
  return { full, half };
}

export function HudOverlay({ snapshot, isController }: HudOverlayProps) {
  if (!snapshot || snapshot.connection.state === 'OFFLINE') {
    return (
      <>
        <div className="crosshair"><span /></div>
      </>
    );
  }
  const { position, player, control, connection, inventory, nearbyPlayers } = snapshot;
  const hearts = iconsFor(player.health);
  const foodIcons = iconsFor(player.food);
  const xpPct = Math.max(0, Math.min(1, player.xpProgress));
  return (
    <>
      {/* Minimal info — top-right only (old large top-left bars removed) */}
      <div className="hud-overlay hud-top-right">
        <div className="hud-bar">{position.blockX.toFixed(0)}, {position.blockY.toFixed(0)}, {position.blockZ.toFixed(0)}</div>
        <div className="hud-bar">{position.dimension}</div>
        <div className="hud-bar">{connection.actualUsername ?? connection.configuredUsername} · {connection.state}</div>
        {nearbyPlayers.length > 0 && <div className="hud-bar">Players nearby: {nearbyPlayers.length}</div>}
        {isController && <div className="hud-bar" style={{ background: 'rgba(46,160,67,0.7)' }}>CONTROLLER</div>}
      </div>
      <div className="crosshair"><span /></div>

      {/* Minecraft-style bottom HUD: hearts / hunger / xp / hotbar */}
      <div className="mc-hud">
        <div className="mc-hud-row">
          <div className="mc-hearts" aria-label={`Health ${player.health}/20`}>
            {Array.from({ length: 10 }, (_, i) => {
              const cls = i < hearts.full ? 'full' : (i === hearts.full && hearts.half ? 'half' : 'empty');
              return <span key={i} className={`mc-heart ${cls}`} />;
            })}
          </div>
          <div className="mc-hunger" aria-label={`Hunger ${player.food}/20`}>
            {Array.from({ length: 10 }, (_, i) => {
              const cls = i < foodIcons.full ? 'full' : (i === foodIcons.full && foodIcons.half ? 'half' : 'empty');
              return <span key={i} className={`mc-food-icon ${cls}`} />;
            })}
          </div>
        </div>
        <div className="mc-xp-wrap">
          {player.xpLevel > 0 && <span className="mc-xp-level">{player.xpLevel}</span>}
          <div className="mc-xp-bar"><div style={{ width: `${xpPct * 100}%` }} /></div>
        </div>
        <div className="hotbar">
          {inventory.hotbar.map((h, i) => (
            <div key={i} className={`hotbar-slot${player.selectedHotbarSlot === i ? ' selected' : ''}`}>
              <div className="count">{h.count > 0 ? h.count : ''}</div>
              <div className="name">{h.displayName ?? h.itemName ?? ''}</div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
