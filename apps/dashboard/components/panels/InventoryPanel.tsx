'use client';

import { useState, useEffect, useRef } from 'react';
import type { BotSnapshot } from '@alex101/shared';

export function InventoryPanel({ snapshot, onSelectHotbar }: { snapshot: BotSnapshot | null; onSelectHotbar: (slot: number) => void }) {
  if (!snapshot) return null;
  if (snapshot.connection.state === 'OFFLINE') {
    return (
      <div className="panel">
        <h3>Inventory</h3>
        <div className="muted">Unavailable — bot is offline. Connect Alex101 to view its inventory.</div>
      </div>
    );
  }
  const inv = snapshot.inventory;
  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="panel">
        <h3>Armor</h3>
        <div className="grid-4">
          {inv.armor.map((a) => (
            <div key={a.slot} className="col" style={{ alignItems: 'center' }}>
              <div className="muted tiny">{a.slot}</div>
              <div className="hotbar-slot" style={{ width: 48, height: 48 }}>
                {a.item ? a.item.displayName ?? a.item.itemName : <span className="muted">—</span>}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="panel">
        <h3>Hotbar (selected {snapshot.player.selectedHotbarSlot + 1})</h3>
        <div className="hotbar" style={{ position: 'relative', transform: 'none', left: 0 }}>
          {inv.hotbar.map((h, i) => (
            <button key={i} className={`hotbar-slot${snapshot.player.selectedHotbarSlot === i ? ' selected' : ''}`} onClick={() => onSelectHotbar(i)}>
              {h.count > 0 && <div className="count">{h.count}</div>}
              <div style={{ fontSize: 9 }}>{h.displayName ?? h.itemName ?? ''}</div>
            </button>
          ))}
        </div>
        {inv.offhand && (
          <>
            <h3 style={{ marginTop: 12 }}>Offhand</h3>
            <div className="hotbar-slot" style={{ width: 36, height: 36 }}>
              {inv.offhand.displayName ?? inv.offhand.itemName}
              {inv.offhand.count > 1 && <div className="count">{inv.offhand.count}</div>}
            </div>
          </>
        )}
      </div>
      <div className="panel">
        <h3>Main Inventory ({inv.main.length} items)</h3>
        {inv.main.length === 0 ? (
          <div className="muted">Empty.</div>
        ) : (
          <div className="inventory-grid">
            {inv.main.map((m) => (
              <div key={m.inventorySlot} className="slot">
                {m.count > 0 && <span className="count" style={{ position: 'absolute', bottom: 0, right: 2, fontSize: 10 }}>{m.count}</span>}
                <span style={{ fontSize: 9 }}>{m.displayName ?? m.itemName ?? ''}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}