'use client';

import { useEffect, useRef } from 'react';

interface ViewerCanvasProps {
  baseUrl: string;
  pointerLock: boolean;
  isConnected: boolean;
}

/**
 * Mounts the prismarine-viewer's own WebGL canvas page in an iframe.
 * The viewer has its own pointer lock + WASD support, so we simply embed it.
 * We add a thin overlay for our HUD via absolute positioned siblings.
 */
export function ViewerCanvas({ baseUrl, pointerLock, isConnected }: ViewerCanvasProps) {
  const ref = useRef<HTMLIFrameElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // The viewer canvas handles pointer lock + WASD when clicked.
    // Our overlay captures click to avoid the viewer stealing pointer lock
    // when the user actually wants our control surface.
  }, [pointerLock, isConnected]);
  return (
    <iframe
      ref={ref}
      title="Alex101 live viewer"
      src={baseUrl}
      className="viewer-iframe"
      allow="autoplay; fullscreen; pointer-lock; gamepad"
      allowFullScreen
    />
  );
}