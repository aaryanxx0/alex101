import type { HotbarItem } from '@alex101/shared';

export { EMPTY_MOVEMENT } from '@alex101/shared';

export function defaultEmptyHotbar(slot: number): HotbarItem {
  return {
    slot,
    count: 0,
    itemId: null,
    itemName: null,
    displayName: null,
    enchantments: [],
    durability: null,
  };
}