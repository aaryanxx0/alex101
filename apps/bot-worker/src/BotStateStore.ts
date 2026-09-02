import type {
  BotSnapshot,
  ChatMessage,
  ConnectionInfo,
  Dimension,
  Gamemode,
  HotbarItem,
  InventoryArmorSlot,
  InventoryItem,
  InventoryState,
  NearbyEntity,
  NearbyPlayer,
  NavigationState,
  PingSample,
  PlayerState,
  PositionState,
  Vec3,
  ViewerState,
  MovementStateMap,
  ControlState,
} from '@alex101/shared';
import {
  EMPTY_MOVEMENT,
  defaultEmptyHotbar,
} from './botDefaults.js';
import { emptySnapshot } from '@alex101/shared';

export function dimensionFromName(name: unknown): Dimension {
  const s = String(name ?? '').toLowerCase();
  if (s.includes('overworld')) return 'overworld';
  if (s.includes('nether')) return 'nether';
  if (s.includes('end') || s.includes('the_end')) return 'the_end';
  return 'unknown';
}

export function gamemodeFromName(name: unknown): Gamemode {
  const s = String(name ?? '').toLowerCase();
  if (s === 'survival') return 'survival';
  if (s === 'creative') return 'creative';
  if (s === 'adventure') return 'adventure';
  if (s === 'spectator') return 'spectator';
  return 'unknown';
}

export interface BotStateInternal {
  connection: ConnectionInfo;
  position: PositionState;
  player: PlayerState;
  inventory: InventoryState;
  navigation: NavigationState;
  control: ControlState;
  viewer: ViewerState;
  nearbyPlayers: NearbyPlayer[];
  nearbyEntities: NearbyEntity[];
  chat: ChatMessage[];
  ping: PingSample;
  startedAt: number | null;
}

export class BotStateStore {
  private state: BotStateInternal;

  constructor(initial: BotStateInternal = createDefaultInternal()) {
    this.state = initial;
  }

  get(): BotStateInternal {
    return this.state;
  }

  patchConnection(patch: Partial<ConnectionInfo>) {
    this.state.connection = { ...this.state.connection, ...patch };
  }

  patchPosition(patch: Partial<PositionState>) {
    this.state.position = { ...this.state.position, ...patch };
  }

  patchPlayer(patch: Partial<PlayerState>) {
    this.state.player = { ...this.state.player, ...patch };
  }

  patchInventory(patch: Partial<InventoryState>) {
    this.state.inventory = { ...this.state.inventory, ...patch };
  }

  patchNavigation(patch: Partial<NavigationState>) {
    this.state.navigation = { ...this.state.navigation, ...patch };
  }

  patchControl(patch: Partial<ControlState>) {
    this.state.control = { ...this.state.control, ...patch };
  }

  patchViewer(patch: Partial<ViewerState>) {
    this.state.viewer = { ...this.state.viewer, ...patch };
  }

  setNearbyPlayers(players: NearbyPlayer[]) {
    this.state.nearbyPlayers = players;
  }

  setNearbyEntities(entities: NearbyEntity[]) {
    this.state.nearbyEntities = entities;
  }

  setPing(sample: PingSample) {
    this.state.ping = sample;
  }

  setStartedAt(ts: number | null) {
    this.state.startedAt = ts;
  }

  pushChat(msg: ChatMessage) {
    this.state.chat.push(msg);
    if (this.state.chat.length > 200) this.state.chat.shift();
  }

  recentChat(n = 50): ChatMessage[] {
    return this.state.chat.slice(-n);
  }

  resetRuntime() {
    const def = createDefaultInternal();
    this.state = {
      ...def,
      connection: {
        ...def.connection,
        ...this.state.connection,
      },
      inventory: def.inventory,
      navigation: def.navigation,
      control: { ...def.control, movement: { ...EMPTY_MOVEMENT } },
      position: def.position,
      player: def.player,
      viewer: { ...def.viewer, ...this.state.viewer },
      chat: [],
      nearbyEntities: [],
      nearbyPlayers: [],
      ping: { ts: Date.now(), ms: null },
      startedAt: this.state.startedAt,
    };
  }

  snapshot(): BotSnapshot {
    const now = Date.now();
    const startedAt = this.state.startedAt;
    const uptimeMs = startedAt ? now - startedAt : 0;
    return {
      connection: { ...this.state.connection, uptimeMs },
      position: { ...this.state.position },
      player: { ...this.state.player },
      inventory: cloneInventory(this.state.inventory),
      navigation: { ...this.state.navigation },
      control: {
        ...this.state.control,
        movement: { ...this.state.control.movement },
      },
      viewer: { ...this.state.viewer },
      nearbyPlayers: this.state.nearbyPlayers.slice(),
      nearbyEntities: this.state.nearbyEntities.slice(),
      ping: { ...this.state.ping },
      uptimeMs,
      now,
    };
  }
}

function createDefaultInternal(): BotStateInternal {
  const snap = emptySnapshot();
  return {
    connection: snap.connection,
    position: snap.position,
    player: snap.player,
    inventory: snap.inventory,
    navigation: snap.navigation,
    control: snap.control,
    viewer: snap.viewer,
    nearbyPlayers: [],
    nearbyEntities: [],
    chat: [],
    ping: { ts: Date.now(), ms: null },
    startedAt: null,
  };
}

function cloneInventory(i: InventoryState): InventoryState {
  return {
    hotbar: i.hotbar.map((h) => ({ ...h, enchantments: [...h.enchantments] })),
    main: i.main.map((m) => ({ ...m, enchantments: [...m.enchantments] })),
    armor: i.armor.map((a) => ({ slot: a.slot, item: a.item ? { ...a.item } : null })),
    offhand: i.offhand ? { ...i.offhand } : null,
  };
}

export function toVec3(p: { x: number; y: number; z: number }): Vec3 {
  return { x: p.x, y: p.y, z: p.z };
}

export function toHotbarItem(slot: number, item: any): HotbarItem {
  if (!item || item.type === 0 || item.count === 0) {
    return defaultEmptyHotbar(slot);
  }
  return {
    slot,
    count: item.count ?? 0,
    itemId: item.type ?? null,
    itemName: item.name ?? null,
    displayName: item.displayName ?? null,
    enchantments: Array.isArray(item.enchants) ? item.enchants.map((e: any) => e?.name ?? String(e)) : [],
    durability: item.durabilityUsed !== undefined ? item.durabilityUsed : null,
  };
}

export function toInventoryItem(inventorySlot: number, item: any): InventoryItem {
  return { ...toHotbarItem(inventorySlot, item), inventorySlot };
}

export function mapArmorSlots(bot: any): InventoryArmorSlot[] {
  const slots: InventoryArmorSlot[] = [
    { slot: 'helmet', item: null },
    { slot: 'chestplate', item: null },
    { slot: 'leggings', item: null },
    { slot: 'boots', item: null },
  ];
  if (!bot?.inventory) return slots;
  const equip = bot.inventory.slots;
  // helmet:39, chestplate:38, leggings:37, boots:36
  const map: Array<[InventoryArmorSlot['slot'], number]> = [
    ['boots', 36],
    ['leggings', 37],
    ['chestplate', 38],
    ['helmet', 39],
  ];
  for (const [slot, idx] of map) {
    const item = equip[idx];
    if (item && item.count > 0) {
      slots.find((s) => s.slot === slot)!.item = toHotbarItem(0, item);
    }
  }
  return slots;
}

export function movementToMap(bot: any): MovementStateMap {
  return {
    forward: !!bot?.controlState?.forward,
    back: !!bot?.controlState?.back,
    left: !!bot?.controlState?.left,
    right: !!bot?.controlState?.right,
    jump: !!bot?.controlState?.jump,
    sprint: !!bot?.controlState?.sprint,
    sneak: !!bot?.controlState?.sneak,
  };
}