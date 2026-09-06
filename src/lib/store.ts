import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { Context, Profile, ProfileMember, Task } from '../types';
import { planContextMigration, profileName } from './profiles';
import { isValidEmail, normalizeEmail } from './sharing';
import { parseNaturalDate } from './dates';
import { nextOccurrence } from './recur';

// ── Persisted state shape ────────────────────────────────────
interface Toast {
  id: string;
  message: string;
  // Absent for plain messages (e.g. a failed share) that have nothing to undo.
  undo?: () => void;
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
  // My memberships of other people's profiles, plus the full member list of every
  // profile I own. RLS decides which rows land here; this is never a security check.
  members: ProfileMember[];
  // The signed-in user. Cached locally so an offline launch still knows who owns
  // what (and so a profile created offline can be stamped with its owner).
  userId: string | null;
  userEmail: string | null;
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
  members: 'stash.members',
  queue: 'stash.queue',
};

// Signed-in identity, cached so the app knows who it is before the session resolves.
const IDENTITY_KEY = 'stash.identity';

interface Identity {
  userId: string | null;
  userEmail: string | null;
}

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
  members: load<ProfileMember[]>(KEY.members, []),
  userId: load<Identity>(IDENTITY_KEY, { userId: null, userEmail: null }).userId,
  userEmail: load<Identity>(IDENTITY_KEY, { userId: null, userEmail: null }).userEmail,
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

// A toast with nothing to undo — how the online-only sharing actions report failure.
function showMessage(message: string): void {
  if (toastTimer) clearTimeout(toastTimer);
  set({ toast: { id: crypto.randomUUID(), message } });
  toastTimer = setTimeout(() => set({ toast: null }), 5000);
}

export function runUndo(): void {
  const toast = state.toast;
  if (!toast) return;
  dismissToast();
  toast.undo?.();
}

function setContexts(contexts: Context[]): void {
  save(KEY.contexts, contexts);
  set({ contexts });
}

function setProfiles(profiles: Profile[]): void {
  save(KEY.profiles, profiles);
  set({ profiles });
}

function setMembers(members: ProfileMember[]): void {
  save(KEY.members, members);
  set({ members });
}

function setIdentity(userId: string | null, userEmail: string | null): void {
  save(IDENTITY_KEY, { userId, userEmail } satisfies Identity);
  set({ userId, userEmail });
}

// True for a membership row that is mine. Matched by user_id once accepted, and by
// email while pending — an invite can predate the account it was addressed to.
function isMyMembership(m: ProfileMember): boolean {
  if (state.userId && m.user_id === state.userId) return true;
  return state.userEmail !== null && normalizeEmail(m.email) === state.userEmail;
}

function ownsProfile(profileId: string): boolean {
  const profile = state.profiles.find((p) => p.id === profileId);
  return profile !== undefined && state.userId !== null && profile.user_id === state.userId;
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
      // The owner is the database's business: profiles.user_id defaults to auth.uid()
      // and RLS checks it. The local copy is optimistic only, and is blank when the
      // profile was created before the session resolved.
      const { user_id: _owner, ...row } = op.row;
      const { error } = await supabase.from('profiles').insert(row);
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
// Resolve who is signed in. A missing user (offline, or a session still refreshing)
// leaves the cached identity alone rather than blanking it — losing it mid-session
// would make every owned profile look like someone else's.
async function loadIdentity(): Promise<void> {
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) return;
  setIdentity(user.id, user.email ? normalizeEmail(user.email) : null);
}

async function fetchAll(): Promise<void> {
  if (!navigator.onLine) return;
  await loadIdentity();
  const [tasksRes, ctxRes, profRes, memberRes] = await Promise.all([
    supabase.from('tasks').select('*').order('created_at', { ascending: false }),
    supabase.from('contexts').select('*').order('created_at', { ascending: true }),
    supabase.from('profiles').select('*').order('created_at', { ascending: true }),
    supabase.from('profile_members').select('*').order('created_at', { ascending: true }),
  ]);
  if (!tasksRes.error && tasksRes.data) {
    const incoming = tasksRes.data as Task[];
    const pendingIds = new Set(readQueue().map((op) => ('row' in op ? op.row.id : op.id)));
    // Rows with unflushed local writes keep their optimistic copy — the server snapshot
    // may predate the queued op and would otherwise clobber the pending change.
    const merged = incoming.map((t) => {
      if (!pendingIds.has(t.id)) return t;
      return state.tasks.find((local) => local.id === t.id) ?? t;
    });
    // Tasks created locally whose insert hasn't flushed yet aren't in the server
    // snapshot at all; keep them so a fetch racing the flush can't make a
    // just-created task vanish.
    const incomingIds = new Set(incoming.map((t) => t.id));
    const pendingLocal = state.tasks.filter((t) => pendingIds.has(t.id) && !incomingIds.has(t.id));
    setTasks(
      [...pendingLocal, ...merged].sort((a, b) => b.created_at.localeCompare(a.created_at)),
    );
  }
  if (!ctxRes.error && ctxRes.data) setContexts(ctxRes.data as Context[]);
  if (!memberRes.error && memberRes.data) setMembers(memberRes.data as ProfileMember[]);
  if (!profRes.error && profRes.data) {
    const incoming = profRes.data as Profile[];
    const incomingIds = new Set(incoming.map((p) => p.id));
    const pendingIds = new Set(readQueue().map((op) => ('row' in op ? op.row.id : op.id)));
    // A profile that has dropped out of the snapshot is one I can no longer read:
    // revoked, left on another device, or deleted by its owner. Purge its local copy
    // silently, per the brief. A profile created locally whose insert hasn't flushed
    // isn't in the snapshot either — those must survive.
    const lost = state.profiles.filter((p) => !incomingIds.has(p.id) && !pendingIds.has(p.id));
    setProfiles(incoming);
    lost.forEach((p) => purgeProfile(p.id));
  }
  syncSharedChannels();
}

// ── Losing access to a shared profile ────────────────────────
// Revoke, leave and owner-delete all end the same way: the profile and everything
// in it must go, locally as well as on the server. Queued writes for those rows go
// too — after revocation they fail RLS forever and would jam the queue behind them.
function purgeProfile(id: string): void {
  const doomed = new Set<string>([
    id,
    ...state.tasks.filter((t) => t.profile_id === id).map((t) => t.id),
    ...state.contexts.filter((c) => c.profile_id === id).map((c) => c.id),
  ]);
  if (state.activeProfileId === id) setActiveProfile(null);
  setTasks(state.tasks.filter((t) => t.profile_id !== id));
  setContexts(state.contexts.filter((c) => c.profile_id !== id));
  setProfiles(state.profiles.filter((p) => p.id !== id));
  setMembers(state.members.filter((m) => m.profile_id !== id));
  writeQueue(
    readQueue().filter((op) => {
      if (doomed.has('row' in op ? op.row.id : op.id)) return false;
      // An unflushed insert names the profile even though the row is already gone
      // from local state by now.
      return !('row' in op && 'profile_id' in op.row && op.row.profile_id === id);
    }),
  );
}

// ── Realtime sync ────────────────────────────────────────────
// Own rows: everything the DB says is mine (user_id = me), plus profile_members.
let channel: RealtimeChannel | null = null;
// Shared profiles: one channel per accepted membership, keyed by profile id, so a
// membership change adds or drops a single channel instead of resubscribing the lot.
// Under owner-owns-everything a member's rows carry the OWNER's user_id, so the
// own-rows filter above would deliver them nothing at all.
const sharedChannels = new Map<string, RealtimeChannel>();

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

// A membership row arriving, changing or vanishing. RLS already scopes this table
// (owner sees their whole member list; everyone else sees only their own row), so
// there is no filter on the subscription.
function applyRemoteMember(
  event: string,
  next: ProfileMember | null,
  prev: Partial<ProfileMember> | undefined,
): void {
  const id = next?.id ?? prev?.id;
  if (!id) return;

  if (event === 'DELETE') {
    // Prefer the copy we already hold: a DELETE payload only carries the whole old
    // row while replica identity is full, and we still want to know whose row it was.
    const gone = state.members.find((m) => m.id === id) ?? (prev as ProfileMember | undefined);
    setMembers(state.members.filter((m) => m.id !== id));
    // My own membership disappearing means I was revoked (or left from another
    // device). Drop the profile silently — the brief is explicit that revocation is
    // not announced.
    if (gone && isMyMembership(gone) && !ownsProfile(gone.profile_id)) purgeProfile(gone.profile_id);
    syncSharedChannels();
    return;
  }

  if (!next) return;
  setMembers([...state.members.filter((m) => m.id !== id), next]);
  syncSharedChannels();
  // An invite of mine turning accepted (typically on another device) opens up rows
  // this device has never been allowed to read; pull the snapshot in.
  if (
    isMyMembership(next) &&
    next.status === 'accepted' &&
    !state.profiles.some((p) => p.id === next.profile_id)
  ) {
    void fetchAll();
  }
}

// Profiles I have accepted membership of and do not own. Owned profiles are
// deliberately excluded: their rows already arrive on the own-rows channel, and a
// second subscription would deliver every event twice.
function sharedProfileIds(): string[] {
  const me = state.userId;
  if (!me) return [];
  const owned = new Set(state.profiles.filter((p) => p.user_id === me).map((p) => p.id));
  const ids = new Set<string>();
  for (const m of state.members) {
    if (m.status !== 'accepted' || m.user_id !== me) continue;
    if (owned.has(m.profile_id)) continue;
    ids.add(m.profile_id);
  }
  return [...ids];
}

// Reconcile the per-profile channels with the current membership set. Called after
// every fetch and every membership change; removing the channels that are no longer
// wanted is what stops them leaking as invites come and go.
function syncSharedChannels(): void {
  const wanted = new Set(sharedProfileIds());
  for (const [id, ch] of sharedChannels) {
    if (wanted.has(id)) continue;
    void supabase.removeChannel(ch);
    sharedChannels.delete(id);
  }
  for (const id of wanted) {
    if (sharedChannels.has(id)) continue;
    sharedChannels.set(id, subscribeToProfile(id));
  }
}

function subscribeToProfile(profileId: string): RealtimeChannel {
  const filter = `profile_id=eq.${profileId}`;
  return supabase
    .channel(`stash-profile-${profileId}`)
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
      // The profile row belongs to its owner, so a rename or a delete would
      // otherwise never reach a member.
      'postgres_changes',
      { event: '*', schema: 'public', table: 'profiles', filter: `id=eq.${profileId}` },
      (payload) => applyRemoteProfile(payload.eventType, payload.new as Profile, (payload.old as { id?: string }).id),
    )
    .subscribe();
}

async function subscribeRealtime(): Promise<void> {
  teardownRealtime();
  if (!state.userId) await loadIdentity();
  const userId = state.userId;
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
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'profile_members' },
      (payload) => applyRemoteMember(payload.eventType, payload.new as ProfileMember, payload.old as Partial<ProfileMember>),
    )
    .subscribe();

  syncSharedChannels();

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
  sharedChannels.forEach((ch) => void supabase.removeChannel(ch));
  sharedChannels.clear();
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
  localStorage.removeItem(KEY.members);
  localStorage.removeItem(KEY.queue);
  localStorage.removeItem(ACTIVE_PROFILE_KEY);
  localStorage.removeItem(IDENTITY_KEY);
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
    members: [],
    userId: null,
    userEmail: null,
  };
  listeners.forEach((fn) => fn());
}

// ── Public mutations (optimistic) ────────────────────────────
export function createTask(title: string, contexts: string[], note?: string, dueOn?: string | null): string {
  const row: Task = {
    id: crypto.randomUUID(),
    title: title.trim(),
    note: note?.trim() || null,
    contexts,
    completed: false,
    created_at: new Date().toISOString(),
    completed_at: null,
    due_on: dueOn ?? null,
    reminder_at: null,
    notify_next_at: null,
    notify_stage: 0,
    recur: null,
    // New tasks land in the profile currently being viewed (null = Default).
    profile_id: state.activeProfileId,
  };
  setTasks([row, ...state.tasks]);
  enqueue({ kind: 'task.insert', row });
  return row.id;
}

// Quick-capture entry point (deeplink): create a task and confirm with an undo toast.
export function quickAddTask(title: string, contexts: string[]): void {
  const { title: cleaned, dueOn } = parseNaturalDate(title);
  const id = createTask(cleaned, contexts, undefined, dueOn);
  showToast('Added', () => deleteTask(id));
}

export function updateTask(id: string, patch: Partial<Pick<Task, 'title' | 'note' | 'contexts' | 'due_on' | 'recur'>>): void {
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
  if (!completed) return;

  navigator.vibrate?.(15);

  // Recurring tasks spawn their next occurrence on completion — the ticked-off
  // row stays in Done as a record, and a fresh task appears with the advanced
  // due date. Undo removes the spawned occurrence and un-checks the original.
  if (task.recur) {
    const next = nextOccurrence(task, crypto.randomUUID());
    setTasks(
      [next, ...state.tasks].sort((a, b) => b.created_at.localeCompare(a.created_at)),
    );
    enqueue({ kind: 'task.insert', row: next });
    const nextDay = new Date(`${next.due_on}T00:00:00`).toLocaleDateString(undefined, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
    showToast(`Completed · next ${nextDay}`, () => {
      deleteTask(next.id);
      dismissToast(); // deleteTask's own "Deleted" toast would mask this undo
      toggleComplete(id);
    });
    return;
  }

  showToast('Completed', () => toggleComplete(id));
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

export function createContext(name: string): Context {
  const row: Context = {
    id: crypto.randomUUID(),
    name: name.trim(),
    created_at: new Date().toISOString(),
    // Tags are scoped to the profile they're created in (null = Default).
    profile_id: state.activeProfileId,
  };
  setContexts([...state.contexts, row]);
  enqueue({ kind: 'context.insert', row });
  return row;
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
  const row: Profile = {
    id: crypto.randomUUID(),
    name: name.trim(),
    created_at: new Date().toISOString(),
    // Optimistic only — the server stamps the real owner (profiles.user_id defaults
    // to auth.uid()) and the next fetch corrects this copy.
    user_id: state.userId ?? '',
  };
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

// ── Sharing ──────────────────────────────────────────────────
// These are deliberately NOT queued like everything else: sharing needs
// connectivity, and replaying a queued membership write after the fact would let a
// revoked member resurrect their own access. Each resolves either way and reports
// failure with a toast, so the UI never has to catch.

export async function inviteMember(profileId: string, email: string): Promise<void> {
  const normalized = normalizeEmail(email);
  if (!isValidEmail(normalized)) {
    showMessage("That doesn't look like an email address");
    return;
  }
  if (normalized === state.userEmail) {
    showMessage("You can't invite yourself");
    return;
  }
  // A repeat invite is a no-op that surfaces the existing one, never a second row.
  const existing = state.members.find((m) => m.profile_id === profileId && m.email === normalized);
  if (existing) {
    showMessage(existing.status === 'accepted' ? 'Already a member' : 'Already invited');
    return;
  }
  const { data, error } = await supabase
    .from('profile_members')
    .insert({ profile_id: profileId, email: normalized })
    .select()
    .single();
  // The message never says whether that address has a Stash account.
  if (error || !data) {
    showMessage("Couldn't send that invite");
    return;
  }
  setMembers([...state.members, data as ProfileMember]);
}

// Owner removing someone, or cancelling an invite they haven't accepted — the same
// row deletion either way.
export async function revokeMember(memberId: string): Promise<void> {
  const member = state.members.find((m) => m.id === memberId);
  const { error } = await supabase.from('profile_members').delete().eq('id', memberId);
  if (error) {
    showMessage("Couldn't remove them");
    return;
  }
  setMembers(state.members.filter((m) => m.id !== memberId));
  if (member && isMyMembership(member) && !ownsProfile(member.profile_id)) {
    purgeProfile(member.profile_id);
  }
  syncSharedChannels();
}

export async function acceptInvite(profileId: string): Promise<void> {
  const { error } = await supabase.rpc('accept_invite', { p_profile_id: profileId });
  if (error) {
    showMessage("Couldn't accept that invite");
    return;
  }
  // The profile and its contents only become readable once the membership is
  // accepted, so take the whole snapshot rather than patching state by hand.
  // fetchAll also brings the per-profile realtime channel up.
  await fetchAll();
}

export async function rejectInvite(memberId: string): Promise<void> {
  const { error } = await supabase.from('profile_members').delete().eq('id', memberId);
  if (error) {
    showMessage("Couldn't reject that invite");
    return;
  }
  // Nothing to purge: a pending invite never gave this device any data.
  setMembers(state.members.filter((m) => m.id !== memberId));
}

// A member removing themselves. The owner can't leave their own profile — that is
// a delete, and it is theirs alone to do.
export async function leaveProfile(profileId: string): Promise<void> {
  const userId = state.userId;
  if (!userId || ownsProfile(profileId)) return;
  const { error } = await supabase
    .from('profile_members')
    .delete()
    .eq('profile_id', profileId)
    .eq('user_id', userId);
  if (error) {
    showMessage("Couldn't leave that profile");
    return;
  }
  purgeProfile(profileId);
  syncSharedChannels();
}
