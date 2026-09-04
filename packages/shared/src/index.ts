/**
 * Connection state machine.
 */
export type ConnectionState =
  | 'OFFLINE'
  | 'CONNECTING'
  | 'AUTHENTICATING'
  | 'CONNECTED'
  | 'SPAWNING'
  | 'SPAWNED'
  | 'RECONNECTING'
  | 'DISCONNECTING'
  | 'ERROR'
  | 'CONNECTION_CONFLICT';

/**
 * Normalized disconnect categories the dashboard can render with friendly text.
 */
export type DisconnectReason =
  | 'NONE'
  | 'DNS_RESOLUTION_ERROR'
  | 'CONNECTION_REFUSED'
  | 'CONNECTION_TIMEOUT'
  | 'SERVER_OFFLINE'
  | 'UNSUPPORTED_PROTOCOL'
  | 'VERSION_MISMATCH'
  | 'AUTH_REQUIRED'
  | 'MICROSOFT_AUTH_FAILURE'
  | 'INVALID_SESSION'
  | 'WHITELIST_REJECTION'
  | 'SERVER_FULL'
  | 'BANNED'
  | 'CONFLICTING_CONNECTION'
  | 'KICKED'
  | 'CONNECTION_RESET'
  | 'SERVER_RESTART'
  | 'LOST_CONNECTION'
  | 'UNKNOWN';

export type AuthMode = 'offline' | 'microsoft';

export type Gamemode = 'survival' | 'creative' | 'adventure' | 'spectator' | 'unknown';

export type Dimension = 'overworld' | 'nether' | 'the_end' | 'unknown';

export type LogLevel = 'DEBUG' | 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR';

export interface LogEntry {
  id: string;
  ts: number;
  level: LogLevel;
  category: string;
  message: string;
  meta?: Record<string, unknown>;
}

export interface ConnectionInfo {
  state: ConnectionState;
  host: string;
  port: number;
  configuredUsername: string;
  actualUsername: string | null;
  minecraftVersion: string;
  serverVersion: string | null;
  authMode: AuthMode;
  lastDisconnect: DisconnectReason;
  lastDisconnectMessage: string | null;
  lastDisconnectAt: number | null;
  reconnectAttempts: number;
  autoReconnect: boolean;
  startedAt: number | null;
  uptimeMs: number;
  /** True when an AuthMe password is configured (value never exposed). */
  authPasswordSet?: boolean;
  /** In-game (EasyAuth/AuthMe) auth state — separate from protocol state. */
  authState?: string;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface PlayerState {
  health: number;
  food: number;
  foodSaturation: number;
  xpLevel: number;
  xpProgress: number;
  xpTotal: number;
  gamemode: Gamemode;
  selectedHotbarSlot: number;
}

export interface PositionState {
  x: number;
  y: number;
  z: number;
  blockX: number;
  blockY: number;
  blockZ: number;
  yaw: number;
  pitch: number;
  velocity: Vec3;
  onGround: boolean;
  dimension: Dimension;
}

export type MovementStateKey =
  | 'forward'
  | 'back'
  | 'left'
  | 'right'
  | 'jump'
  | 'sprint'
  | 'sneak';

export type MovementStateMap = Record<MovementStateKey, boolean>;

export type NavigationMode = 'idle' | 'goto' | 'follow';

export type NavigationStatus =
  | 'IDLE'
  | 'CALCULATING'
  | 'MOVING'
  | 'ARRIVED'
  | 'FAILED'
  | 'UNREACHABLE'
  | 'CANCELLED';

export interface NavigationState {
  mode: NavigationMode;
  status: NavigationStatus;
  target: Vec3 | null;
  targetPlayer: string | null;
  distance: number;
  followDistance: number;
}

export interface HotbarItem {
  slot: number;
  count: number;
  itemId: number | null;
  itemName: string | null;
  displayName: string | null;
  enchantments: string[];
  durability: number | null;
}

export interface InventoryItem extends HotbarItem {
  inventorySlot: number;
}

export interface InventoryArmorSlot {
  slot: 'helmet' | 'chestplate' | 'leggings' | 'boots';
  item: HotbarItem | null;
}

export interface InventoryState {
  hotbar: HotbarItem[];
  main: InventoryItem[];
  armor: InventoryArmorSlot[];
  offhand: HotbarItem | null;
}

export interface ChatMessage {
  id: string;
  ts: number;
  sender: string;
  raw: string;
  text: string;
  isSystem: boolean;
  isWhisper: boolean;
}

export interface NearbyPlayer {
  id: string;
  username: string;
  uuid: string;
  position: Vec3 | null;
  yaw: number | null;
  pitch: number | null;
  distance: number | null;
}

export type EntityKind = 'player' | 'hostile' | 'passive' | 'item' | 'other';

export interface NearbyEntity {
  id: string;
  kind: EntityKind;
  name: string;
  typeId: number | string | null;
  position: Vec3;
  distance: number;
  yaw: number | null;
  pitch: number | null;
}

export interface ControlState {
  controllerId: string | null;
  controllerName: string | null;
  acquiredAt: number | null;
  lastHeartbeat: number | null;
  movement: MovementStateMap;
  pointerLock: boolean;
  yaw: number;
  pitch: number;
}

export interface ViewerState {
  viewerBaseUrl: string;
  renderDistance: number;
  firstPerson: boolean;
  ready: boolean;
  lastError: string | null;
  socketConnected: boolean;
}

export interface PingSample {
  ts: number;
  ms: number | null;
}

export interface BotSnapshot {
  connection: ConnectionInfo;
  position: PositionState;
  player: PlayerState;
  inventory: InventoryState;
  navigation: NavigationState;
  control: ControlState;
  viewer: ViewerState;
  nearbyPlayers: NearbyPlayer[];
  nearbyEntities: NearbyEntity[];
  ping: PingSample;
  uptimeMs: number;
  now: number;
}

export interface ServerStatusSample {
  ts: number;
  host: string;
  port: number;
  online: boolean;
  latencyMs: number | null;
  motd: string | null;
  versionName: string | null;
  versionProtocol: number | null;
  playersOnline: number | null;
  playersMax: number | null;
  favicon: string | null;
  error: string | null;
}

/* ------------------------------------------------------------------ */
/* WebSocket protocol                                                  */
/* ------------------------------------------------------------------ */

export type ControlClaimStatus =
  | 'CONTROL_GRANTED'
  | 'CONTROL_DENIED'
  | 'CONTROL_ALREADY_OWNED'
  | 'CONTROL_AUTH_REQUIRED'
  | 'CONTROL_WS_OFFLINE';

export type ClientCommand =
  | { type: 'hello'; token: string; controllerId: string; controllerName: string }
  | { type: 'heartbeat'; controllerId: string; ts: number }
  | { type: 'request-control'; take?: boolean }
  | { type: 'request-snapshot' }
  | { type: 'connect'; options: ConnectOptions; requestId?: string }
  | { type: 'disconnect' }
  | { type: 'reconnect' }
  | { type: 'respawn' }
  | { type: 'movement'; state: Partial<MovementStateMap> }
  | { type: 'look'; yaw: number; pitch: number; ts: number }
  | { type: 'clear-movement' }
  | { type: 'emergency-stop' }
  | { type: 'select-hotbar'; slot: number }
  | { type: 'chat'; message: string }
  | { type: 'goto'; x: number; y: number; z: number }
  | { type: 'follow-player'; username: string; distance: number }
  | { type: 'stop-follow' }
  | { type: 'come-to-player'; username: string }
  | { type: 'look-at-player'; username: string }
  | { type: 'look-at-coords'; x: number; y: number; z: number }
  | { type: 'cancel-navigation' }
  | { type: 'set-settings'; settings: Partial<PersistedSettings> }
  | { type: 'request-server-status' };

export type ServerEvent =
  | { type: 'welcome'; snapshot: BotSnapshot; recentLogs: LogEntry[]; recentChat: ChatMessage[] }
  | { type: 'snapshot'; snapshot: BotSnapshot }
  | { type: 'log'; entry: LogEntry }
  | { type: 'chat'; message: ChatMessage }
  | { type: 'viewer-status'; viewer: ViewerState }
  | { type: 'control-status'; status: ControlClaimStatus; message?: string }
  | { type: 'error'; code: string; message: string }
  | { type: 'kicked'; reason: DisconnectReason; raw: string };

export interface ConnectOptions {
  host: string;
  port: number;
  username: string;
  version: string;
  authMode: AuthMode;
  autoReconnect: boolean;
  reconnectDelayMs: number;
  viewDistance: number;
  /** AuthMe-style in-game login password. Sent as /login after spawn. Never logged. */
  authPassword?: string;
}

export interface PersistedSettings {
  host: string;
  port: number;
  username: string;
  version: string;
  authMode: AuthMode;
  autoReconnect: boolean;
  reconnectDelayMs: number;
  viewDistance: number;
  mouseSensitivity: number;
  followDistance: number;
  autoRespawn: boolean;
  enableRendering: boolean;
  /** In-game auth password (AuthMe-style plugins). Stored on worker only. Never logged. */
  authPassword: string;
}

export const DEFAULT_SETTINGS: PersistedSettings = {
  host: 'mc.238458.xyz',
  port: 25565,
  username: 'Alex101',
  version: '1.21.11',
  authMode: 'offline',
  autoReconnect: true,
  reconnectDelayMs: 5000,
  viewDistance: 6,
  mouseSensitivity: 0.15,
  followDistance: 3,
  autoRespawn: true,
  enableRendering: true,
  authPassword: '',
};

/**
 * A stable, monotonic 8-char id used in logs/chat.
 */
export function makeId(prefix = ''): string {
  const rand = Math.random().toString(36).slice(2, 10);
  const ts = Date.now().toString(36).slice(-4);
  return `${prefix}${prefix ? '-' : ''}${ts}${rand}`;
}

/**
 * Clamp helpers used by controls and movement validators.
 */
export const clamp = (v: number, min: number, max: number): number => {
  if (Number.isNaN(v) || !Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, v));
};

export const clampPitch = (p: number): number => clamp(p, -90, 90);

export const clampYaw = (y: number): number => {
  if (Number.isNaN(y) || !Number.isFinite(y)) return 0;
  let v = y % 360;
  if (v > 180) v -= 360;
  if (v < -180) v += 360;
  return v;
};

export const EMPTY_MOVEMENT: MovementStateMap = {
  forward: false,
  back: false,
  left: false,
  right: false,
  jump: false,
  sprint: false,
  sneak: false,
};

/**
 * Movement command validator (single source of truth for both sides).
 */
export function isValidMovementState(input: unknown): input is Partial<MovementStateMap> {
  if (!input || typeof input !== 'object') return false;
  const obj = input as Record<string, unknown>;
  for (const [k, v] of Object.entries(obj)) {
    if (!['forward', 'back', 'left', 'right', 'jump', 'sprint', 'sneak'].includes(k)) return false;
    if (typeof v !== 'boolean') return false;
  }
  return true;
}

export function normalizeHotbarSlot(slot: number): number {
  if (!Number.isFinite(slot)) return 0;
  return clamp(Math.floor(slot), 0, 8);
}

export function isValidCoord(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

export function isValidChatMessage(msg: unknown): msg is string {
  return typeof msg === 'string' && msg.length > 0 && msg.length <= 256;
}

export function emptySnapshot(): BotSnapshot {
  return {
    connection: {
      state: 'OFFLINE',
      host: DEFAULT_SETTINGS.host,
      port: DEFAULT_SETTINGS.port,
      configuredUsername: DEFAULT_SETTINGS.username,
      actualUsername: null,
      minecraftVersion: DEFAULT_SETTINGS.version,
      serverVersion: null,
      authMode: DEFAULT_SETTINGS.authMode,
      lastDisconnect: 'NONE',
      lastDisconnectMessage: null,
      lastDisconnectAt: null,
      reconnectAttempts: 0,
      autoReconnect: DEFAULT_SETTINGS.autoReconnect,
      startedAt: null,
      uptimeMs: 0,
    },
    position: {
      x: 0,
      y: 0,
      z: 0,
      blockX: 0,
      blockY: 0,
      blockZ: 0,
      yaw: 0,
      pitch: 0,
      velocity: { x: 0, y: 0, z: 0 },
      onGround: false,
      dimension: 'unknown',
    },
    player: {
      health: 20,
      food: 20,
      foodSaturation: 5,
      xpLevel: 0,
      xpProgress: 0,
      xpTotal: 0,
      gamemode: 'unknown',
      selectedHotbarSlot: 0,
    },
    inventory: {
      hotbar: Array.from({ length: 9 }, (_, i) => ({
        slot: i,
        count: 0,
        itemId: null,
        itemName: null,
        displayName: null,
        enchantments: [],
        durability: null,
      })),
      main: [],
      armor: [
        { slot: 'helmet', item: null },
        { slot: 'chestplate', item: null },
        { slot: 'leggings', item: null },
        { slot: 'boots', item: null },
      ],
      offhand: null,
    },
    navigation: {
      mode: 'idle',
      status: 'IDLE',
      target: null,
      targetPlayer: null,
      distance: 0,
      followDistance: DEFAULT_SETTINGS.followDistance,
    },
    control: {
      controllerId: null,
      controllerName: null,
      acquiredAt: null,
      lastHeartbeat: null,
      movement: { ...EMPTY_MOVEMENT },
      pointerLock: false,
      yaw: 0,
      pitch: 0,
    },
    viewer: {
      viewerBaseUrl: '',
      renderDistance: DEFAULT_SETTINGS.viewDistance,
      firstPerson: true,
      ready: false,
      lastError: null,
      socketConnected: false,
    },
    nearbyPlayers: [],
    nearbyEntities: [],
    ping: { ts: Date.now(), ms: null },
    uptimeMs: 0,
    now: Date.now(),
  };
}