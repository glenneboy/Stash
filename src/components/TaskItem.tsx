import { useEffect, useRef, useState } from 'react';
import type { Context, Task } from '../types';
import { toggleComplete, deleteTask } from '../lib/store';
import { hasReminder, isOverdue } from '../lib/reminders';
import { dueInfo } from '../lib/due';
import { ageInfo, isWithinLiveTickWindow, type DateDisplay } from '../lib/age';
import { TaskNote } from './TaskNote';
import { haptic, prefersReducedMotion } from '../lib/feedback';

interface DragGrip {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: () => void;
}

interface Props {
  task: Task;
  contexts: Context[];
  onEdit: (task: Task) => void;
  dragGrip?: DragGrip;
  isDragging?: boolean;
  dragOver?: 'above' | 'below';
  dateDisplay?: DateDisplay;
  /** Swipe left action. When absent (e.g. completed rows), swiping left deletes. */
  onSwipeLeft?: (task: Task) => void;
  /** Long-press enters multi-select. Absent → long-press does nothing. */
  onLongPress?: (id: string) => void;
  /** In multi-select mode a tap toggles selection instead of opening the task. */
  selecting?: boolean;
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
}

const SWIPE_THRESHOLD = 80;
const LONG_PRESS_MS = 450;
/** How long the tick shows in place before the row folds away. */
const TICK_MS = 320;
const COLLAPSE_MS = 200;

export function TaskItem({
  task,
  contexts,
  onEdit,
  dragGrip,
  isDragging,
  dragOver,
  dateDisplay = 'due',
  onSwipeLeft,
  onLongPress,
  selecting = false,
  selected = false,
  onToggleSelect,
}: Props) {
  const tags = task.contexts
    .map((id) => contexts.find((c) => c.id === id)?.name)
    .filter((n): n is string => Boolean(n));

  const due = dueInfo(task);

  // While in "age" mode, tick once per second for the first 60 seconds of a
  // task's life so the seconds counter updates live; the timer self-clears
  // once the task ages past 60s and never starts in "due" mode or for tasks
  // already past that window, so each row only pays for the timer it needs.
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (dateDisplay !== 'age' || !isWithinLiveTickWindow(task)) return;
    const createdAt = new Date(task.created_at).getTime();
    const id = setInterval(() => {
      if (Date.now() - createdAt >= 60_000) {
        clearInterval(id);
        return;
      }
      forceTick((n) => n + 1);
    }, 1000);
    return () => clearInterval(id);
  }, [dateDisplay, task.created_at]);

  const badge = dateDisplay === 'age' ? { label: ageInfo(task).label, className: 'text-muted', alert: false } : due;

  const [dx, setDx] = useState(0);
  const start = useRef<{ x: number; y: number } | null>(null);
  const swiping = useRef(false);
  const justSwiped = useRef(false);

  // Pop the checkbox only when a task transitions into the completed state.
  const [pop, setPop] = useState(false);
  const wasCompleted = useRef(task.completed);
  useEffect(() => {
    if (task.completed && !wasCompleted.current) {
      setPop(true);
      const id = setTimeout(() => setPop(false), 250);
      wasCompleted.current = task.completed;
      return () => clearTimeout(id);
    }
    wasCompleted.current = task.completed;
  }, [task.completed]);

  // Completing an open task: buzz and draw the tick right away, let it sit for a
  // beat, fold the row shut, then commit — so the row doesn't just vanish.
  // Un-completing (and reduced motion) commits immediately.
  const [completing, setCompleting] = useState(false);
  const rowRef = useRef<HTMLLIElement>(null);
  const isCompleted = useRef(task.completed);
  isCompleted.current = task.completed;
  function complete() {
    if (completing) return;
    if (task.completed || prefersReducedMotion()) {
      toggleComplete(task.id);
      return;
    }
    haptic();
    setCompleting(true);
    setPop(true);
    const commit = () => {
      // Another device may have completed it meanwhile; don't toggle it back open.
      if (!isCompleted.current) toggleComplete(task.id, { haptic: false });
    };
    setTimeout(() => {
      const el = rowRef.current;
      if (!el || typeof el.animate !== 'function') return commit();
      el.style.overflow = 'hidden';
      const anim = el.animate(
        [
          { height: `${el.offsetHeight}px`, opacity: 1 },
          { height: '0px', opacity: 0 },
        ],
        { duration: COLLAPSE_MS, easing: 'ease-in', fill: 'forwards' },
      );
      anim.onfinish = commit;
      anim.oncancel = commit;
    }, TICK_MS);
  }
  const done = task.completed || completing;

  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function cancelPress() {
    if (pressTimer.current) clearTimeout(pressTimer.current);
    pressTimer.current = null;
  }
  useEffect(() => cancelPress, []);

  function onPointerDown(e: React.PointerEvent) {
    start.current = { x: e.clientX, y: e.clientY };
    swiping.current = false;
    if (onLongPress) {
      cancelPress();
      pressTimer.current = setTimeout(() => {
        pressTimer.current = null;
        start.current = null; // no swipe after a long-press
        justSwiped.current = true; // and no click when the finger lifts
        navigator.vibrate?.(10);
        onLongPress(task.id);
      }, LONG_PRESS_MS);
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!start.current) return;
    const deltaX = e.clientX - start.current.x;
    const deltaY = e.clientY - start.current.y;
    if (Math.abs(deltaX) > 10 || Math.abs(deltaY) > 10) cancelPress();
    if (selecting) return; // no swipe actions while selecting
    if (!swiping.current) {
      if (Math.abs(deltaX) > 10 && Math.abs(deltaX) > Math.abs(deltaY)) {
        swiping.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
      } else if (Math.abs(deltaY) > 10) {
        start.current = null; // vertical scroll — let the list handle it
        return;
      } else {
        return;
      }
    }
    setDx(deltaX);
  }

  function onPointerUp() {
    cancelPress();
    if (swiping.current) {
      justSwiped.current = true;
      if (dx > SWIPE_THRESHOLD) complete();
      else if (dx < -SWIPE_THRESHOLD) {
        if (onSwipeLeft) onSwipeLeft(task);
        else deleteTask(task.id);
      }
    }
    start.current = null;
    swiping.current = false;
    setDx(0);
  }

  function onClickCapture(e: React.MouseEvent) {
    if (justSwiped.current) {
      e.preventDefault();
      e.stopPropagation();
      justSwiped.current = false;
      return;
    }
    if (selecting) {
      e.preventDefault();
      e.stopPropagation();
      onToggleSelect?.(task.id);
    }
  }

  return (
    <li
      ref={rowRef}
      data-task-id={task.id}
      className={`relative overflow-hidden transition-opacity ${isDragging ? 'opacity-30' : ''}`}
    >
      {dragOver && (
        <div
          className={`pointer-events-none absolute inset-x-0 z-30 h-0.5 bg-accent ${dragOver === 'above' ? 'top-0' : 'bottom-0'}`}
        />
      )}
      <div
        className={`pointer-events-none absolute inset-0 flex items-center justify-between px-5 text-white ${
          dx > 0 ? 'bg-accent' : dx < 0 ? (onSwipeLeft ? 'bg-sky-600' : 'bg-red-600') : ''
        }`}
      >
        <svg viewBox="0 0 24 24" className={`h-5 w-5 ${dx > 0 ? '' : 'opacity-0'}`} fill="none" stroke="currentColor" strokeWidth="3">
          <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {onSwipeLeft ? (
          <span className={`flex items-center gap-1.5 text-sm font-medium ${dx < 0 ? '' : 'opacity-0'}`}>
            Snooze
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 7v5l3 2M12 22a10 10 0 100-20 10 10 0 000 20z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        ) : (
          <svg viewBox="0 0 24 24" className={`h-5 w-5 ${dx < 0 ? '' : 'opacity-0'}`} fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 7h12M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m-7 0v12a1 1 0 001 1h6a1 1 0 001-1V7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>

      <div
        className={`relative flex touch-pan-y select-none items-start gap-3 px-4 py-3 transition-colors ${
          selected ? 'bg-[#2a1d18]' : 'bg-bg'
        }`}
        style={{
          transform: `translateX(${dx}px)`,
          transition: dx === 0 ? 'transform 150ms ease-out, background-color 150ms' : 'none',
          WebkitTouchCallout: 'none',
        }}
        onContextMenu={onLongPress ? (e) => e.preventDefault() : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClickCapture={onClickCapture}
      >
        {dragGrip && !selecting && (
          <div
            className="touch-none shrink-0 cursor-grab self-center text-muted/30 active:cursor-grabbing"
            onPointerDown={(e) => {
              e.stopPropagation();
              e.currentTarget.setPointerCapture(e.pointerId);
              dragGrip.onPointerDown(e);
            }}
            onPointerMove={(e) => dragGrip.onPointerMove(e)}
            onPointerUp={() => dragGrip.onPointerUp()}
            onPointerCancel={() => dragGrip.onPointerUp()}
          >
            <svg viewBox="0 0 10 16" className="h-4 w-3" fill="currentColor">
              <circle cx="2.5" cy="2" r="1.5" />
              <circle cx="7.5" cy="2" r="1.5" />
              <circle cx="2.5" cy="8" r="1.5" />
              <circle cx="7.5" cy="8" r="1.5" />
              <circle cx="2.5" cy="14" r="1.5" />
              <circle cx="7.5" cy="14" r="1.5" />
            </svg>
          </div>
        )}

        {selecting ? (
          <span
            aria-hidden="true"
            className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md border-2 transition ${
              selected ? 'border-accent bg-accent text-black' : 'border-muted'
            }`}
          >
            {selected && (
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="3">
                <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </span>
        ) : (
        <button
          aria-label={task.completed ? 'Mark incomplete' : 'Mark complete'}
          onClick={complete}
          className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 transition ${
            done ? 'border-accent bg-accent text-black' : 'border-muted'
          } ${pop ? 'animate-pop' : ''}`}
        >
          {done && (
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="3">
              <path
                d="M5 13l4 4L19 7"
                pathLength={1}
                strokeLinecap="round"
                strokeLinejoin="round"
                className={completing ? 'animate-draw [stroke-dasharray:1]' : ''}
              />
            </svg>
          )}
        </button>
        )}

        <button onClick={() => onEdit(task)} aria-pressed={selecting ? selected : undefined} className="min-w-0 flex-1 text-left">
          <p className={`flex items-center gap-1.5 break-words transition-colors duration-200 ${done ? 'text-muted line-through' : ''}`}>
            <span className="min-w-0">{task.title}</span>
            {task.recur && (
              <svg
                viewBox="0 0 24 24"
                aria-label="Repeats"
                className="h-3.5 w-3.5 shrink-0 text-muted"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M17 2l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M3 11v-1a4 4 0 014-4h14" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M7 22l-4-4 4-4" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M21 13v1a4 4 0 01-4 4H3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
            {hasReminder(task) && (
              <svg
                viewBox="0 0 24 24"
                aria-hidden="true"
                className={`h-3.5 w-3.5 shrink-0 ${isOverdue(task) ? 'text-accent' : 'text-muted'}`}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M13.7 21a2 2 0 01-3.4 0" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </p>
          {task.note && <TaskNote text={task.note} completed={task.completed} />}
          {(badge || tags.length > 0) && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {badge && (
                <span className={`inline-flex items-center gap-1 text-xs font-medium ${badge.className}`}>
                  {badge.alert ? (
                    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M10.3 3.9 1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M12 9v4" strokeLinecap="round" />
                      <path d="M12 17h.01" strokeLinecap="round" />
                    </svg>
                  ) : (
                    <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
                  )}
                  <span>{badge.label}</span>
                </span>
              )}
              {tags.map((name) => (
                <span key={name} className="rounded-full bg-elevated px-2 py-0.5 text-xs text-muted">
                  {name}
                </span>
              ))}
            </div>
          )}
        </button>
      </div>
    </li>
  );
}
