import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DEFAULT_SETTINGS, type PersistedSettings } from '@alex101/shared';

/**
 * Persisted (non-secret) settings live on disk. Auth tokens NEVER live here.
 */
export class ConfigManager {
  private readonly file: string;
  private current: PersistedSettings;
  private readonly listeners = new Set<(s: PersistedSettings) => void>();

  constructor(file: string) {
    this.file = resolve(file);
    this.current = this.load();
  }

  private load(): PersistedSettings {
    try {
      if (existsSync(this.file)) {
        const raw = readFileSync(this.file, 'utf8');
        const parsed = JSON.parse(raw);
        return { ...DEFAULT_SETTINGS, ...parsed };
      }
    } catch (err) {
      console.warn('[config] failed to load, falling back to defaults', err);
    }
    return { ...DEFAULT_SETTINGS };
  }

  private persist(): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file, JSON.stringify(this.current, null, 2), 'utf8');
    } catch (err) {
      console.warn('[config] failed to persist', err);
    }
  }

  get(): PersistedSettings {
    return { ...this.current };
  }

  update(patch: Partial<PersistedSettings>): PersistedSettings {
    this.current = { ...this.current, ...patch };
    this.persist();
    for (const fn of this.listeners) fn(this.current);
    return this.current;
  }

  subscribe(fn: (s: PersistedSettings) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}