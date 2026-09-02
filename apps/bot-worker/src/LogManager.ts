import type { LogEntry, LogLevel } from '@alex101/shared';
import { makeId } from '@alex101/shared';

const SECRET_PATTERN = /(access_token|refresh_token|client_secret|password|jwt|bearer)\s*[:=]\s*[A-Za-z0-9._\-+/=]{8,}/gi;

export function redact(input: string): string {
  if (typeof input !== 'string') return input;
  return input.replace(SECRET_PATTERN, (m) => {
    if (m.length <= 6) return '[redacted]';
    return `${m.slice(0, 2)}…[redacted]…${m.slice(-2)}`;
  });
}

export function redactMeta(meta?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!meta) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (typeof v === 'string') out[k] = redact(v);
    else if (v && typeof v === 'object') out[k] = redactMeta(v as Record<string, unknown>) ?? v;
    else out[k] = v;
  }
  return out;
}

export interface LogSinkListener {
  (entry: LogEntry): void;
}

const RING_CAPACITY = 1000;

export class LogManager {
  private readonly ring: LogEntry[] = [];
  private readonly listeners = new Set<LogSinkListener>();

  log(level: LogLevel, category: string, message: string, meta?: Record<string, unknown>): LogEntry {
    const safeMessage = redact(message);
    const safeMeta = redactMeta(meta);
    const entry: LogEntry = {
      id: makeId('log'),
      ts: Date.now(),
      level,
      category,
      message: safeMessage,
      meta: safeMeta,
    };
    if (this.ring.length >= RING_CAPACITY) this.ring.shift();
    this.ring.push(entry);
    for (const l of this.listeners) {
      try {
        l(entry);
      } catch (err) {
        console.error('Log sink error', err);
      }
    }
    return entry;
  }

  debug(category: string, message: string, meta?: Record<string, unknown>) {
    return this.log('DEBUG', category, message, meta);
  }

  info(category: string, message: string, meta?: Record<string, unknown>) {
    return this.log('INFO', category, message, meta);
  }

  success(category: string, message: string, meta?: Record<string, unknown>) {
    return this.log('SUCCESS', category, message, meta);
  }

  warn(category: string, message: string, meta?: Record<string, unknown>) {
    return this.log('WARNING', category, message, meta);
  }

  error(category: string, message: string, meta?: Record<string, unknown>) {
    return this.log('ERROR', category, message, meta);
  }

  recent(): LogEntry[] {
    return this.ring.slice();
  }

  subscribe(fn: LogSinkListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}