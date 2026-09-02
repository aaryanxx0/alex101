import { EventEmitter } from 'node:events';
import type { NavigationStatus, Vec3 } from '@alex101/shared';
import type { LogManager } from './LogManager.js';
import type { BotStateStore } from './BotStateStore.js';

/**
 * Thin wrapper around mineflayer-pathfinder that exposes our state-machine
 * navigation states. Intentionally simple — we deliberately disable block
 * breaking / placing for safety.
 */
export class PathfinderController extends EventEmitter {
  private current: any = null;
  private followInterval: NodeJS.Timeout | null = null;

  constructor(private readonly log: LogManager, private readonly store: BotStateStore) {
    super();
  }

  cancel(reason = 'cancelled') {
    if (this.followInterval) {
      clearInterval(this.followInterval);
      this.followInterval = null;
    }
    if (!this.current) return;
    try {
      this.current.stop();
    } catch (err) {
      this.log.warn('pathfinder', `cancel stop error: ${(err as Error).message}`);
    }
    this.current = null;
    this.store.patchNavigation({ status: 'CANCELLED', target: null, targetPlayer: null, mode: 'idle' });
    this.emit('status', 'CANCELLED' as NavigationStatus, reason);
  }

  private setStatus(status: NavigationStatus, extra: Partial<{ target: Vec3 | null; targetPlayer: string | null; mode: 'idle' | 'goto' | 'follow' }> = {}) {
    const nav = this.store.get().navigation;
    const distance = extra.target && this.store.get().position
      ? Math.hypot(
          this.store.get().position.x - extra.target.x,
          this.store.get().position.y - extra.target.y,
          this.store.get().position.z - extra.target.z,
        )
      : nav.distance;
    this.store.patchNavigation({
      status,
      ...extra,
      distance: Number.isFinite(distance) ? distance : nav.distance,
    });
    this.emit('status', status);
  }

  async goto(bot: any, target: Vec3) {
    if (!bot) return;
    this.cancel('new goal');
    this.setStatus('CALCULATING', { mode: 'goto', target, targetPlayer: null });
    const pathfinder = await import('mineflayer-pathfinder');
    const { goals } = pathfinder;
    try {
      const goal = new goals.GoalNear(target.x, target.y, target.z, 1);
      this.current = bot.pathfinder.goto(goal);
      this.log.info('pathfinder', `Goto ${target.x.toFixed(1)}, ${target.y.toFixed(1)}, ${target.z.toFixed(1)}`);
      this.current.once('arrived', () => {
        this.setStatus('ARRIVED', { mode: 'idle', target: null });
        this.current = null;
      });
      this.current.once('path_update', (result: any) => {
        if (result?.status === 'noPath') {
          this.setStatus('UNREACHABLE', { target });
        } else if (result?.status === 'success') {
          this.setStatus('ARRIVED', { target: null, mode: 'idle' });
          this.current = null;
        }
      });
      this.current.once('stopped', () => {
        if (this.store.get().navigation.status === 'CANCELLED' || this.store.get().navigation.status === 'ARRIVED') return;
        this.setStatus('CANCELLED');
        this.current = null;
      });
    } catch (err) {
      this.setStatus('UNREACHABLE');
      this.log.error('pathfinder', `Goto failed: ${(err as Error).message}`);
    }
  }

  async followPlayer(bot: any, username: string, distance = 3) {
    if (!bot) return;
    this.cancel('new follow');
    this.setStatus('CALCULATING', { mode: 'follow', targetPlayer: username });
    this.store.patchNavigation({ followDistance: distance });
    const pathfinder = await import('mineflayer-pathfinder');
    const { goals, Move } = pathfinder as any;
    const goal = (goals.GoalFollow ?? goals.GoalFollowPlayer)
      ? new goals.GoalFollowPlayer(username, distance)
      : new goals.GoalNear(0, 0, 0, distance);
    try {
      this.current = bot.pathfinder.follow(goal, true);
      this.log.info('pathfinder', `Following ${username} at distance ${distance}`);
    } catch (err) {
      this.setStatus('UNREACHABLE');
      this.log.error('pathfinder', `Follow failed: ${(err as Error).message}`);
      return;
    }
    this.followInterval = setInterval(() => {
      const target = bot.players[username];
      if (!target || !target.entity) {
        this.log.warn('pathfinder', `Player ${username} not visible — staying put`);
        return;
      }
      const p = target.entity.position;
      this.store.patchNavigation({
        target: { x: p.x, y: p.y, z: p.z },
      });
    }, 1000);
    this.current.once('stopped', () => {
      if (this.followInterval) {
        clearInterval(this.followInterval);
        this.followInterval = null;
      }
      this.setStatus('CANCELLED');
      this.current = null;
    });
  }

  async lookAt(bot: any, target: Vec3) {
    if (!bot) return;
    try {
      await bot.lookAt(target as any, true);
      this.log.info('pathfinder', `Looked at ${target.x.toFixed(1)}, ${target.y.toFixed(1)}, ${target.z.toFixed(1)}`);
    } catch (err) {
      this.log.warn('pathfinder', `lookAt failed: ${(err as Error).message}`);
    }
  }

  async lookAtPlayer(bot: any, username: string) {
    if (!bot) return;
    const target = bot.players[username];
    if (!target || !target.entity) {
      this.log.warn('pathfinder', `Player ${username} not found to look at`);
      return;
    }
    await this.lookAt(bot, target.entity.position);
  }

  setupBot(bot: any) {
    if (!bot) return;
    // Configure pathfinder movements to avoid breaking blocks.
    const mcData = (bot as any).mcData ?? (bot as any).version;
    const movements = new (require('mineflayer-pathfinder').Movements)(bot, mcData);
    movements.allowParkour = true;
    movements.canDig = false;
    movements.allowEntityCollisions = true;
    movements.scafoldingBlocks = [];
    (bot as any).pathfinder.setMovements(movements);
  }
}