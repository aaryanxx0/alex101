import type { ViewerState } from '@alex101/shared';
import type { LogManager } from './LogManager.js';

/**
 * Wraps prismarine-viewer as a side-effect (it boots its own Express + socket.io
 * server). We intentionally keep the viewer's HTTP server as a separate listener
 * (or attach to an existing one) so the dashboard can embed it.
 */
export class ViewerManager {
  private port: number;
  private host: string;
  private active: { close: () => Promise<void> } | null = null;
  private readonly log: LogManager;

  constructor(log: LogManager, opts: { host?: string; port: number } = { port: 3007 }) {
    this.log = log;
    this.host = opts.host ?? '0.0.0.0';
    this.port = opts.port;
  }

  baseUrl(): string {
    const h = this.host === '0.0.0.0' ? 'localhost' : this.host;
    return `http://${h}:${this.port}`;
  }

  setPort(port: number) {
    this.port = port;
  }

  getPort() {
    return this.port;
  }

  isActive(): boolean {
    return !!this.active;
  }

  async start(bot: any, viewDistance: number): Promise<void> {
    if (!bot) throw new Error('start() called with no bot');
    if (this.active) {
      await this.stop();
    }
    this.log.info('viewer', `Starting prismarine-viewer (distance ${viewDistance}) on port ${this.port}`);
    // prismarine-viewer uses an Express+http server internally.
    const { mineflayer: mineflayerViewer } = await import('prismarine-viewer');
    await new Promise<void>((resolve, reject) => {
      try {
        const view = mineflayerViewer(bot, {
          port: this.port,
          host: this.host,
          viewDistance,
          firstPerson: true,
        } as any);
        // prismarine-viewer returns an HTTP server-like value; treat as a closeable.
        this.active = {
          close: async () => {
            try {
              if (view && typeof (view as any).close === 'function') {
                await new Promise<void>((res, rej) => {
                  (view as any).close((err?: Error) => (err ? rej(err) : res()));
                });
              }
            } catch (err) {
              this.log.warn('viewer', `view.close error: ${(err as Error).message}`);
            }
          },
        };
        resolve();
      } catch (err) {
        reject(err);
      }
    });
  }

  async stop(): Promise<void> {
    if (!this.active) return;
    await this.active.close();
    this.active = null;
  }
}