import { useMemo, useState } from 'react';
import type { Context, Task } from '../types';
import { createContext, renameContext, deleteContext } from '../lib/store';

interface Counts {
  open: number;
  done: number;
}

interface Props {
  contexts: Context[];
  tasks: Task[];
  onClose: () => void;
}

/** Open/completed task totals per context id. Untagged tasks count towards nothing. */
function countByContext(tasks: Task[]): Map<string, Counts> {
  const counts = new Map<string, Counts>();
  for (const task of tasks) {
    for (const id of task.contexts) {
      const entry = counts.get(id) ?? { open: 0, done: 0 };
      if (task.completed) entry.done++;
      else entry.open++;
      counts.set(id, entry);
    }
  }
  return counts;
}

export function ContextManager({ contexts, tasks, onClose }: Props) {
  const [adding, setAdding] = useState('');
  const counts = useMemo(() => countByContext(tasks), [tasks]);

  function add(e: React.FormEvent) {
    e.preventDefault();
    if (!adding.trim()) return;
    createContext(adding);
    setAdding('');
  }

  return (
    <div className="fixed inset-0 z-20 flex flex-col justify-end bg-black/60" onClick={onClose}>
      <div
        className="safe-bottom max-h-[80vh] overflow-y-auto rounded-t-3xl border-t border-line bg-surface p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-line" />
        <h2 className="mb-3 text-lg font-semibold">Tags</h2>

        <ul className="space-y-2">
          {contexts.map((c) => (
            <ContextRow key={c.id} context={c} counts={counts.get(c.id) ?? { open: 0, done: 0 }} />
          ))}
        </ul>

        <form onSubmit={add} className="mt-4 flex gap-2">
          <input
            value={adding}
            onChange={(e) => setAdding(e.target.value)}
            placeholder="New tag"
            className="min-w-0 flex-1 rounded-xl border border-line bg-bg px-4 py-3 text-base outline-none placeholder:text-muted focus:border-accent"
          />
          <button
            type="submit"
            disabled={!adding.trim()}
            className="rounded-xl bg-accent px-4 py-3 font-medium text-black disabled:opacity-40"
          >
            Add
          </button>
        </form>

        <button onClick={onClose} className="mt-5 w-full rounded-xl border border-line px-4 py-3 text-sm text-muted">
          Done
        </button>
      </div>
    </div>
  );
}

function ContextRow({ context, counts }: { context: Context; counts: Counts }) {
  const [name, setName] = useState(context.name);

  function commit() {
    const next = name.trim();
    if (next && next !== context.name) renameContext(context.id, next);
    else setName(context.name);
  }

  return (
    <li className="flex items-center gap-2">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={commit}
        className="min-w-0 flex-1 rounded-xl border border-line bg-bg px-4 py-2.5 text-base outline-none focus:border-accent"
      />
      <TaskCounts counts={counts} />
      <button
        onClick={() => deleteContext(context.id)}
        aria-label={`Delete ${context.name}`}
        className="shrink-0 rounded-xl border border-line px-3 py-2.5 text-sm text-red-400"
      >
        Remove
      </button>
    </li>
  );
}

/** Open (hollow circle) vs completed (ticked circle) task totals for one tag. */
function TaskCounts({ counts }: { counts: Counts }) {
  return (
    <div
      className="flex shrink-0 items-center gap-2 text-xs tabular-nums text-muted"
      aria-label={`${counts.open} open, ${counts.done} completed`}
    >
      <span className="flex items-center gap-1" title={`${counts.open} open`}>
        <svg viewBox="0 0 24 24" aria-hidden="true" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="9" />
        </svg>
        {counts.open}
      </span>
      <span className="flex items-center gap-1" title={`${counts.done} completed`}>
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          className="h-3.5 w-3.5 text-accent"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M8 12.4l2.6 2.6L16 9.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {counts.done}
      </span>
    </div>
  );
}
