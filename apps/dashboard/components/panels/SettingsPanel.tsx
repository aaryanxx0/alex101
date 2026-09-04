'use client';

import { useState } from 'react';
import type { AuthMode, BotSnapshot, ConnectOptions, PersistedSettings } from '@alex101/shared';

interface Props {
  snapshot: BotSnapshot | null;
  onConnect: (opts: ConnectOptions) => void;
  onDisconnect: () => void;
  onUpdateSettings: (s: Partial<PersistedSettings>) => void;
  onLookAtCoords: (x: number, y: number, z: number) => void;
}

export function SettingsPanel({ snapshot, onConnect, onDisconnect, onUpdateSettings, onLookAtCoords }: Props) {
  const c = snapshot?.connection;
  const [host, setHost] = useState(c?.host ?? 'mc.238458.xyz');
  const [port, setPort] = useState(c?.port ?? 25565);
  const [username, setUsername] = useState(c?.configuredUsername ?? 'Alex101');
  const [version, setVersion] = useState(c?.minecraftVersion ?? '1.21.11');
  const [authMode, setAuthMode] = useState<AuthMode>(c?.authMode ?? 'offline');
  const [autoReconnect, setAutoReconnect] = useState(true);
  const [reconnectDelayMs, setReconnectDelayMs] = useState(5000);
  const [viewDistance, setViewDistance] = useState(6);
  const [mouseSensitivity, setMouseSensitivity] = useState(0.15);
  const [followDistance, setFollowDistance] = useState(3);
  const [autoRespawn, setAutoRespawn] = useState(true);
  const [enableRendering, setEnableRendering] = useState(true);
  const [authPassword, setAuthPassword] = useState('');
  const [lx, setLx] = useState('0');
  const [ly, setLy] = useState('64');
  const [lz, setLz] = useState('0');
  const [commandText, setCommandText] = useState('/tp Alex101 0 64 0');

  return (
    <div className="col" style={{ gap: 12, maxWidth: 720 }}>
      <div className="panel">
        <h3>Connection</h3>
        <div className="grid-2">
          <div><label>Minecraft host</label><input value={host} onChange={(e) => setHost(e.target.value)} /></div>
          <div><label>Port</label><input type="number" value={port} onChange={(e) => setPort(Number(e.target.value))} /></div>
          <div><label>Username</label><input value={username} onChange={(e) => setUsername(e.target.value)} /></div>
          <div><label>Minecraft version</label><input value={version} onChange={(e) => setVersion(e.target.value)} /></div>
          <div>
            <label>Authentication</label>
            <select value={authMode} onChange={(e) => setAuthMode(e.target.value as AuthMode)}>
              <option value="offline">offline (server permits)</option>
              <option value="microsoft">microsoft (device-code)</option>
            </select>
          </div>
          <div><label>View distance (chunks)</label>
            <input type="number" min={1} max={32} value={viewDistance} onChange={(e) => setViewDistance(Math.max(1, Math.min(32, Number(e.target.value))))} />
          </div>
          <div>
            <label>Minecraft server / AuthMe password</label>
            <input
              type="password"
              value={authPassword}
              onChange={(e) => setAuthPassword(e.target.value)}
              placeholder={snapshot?.connection.authPasswordSet ? 'Password is saved on the worker — type only to change it' : 'Sent as /login after spawn (server-dependent)'}
              autoComplete="new-password"
            />
            <div className="row" style={{ gap: 8, marginTop: 6, alignItems: 'center' }}>
              <span className="tiny muted">
                Status: <strong style={{ color: snapshot?.connection.authPasswordSet ? 'var(--good)' : 'var(--warn)' }}>
                  {snapshot?.connection.authPasswordSet ? 'Configured' : 'Not configured'}
                </strong>
                {' — '}
                <span style={{ color: 'var(--fg-2)' }}>the saved value never leaves the worker.</span>
              </span>
            </div>
            <div className="row" style={{ gap: 8, marginTop: 6 }}>
              <button onClick={() => onUpdateSettings({ authPassword })} disabled={!authPassword}>Save securely</button>
              {authPassword && <button onClick={() => { setAuthPassword(''); onUpdateSettings({ authPassword: '' }); }}>Clear saved password</button>}
            </div>
          </div>
        </div>
        <div className="row" style={{ gap: 16, marginTop: 12 }}>
          <label><input type="checkbox" checked={autoReconnect} onChange={(e) => setAutoReconnect(e.target.checked)} /> Auto-reconnect</label>
          <label><input type="checkbox" checked={enableRendering} onChange={(e) => setEnableRendering(e.target.checked)} /> Enable WebGL viewer</label>
        </div>
        <div className="row" style={{ gap: 8, marginTop: 12 }}>
          <button className="primary" onClick={() => onConnect({ host, port, username, version, authMode, autoReconnect, reconnectDelayMs, viewDistance, authPassword })}>
            {snapshot?.connection.state === 'OFFLINE' || snapshot?.connection.state === 'ERROR' ? 'Connect' : 'Reconnect'}
          </button>
          <button className="danger" onClick={onDisconnect} disabled={snapshot?.connection.state === 'OFFLINE'}>Disconnect</button>
        </div>
      </div>

      <div className="panel">
        <h3>Controls</h3>
        <div className="grid-2">
          <div>
            <label>Reconnect delay (ms)</label>
            <input type="number" min={500} max={60000} value={reconnectDelayMs} onChange={(e) => setReconnectDelayMs(Number(e.target.value))} />
          </div>
          <div>
            <label>Mouse sensitivity (deg/px)</label>
            <input type="number" step={0.05} value={mouseSensitivity} onChange={(e) => {
              const v = Number(e.target.value);
              setMouseSensitivity(v);
              (window as any).__alex101_sens = v;
            }} />
          </div>
          <div>
            <label>Follow distance (blocks)</label>
            <input type="number" min={1} max={16} value={followDistance} onChange={(e) => setFollowDistance(Math.max(1, Math.min(16, Number(e.target.value))))} />
          </div>
          <div>
            <label>Auto-respawn</label>
            <select value={autoRespawn ? 'yes' : 'no'} onChange={(e) => setAutoRespawn(e.target.value === 'yes')}>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </div>
        </div>
        <button style={{ marginTop: 8 }} onClick={() => onUpdateSettings({ autoReconnect, reconnectDelayMs, viewDistance, mouseSensitivity, followDistance, autoRespawn, enableRendering, authPassword })}>
          Save preferences
        </button>
      </div>

      <div className="panel">
        <h3>Look at coordinates</h3>
        <div className="grid-3">
          <input value={lx} onChange={(e) => setLx(e.target.value)} />
          <input value={ly} onChange={(e) => setLy(e.target.value)} />
          <input value={lz} onChange={(e) => setLz(e.target.value)} />
        </div>
        <button style={{ marginTop: 8 }} onClick={() => {
          const xv = Number(lx), yv = Number(ly), zv = Number(lz);
          if (!Number.isFinite(xv) || !Number.isFinite(yv) || !Number.isFinite(zv)) return;
          onLookAtCoords(xv, yv, zv);
        }}>Look at</button>
      </div>

      <div className="panel">
        <h3>Manual command (requires server permission / OP)</h3>
        <p className="muted tiny">This sends the raw chat line through Alex101. Commands such as <code>/tp</code>, <code>/gamemode</code>, <code>/give</code> only work if Alex101 has the necessary operator permission on the server. The bot does not attempt to bypass.</p>
        <input value={commandText} onChange={(e) => setCommandText(e.target.value)} placeholder="/tp Alex101 0 64 0" />
        <button style={{ marginTop: 8 }} onClick={() => {
          if (!commandText.startsWith('/')) return;
          // Send through chat channel.
          (window as any).__alex101_send_chat?.(commandText);
        }}>Send (requires OP)</button>
      </div>

      <div className="panel">
        <h3>Authentication notes</h3>
        <p className="muted tiny">
          <strong>OFFLINE MODE</strong> works only if the Minecraft server permits offline-mode usernames. The server may still reject the bot if the whitelist is enabled.
        </p>
        <p className="muted tiny">
          <strong>MICROSOFT MODE</strong> uses the official prismarine-auth device-code flow. A code will be printed in the bot-worker logs and surfaced as a warning in the Logs panel. The Microsoft account password is NEVER collected through this website.
        </p>
      </div>

      <div className="panel">
        <h3>Whitelist</h3>
        <p className="muted tiny">
          If the server has a whitelist enabled and Alex101 is not on it, the connection will be rejected with the actual server message. The dashboard will show the rejection clearly and stop auto-reconnecting.
        </p>
      </div>
    </div>
  );
}