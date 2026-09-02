'use client';

interface ControlPadProps {
  onPress: (key: 'forward' | 'back' | 'left' | 'right' | 'jump' | 'sprint' | 'sneak', value: boolean) => void;
}

export function ControlPad({ onPress }: ControlPadProps) {
  function press(k: 'forward' | 'back' | 'left' | 'right' | 'jump' | 'sprint' | 'sneak') {
    return {
      onMouseDown: (e: React.MouseEvent) => { e.preventDefault(); onPress(k, true); },
      onMouseUp: () => onPress(k, false),
      onMouseLeave: () => onPress(k, false),
      onTouchStart: (e: React.TouchEvent) => { e.preventDefault(); onPress(k, true); },
      onTouchEnd: (e: React.TouchEvent) => { e.preventDefault(); onPress(k, false); },
    };
  }
  return (
    <div className="controls-grid" aria-label="manual controls">
      <span />
      <button {...press('forward')}>W</button>
      <span />
      <button {...press('left')}>A</button>
      <button {...press('back')}>S</button>
      <button {...press('right')}>D</button>
      <button {...press('sneak')}>Shift</button>
      <button {...press('jump')}>Space</button>
      <button {...press('sprint')}>Ctrl</button>
    </div>
  );
}