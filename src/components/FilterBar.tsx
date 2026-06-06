import { useRef } from 'react';
import type { Context } from '../types';

interface Props {
  contexts: Context[];
  stickies: string[];
  transient: string | null;
  onQuickPress: (id: string) => void;
  onToggleSticky: (id: string) => void;
  onClear: () => void;
  onManage: () => void;
}

export function FilterBar({
  contexts,
  stickies,
  transient,
  onQuickPress,
  onToggleSticky,
  onClear,
  onManage,
}: Props) {
  const nothingSelected = stickies.length === 0 && transient === null;
  return (
    <div className="flex items-center border-b border-line px-4 py-2">
      <div className="relative min-w-0 flex-1">
        <div className="flex items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <Chip label="All" active={nothingSelected} onTap={onClear} onLong={onClear} />
          {contexts.map((c) => (
            <Chip
              key={c.id}
              label={c.name}
              active={stickies.includes(c.id) || transient === c.id}
              sticky={stickies.includes(c.id)}
              onTap={() => onQuickPress(c.id)}
              onLong={() => onToggleSticky(c.id)}
            />
          ))}
        </div>
        <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-r from-transparent to-bg" />
      </div>
      <button
        onClick={onManage}
        aria-label="Manage tags"
        className="ml-2 shrink-0 rounded-full border border-line p-2 text-muted"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 20h9" strokeLinecap="round" />
          <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  );
}

const LONG_PRESS_MS = 500;
const MOVE_CANCEL_PX = 10;

function Chip({
  label,
  active,
  sticky = false,
  onTap,
  onLong,
}: {
  label: string;
  active: boolean;
  sticky?: boolean;
  onTap: () => void;
  onLong: () => void;
}) {
  const timer = useRef<number | null>(null);
  const fired = useRef(false);
  const start = useRef({ x: 0, y: 0 });

  function clear() {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }

  function onPointerDown(e: React.PointerEvent) {
    fired.current = false;
    start.current = { x: e.clientX, y: e.clientY };
    timer.current = window.setTimeout(() => {
      fired.current = true;
      navigator.vibrate?.(15);
      onLong();
    }, LONG_PRESS_MS);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (timer.current === null) return;
    const dx = e.clientX - start.current.x;
    const dy = e.clientY - start.current.y;
    if (Math.hypot(dx, dy) > MOVE_CANCEL_PX) clear();
  }

  function onPointerUp() {
    const wasPending = timer.current !== null;
    clear();
    if (wasPending && !fired.current) onTap();
  }

  return (
    <button
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={clear}
      onPointerCancel={clear}
      onContextMenu={(e) => e.preventDefault()}
      style={{ WebkitTouchCallout: 'none' }}
      className={`flex shrink-0 select-none items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium transition ${
        active ? 'bg-accent text-black' : 'bg-surface text-muted'
      }`}
    >
      {label}
      {sticky && <span className="h-1.5 w-1.5 rounded-full bg-black/60" />}
    </button>
  );
}
