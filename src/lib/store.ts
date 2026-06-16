import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { Context, Profile, Task } from '../types';
import { planContextMigration, profileName } from './profiles';

// ── Persisted state shape ────────────────────────────────────
interface Toast {
  id: string;
  message: string;
  undo: () => void;
}

interface State {
  tasks: Task[];
  contexts: Context[];
  profiles: Profile[];
  // The profile currently being viewed. null = the implicit Default profile.
  // This is a per-device preference (not synced), so each device can view its own.
  activeProfileId: string | null;
  loaded: boolean;
  online: boolean;
  syncing: boolean;
  pending: number;
  toast: Toast | null;
}

type Op =
  | { kind: 'task.insert'; row: Task }
  | { kind: 'task.update'; id: string; patch: Partial<Task> }
  | { kind: 'task.delete'; id: string }
  | { kind: 'context.insert'; row: Context }
  | { kind: 'context.update'; id: string; patch: Partial<Context> }
  | { kind: 'context.delete'; id: string }
  | { kind: 'profile.insert'; row: Profile }
  | { kind: 'profile.update'; id: string; patch: Partial<Profile> }
  | { kind: 'profile.delete'; id: string };

const KEY = {
  tasks: 'stash.tasks',
  contexts: 'stash.contexts',
  profiles: 'stash.profiles',
  queue: 'stash.queue',
};

// Per-device active-profile preference, kept separate from synced data.
const ACTIVE_PROFILE_KEY = 'stash.activeProfile';

// ── In-memory state + subscribers ────────────────────────────
let state: State = {
  tasks: load<Task[]>(KEY.tasks, []),
  contexts: load<Context[]>(KEY.contexts, []),
  profiles: load<Profile[]>(KEY.profiles, []),
  activeProfileId: load<string | null>(ACTIVE_PROFILE_KEY, null),
  loaded: false,
  online: navigator.onLine,
  syncing: false,
  pending: load<Op[]>(KEY.queue, []).length,
  toast: null,
};

const listeners = new Set<() => void>();

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getSnapshot(): State {
  return state;
}

function set(patch: Partial<State>): void {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn());
}

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full / unavailable — non-fatal */
  }
}

function setTasks(tasks: Task[]): void {
  save(KEY.tasks, tasks);
  set({ tasks });
}

// ── Undo toast ───────────────────────────────────────────────
let toastTimer: ReturnType<typeof setTimeout> | undefined;

function showToast(message: string, undo: () => void): void {
  if (toastTimer) clearTimeout(toastTimer);
  set({ toast: { id: crypto.randomUUID(), message, undo } });
  toastTimer = setTimeout(() => set({ toast: null }), 5000);
}

export function dismissToast(): void {
  if (toastTimer) clearTimeout(toastTimer);
  set({ toast: null });
}

export function runUndo(): void {
  const toast = state.toast;
  if (!toast) return;
  dismissToast();
  toast.undo();
}

function setContexts(contexts: Context[]): void {
  save(KEY.contexts, contexts);
  set({ contexts });
}

function setProfiles(profiles: Profile[]): void {
  save(KEY.profiles, profiles);
  set({ profiles });
}

// ── Write queue ──────────────────────────────────────────────
function readQueue(): Op[] {
  return load<Op[]>(KEY.queue, []);
}

function writeQueue(queue: Op[]): void {
  save(KEY.queue, queue);
  set({ pending: queue.length });
}

function enqueue(op: Op): void {
  writeQueue([...readQueue(), op]);
  void flush();
}

async function applyOp(op: Op): Promise<void> {
  switch (op.kind) {
    case 'task.insert': {
      const { error } = await supabase.from('tasks').insert(op.row);
      if (error) throw error;
      break;
    }
    case 'task.update': {
      const { error } = await supabase.from('tasks').update(op.patch).eq('id', op.id);
      if (error) throw error;
      break;
    }
    case 'task.delete': {
      const { error } = await supabase.from('tasks').delete().eq('id', op.id);
      if (error) throw error;
      break;
    }
    case 'context.insert': {
      const { error } = await supabase.from('contexts').insert(op.row);
      if (error) throw error;
      break;
    }
    case 'context.update': {
      const { error } = await supabase.from('contexts').update(op.patch).eq('id', op.id);
      if (error) throw error;
      break;
    }
    case 'context.delete': {
      const { error } = await supabase.from('contexts').delete().eq('id', op.id);
      if (error) throw error;
      break;
    }
    case 'profile.insert': {
      const { error } = await supabase.from('profiles').insert(op.row);
      if (error) throw error;
      break;
    }
    case 'profile.update': {
      const { error } = await supabase.from('profiles').update(op.patch).eq('id', op.id);
      if (error) throw error;
      break;
    }
    case 'profile.delete': {
      // The DB foreign key cascades to this profile's tasks + contexts server-side.
      const { error } = await supabase.from('profiles').delete().eq('id', op.id);
      if (error) throw error;
      break;
    }
  }
}

let flushing = false;

export async function flush(): Promise<void> {
  if (flushing || !navigator.onLine) return;
  if (readQueue().length === 0) return;

  flushing = true;
  set({ syncing: true });
  try {
    // Re-read on every iteration: ops can be appended mid-flush (e.g. EditSheet's save
    // enqueues an updateTask then a setReminder back to back), and writing back a stale
    // snapshot would silently drop anything appended after it was taken.
    let queue = readQueue();
    while (queue.length > 0) {
      await applyOp(queue[0]);
      writeQueue(readQueue().slice(1));
      queue = readQueue();
    }
  } catch {
    // Stop on first failure; remaining ops stay queued for the next attempt.
  } finally {
    flushing = false;
    set({ syncing: false });
  }
}

// ── Server fetch + reconcile ─────────────────────────────────
async function fetchAll(): Promise<void> {
  if (!navigator.onLine) return;
  const [tasksRes, ctxRes, profRes] = await Promise.all([
    supabase.from('tasks').select('*').order('created_at', { ascending: false }),
    supabase.from('contexts').select('*').order('created_at', { ascending: true }),
    supabase.from('profiles').select('*').order('created_at', { ascending: true }),
  ]);
  if (!tasksRes.error && tasksRes.data) {
    const incoming = tasksRes.data as Task[];
    // Rows with unflushed local writes keep their optimistic copy — the server snapshot
    // may predate the queued op and would otherwise clobber the pending change.
    const merged = incoming.map((t) => {
      if (!hasPendingForRow(t.id)) return t;
      return state.tasks.find((local) => local.id === t.id) ?? t;
    });
    setTasks(merged);
  }
  if (!ctxRes.error && ctxRes.data) setContexts(ctxRes.data as Context[]);
  if (!profRes.error && profRes.data) setProfiles(profRes.data as Profile[]);
}

// ── Realtime sync ────────────────────────────────────────────
let channel: RealtimeChannel | null = null;

// A remote event for a row we still have unsynced locally must be ignored,
// so an incoming change never clobbers a pending optimistic edit.
function hasPendingForRow(id: string): boolean {
  return readQueue().some((op) => ('row' in op ? op.row.id : op.id) === id);
}

function applyRemoteTask(event: string, next: Task | null, prevId: string | undefined): void {
  const id = next?.id ?? prevId;
  if (!id || hasPendingForRow(id)) return;
  if (event === 'DELETE') {
    setTasks(state.tasks.filter((t) => t.id !== id));
    return;
  }
  if (!next) return;
  const rest = state.tasks.filter((t) => t.id !== id);
  setTasks([next, ...rest].sort((a, b) => b.created_at.localeCompare(a.created_at)));
}

function applyRemoteContext(event: string, next: Context | null, prevId: string | undefined): void {
  const id = next?.id ?? prevId;
  if (!id || hasPendingForRow(id)) return;
  if (event === 'DELETE') {
    setContexts(state.contexts.filter((c) => c.id !== id));
    return;
  }
  if (!next) return;
  const rest = state.contexts.filter((c) => c.id !== id);
  setContexts([...rest, next].sort((a, b) => a.created_at.localeCompare(b.created_at)));
}

function applyRemoteProfile(event: string, next: Profile | null, prevId: string | undefined): void {
  const id = next?.id ?? prevId;
  if (!id || hasPendingForRow(id)) return;
  if (event === 'DELETE') {
    // A profile delete cascades on the server; mirror that locally by dropping the
    // profile and any of its tasks/contexts (their own DELETE events may also arrive).
    if (id === state.activeProfileId) setActiveProfile(null);
    setTasks(state.tasks.filter((t) => t.profile_id !== id));
    setContexts(state.contexts.filter((c) => c.profile_id !== id));
    setProfiles(state.profiles.filter((p) => p.id !== id));
    return;
  }
  if (!next) return;
  const rest = state.profiles.filter((p) => p.id !== id);
  setProfiles([...rest, next].sort((a, b) => a.created_at.localeCompare(b.created_at)));
}

function onResume(): void {
  if (document.visibilityState === 'visible') void fetchAll();
}

async function subscribeRealtime(): Promise<void> {
  teardownRealtime();
  const { data } = await supabase.auth.getUser();
  const userId = data.user?.id;
  if (!userId) return;
  const filter = `user_id=eq.${userId}`;

  channel = supabase
    .channel('stash-sync')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'tasks', filter },
      (payload) => applyRemoteTask(payload.eventType, payload.new as Task, (payload.old as { id?: string }).id),
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'contexts', filter },
      (payload) => applyRemoteContext(payload.eventType, payload.new as Context, (payload.old as { id?: string }).id),
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'profiles', filter },
      (payload) => applyRemoteProfile(payload.eventType, payload.new as Profile, (payload.old as { id?: string }).id),
    )
    .subscribe();

  document.addEventListener('visibilitychange', onResume);
  window.addEventListener('focus', onResume);
}

function teardownRealtime(): void {
  document.removeEventListener('visibilitychange', onResume);
  window.removeEventListener('focus', onResume);
  if (channel) {
    void supabase.removeChannel(channel);
    channel = null;
  }
}

export async function init(): Promise<void> {
  set({ online: navigator.onLine });
  await flush();
  await fetchAll();
  await subscribeRealtime();
  set({ loaded: true });

  window.addEventListener('online', () => {
    set({ online: true });
    void flush().then(fetchAll);
  });
  window.addEventListener('offline', () => set({ online: false }));

  // Safety net: retry queued writes periodically while anything is pending.
  setInterval(() => {
    if (readQueue().length > 0) void flush();
  }, 15000);
}

export function reset(): void {
  teardownRealtime();
  localStorage.removeItem(KEY.tasks);
  localStorage.removeItem(KEY.contexts);
  localStorage.removeItem(KEY.profiles);
  localStorage.removeItem(KEY.queue);
  localStorage.removeItem(ACTIVE_PROFILE_KEY);
  state = {
    tasks: [],
    contexts: [],
    profiles: [],
    activeProfileId: null,
    loaded: false,
    online: navigator.onLine,
    syncing: false,
    pending: 0,
    toast: null,
  };
  listeners.forEach((fn) => fn());
}

// ── Public mutations (optimistic) ────────────────────────────
export function createTask(title: string, contexts: string[], note?: string): string {
  const row: Task = {
    id: crypto.randomUUID(),
    title: title.trim(),
    note: note?.trim() || null,
    contexts,
    completed: false,
    created_at: new Date().toISOString(),
    completed_at: null,
    due_on: null,
    reminder_at: null,
    notify_next_at: null,
    notify_stage: 0,
    // New tasks land in the profile currently being viewed (null = Default).
    profile_id: state.activeProfileId,
  };
  setTasks([row, ...state.tasks]);
  enqueue({ kind: 'task.insert', row });
  return row.id;
}

// Quick-capture entry point (deeplink): create a task and confirm with an undo toast.
export function quickAddTask(title: string, contexts: string[]): void {
  const id = createTask(title, contexts);
  showToast('Added', () => deleteTask(id));
}

export function updateTask(id: string, patch: Partial<Pick<Task, 'title' | 'note' | 'contexts' | 'due_on'>>): void {
  setTasks(state.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  enqueue({ kind: 'task.update', id, patch });
}

// Set/replace a one-off reminder. Resets the nudge schedule to stage 0 at the new time.
export function setReminder(id: string, reminderAt: string): void {
  const patch: Partial<Task> = { reminder_at: reminderAt, notify_next_at: reminderAt, notify_stage: 0 };
  setTasks(state.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  enqueue({ kind: 'task.update', id, patch });
}

// Remove a reminder and cancel any pending nudges.
export function clearReminder(id: string): void {
  const patch: Partial<Task> = { reminder_at: null, notify_next_at: null, notify_stage: 0 };
  setTasks(state.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  enqueue({ kind: 'task.update', id, patch });
}

// Move a task to another profile. Tags are profile-scoped, so we re-point the
// task's tags at the destination's matching tags (by name), creating any that are
// missing so nothing is lost. An undo toast restores the task's prior profile and
// tags exactly. No-op if the task is already in the target profile.
export function moveTaskToProfile(id: string, targetProfileId: string | null): void {
  const task = state.tasks.find((t) => t.id === id);
  if (!task) return;
  const from = task.profile_id ?? null;
  if (from === targetProfileId) return;
  const prevContexts = task.contexts;

  const { contexts, created } = planContextMigration(
    task.contexts,
    state.contexts,
    targetProfileId,
    (name) => ({
      id: crypto.randomUUID(),
      name,
      created_at: new Date().toISOString(),
      profile_id: targetProfileId,
    }),
  );

  // Create the missing tags in the destination before re-pointing the task at them.
  if (created.length > 0) {
    setContexts([...state.contexts, ...created]);
    created.forEach((row) => enqueue({ kind: 'context.insert', row }));
  }

  const patch: Partial<Task> = { profile_id: targetProfileId, contexts };
  setTasks(state.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  enqueue({ kind: 'task.update', id, patch });

  showToast(`Moved to ${profileName(state.profiles, targetProfileId)}`, () => {
    const undo: Partial<Task> = { profile_id: from, contexts: prevContexts };
    setTasks(state.tasks.map((t) => (t.id === id ? { ...t, ...undo } : t)));
    enqueue({ kind: 'task.update', id, patch: undo });
  });
}

export function toggleComplete(id: string): void {
  const task = state.tasks.find((t) => t.id === id);
  if (!task) return;
  const completed = !task.completed;
  const completed_at = completed ? new Date().toISOString() : null;
  const patch: Partial<Task> = { completed, completed_at };
  if (completed) {
    patch.notify_next_at = null;
  } else if (task.reminder_at) {
    patch.notify_next_at = task.reminder_at;
    patch.notify_stage = 0;
  }
  setTasks(state.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  enqueue({ kind: 'task.update', id, patch });
  if (completed) {
    navigator.vibrate?.(15);
    showToast('Completed', () => toggleComplete(id));
  }
}

export function clearCompleted(cleared: Task[]): void {
  if (cleared.length === 0) return;
  const ids = new Set(cleared.map((t) => t.id));
  setTasks(state.tasks.filter((t) => !ids.has(t.id)));
  cleared.forEach((t) => enqueue({ kind: 'task.delete', id: t.id }));
  showToast(`Cleared ${cleared.length}`, () => restoreMany(cleared));
}

function restoreMany(tasks: Task[]): void {
  const merged = [...state.tasks, ...tasks].sort((a, b) => b.created_at.localeCompare(a.created_at));
  setTasks(merged);
  tasks.forEach((row) => enqueue({ kind: 'task.insert', row }));
}

export function deleteTask(id: string): void {
  const task = state.tasks.find((t) => t.id === id);
  setTasks(state.tasks.filter((t) => t.id !== id));
  enqueue({ kind: 'task.delete', id });
  if (task) showToast('Deleted', () => restoreTask(task));
}

function restoreTask(task: Task): void {
  const tasks = [...state.tasks, task].sort((a, b) => b.created_at.localeCompare(a.created_at));
  setTasks(tasks);
  enqueue({ kind: 'task.insert', row: task });
}

export function createContext(name: string): void {
  const row: Context = {
    id: crypto.randomUUID(),
    name: name.trim(),
    created_at: new Date().toISOString(),
    // Tags are scoped to the profile they're created in (null = Default).
    profile_id: state.activeProfileId,
  };
  setContexts([...state.contexts, row]);
  enqueue({ kind: 'context.insert', row });
}

export function renameContext(id: string, name: string): void {
  setContexts(state.contexts.map((c) => (c.id === id ? { ...c, name: name.trim() } : c)));
  enqueue({ kind: 'context.update', id, patch: { name: name.trim() } });
}

export function deleteContext(id: string): void {
  // Strip the context from any tasks that reference it.
  state.tasks
    .filter((t) => t.contexts.includes(id))
    .forEach((t) => updateTask(t.id, { contexts: t.contexts.filter((c) => c !== id) }));
  setContexts(state.contexts.filter((c) => c.id !== id));
  enqueue({ kind: 'context.delete', id });
}

// ── Profiles ─────────────────────────────────────────────────
// Select which profile is being viewed. Per-device only — not synced or queued.
export function setActiveProfile(id: string | null): void {
  save(ACTIVE_PROFILE_KEY, id);
  set({ activeProfileId: id });
}

export function createProfile(name: string): string {
  const row: Profile = { id: crypto.randomUUID(), name: name.trim(), created_at: new Date().toISOString() };
  setProfiles([...state.profiles, row]);
  enqueue({ kind: 'profile.insert', row });
  return row.id;
}

export function renameProfile(id: string, name: string): void {
  setProfiles(state.profiles.map((p) => (p.id === id ? { ...p, name: name.trim() } : p)));
  enqueue({ kind: 'profile.update', id, patch: { name: name.trim() } });
}

// Deleting a profile removes it and all of its tasks + contexts. The single queued
// profile.delete relies on the DB foreign-key cascade to remove the children
// server-side; here we drop them optimistically from local state.
export function deleteProfile(id: string): void {
  if (state.activeProfileId === id) setActiveProfile(null);
  setTasks(state.tasks.filter((t) => t.profile_id !== id));
  setContexts(state.contexts.filter((c) => c.profile_id !== id));
  setProfiles(state.profiles.filter((p) => p.id !== id));
  enqueue({ kind: 'profile.delete', id });
}
