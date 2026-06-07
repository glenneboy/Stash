import { useEffect, useState } from 'react';
import type { Context, Task } from '../types';
import { updateTask, deleteTask, setReminder, clearReminder } from '../lib/store';
import { ensurePushSubscription } from '../lib/push';
import { toLocalInput, fromLocalInput } from '../lib/reminders';

interface Props {
  task: Task;
  contexts: Context[];
  onClose: () => void;
}

export function EditSheet({ task, contexts, onClose }: Props) {
  const [title, setTitle] = useState(task.title);
  const [note, setNote] = useState(task.note ?? '');
  const [tags, setTags] = useState<string[]>(task.contexts);
  const [reminder, setReminderInput] = useState(toLocalInput(task.reminder_at));
  const [notifyWarn, setNotifyWarn] = useState(false);

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
    updateTask(task.id, { title: title.trim(), note: note.trim() || null, contexts: tags });

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

  return (
    <div className="fixed inset-0 z-20 flex flex-col justify-end bg-black/60" onClick={onClose}>
      <div
        className="safe-bottom rounded-t-3xl border-t border-line bg-surface p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-line" />

        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title"
          className="w-full rounded-xl border border-line bg-bg px-4 py-3 text-base outline-none focus:border-accent"
        />
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
          <label htmlFor="reminder-input" className="mb-1 block text-xs text-muted">Remind me</label>
          <div className="flex items-center gap-2">
            <input
              id="reminder-input"
              type="datetime-local"
              value={reminder}
              onChange={(e) => setReminderInput(e.target.value)}
              className="flex-1 rounded-xl border border-line bg-bg px-4 py-3 text-base outline-none focus:border-accent"
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
