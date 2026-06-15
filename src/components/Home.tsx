import { useEffect, useMemo, useRef, useState } from 'react';
import type { Profile, Task } from '../types';
import { useStore } from '../lib/useStore';
import { quickAddTask, clearCompleted, setActiveProfile } from '../lib/store';
import { parseTags } from '../lib/tags';
import { tasksForProfile, contextsForProfile, profileName, DEFAULT_PROFILE_NAME } from '../lib/profiles';
import { supabase } from '../lib/supabase';
import { CaptureBar } from './CaptureBar';
import { FilterBar } from './FilterBar';
import { TaskItem } from './TaskItem';
import { EditSheet } from './EditSheet';
import { ContextManager } from './ContextManager';
import { ProfileManager } from './ProfileManager';
import { Toast } from './Toast';

/** Intersection: a task matches only if it carries every selected context. Empty = all. */
function matchesSelection(task: Task, selected: string[]): boolean {
  return selected.every((id) => task.contexts.includes(id));
}

function matchesQuery(task: Task, q: string): boolean {
  if (!q) return true;
  return task.title.toLowerCase().includes(q) || (task.note?.toLowerCase().includes(q) ?? false);
}

type SortField = 'date' | 'title' | 'due' | 'custom';
type SortDir = 'asc' | 'desc';
interface Sort {
  field: SortField;
  dir: SortDir;
}

function sortTasks(tasks: Task[], { field, dir }: Sort): Task[] {
  if (field === 'due') {
    return [...tasks].sort((a, b) => {
      const aHas = a.due_on != null;
      const bHas = b.due_on != null;
      if (aHas && bHas) {
        const cmp = a.due_on!.localeCompare(b.due_on!);
        return dir === 'asc' ? cmp : -cmp;
      }
      if (aHas) return -1;
      if (bHas) return 1;
      return 0;
    });
  }
  const cmp = (a: Task, b: Task) =>
    field === 'title' ? a.title.localeCompare(b.title) : a.created_at.localeCompare(b.created_at);
  return [...tasks].sort((a, b) => (dir === 'asc' ? cmp(a, b) : -cmp(a, b)));
}

const CUSTOM_ORDER_KEY = 'stash.customOrder';

function loadCustomOrders(): Record<string, string[]> {
  try {
    return JSON.parse(localStorage.getItem(CUSTOM_ORDER_KEY) ?? '{}');
  } catch {
    return {};
  }
}

function saveCustomOrders(orders: Record<string, string[]>) {
  localStorage.setItem(CUSTOM_ORDER_KEY, JSON.stringify(orders));
}

// Custom sort orders are stored per (profile, context-selection). Including the
// profile prevents the empty-selection "All" key from colliding across profiles.
function getContextKey(profileId: string | null, selected: string[]): string {
  return `${profileId ?? 'default'}::${[...selected].sort().join('|')}`;
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

interface DragState {
  id: string;
  overId: string | null;
  before: boolean;
}

export function Home() {
  const { tasks: allTasks, contexts: rawContexts, profiles, activeProfileId, online, syncing, pending, loaded } =
    useStore();
  // Everything below operates on just the active profile's slice — switching
  // profiles swaps to a completely separate set of tasks and tags.
  const tasks = useMemo(() => tasksForProfile(allTasks, activeProfileId), [allTasks, activeProfileId]);
  const contexts = useMemo(
    () => contextsForProfile(rawContexts, activeProfileId).sort((a, b) => a.name.localeCompare(b.name)),
    [rawContexts, activeProfileId],
  );
  const [profileManageOpen, setProfileManageOpen] = useState(false);
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
  const [customOrders, setCustomOrders] = useState<Record<string, string[]>>(loadCustomOrders);
  const shared = useMemo(readShared, []);

  // Drag state: ref for fresh reads in handlers, state for rendering.
  const dragData = useRef<DragState | null>(null);
  const [drag, _setDrag] = useState<DragState | null>(null);
  function setDrag(v: DragState | null) {
    dragData.current = v;
    _setDrag(v);
  }

  const listRef = useRef<HTMLUListElement>(null);
  // Always-fresh reference to the current active list for use in event handlers.
  const activeRef = useRef<Task[]>([]);

  const selected = useMemo(
    () => (transient && !stickies.includes(transient) ? [...stickies, transient] : stickies),
    [stickies, transient],
  );

  const contextKey = useMemo(() => getContextKey(activeProfileId, selected), [activeProfileId, selected]);

  // When the context selection changes, auto-apply custom sort if one is saved,
  // or reset out of custom sort if none exists for the new context.
  useEffect(() => {
    setActiveSort((prev) => {
      if (customOrders[contextKey]) return { field: 'custom', dir: 'asc' };
      if (prev.field === 'custom') return { field: 'date', dir: 'desc' };
      return prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextKey]);

  const q = query.trim().toLowerCase();
  const visible = useMemo(
    () => tasks.filter((t) => matchesSelection(t, selected) && matchesQuery(t, q)),
    [tasks, selected, q],
  );

  const active = useMemo(() => {
    const activeTasks = visible.filter((t) => !t.completed);
    let result: Task[];
    if (activeSort.field === 'custom') {
      const order = customOrders[contextKey];
      if (order) {
        const orderMap = new Map(order.map((id, i) => [id, i]));
        result = [...activeTasks].sort(
          (a, b) => (orderMap.get(a.id) ?? Infinity) - (orderMap.get(b.id) ?? Infinity),
        );
      } else {
        result = sortTasks(activeTasks, { field: 'date', dir: 'desc' });
      }
    } else {
      result = sortTasks(activeTasks, activeSort);
    }
    activeRef.current = result;
    return result;
  }, [visible, activeSort, customOrders, contextKey]);

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

  // When switching away from custom sort, forget the stored order for this context.
  function handleActiveSortChange(sort: Sort) {
    if (sort.field !== 'custom' && customOrders[contextKey]) {
      const updated = { ...customOrders };
      delete updated[contextKey];
      setCustomOrders(updated);
      saveCustomOrders(updated);
    }
    setActiveSort(sort);
  }

  // --- Drag-to-reorder ---

  function findTaskAtY(y: number): { id: string; before: boolean } | null {
    if (!listRef.current) return null;
    const items = listRef.current.querySelectorAll<HTMLElement>('li[data-task-id]');
    for (const item of items) {
      const rect = item.getBoundingClientRect();
      if (y >= rect.top && y <= rect.bottom) {
        return { id: item.dataset.taskId!, before: y < rect.top + rect.height / 2 };
      }
    }
    return null;
  }

  function startDrag(_e: React.PointerEvent, taskId: string) {
    // Initialise a custom order from the current display order if one isn't saved yet.
    if (!customOrders[contextKey]) {
      const ids = activeRef.current.map((t) => t.id);
      const updated = { ...customOrders, [contextKey]: ids };
      setCustomOrders(updated);
      saveCustomOrders(updated);
      setActiveSort({ field: 'custom', dir: 'asc' });
    }
    setDrag({ id: taskId, overId: null, before: true });
  }

  function moveDrag(e: React.PointerEvent) {
    const d = dragData.current;
    if (!d) return;
    const result = findTaskAtY(e.clientY);
    if (!result) return;
    if (d.overId !== result.id || d.before !== result.before) {
      setDrag({ ...d, overId: result.id, before: result.before });
    }
  }

  function endDrag() {
    const d = dragData.current;
    if (d?.overId && d.overId !== d.id) {
      const ids = activeRef.current.map((t) => t.id);
      const filtered = ids.filter((id) => id !== d.id);
      const targetIdx = filtered.indexOf(d.overId);
      if (targetIdx !== -1) {
        filtered.splice(d.before ? targetIdx : targetIdx + 1, 0, d.id);
        const updated = { ...customOrders, [contextKey]: filtered };
        setCustomOrders(updated);
        saveCustomOrders(updated);
      }
    }
    setDrag(null);
  }

  const hasCustomOrder = Boolean(customOrders[contextKey]);
  // Disable drag handles while a search filter is active.
  const dragEnabled = !q;

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
    // Search across all profiles: a notification may target a task in one that
    // isn't currently active, so switch to its profile before opening it.
    const t = allTasks.find((x) => x.id === id);
    if (t) {
      if ((t.profile_id ?? null) !== activeProfileId) setActiveProfile(t.profile_id ?? null);
      setEditing(t);
    }
  }, [loaded, allTasks, activeProfileId]);

  // Context deep-link: `?context=<name>` activates that context as a sticky filter once loaded.
  // Silently ignored if the context doesn't exist or has no tasks.
  const contextLinkHandled = useRef(false);
  useEffect(() => {
    if (contextLinkHandled.current || !loaded) return;
    const name = new URLSearchParams(window.location.search).get('context');
    contextLinkHandled.current = true;
    if (!name) return;
    window.history.replaceState({}, '', window.location.pathname);
    const ctx = contexts.find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (!ctx) return;
    const hasTasks = tasks.some((t) => t.contexts.includes(ctx.id));
    if (!hasTasks) return;
    setStickies([ctx.id]);
  }, [loaded, contexts, tasks]);

  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col">
      <header className="safe-top flex items-center justify-between px-4 pb-1 pt-2">
        <ProfileSelector
          profiles={profiles}
          activeProfileId={activeProfileId}
          onSelect={setActiveProfile}
          onManage={() => setProfileManageOpen(true)}
        />
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
              <p className="text-muted">No matches for "{query.trim()}".</p>
            </div>
          ) : (
            <EmptyState loaded={loaded} />
          )
        ) : (
          <>
            {active.length > 0 && (
              <div className="flex items-center justify-end px-4 pt-2">
                <SortControl sort={activeSort} onChange={handleActiveSortChange} hasCustom={hasCustomOrder} />
              </div>
            )}
            <ul ref={listRef} className="divide-y divide-line/60">
              {active.map((t) => (
                <TaskItem
                  key={t.id}
                  task={t}
                  contexts={contexts}
                  onEdit={setEditing}
                  isDragging={drag?.id === t.id}
                  dragOver={drag?.overId === t.id ? (drag.before ? 'above' : 'below') : undefined}
                  dragGrip={dragEnabled ? {
                    onPointerDown: (e) => startDrag(e, t.id),
                    onPointerMove: moveDrag,
                    onPointerUp: endDrag,
                  } : undefined}
                />
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
      {profileManageOpen && <ProfileManager profiles={profiles} onClose={() => setProfileManageOpen(false)} />}
      <Toast />
    </div>
  );
}

const SORT_FIELDS: { field: Exclude<SortField, 'custom'>; label: string }[] = [
  { field: 'date', label: 'Date' },
  { field: 'due', label: 'Due Date' },
  { field: 'title', label: 'Title' },
];

function SortControl({
  sort,
  onChange,
  hasCustom,
}: {
  sort: Sort;
  onChange: (s: Sort) => void;
  hasCustom?: boolean;
}) {
  const [open, setOpen] = useState(false);

  function pick(field: SortField) {
    if (field === 'custom') {
      setOpen(false);
      return;
    }
    if (field === sort.field) onChange({ field, dir: sort.dir === 'asc' ? 'desc' : 'asc' });
    else onChange({ field, dir: field === 'date' ? 'desc' : 'asc' });
    setOpen(false);
  }

  const label =
    sort.field === 'custom'
      ? 'Custom'
      : sort.field === 'date'
      ? `Date ${sort.dir === 'asc' ? '↑' : '↓'}`
      : sort.field === 'due'
      ? `Due ${sort.dir === 'asc' ? '↑' : '↓'}`
      : `Title ${sort.dir === 'asc' ? '↑' : '↓'}`;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Sort"
        className={`flex items-center gap-1 text-xs ${open ? 'text-accent' : 'text-muted'}`}
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M7 4v16m0 0l-3-3m3 3l3-3M17 20V4m0 0l-3 3m3-3l3 3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span>{label}</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-32 overflow-hidden rounded-xl border border-line bg-elevated shadow-lg">
            {hasCustom && (
              <button
                onClick={() => pick('custom')}
                className="flex w-full items-center justify-between px-3 py-2 text-sm text-muted"
              >
                <span className={sort.field === 'custom' ? 'text-accent' : ''}>Custom</span>
                {sort.field === 'custom' && <span className="text-accent">✓</span>}
              </button>
            )}
            {SORT_FIELDS.map(({ field, label: fieldLabel }) => (
              <button
                key={field}
                onClick={() => pick(field)}
                className="flex w-full items-center justify-between px-3 py-2 text-sm text-muted"
              >
                <span className={field === sort.field ? 'text-accent' : ''}>{fieldLabel}</span>
                {field === sort.field && <span className="text-accent">{sort.dir === 'asc' ? '↑' : '↓'}</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ProfileSelector({
  profiles,
  activeProfileId,
  onSelect,
  onManage,
}: {
  profiles: Profile[];
  activeProfileId: string | null;
  onSelect: (id: string | null) => void;
  onManage: () => void;
}) {
  const [open, setOpen] = useState(false);
  const current = profileName(profiles, activeProfileId);

  function choose(id: string | null) {
    onSelect(id);
    setOpen(false);
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Switch profile"
        className="flex items-center gap-1 text-lg font-bold tracking-tight"
      >
        <span>{current}</span>
        <svg viewBox="0 0 24 24" className={`h-4 w-4 text-muted transition ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 z-20 mt-1 w-48 overflow-hidden rounded-xl border border-line bg-elevated shadow-lg">
            <ProfileOption label={DEFAULT_PROFILE_NAME} active={activeProfileId === null} onClick={() => choose(null)} />
            {profiles.map((p) => (
              <ProfileOption key={p.id} label={p.name} active={activeProfileId === p.id} onClick={() => choose(p.id)} />
            ))}
            <button
              onClick={() => {
                setOpen(false);
                onManage();
              }}
              className="flex w-full items-center gap-2 border-t border-line px-3 py-2 text-sm text-muted"
            >
              <span className="text-accent">+</span> Manage profiles…
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function ProfileOption({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center justify-between px-3 py-2 text-sm text-muted">
      <span className={active ? 'text-accent' : ''}>{label}</span>
      {active && <span className="text-accent">✓</span>}
    </button>
  );
}

function EmptyState({ loaded }: { loaded: boolean }) {
  return (
    <div className="grid place-items-center px-8 py-24 text-center">
      <p className="text-muted">{loaded ? 'Nothing here yet — add something above.' : 'Loading your tasks…'}</p>
    </div>
  );
}
