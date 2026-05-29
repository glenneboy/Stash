import { useState } from 'react';
import type { Context, Task } from '../types';
import { updateTask, deleteTask } from '../lib/store';

interface Props {
  task: Task;
  contexts: Context[];
  onClose: () => void;
}

export function EditSheet({ task, contexts, onClose }: Props) {
  const [title, setTitle] = useState(task.title);
  const [note, setNote] = useState(task.note ?? '');
  const [tags, setTags] = useState<string[]>(task.contexts);

  function toggleTag(id: string) {
    setTags((t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t, id]));
  }

  function save() {
    if (!title.trim()) return;
    updateTask(task.id, { title: title.trim(), note: note.trim() || null, contexts: tags });
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
