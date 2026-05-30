import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { Context, Task } from '../types';

// ── Persisted state shape ────────────────────────────────────
interface Toast {
  id: string;
  message: string;
  undo: () => void;
}

interface State {
  tasks: Task[];
  contexts: Context[];
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
  | { kind: 'context.delete'; id: string };

const DEFAULT_CONTEXTS = ['IOM', 'Work', 'Home', 'Personal'];

const KEY = {
  tasks: 'stash.tasks',
  contexts: 'stash.contexts',
  queue: 'stash.queue',
};

// ── In-memory state + subscribers ────────────────────────────
let state: State = {
  tasks: load<Task[]>(KEY.tasks, []),
  contexts: load<Context[]>(KEY.contexts, []),
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
  }
}

let flushing = false;

export async function flush(): Promise<void> {
  if (flushing || !navigator.onLine) return;
  let queue = readQueue();
  if (queue.length === 0) return;

  flushing = true;
  set({ syncing: true });
  try {
    while (queue.length > 0) {
      await applyOp(queue[0]);
      queue = queue.slice(1);
      writeQueue(queue);
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
  const [tasksRes, ctxRes] = await Promise.all([
    supabase.from('tasks').select('*').order('created_at', { ascending: false }),
    supabase.from('contexts').select('*').order('created_at', { ascending: true }),
  ]);
  if (!tasksRes.error && tasksRes.data) setTasks(tasksRes.data as Task[]);
  if (!ctxRes.error && ctxRes.data) setContexts(ctxRes.data as Context[]);
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

async function seedDefaultsIfEmpty(): Promise<void> {
  if (state.contexts.length > 0 || readQueue().length > 0) return;
  const now = new Date().toISOString();
  const rows: Context[] = DEFAULT_CONTEXTS.map((name) => ({
    id: crypto.randomUUID(),
    name,
    created_at: now,
  }));
  setContexts(rows);
  rows.forEach((row) => enqueue({ kind: 'context.insert', row }));
}

export async function init(): Promise<void> {
  set({ online: navigator.onLine });
  await flush();
  await fetchAll();
  await seedDefaultsIfEmpty();
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
  localStorage.removeItem(KEY.queue);
  state = { tasks: [], contexts: [], loaded: false, online: navigator.onLine, syncing: false, pending: 0, toast: null };
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

export function updateTask(id: string, patch: Partial<Pick<Task, 'title' | 'note' | 'contexts'>>): void {
  setTasks(state.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  enqueue({ kind: 'task.update', id, patch });
}

export function toggleComplete(id: string): void {
  const task = state.tasks.find((t) => t.id === id);
  if (!task) return;
  const completed = !task.completed;
  const completed_at = completed ? new Date().toISOString() : null;
  setTasks(state.tasks.map((t) => (t.id === id ? { ...t, completed, completed_at } : t)));
  enqueue({ kind: 'task.update', id, patch: { completed, completed_at } });
  if (completed) showToast('Completed', () => toggleComplete(id));
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
  const row: Context = { id: crypto.randomUUID(), name: name.trim(), created_at: new Date().toISOString() };
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
