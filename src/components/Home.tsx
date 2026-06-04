import { useEffect, useMemo, useRef, useState } from 'react';
import type { Filter, Task } from '../types';
import { ALL_FILTER } from '../types';
import { useStore } from '../lib/useStore';
import { quickAddTask, clearCompleted } from '../lib/store';
import { parseTags } from '../lib/tags';
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

function matchesQuery(task: Task, q: string): boolean {
  if (!q) return true;
  return task.title.toLowerCase().includes(q) || (task.note?.toLowerCase().includes(q) ?? false);
}

type DateGroup = 'Today' | 'Yesterday' | 'Earlier';
const DATE_GROUPS: DateGroup[] = ['Today', 'Yesterday', 'Earlier'];
const DAY = 86_400_000;

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function dateGroup(iso: string): DateGroup {
  const diff = startOfDay(new Date()) - startOfDay(new Date(iso));
  if (diff <= 0) return 'Today';
  if (diff === DAY) return 'Yesterday';
  return 'Earlier';
}

// Split an already date-sorted list into Today / Yesterday / Earlier, preserving order.
function groupByDate(tasks: Task[]): { label: DateGroup; items: Task[] }[] {
  const buckets = new Map<DateGroup, Task[]>();
  for (const t of tasks) {
    const g = dateGroup(t.created_at);
    const bucket = buckets.get(g) ?? [];
    bucket.push(t);
    buckets.set(g, bucket);
  }
  return DATE_GROUPS.filter((g) => buckets.has(g)).map((label) => ({ label, items: buckets.get(label)! }));
}

/**
 * Read content shared into the app via the PWA share target, then clean the URL.
 * The full detail becomes the note (it can be long); the first few words are
 * offered as a suggested title.
 */
function readShared(): { title: string; note: string } {
  const params = new URLSearchParams(window.location.search);
  const note = [params.get('title'), params.get('text'), params.get('url')]
    .filter(Boolean)
    .join('\n')
    .trim();
  if (note) window.history.replaceState({}, '', window.location.pathname);
  const title = note.split(/\s+/).slice(0, 6).join(' ');
  return { title, note };
}

export function Home() {
  const { tasks, contexts, online, syncing, pending, loaded } = useStore();
  const [filter, setFilter] = useState<Filter>(ALL_FILTER);
  const [showCompleted, setShowCompleted] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [manageOpen, setManageOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const shared = useMemo(readShared, []);

  // Quick-capture deeplink: `?add=<text>` creates a task headlessly once the store has
  // loaded (so inline `#tags` can resolve against existing contexts). Fires once per load.
  const addHandled = useRef(false);
  useEffect(() => {
    if (addHandled.current || !loaded) return;
    const text = new URLSearchParams(window.location.search).get('add');
    addHandled.current = true;
    if (text === null) return;
    window.history.replaceState({}, '', window.location.pathname);
    const { title, tagIds } = parseTags(text, contexts);
    if (title) quickAddTask(title, tagIds);
  }, [loaded, contexts]);

  const q = query.trim().toLowerCase();
  const visible = useMemo(
    () => tasks.filter((t) => matchesFilter(t, filter) && matchesQuery(t, q)),
    [tasks, filter, q],
  );
  const active = visible.filter((t) => !t.completed);
  const completed = visible.filter((t) => t.completed);
  const groups = useMemo(() => groupByDate(active), [active]);

  const activeContextId = filter === ALL_FILTER ? null : filter;

  function toggleSearch() {
    setSearchOpen((open) => {
      if (open) setQuery('');
      return !open;
    });
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col">
      <header className="safe-top flex items-center justify-between px-4 pb-1 pt-2">
        <h1 className="text-lg font-bold tracking-tight">Stash</h1>
        <div className="flex items-center gap-3 text-xs text-muted">
          {!online && <span className="text-amber-400">Offline</span>}
          {online && syncing && <span>Syncing…</span>}
          {online && !syncing && pending > 0 && <span>{pending} queued</span>}
          <button
            onClick={toggleSearch}
            aria-label="Search"
            className={searchOpen ? 'text-accent' : ''}
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.3-4.3" strokeLinecap="round" />
            </svg>
          </button>
          <button onClick={() => supabase.auth.signOut()} className="underline">
            Sign out
          </button>
        </div>
      </header>

      <CaptureBar
        contexts={contexts}
        activeContextId={activeContextId}
        initialTitle={shared.title}
        initialNote={shared.note}
      />
      <FilterBar contexts={contexts} active={filter} onChange={setFilter} onManage={() => setManageOpen(true)} />

      {searchOpen && (
        <div className="border-b border-line px-4 py-2">
          <input
            autoFocus
            enterKeyHint="search"
            placeholder="Search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full rounded-xl border border-line bg-surface px-4 py-2 text-base outline-none placeholder:text-muted focus:border-accent"
          />
        </div>
      )}

      <main className="flex-1">
        {active.length === 0 && completed.length === 0 ? (
          q ? (
            <div className="grid place-items-center px-8 py-24 text-center">
              <p className="text-muted">No matches for “{query.trim()}”.</p>
            </div>
          ) : (
            <EmptyState loaded={loaded} />
          )
        ) : (
          groups.map((group) => (
            <section key={group.label}>
              <h2 className="px-4 pb-1 pt-4 text-xs font-medium uppercase tracking-wide text-muted">
                {group.label}
              </h2>
              <ul className="divide-y divide-line/60">
                {group.items.map((t) => (
                  <TaskItem key={t.id} task={t} contexts={contexts} onEdit={setEditing} />
                ))}
              </ul>
            </section>
          ))
        )}

        {completed.length > 0 && (
          <section className="mt-2 border-t border-line">
            <div className="flex w-full items-center justify-between px-4 py-3 text-sm text-muted">
              <button onClick={() => setShowCompleted((s) => !s)} className="flex-1 text-left">
                Completed ({completed.length})
              </button>
              <div className="flex items-center gap-4">
                <button onClick={clearCompleted} className="text-muted hover:text-red-400">
                  Clear
                </button>
                <button onClick={() => setShowCompleted((s) => !s)}>{showCompleted ? 'Hide' : 'Show'}</button>
              </div>
            </div>
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
