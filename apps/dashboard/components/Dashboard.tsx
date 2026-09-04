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

type ToastKind = 'error' | 'success' | 'info' | 'warning';

interface ToastItem {
  id: number;
  kind: ToastKind;
  text: string;
  leaving?: boolean;
}

const TOAST_VISIBLE_MS = 4600;
const TOAST_LEAVE_MS = 450;
const TOAST_DEDUPE_MS = 12000;

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
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const lastToastRef = useRef<{ text: string; ts: number } | null>(null);

  /** Push a toast: slide in, visible ~5s, slide out, removed from DOM. Deduped. */
  const pushToast = useCallback((kind: ToastKind, text: string) => {
    const now = Date.now();
    if (lastToastRef.current && lastToastRef.current.text === text && now - lastToastRef.current.ts < TOAST_DEDUPE_MS) return;
    lastToastRef.current = { text, ts: now };
    const id = now + Math.floor(Math.random() * 1000);
    setToasts((t) => [...t.slice(-3), { id, kind, text }]);
    setTimeout(() => {
      setToasts((t) => t.map((x) => (x.id === id ? { ...x, leaving: true } : x)));
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), TOAST_LEAVE_MS);
    }, TOAST_VISIBLE_MS);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((t) => t.map((x) => (x.id === id ? { ...x, leaving: true } : x)));
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), TOAST_LEAVE_MS);
  }, []);

  // ---- Diagnostics (visible with ?debug=1 or localStorage.alex101_debug=1) ----
  const [dbg] = useState(() => {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('debug') === '1'
      || window.localStorage.getItem('alex101_debug') === '1';
  });
  const [isTouchDevice] = useState(() => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches);
  const [diagToken, setDiagToken] = useState<'OK' | 'FAIL' | 'WAITING'>('WAITING');
  const [diagWs, setDiagWs] = useState<'CONNECTING' | 'CONNECTED' | 'AUTHENTICATED' | 'CLOSED' | 'ERROR'>('CONNECTING');
  const [diagSnapshot, setDiagSnapshot] = useState<'WAITING' | 'RECEIVED'>('WAITING');

  const wsRef = useRef<WebSocket | null>(null);
  const tokenRef = useRef<string>('');
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
        setDiagToken('FAIL');
        return;
      }
      const tokenData = await tokenRes.json();
      tokenRef.current = tokenData.token;
      setDiagToken('OK');
      setViewerUrl(workerUrl.replace(/\/$/, '') + '/viewer/');

      const wsUrl = workerUrl.replace(/^http/, 'ws') + '/ws';
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      setDiagWs('CONNECTING');

      ws.onopen = () => {
        setConnected(true);
        setDiagWs('CONNECTED');
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
            setDiagWs('AUTHENTICATED');
            setDiagSnapshot('RECEIVED');
            break;
          case 'snapshot':
            setSnapshot(msg.snapshot);
            setDiagSnapshot('RECEIVED');
            break;
          case 'log':
            setLogs((l) => [...l, msg.entry].slice(-300));
            break;
          case 'chat':
            setChat((c) => [...c, msg.message].slice(-200));
            break;
          case 'viewer-status':
            setViewerUrl(workerUrl.replace(/\/$/, '') + '/viewer/');
            break;
          case 'control-status':
            if (msg.status === 'CONTROL_GRANTED') pushToast('success', 'Control granted — this browser owns Alex101.');
            else if (msg.status === 'CONTROL_DENIED') pushToast('warning', msg.message || 'Alex101 is controlled by another session.');
            else pushToast('warning', `Control: ${msg.status}${msg.message ? ` — ${msg.message}` : ''}`);
            break;
          case 'error':
            pushToast('error', `${msg.code}: ${msg.message}`);
            break;
          case 'kicked':
            pushToast('error', `Kicked: ${msg.reason} — ${msg.raw}`);
            break;
        }
      };

      ws.onclose = (ev) => {
        setConnected(false);
        setDiagWs('CLOSED');
        // Stuck-key protection: dropping the WS must release all held keys.
        movementKeysRef.current.clear();
        console.warn(`[alex101] WS closed code=${ev.code} reason="${ev.reason}" wasClean=${ev.wasClean}`);
        wsRef.current = null;
        // Reconnect with backoff
        reconnectAttemptRef.current++;
        const delay = Math.min(8000, 1500 * 2 ** (reconnectAttemptRef.current - 1));
        setTimeout(() => { openWebSocket(); }, delay);
      };

      ws.onerror = () => {
        setDiagWs('ERROR');
        setAuthError('WebSocket error — check worker is running');
      };
    } catch (err) {
      setAuthError((err as Error).message);
      setDiagWs('ERROR');
    }
  }, [workerUrl]);

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
      AltLeft: 'sprint', AltRight: 'sprint',
    };
    function clearAllMovement() {
      movementKeysRef.current.clear();
      sendCommand({ type: 'clear-movement' });
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.repeat) return;
      if (!isController) return;
      if (e.target && (e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.target && (e.target as HTMLElement).tagName === 'TEXTAREA') return;
      const k = map[e.code];
      if (k) {
        e.preventDefault();
        if (k === 'sprint') e.preventDefault(); // prevent browser menu on Alt
        if (!movementKeysRef.current.has(e.code)) {
          movementKeysRef.current.add(e.code);
          applyMovement({ [k]: true } as any);
        }
      } else if (/Digit[1-9]/.test(e.code)) {
        const slot = Number(e.code.replace('Digit', '')) - 1;
        sendCommand({ type: 'select-hotbar', slot });
      } else if (e.code === 'Escape') {
        // ESC releases pointer lock and clears all held controls (stuck-key protection)
        if (document.pointerLockElement) document.exitPointerLock();
        clearAllMovement();
      }
    }
    function onKeyUp(e: KeyboardEvent) {
      const k = map[e.code];
      if (k) {
        movementKeysRef.current.delete(e.code);
        applyMovement({ [k]: false } as any);
      }
    }
    function onBlurProtection() {
      if (movementKeysRef.current.size > 0) clearAllMovement();
    }
    function onPointerLockLoss() {
      setPointerLock(!!document.pointerLockElement);
      if (!document.pointerLockElement && movementKeysRef.current.size > 0) clearAllMovement();
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlurProtection);
    document.addEventListener('pointerlockchange', onPointerLockLoss);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlurProtection);
      document.removeEventListener('pointerlockchange', onPointerLockLoss);
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
    sendCommand({ type: 'connect', options: opts, requestId: makeId('req') });
  }, []);
  const onDisconnect = useCallback(() => sendCommand({ type: 'disconnect' }), []);
  const onRespawn = useCallback(() => sendCommand({ type: 'respawn' }), []);
  const onEmergencyStop = useCallback(() => sendCommand({ type: 'emergency-stop' }), []);

  // ---- Lifecycle toolbar (START/STOP BOT) ----
  const connState = snapshot?.connection.state ?? 'OFFLINE';
  const canStart = connState === 'OFFLINE' || connState === 'ERROR';
  const canStop = !canStart && connState !== 'DISCONNECTING';
  const startBot = useCallback(() => {
    const c = snapshot?.connection;
    if (!c) return;
    // authPassword intentionally omitted: the worker resolves the saved
    // protected setting / BOT_PASSWORD env (password never round-trips here).
    onConnect({
      host: c.host,
      port: c.port,
      username: c.configuredUsername,
      version: c.minecraftVersion,
      authMode: c.authMode,
      autoReconnect: true,
      reconnectDelayMs: 5000,
      viewDistance: snapshot?.viewer.renderDistance ?? 6,
    });
  }, [snapshot?.connection, snapshot?.viewer.renderDistance, onConnect]);
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
  const otherController = !!snapshot?.control?.controllerId && !isControllerFromSnapshot;
  useEffect(() => { setIsController(isControllerFromSnapshot); }, [isControllerFromSnapshot]);

  // Auto-claim control right after authentication when no one owns it.
  useEffect(() => {
    if (!snapshot) return;
    if (snapshot.control.controllerId === controllerIdRef.current) return; // we own it
    if (snapshot.control.controllerId) return; // someone else owns it (read-only + Take control)
    sendCommand({ type: 'request-control' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!snapshot, snapshot?.control?.controllerId]);

  const onRequestControl = () => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || !tokenRef.current) {
      pushToast('warning', 'CONTROL_WS_OFFLINE — realtime connection to the worker is not available.');
      return;
    }
    sendCommand({ type: 'request-control', take: otherController });
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

  // Toast triggers — pushed once per state change, auto-dismissed by the stack.
  useEffect(() => {
    if (authError) pushToast('error', authError);
  }, [authError, pushToast]);
  useEffect(() => {
    if (lastDisconnectFriendly) {
      pushToast('error', `Last disconnect: ${lastDisconnectFriendly}${snapshot?.connection.lastDisconnectMessage ? ` — ${snapshot.connection.lastDisconnectMessage}` : ''}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastDisconnectFriendly]);

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
          {canStart && <button className="primary" onClick={startBot}>START BOT</button>}
          {canStop && <button className="danger" onClick={onDisconnect}>STOP BOT</button>}
          {connState === 'SPAWNED' && <button onClick={onRespawn}>Respawn</button>}
          {connState === 'SPAWNED' && <button className="danger" onClick={onEmergencyStop}>EMERGENCY STOP</button>}
          {!isController && otherController && (
            <button onClick={onRequestControl}>Take control</button>
          )}
          {isController && <span style={{ fontSize: 12, color: 'var(--good)' }}>You control Alex101</span>}
          <form action="/api/logout" method="POST">
            <button type="submit">Sign out</button>
          </form>
          <HeartbeatIndicator />
        </div>
      </header>

      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast-item ${t.kind}${t.leaving ? ' leaving' : ''}`}>
            <span>{t.text}</span>
            <button className="toast-close" aria-label="Dismiss" onClick={() => dismissToast(t.id)}>×</button>
          </div>
        ))}
      </div>
      {dbg && (
        <div style={{ position: 'fixed', bottom: 8, right: 8, zIndex: 9999, fontSize: 11, fontFamily: 'monospace', background: 'rgba(0,0,0,.85)', color: '#9f9', padding: '6px 10px', borderRadius: 6 }}>
          HTTP: OK · TOKEN: {diagToken} · WS: {diagWs} · SNAPSHOT: {diagSnapshot} · CONTROL: {isController ? 'OWNED_BY_THIS_BROWSER' : otherController ? 'OWNED_BY_OTHER' : 'NONE'}
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
              {isConnected && viewerUrl ? (
                <ViewerCanvas baseUrl={viewerUrl} pointerLock={pointerLock} isConnected={isConnected} />
              ) : (
                <div className="viewer-empty">
                  <h2 style={{ marginTop: 0 }}>Alex101 is offline</h2>
                  <p className="muted">Connect the bot to start live view. The WebGL viewer starts as soon as Alex101 spawns.</p>
                </div>
              )}
              {!pointerLock && isController && isConnected && (
                <div className="fullscreen-prompt">Click to enable pointer lock — WASD/mouse to control</div>
              )}
              <HudOverlay snapshot={snapshot} isController={isController} />
              {isController && isTouchDevice && (
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
              {isTouchDevice && (
                <ControlPad onPress={(key, value) => {
                  if (key === 'jump') {
                    if (value) applyMovement({ jump: true });
                    else applyMovement({ jump: false });
                  } else {
                    applyMovement({ [key]: value } as any);
                  }
                }} />
              )}
              {connState === 'SPAWNED' && <button className="danger" onClick={onEmergencyStop}>EMERGENCY STOP</button>}
              {connState === 'SPAWNED' && <button onClick={onRespawn}>Respawn</button>}
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
    case 'CONNECTION_CONFLICT':
      return 'error';
    default: return 'off';
  }
}