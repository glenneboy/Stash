import { useEffect, useState } from 'react';
import type { Context } from '../types';
import { createTask, createTasks } from '../lib/store';
import { parseCapture, recognisedTags, splitPastedLines, whenLabel, type CaptureSkip } from '../lib/capture';
import { recurLabel } from '../lib/recur';
import { ensurePushSubscription } from '../lib/push';
import { NoteEditor } from './NoteEditor';

interface Props {
  contexts: Context[];
  /** Contexts in the active filter view; new tasks are pre-tagged with all of them. */
  activeContextIds: string[];
  /** Text shared into the app via the PWA share target, used to prefill the input. */
  initialTitle?: string;
  /** Full shared detail, prefilled into the note (revealed when present). */
  initialNote?: string;
}

export function CaptureBar({ contexts, activeContextIds, initialTitle = '', initialNote = '' }: Props) {
  const [title, setTitle] = useState(initialTitle);
  const [note, setNote] = useState(initialNote);
  const [tags, setTags] = useState<string[]>(activeContextIds);
  const [showTags, setShowTags] = useState(false);

  // Keep the pre-tagged contexts in step with the active filter view.
  const seedKey = activeContextIds.join(',');
  useEffect(() => setTags(activeContextIds), [seedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggleTag(id: string) {
    setTags((t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t, id]));
  }

  // Pieces of the parse the user tapped away; their text stays in the title.
  const [skip, setSkip] = useState<CaptureSkip>({});

  const now = new Date();
  // `full` drives the chip labels (what was recognised); `parsed` is what will be saved.
  const full = parseCapture(title, contexts, now);
  const parsed = parseCapture(title, contexts, now, skip);
  const inlineTags = recognisedTags(title, contexts);

  function toggleSkip(key: 'when' | 'recur') {
    setSkip((s) => ({ ...s, [key]: !s[key] }));
  }
  function toggleSkipTag(id: string) {
    setSkip((s) => {
      const tags = s.tags ?? [];
      return { ...s, tags: tags.includes(id) ? tags.filter((t) => t !== id) : [...tags, id] };
    });
  }

  function reset() {
    setTitle('');
    setNote('');
    setTags(activeContextIds);
    setShowTags(false);
    setSkip({});
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !parsed.title.trim()) return;
    const merged = [...new Set([...tags, ...parsed.tagIds])];
    createTask(parsed.title, merged, note, parsed.dueOn, { reminderAt: parsed.reminderAt, recur: parsed.recur });
    // Ask for notification permission while we still have the tap's user gesture.
    if (parsed.reminderAt) void ensurePushSubscription();
    reset();
  }

  // Pasting several lines adds one task per line (each parsed the same way).
  function onPaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const lines = splitPastedLines(e.clipboardData.getData('text'));
    if (lines.length < 2) return;
    e.preventDefault();
    const items = lines.map((line) => {
      const c = parseCapture(line, contexts);
      return {
        title: c.title,
        contexts: [...new Set([...tags, ...c.tagIds])],
        dueOn: c.dueOn,
        reminderAt: c.reminderAt,
        recur: c.recur,
      };
    });
    createTasks(items);
    if (items.some((i) => i.reminderAt)) void ensurePushSubscription();
    reset();
  }

  const showChips = title.trim() !== '' && (full.found.when || full.found.recur || inlineTags.length > 0);

  return (
    <form onSubmit={submit} className="border-b border-line bg-bg/95 px-4 pb-3 pt-2 backdrop-blur">
      <div className="flex items-center gap-2">
        <input
          autoFocus
          enterKeyHint="done"
          placeholder="What needs doing?"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            if (!e.target.value) setSkip({});
          }}
          onPaste={onPaste}
          className="min-w-0 flex-1 rounded-xl border border-line bg-surface px-4 py-3 text-base outline-none placeholder:text-muted focus:border-accent"
        />
        {contexts.length > 0 && (
          <button
            type="button"
            onClick={() => setShowTags((s) => !s)}
            aria-label="Add context tags"
            className={`shrink-0 rounded-xl border px-3 py-3 text-sm transition ${
              tags.length > 0 || showTags
                ? 'border-accent text-accent'
                : 'border-line text-muted'
            }`}
          >
            {tags.length > 0 ? `#${tags.length}` : '#'}
          </button>
        )}
        <button
          type="submit"
          disabled={!title.trim()}
          className="shrink-0 rounded-xl bg-accent px-4 py-3 font-medium text-black transition active:scale-95 disabled:opacity-40"
        >
          Add
        </button>
      </div>

      {showChips && (
        <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Understood from your text">
          {full.found.when && full.dueOn && (
            <Chip off={Boolean(skip.when)} onClick={() => toggleSkip('when')} icon={full.reminderAt ? 'clock' : 'calendar'}>
              {whenLabel(full.dueOn, full.reminderAt, now)}
            </Chip>
          )}
          {full.found.recur && full.recur && (
            <Chip off={Boolean(skip.recur)} onClick={() => toggleSkip('recur')} icon="repeat">
              {recurLabel(full.recur)}
            </Chip>
          )}
          {inlineTags.map((id) => (
            <Chip key={id} off={(skip.tags ?? []).includes(id)} onClick={() => toggleSkipTag(id)} icon="tag">
              {contexts.find((c) => c.id === id)?.name}
            </Chip>
          ))}
        </div>
      )}

      {note && (
        <NoteEditor
          value={note}
          onChange={setNote}
          placeholder="Note"
          minRows={4}
          className="mt-2 rounded-xl border border-line bg-surface px-4 pb-1 pt-3 focus-within:border-accent"
        />
      )}

      {showTags && contexts.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {contexts.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => toggleTag(c.id)}
              className={`rounded-full border px-3 py-1 text-xs transition ${
                tags.includes(c.id)
                  ? 'border-accent bg-accent/15 text-accent'
                  : 'border-line text-muted'
              }`}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}
    </form>
  );
}

const ICONS = {
  calendar: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z',
  clock: 'M12 7v5l3 2M12 22a10 10 0 100-20 10 10 0 000 20z',
  repeat: 'M17 2l4 4-4 4M3 11v-1a4 4 0 014-4h14M7 22l-4-4 4-4M21 13v1a4 4 0 01-4 4H3',
  tag: 'M20.6 13.4l-7.2 7.2a2 2 0 01-2.8 0L2 12V2h10l8.6 8.6a2 2 0 010 2.8zM7 7h.01',
};

// A recognised piece of the text. Tap to ignore it (it stays in the title); tap again to use it.
function Chip({
  off,
  onClick,
  icon,
  children,
}: {
  off: boolean;
  onClick: () => void;
  icon: keyof typeof ICONS;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={!off}
      title={off ? 'Ignored — tap to use' : 'Tap to ignore'}
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition animate-fade ${
        off ? 'border-dashed border-line text-muted line-through' : 'border-accent/40 bg-accent/10 text-accent'
      }`}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2">
        <path d={ICONS[icon]} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {children}
    </button>
  );
}
