import type { Bot } from 'mineflayer';
import type { EntityKind, NearbyEntity, NearbyPlayer, Vec3 } from '@alex101/shared';
import type { BotStateStore } from './BotStateStore.js';
import { dimensionFromName, gamemodeFromName, toVec3 } from './BotStateStore.js';

const HOSTILE_NAMES = new Set([
  'zombie', 'skeleton', 'creeper', 'spider', 'cave_spider', 'enderman', 'witch',
  'pillager', 'vindicator', 'ravager', 'evoker', 'vex', 'phantom', 'drowned',
  'husk', 'stray', 'blaze', 'ghast', 'magma_cube', 'slime', 'wither_skeleton',
  'piglin', 'piglin_brute', 'hoglin', 'zoglin', 'guardian', 'elder_guardian',
  'shulker', 'silverfish', 'endermite', 'bee', 'warden', 'breeze', 'bogged',
  'creaking',
]);

const PASSIVE_NAMES = new Set([
  'pig', 'cow', 'sheep', 'chicken', 'rabbit', 'horse', 'donkey', 'mule',
  'llama', 'cat', 'dog', 'wolf', 'parrot', 'fox', 'bee', 'axolotl', 'frog',
  'goat', 'camel', 'sniffer', 'armadillo', 'mooshroom', 'turtle', 'ocelot',
  'villager', 'wandering_trader', 'trader_llama', 'panda', 'polar_bear',
  'nautilus', 'zombie_nautilus',
]);

function classifyEntityType(typeName: string, name: string): EntityKind {
  const lower = (typeName || name || '').toLowerCase();
  if (HOSTILE_NAMES.has(lower)) return 'hostile';
  if (PASSIVE_NAMES.has(lower)) return 'passive';
  if (lower === 'player' || lower === 'other_player') return 'player';
  if (lower === 'item' || lower === 'item_entity' || lower === 'dropped_item') return 'item';
  return 'other';
}

export function refreshNearby(bot: Bot | null, store: BotStateStore): { players: NearbyPlayer[]; entities: NearbyEntity[] } {
  if (!bot || !bot.entity) {
    store.setNearbyPlayers([]);
    store.setNearbyEntities([]);
    return { players: [], entities: [] };
  }
  const myPos = bot.entity.position;
  const players: NearbyPlayer[] = [];
  const entities: NearbyEntity[] = [];

  for (const [username, p] of Object.entries(bot.players || {})) {
    if (!p || !p.entity) continue;
    const dist = p.entity.position.distanceTo(myPos);
    players.push({
      id: p.uuid || `p-${username}`,
      username,
      uuid: p.uuid || '',
      position: toVec3(p.entity.position),
      yaw: p.entity.yaw ?? null,
      pitch: p.entity.pitch ?? null,
      distance: dist,
    });
  }

  for (const id of Object.keys(bot.entities || {})) {
    const e = bot.entities[id];
    if (!e || e === bot.entity) continue;
    if (e.type === 'player') continue; // already in bot.players
    if (!e.position) continue;
    const dist = e.position.distanceTo(myPos);
    const name = e.name ?? e.username ?? e.type ?? `entity-${id}`;
    const kind = classifyEntityType(e.type ?? e.name ?? '', name);
    entities.push({
      id: String(id),
      kind,
      name,
      typeId: typeof e.type === 'number' ? e.type : (e.type ?? null),
      position: toVec3(e.position),
      distance: dist,
      yaw: e.yaw ?? null,
      pitch: e.pitch ?? null,
    });
  }

  store.setNearbyPlayers(players);
  store.setNearbyEntities(entities);
  return { players, entities };
}

export function vec3ToVec(v: { x: number; y: number; z: number }): Vec3 {
  return { x: v.x, y: v.y, z: v.z };
}

export function gamemodeFromBot(bot: any): 'survival' | 'creative' | 'adventure' | 'spectator' | 'unknown' {
  return gamemodeFromName(bot?.game?.gameMode);
}

export function dimensionFromBot(bot: any): 'overworld' | 'nether' | 'the_end' | 'unknown' {
  return dimensionFromName(bot?.game?.dimension);
}