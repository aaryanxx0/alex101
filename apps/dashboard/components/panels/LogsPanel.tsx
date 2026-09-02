'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { LogEntry, LogLevel } from '@alex101/shared';

const LEVELS: LogLevel[] = ['DEBUG', 'INFO', 'SUCCESS', 'WARNING', 'ERROR'];

export function LogsPanel({ entries }: { entries: LogEntry[] }) {
  const [paused, setPaused] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<LogLevel | 'ALL'>('ALL');
  const [view, setView] = useState<LogEntry[]>(entries);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Update local view as new entries arrive, unless paused
  useEffect(() => {
    if (!paused) setView(entries);
  }, [entries, paused]);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [view, autoScroll]);

  const filtered = useMemo(() => {
    return view.filter((e) => {
      if (filter !== 'ALL' && e.level !== filter) return false;
      if (search && !`${e.message} ${e.category}`.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [view, search, filter]);

  return (
    <div className="panel" style={{ minHeight: 400 }}>
      <h3>Logs</h3>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button onClick={() => setPaused((p) => !p)}>{paused ? 'Resume' : 'Pause'}</button>
        <button onClick={() => setAutoScroll((a) => !a)}>Auto-scroll: {autoScroll ? 'on' : 'off'}</button>
        <select value={filter} onChange={(e) => setFilter(e.target.value as any)}>
          <option value="ALL">All levels</option>
          {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="search…" style={{ width: 200 }} />
        <button onClick={() => {
          const blob = new Blob([filtered.map((e) => `[${e.ts}] ${e.level} ${e.category}: ${e.message}`).join('\n')], { type: 'text/plain' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'alex101.log';
          a.click();
          URL.revokeObjectURL(url);
        }}>Download</button>
        <button onClick={() => navigator.clipboard?.writeText(filtered.map((e) => e.message).join('\n'))}>Copy</button>
      </div>
      <div
        ref={scrollRef}
        style={{ background: 'var(--bg-0)', marginTop: 8, padding: 8, borderRadius: 4, maxHeight: 480, overflowY: 'auto' }}
      >
        {filtered.length === 0 ? <div className="muted">No log entries.</div> : filtered.slice(-500).map((e) => (
          <div key={e.id} className={`log-line ${e.level}`}>
            [{new Date(e.ts).toLocaleTimeString()}] {e.level} {e.category}: {e.message}
          </div>
        ))}
      </div>
    </div>
  );
}