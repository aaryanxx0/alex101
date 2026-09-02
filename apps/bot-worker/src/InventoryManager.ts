import type { Bot } from 'mineflayer';
import type { HotbarItem, InventoryItem, InventoryState } from '@alex101/shared';
import { defaultEmptyHotbar } from './botDefaults.js';
import type { BotStateStore } from './BotStateStore.js';
import { mapArmorSlots, toHotbarItem, toInventoryItem } from './BotStateStore.js';

export function refreshInventory(bot: Bot | null, store: BotStateStore): void {
  if (!bot) return;
  const inv = bot.inventory;
  if (!inv) return;

  const hotbar: HotbarItem[] = Array.from({ length: 9 }, (_, i) => {
    const item = inv.slots[i + 36]; // hotbar slots 36..44
    return toHotbarItem(i, item);
  });

  const main: InventoryItem[] = [];
  for (let i = 9; i <= 35; i++) {
    const item = inv.slots[i];
    if (!item || item.count === 0) continue;
    main.push(toInventoryItem(i, item));
  }

  const offhandItem = inv.slots[45];
  const offhand: HotbarItem | null = offhandItem && offhandItem.count > 0
    ? toHotbarItem(0, offhandItem)
    : null;

  const next: InventoryState = {
    hotbar,
    main,
    armor: mapArmorSlots(bot),
    offhand,
  };
  store.patchInventory(next);
  store.patchPlayer({ selectedHotbarSlot: (inv as any).currentSlot ?? 0 });
}

export function defaultEmptyInventory(): InventoryState {
  return {
    hotbar: Array.from({ length: 9 }, (_, i) => defaultEmptyHotbar(i)),
    main: [],
    armor: [
      { slot: 'helmet', item: null },
      { slot: 'chestplate', item: null },
      { slot: 'leggings', item: null },
      { slot: 'boots', item: null },
    ],
    offhand: null,
  };
}