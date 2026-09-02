'use client';

import { useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '@alex101/shared';

interface Props {
  messages: ChatMessage[];
  onSend: (msg: string) => void;
  disabled: boolean;
}

export function ChatPanel({ messages, onSend, disabled }: Props) {
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length]);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target && ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA')) return;
      if (e.code === 'KeyT' || e.code === 'Enter') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className="panel" style={{ display: 'flex', flexDirection: 'column', minHeight: 400 }}>
      <h3>Chat</h3>
      <div ref={listRef} style={{ flex: 1, overflowY: 'auto', background: 'var(--bg-0)', padding: 8, borderRadius: 4, minHeight: 280 }}>
        {messages.length === 0 ? <div className="muted">No chat yet.</div> : null}
        {messages.map((m) => (
          <div key={m.id} className="log-line" style={{ padding: '4px 6px', color: m.isWhisper ? '#d2a44d' : m.isSystem ? 'var(--fg-2)' : 'var(--fg-0)' }}>
            <span className="muted tiny">[{new Date(m.ts).toLocaleTimeString()}] </span>
            <strong>{m.sender}: </strong>{m.text}
          </div>
        ))}
      </div>
      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          const value = text.trim();
          if (!value) return;
          onSend(value);
          setText('');
        }}
      >
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.code === 'Escape') {
              (e.target as HTMLInputElement).blur();
            }
          }}
          placeholder={disabled ? 'You do not have control. Request it from the top bar.' : 'Type chat (T or Enter)'}
          disabled={disabled}
          maxLength={256}
        />
        <button type="submit" disabled={disabled || !text.trim()} className="primary">Send</button>
      </form>
    </div>
  );
}