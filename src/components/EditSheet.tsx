import { useEffect, useState } from 'react';
import type { Context, Profile, Task } from '../types';
import { updateTask, deleteTask, setReminder, clearReminder, toggleComplete, moveTaskToProfile } from '../lib/store';
import { ensurePushSubscription } from '../lib/push';
import { toLocalInput, fromLocalInput, reminderWeekday, dueWeekday } from '../lib/reminders';
import { DEFAULT_PROFILE_ID, DEFAULT_PROFILE_NAME, profileOf } from '../lib/profiles';

interface Props {
  task: Task;
  contexts: Context[];
  profiles: Profile[];
  onClose: () => void;
}

export function EditSheet({ task, contexts, profiles, onClose }: Props) {
  const [title, setTitle] = useState(task.title);
  const [note, setNote] = useState(task.note ?? '');
  const [tags, setTags] = useState<string[]>(task.contexts);
  const [due, setDue] = useState(task.due_on ?? '');
  const [reminder, setReminderInput] = useState(toLocalInput(task.reminder_at));
  const [notifyWarn, setNotifyWarn] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);

  // Every profile the task could move to: the Default ("Personal") bucket plus each
  // named profile, minus the one it already lives in.
  const currentProfileId = profileOf(task);
  const moveTargets: { id: string | null; name: string }[] = [
    { id: DEFAULT_PROFILE_ID, name: DEFAULT_PROFILE_NAME },
    ...profiles.map((p) => ({ id: p.id, name: p.name })),
  ].filter((p) => p.id !== currentProfileId);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  function toggleTag(id: string) {
    setTags((t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t, id]));
  }

  async function save() {
    if (!title.trim()) return;
    updateTask(task.id, { title: title.trim(), note: note.trim() || null, contexts: tags, due_on: due || null });

    const nextIso = reminder ? fromLocalInput(reminder) : null;
    const reminderChanged =
      nextIso === null || task.reminder_at === null
        ? nextIso !== task.reminder_at
        : new Date(nextIso).getTime() !== new Date(task.reminder_at).getTime();

    if (reminderChanged) {
      if (nextIso) {
        setReminder(task.id, nextIso);
        const result = await ensurePushSubscription();
        if (result !== 'granted' && !notifyWarn) {
          setNotifyWarn(true);
          return; // keep sheet open so the warning is seen; a second Save closes it
        }
      } else {
        clearReminder(task.id);
      }
    }
    onClose();
  }

  function remove() {
    deleteTask(task.id);
    onClose();
  }

  // Save any in-progress edits first so they travel with the task, then move it.
  // The move surfaces its own "Moved to … · Undo" toast, so we just close here.
  function move(targetId: string | null) {
    if (title.trim()) {
      updateTask(task.id, { title: title.trim(), note: note.trim() || null, contexts: tags, due_on: due || null });
    }
    moveTaskToProfile(task.id, targetId);
    onClose();
  }

  // Completing from the sheet keeps any unsaved edits, then closes.
  function complete() {
    if (title.trim()) {
      updateTask(task.id, { title: title.trim(), note: note.trim() || null, contexts: tags, due_on: due || null });
    }
    toggleComplete(task.id);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-20 flex flex-col justify-end bg-black/60" onClick={onClose}>
      <div
        className="safe-bottom rounded-t-3xl border-t border-line bg-surface p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-line" />

        <div className="flex items-center gap-3">
          <button
            aria-label={task.completed ? 'Mark incomplete' : 'Mark complete'}
            onClick={complete}
            className={`grid h-7 w-7 shrink-0 place-items-center rounded-full border-2 transition ${
              task.completed ? 'border-accent bg-accent text-black' : 'border-muted'
            }`}
          >
            {task.completed && (
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="3">
                <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title"
            className="min-w-0 flex-1 rounded-xl border border-line bg-bg px-4 py-3 text-base outline-none focus:border-accent"
          />
        </div>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note (optional)"
          rows={3}
          className="mt-3 w-full resize-none rounded-xl border border-line bg-bg px-4 py-3 text-base outline-none placeholder:text-muted focus:border-accent"
        />

        {contexts.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {contexts.map((c) => (
              <button
                key={c.id}
                onClick={() => toggleTag(c.id)}
                className={`rounded-full border px-3 py-1 text-sm transition ${
                  tags.includes(c.id) ? 'border-accent bg-accent/15 text-accent' : 'border-line text-muted'
                }`}
              >
                {c.name}
              </button>
            ))}
          </div>
        )}

        <div className="mt-3">
          <label htmlFor="due-input" className="mb-1 block text-xs text-muted">Due date</label>
          <div className="flex items-center gap-2">
            <span className="w-9 shrink-0 text-sm text-muted">{dueWeekday(due)}</span>
            <input
              id="due-input"
              type="date"
              value={due}
              onChange={(e) => setDue(e.target.value)}
              className="w-44 rounded-xl border border-line bg-bg px-4 py-3 text-base outline-none focus:border-accent"
            />
            {due && (
              <button
                onClick={() => setDue('')}
                aria-label="Clear due date"
                className="rounded-xl border border-line px-3 py-3 text-sm text-muted"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        <div className="mt-3">
          <label htmlFor="reminder-input" className="mb-1 block text-xs text-muted">Remind me</label>
          <div className="flex items-center gap-2">
            <span className="w-9 shrink-0 text-sm text-muted">{reminderWeekday(reminder)}</span>
            <input
              id="reminder-input"
              type="datetime-local"
              value={reminder}
              onChange={(e) => setReminderInput(e.target.value)}
              className="w-52 rounded-xl border border-line bg-bg px-4 py-3 text-base outline-none focus:border-accent"
            />
            {reminder && (
              <button
                onClick={() => setReminderInput('')}
                aria-label="Clear reminder"
                className="rounded-xl border border-line px-3 py-3 text-sm text-muted"
              >
                Clear
              </button>
            )}
          </div>
          {notifyWarn && (
            <p className="mt-1.5 text-xs text-amber-400">
              Notifications aren't set up — reminder saved, but it won't alert until notifications are allowed on this device.
            </p>
          )}
        </div>

        {moveTargets.length > 0 && (
          <div className="mt-3">
            <span className="mb-1 block text-xs text-muted">Move to another profile</span>
            <button
              type="button"
              onClick={() => setMoveOpen((o) => !o)}
              aria-expanded={moveOpen}
              className="flex w-full items-center justify-between rounded-xl border border-line bg-bg px-4 py-3 text-base outline-none focus:border-accent"
            >
              <span className="flex items-center gap-2">
                <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4 shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Move this to…
              </span>
              <svg viewBox="0 0 24 24" className={`h-4 w-4 text-muted transition ${moveOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            {moveOpen && (
              <div className="mt-1 overflow-hidden rounded-xl border border-line">
                {moveTargets.map((p) => (
                  <button
                    key={p.id ?? 'default'}
                    type="button"
                    onClick={() => move(p.id)}
                    className="block w-full px-4 py-3 text-left text-base text-muted hover:text-accent active:bg-elevated"
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="mt-5 flex items-center gap-3">
          <button onClick={remove} className="rounded-xl border border-line px-4 py-3 text-sm text-red-400">
            Delete
          </button>
          <button
            onClick={save}
            disabled={!title.trim()}
            className="flex-1 rounded-xl bg-accent px-4 py-3 font-medium text-black active:scale-[0.99] disabled:opacity-40"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
