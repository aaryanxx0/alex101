import { EventEmitter } from 'node:events';
import type { LogManager } from './LogManager.js';
import type { BotStateStore } from './BotStateStore.js';
import { EMPTY_MOVEMENT } from '@alex101/shared';

export interface AcquiredController {
  controllerId: string;
  controllerName: string;
  acquiredAt: number;
}

/**
 * Tracks which browser session has control of movement. Movement + look input
 * from a non-controlling browser is rejected (read-only). If the heartbeat
 * stops, we clear all movement.
 */
export class ControlSessionManager extends EventEmitter {
  private current: AcquiredController | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private static readonly HEARTBEAT_TIMEOUT_MS = 3500;

  constructor(private readonly log: LogManager, private readonly store: BotStateStore) {
    super();
    this.heartbeatTimer = setInterval(() => this.checkHeartbeat(), 1000);
    this.heartbeatTimer.unref?.();
  }

  acquire(controllerId: string, controllerName: string): boolean {
    if (this.current && this.current.controllerId === controllerId) {
      this.current.acquiredAt = Date.now();
      this.store.patchControl({ controllerName });
      this.emit('changed', this.current);
      return true;
    }
    if (this.current) {
      this.log.warn('control', `Refused takeover: already held by ${this.current.controllerName}`);
      return false;
    }
    this.current = { controllerId, controllerName, acquiredAt: Date.now() };
    this.store.patchControl({ controllerId, controllerName, acquiredAt: Date.now(), lastHeartbeat: Date.now() });
    this.log.success('control', `Control acquired by ${controllerName}`);
    this.emit('changed', this.current);
    return true;
  }

  release(controllerId: string): void {
    if (!this.current) return;
    if (this.current.controllerId !== controllerId) return;
    this.log.info('control', `Control released by ${this.current.controllerName}`);
    this.current = null;
    this.store.patchControl({ controllerId: null, controllerName: null, acquiredAt: null, lastHeartbeat: null });
    this.releaseAllMovement();
    this.emit('changed', null);
  }

  releaseAllMovement(): void {
    this.store.patchControl({ movement: { ...EMPTY_MOVEMENT } });
    this.emit('force-clear-movement');
  }

  isOwner(controllerId: string): boolean {
    return !!this.current && this.current.controllerId === controllerId;
  }

  heartbeat(controllerId: string): void {
    if (!this.current || this.current.controllerId !== controllerId) return;
    this.store.patchControl({ lastHeartbeat: Date.now() });
  }

  private checkHeartbeat() {
    if (!this.current) return;
    const now = Date.now();
    if (now - (this.store.get().control.lastHeartbeat ?? 0) > ControlSessionManager.HEARTBEAT_TIMEOUT_MS) {
      this.log.warn('control', `Heartbeat timeout for ${this.current.controllerName} — releasing control & clearing movement`);
      this.release(this.current.controllerId);
    }
  }

  dispose() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}