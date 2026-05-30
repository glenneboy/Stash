import { useMemo, useState } from 'react';
import type { Filter, Task } from '../types';
import { ALL_FILTER } from '../types';
import { useStore } from '../lib/useStore';
import { supabase } from '../lib/supabase';
import { CaptureBar } from './CaptureBar';
import { FilterBar } from './FilterBar';
import { TaskItem } from './TaskItem';
import { EditSheet } from './EditSheet';
import { ContextManager } from './ContextManager';
import { Toast } from './Toast';

function matchesFilter(task: Task, filter: Filter): boolean {
  if (filter === ALL_FILTER) return true;
  return task.contexts.includes(filter);
}

/** Read text shared into the app via the PWA share target, then clean the URL. */
function readSharedText(): string {
  const params = new URLSearchParams(window.location.search);
  const shared = [params.get('title'), params.get('text'), params.get('url')]
    .filter(Boolean)
    .join(' ')
    .trim();
  if (shared) window.history.replaceState({}, '', window.location.pathname);
  return shared;
}

export function Home() {
  const { tasks, contexts, online, syncing, pending, loaded } = useStore();
  const [filter, setFilter] = useState<Filter>(ALL_FILTER);
  const [showCompleted, setShowCompleted] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [manageOpen, setManageOpen] = useState(false);
  const sharedText = useMemo(readSharedText, []);

  const visible = useMemo(() => tasks.filter((t) => matchesFilter(t, filter)), [tasks, filter]);
  const active = visible.filter((t) => !t.completed);
  const completed = visible.filter((t) => t.completed);

  const activeContextId = filter === ALL_FILTER ? null : filter;

  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col">
      <header className="safe-top flex items-center justify-between px-4 pb-1 pt-2">
        <h1 className="text-lg font-bold tracking-tight">Stash</h1>
        <div className="flex items-center gap-3 text-xs text-muted">
          {!online && <span className="text-amber-400">Offline</span>}
          {online && syncing && <span>Syncing…</span>}
          {online && !syncing && pending > 0 && <span>{pending} queued</span>}
          <button onClick={() => supabase.auth.signOut()} className="underline">
            Sign out
          </button>
        </div>
      </header>

      <CaptureBar contexts={contexts} activeContextId={activeContextId} initialTitle={sharedText} />
      <FilterBar contexts={contexts} active={filter} onChange={setFilter} onManage={() => setManageOpen(true)} />

      <main className="flex-1">
        {active.length === 0 && completed.length === 0 ? (
          <EmptyState loaded={loaded} />
        ) : (
          <ul className="divide-y divide-line/60">
            {active.map((t) => (
              <TaskItem key={t.id} task={t} contexts={contexts} onEdit={setEditing} />
            ))}
          </ul>
        )}

        {completed.length > 0 && (
          <section className="mt-2 border-t border-line">
            <button
              onClick={() => setShowCompleted((s) => !s)}
              className="flex w-full items-center justify-between px-4 py-3 text-sm text-muted"
            >
              <span>Completed ({completed.length})</span>
              <span>{showCompleted ? 'Hide' : 'Show'}</span>
            </button>
            {showCompleted && (
              <ul className="divide-y divide-line/60">
                {completed.map((t) => (
                  <TaskItem key={t.id} task={t} contexts={contexts} onEdit={setEditing} />
                ))}
              </ul>
            )}
          </section>
        )}
      </main>

      {editing && (
        <EditSheet task={tasks.find((t) => t.id === editing.id) ?? editing} contexts={contexts} onClose={() => setEditing(null)} />
      )}
      {manageOpen && <ContextManager contexts={contexts} onClose={() => setManageOpen(false)} />}
      <Toast />
    </div>
  );
}

function EmptyState({ loaded }: { loaded: boolean }) {
  return (
    <div className="grid place-items-center px-8 py-24 text-center">
      <p className="text-muted">{loaded ? 'Nothing here yet — add something above.' : 'Loading your tasks…'}</p>
    </div>
  );
}
