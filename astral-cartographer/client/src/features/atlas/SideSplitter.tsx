import { useEffect, useState, type RefObject } from 'react';

/**
 * Draggable divider between the Repository Explorer and the details panel.
 * The share is the explorer's part of the side panel's height; it is remembered in this browser.
 */
const KEY = 'atlas-explorer-share';
export const SHARE_LIMITS = { MIN: 0.2, MAX: 0.8, DEFAULT: 0.5, STEP: 0.05 };
const clamp = (v: number) => Math.min(SHARE_LIMITS.MAX, Math.max(SHARE_LIMITS.MIN, v));

export function useExplorerShare(): [number, (v: number) => void] {
  const [share, setShare] = useState(() => {
    try {
      const v = Number(localStorage.getItem(KEY));
      return v >= SHARE_LIMITS.MIN && v <= SHARE_LIMITS.MAX ? v : SHARE_LIMITS.DEFAULT;
    } catch {
      return SHARE_LIMITS.DEFAULT;
    }
  });
  useEffect(() => {
    try { localStorage.setItem(KEY, String(share)); } catch { /* storage unavailable: the size is just not remembered */ }
  }, [share]);
  return [share, (v) => setShare(clamp(v))];
}

interface Props {
  share: number;
  onChange: (share: number) => void;
  /** the side panel; its height is what the share divides */
  containerRef: RefObject<HTMLElement>;
}

export default function SideSplitter({ share, onChange, containerRef }: Props) {
  const fromPointer = (clientY: number) => {
    const box = containerRef.current?.getBoundingClientRect();
    if (box && box.height > 0) onChange((clientY - box.top) / box.height);
  };
  return (
    <div
      className="atlas-splitter"
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize the Repository Explorer"
      aria-valuemin={SHARE_LIMITS.MIN * 100}
      aria-valuemax={SHARE_LIMITS.MAX * 100}
      aria-valuenow={Math.round(share * 100)}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) fromPointer(e.clientY); }}
      onPointerUp={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }}
      onDoubleClick={() => onChange(SHARE_LIMITS.DEFAULT)}
      onKeyDown={(e) => {
        const d = e.key === 'ArrowUp' ? -SHARE_LIMITS.STEP : e.key === 'ArrowDown' ? SHARE_LIMITS.STEP : 0;
        if (d) { e.preventDefault(); onChange(share + d); }
        else if (e.key === 'Home') { e.preventDefault(); onChange(SHARE_LIMITS.MIN); }
        else if (e.key === 'End') { e.preventDefault(); onChange(SHARE_LIMITS.MAX); }
      }}
    >
      <span aria-hidden="true" />
    </div>
  );
}
