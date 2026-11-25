import { useEffect, useState } from 'react';
import type { Context, Task } from '../types';
import { completeTasks, deleteTasks, toggleTagOnTasks } from '../lib/store';

interface Props {
  ids: string[];
  tasks: Task[];
  contexts: Context[];
  onSnooze: () => void;
  onDone: () => void;
}

/** Bottom bar for multi-select: complete, snooze, tag or delete everything selected. */
export function SelectionBar({ ids, tasks, contexts, onSnooze, onDone }: Props) {
  const [tagging, setTagging] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (tagging) setTagging(false);
      else onDone();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tagging, onDone]);

  const n = ids.length;
  const chosen = tasks.filter((t) => ids.includes(t.id));

  function act(fn: () => void) {
    fn();
    onDone();
  }

  return (
    <>
      <div className="safe-bottom fixed inset-x-0 bottom-0 z-40 flex justify-center px-3 pb-3 animate-rise">
        <div className="flex w-full max-w-xl items-center gap-0 rounded-2xl border border-line bg-elevated p-1.5 shadow-2xl">
          <button onClick={onDone} aria-label="Cancel selection" className="grid h-11 w-10 shrink-0 place-items-center text-muted">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M6 18L18 6" strokeLinecap="round" />
            </svg>
          </button>
          <span className="min-w-0 flex-1 truncate pr-1 text-sm font-medium">{n} selected</span>
          <BarButton label="Done" onClick={() => act(() => completeTasks(ids))} icon="M5 13l4 4L19 7" />
          <BarButton label="Snooze" onClick={onSnooze} icon="M12 7v5l3 2M12 22a10 10 0 100-20 10 10 0 000 20z" />
          {contexts.length > 0 && (
            <BarButton
              label="Tag"
              onClick={() => setTagging(true)}
              icon="M20.6 13.4l-7.2 7.2a2 2 0 01-2.8 0L2 12V2h10l8.6 8.6a2 2 0 010 2.8zM7 7h.01"
            />
          )}
          <BarButton
            label="Delete"
            danger
            onClick={() => act(() => deleteTasks(ids))}
            icon="M6 7h12M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m-7 0v12a1 1 0 001 1h6a1 1 0 001-1V7"
          />
        </div>
      </div>

      {tagging && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40 animate-fade sm:items-center sm:justify-center" onClick={() => setTagging(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Tag selected tasks"
            onClick={(e) => e.stopPropagation()}
            className="safe-bottom w-full animate-rise rounded-t-3xl border-t border-line bg-elevated px-4 pb-4 pt-5 shadow-2xl sm:max-w-[360px] sm:rounded-2xl sm:border"
          >
            <h2 className="mb-1 text-center text-[15px] font-semibold">Tag {n === 1 ? '1 task' : `${n} tasks`}</h2>
            <p className="mb-4 text-center text-[13px] text-muted">Tap to add. Tap a filled tag to remove it.</p>
            <div className="flex flex-wrap justify-center gap-2">
              {contexts.map((c) => {
                const have = chosen.filter((t) => t.contexts.includes(c.id)).length;
                const all = have === chosen.length && have > 0;
                return (
                  <button
                    key={c.id}
                    onClick={() => toggleTagOnTasks(ids, c.id)}
                    className={`rounded-full border px-3 py-1.5 text-sm transition ${
                      all
                        ? 'border-accent bg-accent/15 text-accent'
                        : have > 0
                          ? 'border-dashed border-accent/60 text-accent'
                          : 'border-line text-muted'
                    }`}
                  >
                    {c.name}
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => {
                setTagging(false);
                onDone();
              }}
              className="mt-5 h-12 w-full rounded-[14px] bg-accent text-[15px] font-bold text-black"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function BarButton({ label, icon, onClick, danger }: { label: string; icon: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`flex h-11 w-[52px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl text-[10px] font-medium active:bg-surface ${
        danger ? 'text-[#e8674f]' : ''
      }`}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
        <path d={icon} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {label}
    </button>
  );
}
