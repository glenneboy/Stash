import { useEffect, useRef, useState } from 'react';
import type { Context, Task } from '../types';
import { toggleComplete, deleteTask } from '../lib/store';
import { hasReminder, isOverdue } from '../lib/reminders';

interface Props {
  task: Task;
  contexts: Context[];
  onEdit: (task: Task) => void;
}

const SWIPE_THRESHOLD = 80;

export function TaskItem({ task, contexts, onEdit }: Props) {
  const tags = task.contexts
    .map((id) => contexts.find((c) => c.id === id)?.name)
    .filter((n): n is string => Boolean(n));

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

  function onPointerDown(e: React.PointerEvent) {
    start.current = { x: e.clientX, y: e.clientY };
    swiping.current = false;
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!start.current) return;
    const deltaX = e.clientX - start.current.x;
    const deltaY = e.clientY - start.current.y;
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
    if (swiping.current) {
      justSwiped.current = true;
      if (dx > SWIPE_THRESHOLD) toggleComplete(task.id);
      else if (dx < -SWIPE_THRESHOLD) deleteTask(task.id);
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
    }
  }

  return (
    <li className="relative overflow-hidden">
      <div
        className={`pointer-events-none absolute inset-0 flex items-center justify-between px-5 text-white ${
          dx > 0 ? 'bg-accent' : dx < 0 ? 'bg-red-600' : ''
        }`}
      >
        <svg viewBox="0 0 24 24" className={`h-5 w-5 ${dx > 0 ? '' : 'opacity-0'}`} fill="none" stroke="currentColor" strokeWidth="3">
          <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <svg viewBox="0 0 24 24" className={`h-5 w-5 ${dx < 0 ? '' : 'opacity-0'}`} fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M6 7h12M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m-7 0v12a1 1 0 001 1h6a1 1 0 001-1V7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>

      <div
        className="relative flex touch-pan-y select-none items-start gap-3 bg-bg px-4 py-3"
        style={{ transform: `translateX(${dx}px)`, transition: dx === 0 ? 'transform 150ms ease-out' : 'none' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClickCapture={onClickCapture}
      >
        <button
          aria-label={task.completed ? 'Mark incomplete' : 'Mark complete'}
          onClick={() => toggleComplete(task.id)}
          className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 transition ${
            task.completed ? 'border-accent bg-accent text-black' : 'border-muted'
          } ${pop ? 'animate-pop' : ''}`}
        >
          {task.completed && (
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="3">
              <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>

        <button onClick={() => onEdit(task)} className="min-w-0 flex-1 text-left">
          <p className={`flex items-center gap-1.5 break-words ${task.completed ? 'text-muted line-through' : ''}`}>
            <span className="min-w-0">{task.title}</span>
            {hasReminder(task) && (
              <svg
                viewBox="0 0 24 24"
                aria-label="Reminder set"
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
          {task.note && <p className="mt-0.5 break-words text-sm text-muted">{task.note}</p>}
          {tags.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
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
