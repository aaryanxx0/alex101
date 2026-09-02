'use client';

import { useState } from 'react';

interface MobileOverlayProps {
  onMove: (key: 'forward' | 'back' | 'left' | 'right', value: boolean) => void;
  onJump: () => void;
  onJumpRelease: () => void;
  onSprint: (value: boolean) => void;
  onSneak: (value: boolean) => void;
}

export function MobileOverlay({ onMove, onJump, onJumpRelease, onSprint, onSneak }: MobileOverlayProps) {
  const [show, setShow] = useState(true);
  if (!show) {
    return (
      <div className="mobile-overlay">
        <button style={{ position: 'absolute', top: 12, left: 12, pointerEvents: 'auto' }} onClick={() => setShow(true)}>Show mobile controls</button>
      </div>
    );
  }
  function touch(key: 'forward' | 'back' | 'left' | 'right') {
    return {
      onTouchStart: (e: React.TouchEvent) => { e.preventDefault(); onMove(key, true); },
      onTouchEnd: (e: React.TouchEvent) => { e.preventDefault(); onMove(key, false); },
      onTouchCancel: () => onMove(key, false),
    };
  }
  return (
    <div className="mobile-overlay">
      <button style={{ position: 'absolute', top: 12, left: 12, pointerEvents: 'auto' }} onClick={() => setShow(false)}>Hide mobile controls</button>
      <div className="mobile-controls">
        <button className="forward" {...touch('forward')}>▲</button>
        <button className="left" {...touch('left')}>◀</button>
        <button className="right" {...touch('right')}>▶</button>
        <button className="back" {...touch('back')}>▼</button>
      </div>
      <div className="mobile-actions">
        <button onTouchStart={onJump} onTouchEnd={onJumpRelease}>Jump</button>
        <button
          onTouchStart={() => onSprint(true)} onTouchEnd={() => onSprint(false)}
          onMouseDown={() => onSprint(true)} onMouseUp={() => onSprint(false)}
        >Sprint</button>
        <button
          onTouchStart={() => onSneak(true)} onTouchEnd={() => onSneak(false)}
          onMouseDown={() => onSneak(true)} onMouseUp={() => onSneak(false)}
        >Sneak</button>
      </div>
    </div>
  );
}