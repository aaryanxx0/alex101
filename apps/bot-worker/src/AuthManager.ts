import type { AuthMode } from '@alex101/shared';
import { LogManager } from './LogManager.js';

/**
 * Microsoft device-code flow (no password) via prismarine-auth.
 *
 * The device-code is logged to the console and surfaced to the dashboard so the
 * human user can complete auth in their browser. We never store passwords.
 */
export interface MicrosoftAuthResult {
  username: string;
  profile?: Record<string, unknown>;
}

export class AuthManager {
  private cache: Map<string, { token: string; profile?: Record<string, unknown>; username: string; ts: number }> = new Map();

  constructor(private readonly log: LogManager) {}

  async authenticate(mode: AuthMode, username: string): Promise<MicrosoftAuthResult | null> {
    if (mode === 'offline') {
      this.log.info('auth', `Offline mode: username "${username}" will be sent directly to the server`);
      return { username };
    }

    const cached = this.cache.get(username);
    if (cached && Date.now() - cached.ts < 1000 * 60 * 60 * 12) {
      this.log.info('auth', `Using cached Microsoft auth for ${username}`);
      return { username: cached.username, profile: cached.profile };
    }

    this.log.info('auth', `Starting Microsoft device-code auth for ${username}`);
    const auth = await import('prismarine-auth');
    const Auth = (auth as any).default ?? auth;
    try {
      const flow = new Auth('user', { flow: 'live', authTitle: 'Alex101' }, (uuid: string, data: { user_code: string; device_code: string; verification_uri: string; expires_in: number; interval: number }) => {
        const msg = `Microsoft auth required. Visit ${data.verification_uri} and enter code ${data.user_code}`;
        this.log.warn('auth', msg);
        console.warn(`\n>>> ${msg} <<<\n`);
      });
      const result: any = await flow.getMinecraftToken({ fetchProfile: true });
      const actualUsername: string = result?.profile?.name || username;
      const token = result?.token ?? result?.access_token ?? '';
      this.cache.set(username, { token, profile: result?.profile, username: actualUsername, ts: Date.now() });
      this.log.success('auth', `Microsoft auth succeeded for ${actualUsername}`);
      return { username: actualUsername, profile: result?.profile };
    } catch (err) {
      this.log.error('auth', `Microsoft auth failed: ${(err as Error).message}`);
      throw err;
    }
  }

  /** Resolve a cached Microsoft token for injection into mineflayer. */
  tokenFor(username: string): string | undefined {
    return this.cache.get(username)?.token;
  }
}