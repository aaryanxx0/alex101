'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { ViewerCanvas } from './ViewerCanvas';
import { StatusPanel } from './panels/StatusPanel';
import { PositionPanel } from './panels/PositionPanel';
import { PlayersPanel } from './panels/PlayersPanel';
import { NavPanel } from './panels/NavPanel';
import { SettingsPanel } from './panels/SettingsPanel';
import { LogsPanel } from './panels/LogsPanel';
import { InventoryPanel } from './panels/InventoryPanel';
import { EntitiesPanel } from './panels/EntitiesPanel';
import { ChatPanel } from './panels/ChatPanel';
import { HudOverlay } from './HudOverlay';
import { ControlPad } from './ControlPad';
import { MobileOverlay } from './MobileOverlay';
import { HeartbeatIndicator } from './HeartbeatIndicator';
import {
  type BotSnapshot,
  type ClientCommand,
  type ChatMessage,
  type ConnectOptions,
  type DisconnectReason,
  type LogEntry,
  type ServerEvent,
  DEFAULT_SETTINGS,
  makeId,
  clampPitch,
  clampYaw,
} from '@alex101/shared';

type Tab = 'play' | 'navigation' | 'players' | 'inventory' | 'chat' | 'logs' | 'settings';

interface DashboardProps {
  workerUrl: string;
}

export function Dashboard({ workerUrl }: DashboardProps) {
  const [snapshot, setSnapshot] = useState<BotSnapshot | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [connected, setConnected] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('play');
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);
  const [pointerLock, setPointerLock] = useState(false);
  const [isController, setIsController] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const controllerIdRef = useRef<string>(makeId('ctrl'));
  const controllerNameRef = useRef<string>('Browser');
  const movementKeysRef = useRef<Set<string>>(new Set());
  const lastLookRef = useRef<{ yaw: number; pitch: number; ts: number } | null>(null);
  const heartbeatRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);

  // ----- Worker websocket connection -----
  const openWebSocket = useCallback(async () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return;
    setAuthError(null);
    try {
      const tokenRes = await fetch('/api/worker/token', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ controllerId: controllerIdRef.current }),
      });
      if (!tokenRes.ok) {
        const err = await tokenRes.json().catch(() => ({}));
        setAuthError(err?.error || 'Failed to get token');
        return;
      }
      const tokenData = await tokenRes.json();
      setViewerUrl(tokenData.viewerBaseUrl);

      const wsUrl = workerUrl.replace(/^http/, 'ws') + '/ws';
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        const hello: ClientCommand = {
          type: 'hello',
          token: tokenData.token,
          controllerId: controllerIdRef.current,
          controllerName: controllerNameRef.current,
        };
        ws.send(JSON.stringify(hello));
      };

      ws.onmessage = (ev) => {
        let msg: ServerEvent;
        try { msg = JSON.parse(ev.data); } catch { return; }
        switch (msg.type) {
          case 'welcome':
            setSnapshot(msg.snapshot);
            setLogs(msg.recentLogs);
            setChat(msg.recentChat);
            if (msg.snapshot.connection.actualUsername) setViewerUrl(msg.snapshot.viewer.viewerBaseUrl || viewerUrl);
            break;
          case 'snapshot':
            setSnapshot(msg.snapshot);
            break;
          case 'log':
            setLogs((l) => [...l, msg.entry].slice(-300));
            break;
          case 'chat':
            setChat((c) => [...c, msg.message].slice(-200));
            break;
          case 'viewer-status':
            setViewerUrl(msg.viewer.viewerBaseUrl || viewerUrl);
            break;
          case 'error':
            setStatusMessage(`${msg.code}: ${msg.message}`);
            break;
          case 'kicked':
            setStatusMessage(`Kicked: ${msg.reason} — ${msg.raw}`);
            break;
        }
      };

      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;
        // Reconnect with backoff
        reconnectAttemptRef.current++;
        const delay = Math.min(8000, 1500 * 2 ** (reconnectAttemptRef.current - 1));
        setTimeout(() => { openWebSocket(); }, delay);
      };

      ws.onerror = () => {
        setAuthError('WebSocket error — check worker is running');
      };
    } catch (err) {
      setAuthError((err as Error).message);
    }
  }, [workerUrl, viewerUrl]);

  useEffect(() => {
    openWebSocket();
    return () => {
      wsRef.current?.close();
    };
  }, [openWebSocket]);

  // Heartbeat
  useEffect(() => {
    if (!connected) return;
    const id = window.setInterval(() => {
      sendCommand({ type: 'heartbeat', controllerId: controllerIdRef.current, ts: Date.now() });
    }, 1500);
    heartbeatRef.current = id;
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

  // Visibility / focus loss => clear movement
  useEffect(() => {
    const handler = () => {
      if (movementKeysRef.current.size > 0) {
        movementKeysRef.current.clear();
        sendCommand({ type: 'clear-movement' });
      }
    };
    window.addEventListener('blur', handler);
    document.addEventListener('visibilitychange', handler);
    return () => {
      window.removeEventListener('blur', handler);
      document.removeEventListener('visibilitychange', handler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function sendCommand(cmd: ClientCommand) {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(cmd));
  }

  // ---- Control ----
  function applyMovement(diff: Partial<{ forward: boolean; back: boolean; left: boolean; right: boolean; jump: boolean; sprint: boolean; sneak: boolean }>) {
    if (!isController) return;
    sendCommand({ type: 'movement', state: diff });
  }

  // ---- Keyboard ----
  useEffect(() => {
    const map: Record<string, 'forward' | 'back' | 'left' | 'right' | 'jump' | 'sprint' | 'sneak'> = {
      KeyW: 'forward', ArrowUp: 'forward',
      KeyS: 'back', ArrowDown: 'back',
      KeyA: 'left', ArrowLeft: 'left',
      KeyD: 'right', ArrowRight: 'right',
      Space: 'jump',
      ShiftLeft: 'sneak', ShiftRight: 'sneak',
      ControlLeft: 'sprint', ControlRight: 'sprint',
    };
    function onKeyDown(e: KeyboardEvent) {
      if (e.repeat) return;
      if (!isController) return;
      if (e.target && (e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.target && (e.target as HTMLElement).tagName === 'TEXTAREA') return;
      const k = map[e.code];
      if (k) {
        e.preventDefault();
        if (!movementKeysRef.current.has(e.code)) {
          movementKeysRef.current.add(e.code);
          applyMovement({ [k]: true } as any);
        }
      } else if (e.code === 'KeyT' || (e.code === 'Enter' && !snapshot?.control?.controllerId)) {
        // T to focus chat input handled separately
      } else if (/Digit[1-9]/.test(e.code)) {
        const slot = Number(e.code.replace('Digit', '')) - 1;
        sendCommand({ type: 'select-hotbar', slot });
      } else if (e.code === 'Escape') {
        if (document.pointerLockElement) {
          document.exitPointerLock();
        }
      }
    }
    function onKeyUp(e: KeyboardEvent) {
      const k = map[e.code];
      if (k) {
        movementKeysRef.current.delete(e.code);
        applyMovement({ [k]: false } as any);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [isController, snapshot?.control?.controllerId]);

  // Pointer lock + mouse look
  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!document.pointerLockElement) return;
      if (!isController) return;
      const sens = snapshot?.player ? Number(((window as any).__alex101_sens) ?? 0.15) : 0.15;
      const yaw = (snapshot?.control.yaw ?? 0) - e.movementX * sens;
      const pitch = clampPitch((snapshot?.control.pitch ?? 0) - e.movementY * sens);
      const ts = Date.now();
      // Throttle to 30hz
      if (lastLookRef.current && ts - lastLookRef.current.ts < 33) return;
      lastLookRef.current = { yaw: clampYaw(yaw), pitch, ts };
      sendCommand({ type: 'look', yaw: clampYaw(yaw), pitch, ts });
    }
    function onPointerLockChange() {
      setPointerLock(!!document.pointerLockElement);
    }
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('pointerlockchange', onPointerLockChange);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('pointerlockchange', onPointerLockChange);
    };
  }, [isController, snapshot?.control.yaw, snapshot?.control.pitch, snapshot?.player]);

  const settings = snapshot?.connection;

  const onConnect = useCallback((opts: ConnectOptions) => {
    sendCommand({ type: 'connect', options: opts });
  }, []);
  const onDisconnect = useCallback(() => sendCommand({ type: 'disconnect' }), []);
  const onRespawn = useCallback(() => sendCommand({ type: 'respawn' }), []);
  const onEmergencyStop = useCallback(() => sendCommand({ type: 'emergency-stop' }), []);
  const onChatSend = useCallback((msg: string) => sendCommand({ type: 'chat', message: msg }), []);
  useEffect(() => {
    (window as any).__alex101_send_chat = onChatSend;
    return () => { delete (window as any).__alex101_send_chat; };
  }, [onChatSend]);
  const onGoto = useCallback((x: number, y: number, z: number) => sendCommand({ type: 'goto', x, y, z }), []);
  const onFollow = useCallback((username: string, distance: number) => sendCommand({ type: 'follow-player', username, distance }), []);
  const onStopFollow = useCallback(() => sendCommand({ type: 'stop-follow' }), []);
  const onLookAtPlayer = useCallback((username: string) => sendCommand({ type: 'look-at-player', username }), []);
  const onLookAtCoords = useCallback((x: number, y: number, z: number) => sendCommand({ type: 'look-at-coords', x, y, z }), []);
  const onCancelNav = useCallback(() => sendCommand({ type: 'cancel-navigation' }), []);
  const onSelectHotbar = useCallback((slot: number) => sendCommand({ type: 'select-hotbar', slot }), []);
  const onUpdateSettings = useCallback((s: Partial<typeof DEFAULT_SETTINGS>) => sendCommand({ type: 'set-settings', settings: s }), []);

  const isConnected = !!snapshot && (snapshot.connection.state === 'CONNECTED' || snapshot.connection.state === 'SPAWNED' || snapshot.connection.state === 'SPAWNING');
  const isControllerFromSnapshot = snapshot?.control?.controllerId === controllerIdRef.current;
  useEffect(() => { setIsController(isControllerFromSnapshot); }, [isControllerFromSnapshot]);

  const onRequestControl = () => {
    sendCommand({ type: 'hello', token: '__placeholder__', controllerId: controllerIdRef.current, controllerName: controllerNameRef.current } as any);
  };

  const onEnterPointerLock = useCallback(() => {
    if (document.pointerLockElement) return;
    const el = document.querySelector('.viewer-shell') as HTMLElement | null;
    el?.requestPointerLock?.();
  }, []);

  const lastDisconnectFriendly = useMemo(() => {
    if (!snapshot) return null;
    const r: DisconnectReason = snapshot.connection.lastDisconnect;
    if (r === 'NONE') return null;
    return `${r}`;
  }, [snapshot?.connection.lastDisconnect]);

  return (
    <div className="app-root">
      <header className="topbar">
        <div className="row" style={{ gap: 12 }}>
          <h1>Alex101</h1>
          <span className="meta">
            <span><span className={`dot ${dotClass(snapshot?.connection.state)}`} /> {snapshot?.connection.state ?? 'OFFLINE'}</span>
            <span><strong>{snapshot?.connection.host ?? 'mc.238458.xyz'}</strong>:{snapshot?.connection.port ?? 25565}</span>
            <span>mc <strong>{snapshot?.connection.minecraftVersion ?? '1.21.11'}</strong></span>
            <span><strong>{snapshot?.connection.actualUsername ?? snapshot?.connection.configuredUsername ?? 'Alex101'}</strong></span>
            {snapshot?.ping?.ms !== null && snapshot?.ping?.ms !== undefined && <span>Ping {snapshot?.ping.ms}ms</span>}
          </span>
        </div>
        <div className="row">
          {snapshot?.viewer?.viewerBaseUrl && (
            <a href={snapshot.viewer.viewerBaseUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', fontSize: 12 }}>
              Open viewer in new tab
            </a>
          )}
          {!isController && snapshot?.connection.state !== 'OFFLINE' && (
            <button onClick={onRequestControl}>Request control</button>
          )}
          {isController && <span style={{ fontSize: 12, color: 'var(--good)' }}>You control Alex101</span>}
          <form action="/api/logout" method="POST">
            <button type="submit">Sign out</button>
          </form>
          <HeartbeatIndicator />
        </div>
      </header>

      {authError && <div className="toast error">{authError}</div>}
      {lastDisconnectFriendly && (
        <div className="toast error" style={{ left: 16, right: 'auto' }}>
          Last disconnect: {lastDisconnectFriendly} — {snapshot?.connection.lastDisconnectMessage}
        </div>
      )}

      <nav className="app-tabs">
        <button className={tab === 'play' ? 'active' : ''} onClick={() => setTab('play')}>Play</button>
        <button className={tab === 'navigation' ? 'active' : ''} onClick={() => setTab('navigation')}>Navigation</button>
        <button className={tab === 'players' ? 'active' : ''} onClick={() => setTab('players')}>Players</button>
        <button className={tab === 'inventory' ? 'active' : ''} onClick={() => setTab('inventory')}>Inventory</button>
        <button className={tab === 'chat' ? 'active' : ''} onClick={() => setTab('chat')}>Chat</button>
        <button className={tab === 'logs' ? 'active' : ''} onClick={() => setTab('logs')}>Logs</button>
        <button className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')}>Settings</button>
      </nav>

      {tab === 'play' && (
        <div className="layout">
          <div>
            <div className="viewer-shell">
              {viewerUrl ? (
                <ViewerCanvas baseUrl={viewerUrl} pointerLock={pointerLock} isConnected={isConnected} />
              ) : (
                <div className="viewer-empty">
                  <h2 style={{ marginTop: 0 }}>Viewer not ready yet</h2>
                  <p className="muted">The prismarine-viewer server starts as soon as the bot spawns. Connect Alex101 to see the world.</p>
                </div>
              )}
              {!pointerLock && isController && isConnected && (
                <div className="fullscreen-prompt">Click to enable pointer lock — WASD/mouse to control</div>
              )}
              <HudOverlay snapshot={snapshot} isController={isController} />
              {isController && (
                <MobileOverlay
                  onMove={(k, v) => applyMovement({ [k]: v } as any)}
                  onJump={() => applyMovement({ jump: true })}
                  onJumpRelease={() => applyMovement({ jump: false })}
                  onSprint={(v) => applyMovement({ sprint: v })}
                  onSneak={(v) => applyMovement({ sneak: v })}
                />
                )}
              <div
                className="click-capture"
                style={{ position: 'absolute', inset: 0, cursor: 'pointer' }}
                onClick={onEnterPointerLock}
              />
            </div>
            <div className="row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
              <ControlPad onPress={(key, value) => {
                if (key === 'jump') {
                  if (value) applyMovement({ jump: true });
                  else applyMovement({ jump: false });
                } else {
                  applyMovement({ [key]: value } as any);
                }
              }} />
              <button className="danger" onClick={onEmergencyStop}>EMERGENCY STOP</button>
              <button onClick={onRespawn}>Respawn</button>
            </div>
          </div>
          <div className="sidebar">
            <StatusPanel snapshot={snapshot} />
            <PositionPanel snapshot={snapshot} />
            <NavPanel snapshot={snapshot} onGoto={onGoto} onCancel={onCancelNav} disabled={!isController} />
          </div>
        </div>
      )}

      {tab === 'navigation' && (
        <div style={{ padding: 16 }}>
          <NavPanel snapshot={snapshot} onGoto={onGoto} onCancel={onCancelNav} disabled={!isController} expanded />
        </div>
      )}
      {tab === 'players' && (
        <div style={{ padding: 16 }}>
          <PlayersPanel snapshot={snapshot} onFollow={onFollow} onLookAt={onLookAtPlayer} disabled={!isController} />
          <EntitiesPanel snapshot={snapshot} />
        </div>
      )}
      {tab === 'inventory' && (
        <div style={{ padding: 16 }}>
          <InventoryPanel snapshot={snapshot} onSelectHotbar={onSelectHotbar} />
        </div>
      )}
      {tab === 'chat' && (
        <div style={{ padding: 16 }}>
          <ChatPanel messages={chat} onSend={onChatSend} disabled={!isController} />
        </div>
      )}
      {tab === 'logs' && (
        <div style={{ padding: 16 }}>
          <LogsPanel entries={logs} />
        </div>
      )}
      {tab === 'settings' && (
        <div style={{ padding: 16 }}>
          <SettingsPanel snapshot={snapshot} onConnect={onConnect} onDisconnect={onDisconnect} onUpdateSettings={onUpdateSettings} onLookAtCoords={onLookAtCoords} />
        </div>
      )}
    </div>
  );
}

function dotClass(state?: string): string {
  switch (state) {
    case 'OFFLINE': return 'off';
    case 'CONNECTING':
    case 'AUTHENTICATING':
    case 'RECONNECTING':
    case 'DISCONNECTING':
    case 'SPAWNING':
      return 'connecting';
    case 'CONNECTED':
    case 'SPAWNED':
      return 'connected';
    case 'ERROR':
      return 'error';
    default: return 'off';
  }
}