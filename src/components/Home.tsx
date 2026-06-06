import { useEffect, useMemo, useRef, useState } from 'react';
import type { Task } from '../types';
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

/** Intersection: a task matches only if it carries every selected context. Empty = all. */
function matchesSelection(task: Task, selected: string[]): boolean {
  return selected.every((id) => task.contexts.includes(id));
}

function matchesQuery(task: Task, q: string): boolean {
  if (!q) return true;
  return task.title.toLowerCase().includes(q) || (task.note?.toLowerCase().includes(q) ?? false);
}

type SortField = 'date' | 'title';
type SortDir = 'asc' | 'desc';
interface Sort {
  field: SortField;
  dir: SortDir;
}

function sortTasks(tasks: Task[], { field, dir }: Sort): Task[] {
  const cmp = (a: Task, b: Task) =>
    field === 'title' ? a.title.localeCompare(b.title) : a.created_at.localeCompare(b.created_at);
  return [...tasks].sort((a, b) => (dir === 'asc' ? cmp(a, b) : -cmp(a, b)));
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
  // Filter view: any number of sticky contexts (long-pressed) plus at most one transient
  // (quick-tapped). The visible list is the intersection of all selected contexts.
  const [stickies, setStickies] = useState<string[]>([]);
  const [transient, setTransient] = useState<string | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [manageOpen, setManageOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeSort, setActiveSort] = useState<Sort>({ field: 'date', dir: 'desc' });
  const [completedSort, setCompletedSort] = useState<Sort>({ field: 'date', dir: 'desc' });
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

  // Notification deep-link: `?task=<id>` opens that task's edit sheet once loaded.
  const taskLinkHandled = useRef(false);
  useEffect(() => {
    if (taskLinkHandled.current || !loaded) return;
    const id = new URLSearchParams(window.location.search).get('task');
    taskLinkHandled.current = true;
    if (!id) return;
    window.history.replaceState({}, '', window.location.pathname);
    const t = tasks.find((x) => x.id === id);
    if (t) setEditing(t);
  }, [loaded, tasks]);

  const selected = useMemo(
    () => (transient && !stickies.includes(transient) ? [...stickies, transient] : stickies),
    [stickies, transient],
  );

  const q = query.trim().toLowerCase();
  const visible = useMemo(
    () => tasks.filter((t) => matchesSelection(t, selected) && matchesQuery(t, q)),
    [tasks, selected, q],
  );
  const active = useMemo(() => sortTasks(visible.filter((t) => !t.completed), activeSort), [visible, activeSort]);
  const completed = useMemo(() => sortTasks(visible.filter((t) => t.completed), completedSort), [visible, completedSort]);

  // Quick tap: toggle the transient, un-stick a sticky (leaving the transient), or set a new
  // transient. Selecting something new clears the previous transient; removing never does.
  function quickPress(id: string) {
    if (transient === id) setTransient(null);
    else if (stickies.includes(id)) setStickies((s) => s.filter((x) => x !== id));
    else setTransient(id);
  }

  // Long press: toggle sticky. Adding a sticky clears the transient; removing one leaves it.
  function toggleSticky(id: string) {
    const removing = stickies.includes(id);
    setStickies((s) => (removing ? s.filter((x) => x !== id) : [...s, id]));
    if (!removing) setTransient(null);
  }

  function clearSelection() {
    setStickies([]);
    setTransient(null);
  }

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
        activeContextIds={selected}
        initialTitle={shared.title}
        initialNote={shared.note}
      />
      <FilterBar
        contexts={contexts}
        stickies={stickies}
        transient={transient}
        onQuickPress={quickPress}
        onToggleSticky={toggleSticky}
        onClear={clearSelection}
        onManage={() => setManageOpen(true)}
      />

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
          <>
            {active.length > 0 && (
              <div className="flex items-center justify-end px-4 pt-2">
                <SortControl sort={activeSort} onChange={setActiveSort} />
              </div>
            )}
            <ul className="divide-y divide-line/60">
              {active.map((t) => (
                <TaskItem key={t.id} task={t} contexts={contexts} onEdit={setEditing} />
              ))}
            </ul>
          </>
        )}

        {completed.length > 0 && (
          <section className="mt-2 border-t border-line">
            <div className="flex w-full items-center justify-between px-4 py-3 text-sm text-muted">
              <button onClick={() => setShowCompleted((s) => !s)} className="flex-1 text-left">
                Completed ({completed.length})
              </button>
              <div className="flex items-center gap-4">
                {showCompleted && <SortControl sort={completedSort} onChange={setCompletedSort} />}
                <button onClick={() => clearCompleted(completed)} className="text-muted hover:text-red-400">
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

const SORT_FIELDS: { field: SortField; label: string }[] = [
  { field: 'date', label: 'Date' },
  { field: 'title', label: 'Title' },
];

function SortControl({ sort, onChange }: { sort: Sort; onChange: (s: Sort) => void }) {
  const [open, setOpen] = useState(false);

  function pick(field: SortField) {
    if (field === sort.field) onChange({ field, dir: sort.dir === 'asc' ? 'desc' : 'asc' });
    else onChange({ field, dir: field === 'date' ? 'desc' : 'asc' });
    setOpen(false);
  }

  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} aria-label="Sort" className={open ? 'text-accent' : 'text-muted'}>
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M7 4v16m0 0l-3-3m3 3l3-3M17 20V4m0 0l-3 3m3-3l3 3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-32 overflow-hidden rounded-xl border border-line bg-elevated shadow-lg">
            {SORT_FIELDS.map(({ field, label }) => (
              <button
                key={field}
                onClick={() => pick(field)}
                className="flex w-full items-center justify-between px-3 py-2 text-sm text-muted"
              >
                <span className={field === sort.field ? 'text-accent' : ''}>{label}</span>
                {field === sort.field && <span className="text-accent">{sort.dir === 'asc' ? '↑' : '↓'}</span>}
              </button>
            ))}
          </div>
        </>
      )}
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
