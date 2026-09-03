import type { DisconnectReason } from '@alex101/shared';

/**
 * Map raw errors / kick messages to normalized reasons the UI can display.
 */
export function classifyError(rawMessage: string, code?: string): DisconnectReason {
  const msg = String(rawMessage || '').toLowerCase();
  if (code === 'ENOTFOUND') return 'DNS_RESOLUTION_ERROR';
  if (code === 'ECONNREFUSED') return 'CONNECTION_REFUSED';
  if (code === 'ETIMEDOUT' || code === 'ECONNRESET' || code === 'EHOSTUNREACH') {
    if (/timeout|timed out/i.test(msg)) return 'CONNECTION_TIMEOUT';
    return 'CONNECTION_RESET';
  }
  if (!code && /disconnected|connection lost|closed/i.test(msg)) return 'LOST_CONNECTION';

  if (/whitelist|not on the whitelist|you are not on/i.test(msg)) return 'WHITELIST_REJECTION';
  if (/server is full|full/i.test(msg) && /server/i.test(msg)) return 'SERVER_FULL';
  if (/already connected/i.test(msg)) return 'CONFLICTING_CONNECTION';
  if (/banned/i.test(msg)) return 'BANNED';
  if (/outdated|incompatible protocol/i.test(msg)) return 'UNSUPPORTED_PROTOCOL';
  if (/invalid session|session.*invalid/i.test(msg)) return 'INVALID_SESSION';
  if (/microsoft.*auth|auth.*required|please authenticate/i.test(msg)) return 'MICROSOFT_AUTH_FAILURE';
  if (/server.*restart|server is restarting/i.test(msg)) return 'SERVER_RESTART';
  if (/kicked|kick/i.test(msg)) return 'KICKED';
  if (/timeout/i.test(msg)) return 'CONNECTION_TIMEOUT';
  return 'UNKNOWN';
}

export function friendlyReason(reason: DisconnectReason): string {
  switch (reason) {
    case 'DNS_RESOLUTION_ERROR': return 'Could not resolve the Minecraft server hostname.';
    case 'CONNECTION_REFUSED': return 'The Minecraft server actively refused the connection.';
    case 'CONNECTION_TIMEOUT': return 'The connection to the Minecraft server timed out.';
    case 'SERVER_OFFLINE': return 'The Minecraft server appears to be offline.';
    case 'UNSUPPORTED_PROTOCOL': return 'The Minecraft server uses an unsupported protocol version.';
    case 'VERSION_MISMATCH': return 'The configured Minecraft version does not match the server.';
    case 'AUTH_REQUIRED': return 'The server requires authenticated login.';
    case 'MICROSOFT_AUTH_FAILURE': return 'Microsoft authentication failed.';
    case 'INVALID_SESSION': return 'The Minecraft session is invalid or expired.';
    case 'WHITELIST_REJECTION': return 'Server whitelist rejected the connection.';
    case 'SERVER_FULL': return 'The Minecraft server is full.';
    case 'BANNED': return 'The bot is banned from this server.';
    case 'KICKED': return 'The bot was kicked by the server.';
    case 'CONNECTION_RESET': return 'The connection was reset.';
    case 'SERVER_RESTART': return 'The Minecraft server restarted.';
    case 'LOST_CONNECTION': return 'Connection lost.';
    default: return 'Unknown error.';
  }
}

export function isPermanent(reason: DisconnectReason): boolean {
  switch (reason) {
    case 'WHITELIST_REJECTION':
    case 'BANNED':
    case 'INVALID_SESSION':
    case 'MICROSOFT_AUTH_FAILURE':
    case 'UNSUPPORTED_PROTOCOL':
      return true;
    default:
      return false;
  }
}