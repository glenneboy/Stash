import { useEffect, useRef, useState } from 'react';
import type { Context, Profile, Recurrence, Task } from '../types';
import { updateTask, deleteTask, setReminder, clearReminder, toggleComplete, moveTaskToProfile, createContext } from '../lib/store';
import { ensurePushSubscription } from '../lib/push';
import { toLocalInput, fromLocalInput } from '../lib/reminders';
import { DEFAULT_PROFILE_ID, DEFAULT_PROFILE_NAME, profileOf } from '../lib/profiles';

interface Props {
  task: Task;
  contexts: Context[];
  profiles: Profile[];
  onClose: () => void;
}

// "Mon 22 Jun" for a date-only value (`YYYY-MM-DD`), parsed from parts to avoid
// the UTC-midnight day slip.
function dueLabel(value: string): string {
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d) return '';
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

// "Mon 22 Jun, 12:13" for a datetime-local value (`YYYY-MM-DDTHH:MM`).
function remindLabel(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}, ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })}`;
}

const SECTION_LABEL = 'mb-2.5 ml-1 mt-5 block text-xs font-semibold uppercase tracking-[0.08em] text-muted';
const CARD = 'rounded-2xl border border-white/5 bg-elevated/60';

export function EditSheet({ task, contexts, profiles, onClose }: Props) {
  const [title, setTitle] = useState(task.title);
  const [note, setNote] = useState(task.note ?? '');
  const [tags, setTags] = useState<string[]>(task.contexts);
  const [due, setDue] = useState(task.due_on ?? '');
  const [reminder, setReminderInput] = useState(toLocalInput(task.reminder_at));
  const [notifyWarn, setNotifyWarn] = useState(false);
  // 'custom' shows the every-N picker; presets map straight to a rule.
  const [repeat, setRepeat] = useState<'none' | 'day' | 'week' | 'month' | 'custom'>(() => {
    if (!task.recur) return 'none';
    return task.recur.interval === 1 ? task.recur.unit : 'custom';
  });
  const [customN, setCustomN] = useState(task.recur?.interval ?? 2);
  const [customUnit, setCustomUnit] = useState<Recurrence['unit']>(task.recur?.unit ?? 'week');
  const [repeatOpen, setRepeatOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [addingContext, setAddingContext] = useState(false);
  const [newContextName, setNewContextName] = useState('');
  const dueInputRef = useRef<HTMLInputElement>(null);
  const reminderInputRef = useRef<HTMLInputElement>(null);

  // Desktop browsers only auto-open a date/datetime-local picker when the click
  // lands on the input's own calendar-icon hit-zone, not anywhere in its box like
  // mobile does. Since these inputs are stretched invisibly under a label, force
  // the picker open explicitly so clicking anywhere on the pill works everywhere.
  function openPicker(ref: React.RefObject<HTMLInputElement | null>) {
    ref.current?.showPicker?.();
  }

  const repeatActive = repeat !== 'none';
  const repeatLabels = { day: 'Daily', week: 'Weekly', month: 'Monthly' } as const;
  const repeatLabel =
    repeat === 'custom'
      ? `Every ${Math.max(1, Math.floor(customN) || 1)} ${customUnit}${(Math.floor(customN) || 1) > 1 ? 's' : ''}`
      : repeat === 'none'
        ? ''
        : repeatLabels[repeat];

  // Every profile the task could move to: the Default ("Personal") bucket plus each
  // named profile, minus the one it already lives in.
  const currentProfileId = profileOf(task);
  const currentProfileName =
    currentProfileId === DEFAULT_PROFILE_ID
      ? DEFAULT_PROFILE_NAME
      : profiles.find((p) => p.id === currentProfileId)?.name ?? DEFAULT_PROFILE_NAME;
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

  // The rule the current picker state represents (null = doesn't repeat).
  function recurRule(): Recurrence | null {
    if (repeat === 'none') return null;
    if (repeat === 'custom') return { unit: customUnit, interval: Math.max(1, Math.floor(customN) || 1) };
    return { unit: repeat, interval: 1 };
  }

  function toggleTag(id: string) {
    setTags((t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t, id]));
  }

  // Creates the context (or reuses a same-named one) and tags this task with it.
  function addContext() {
    const name = newContextName.trim();
    if (!name) {
      setAddingContext(false);
      return;
    }
    const existing = contexts.find((c) => c.name.toLowerCase() === name.toLowerCase());
    const ctx = existing ?? createContext(name);
    setTags((t) => (t.includes(ctx.id) ? t : [...t, ctx.id]));
    setNewContextName('');
    setAddingContext(false);
  }

  async function save() {
    if (!title.trim()) return;
    updateTask(task.id, { title: title.trim(), note: note.trim() || null, contexts: tags, due_on: due || null, recur: recurRule() });

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
      updateTask(task.id, { title: title.trim(), note: note.trim() || null, contexts: tags, due_on: due || null, recur: recurRule() });
    }
    moveTaskToProfile(task.id, targetId);
    onClose();
  }

  // Completing from the sheet keeps any unsaved edits, then closes.
  function complete() {
    if (title.trim()) {
      updateTask(task.id, { title: title.trim(), note: note.trim() || null, contexts: tags, due_on: due || null, recur: recurRule() });
    }
    toggleComplete(task.id);
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-20 flex flex-col justify-end bg-black/60 sm:items-center sm:justify-center"
      onClick={onClose}
    >
      <div
        className="safe-bottom max-h-full w-full overflow-y-auto rounded-t-3xl border-t border-line bg-surface p-4 pt-[18px] sm:max-w-[640px] sm:rounded-2xl sm:border sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-[18px] h-1 w-9 rounded-full bg-line sm:hidden" />

        {/* Content */}
        <div className={`${CARD} p-4`}>
          <div className="flex items-start gap-3">
            <button
              aria-label={task.completed ? 'Mark incomplete' : 'Mark complete'}
              onClick={complete}
              className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 transition ${
                task.completed ? 'border-accent bg-accent text-black' : 'border-white/30'
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
              className="min-w-0 flex-1 bg-transparent text-lg font-semibold leading-tight outline-none placeholder:text-muted sm:text-xl"
            />
          </div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Add a note…"
            rows={2}
            className="ml-9 mt-2 block w-[calc(100%-2.25rem)] resize-none bg-transparent text-sm leading-relaxed text-[#9a948e] outline-none placeholder:text-muted"
          />
        </div>

        <div className="sm:flex sm:items-start sm:gap-4">
          <div className="min-w-0 sm:flex-1">
            <span className={SECTION_LABEL}>Schedule</span>
            <div className={`${CARD} p-3.5`}>
              <div className="flex flex-wrap items-center gap-2">
                {/* Due pill — the native picker sits invisibly on top so a tap opens it */}
                <label
                  onClick={() => openPicker(dueInputRef)}
                  className={`relative inline-flex cursor-pointer items-center gap-1.5 rounded-full px-3.5 py-2 text-[13px] font-medium transition ${
                    due
                      ? 'border border-accent/40 bg-accent/[0.13] text-[#f0a888]'
                      : 'border border-dashed border-white/[0.18] text-muted'
                  }`}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="5" width="18" height="16" rx="2" />
                    <path d="M8 3v4M16 3v4M3 10h18" strokeLinecap="round" />
                  </svg>
                  {due ? dueLabel(due) : 'Due date'}
                  <input
                    ref={dueInputRef}
                    type="date"
                    aria-label="Due date"
                    value={due}
                    onChange={(e) => setDue(e.target.value)}
                    className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                  />
                  {due && (
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setDue('');
                      }}
                      aria-label="Clear due date"
                      className="relative z-10 -mr-1 grid h-5 w-5 place-items-center rounded-full text-[#f0a888]/70"
                    >
                      ✕
                    </button>
                  )}
                </label>

                {/* Remind pill */}
                <label
                  onClick={() => openPicker(reminderInputRef)}
                  className={`relative inline-flex cursor-pointer items-center gap-1.5 rounded-full px-3.5 py-2 text-[13px] font-medium transition ${
                    reminder
                      ? 'border border-white/10 bg-white/5 text-[#d3cec9]'
                      : 'border border-dashed border-white/[0.18] text-muted'
                  }`}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9M10.3 21a2 2 0 003.4 0" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  {reminder ? remindLabel(reminder) : 'Add reminder'}
                  <input
                    ref={reminderInputRef}
                    type="datetime-local"
                    aria-label="Remind me"
                    value={reminder}
                    onChange={(e) => setReminderInput(e.target.value)}
                    className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                  />
                  {reminder && (
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setReminderInput('');
                      }}
                      aria-label="Clear reminder"
                      className="relative z-10 -mr-1 grid h-5 w-5 place-items-center rounded-full text-[#d3cec9]/70"
                    >
                      ✕
                    </button>
                  )}
                </label>

                <span className="min-w-2 flex-1" />

                {repeatActive && <span className="text-[13px] font-semibold text-accent">{repeatLabel}</span>}
                <button
                  aria-label="Repeat"
                  aria-expanded={repeatOpen}
                  onClick={() => setRepeatOpen((o) => !o)}
                  className={`grid h-10 w-10 shrink-0 place-items-center rounded-full border transition ${
                    repeatActive
                      ? 'border-accent bg-accent/[0.16] text-accent'
                      : 'border-white/10 bg-white/[0.04] text-muted'
                  }`}
                >
                  <svg viewBox="0 0 24 24" className="h-[19px] w-[19px]" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M17 2l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M3 11v-1a4 4 0 014-4h14M7 22l-4-4 4-4" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M21 13v1a4 4 0 01-4 4H3" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>

              {repeatOpen && (
                <div className="mt-3.5 border-t border-white/[0.06] pt-3.5">
                  <div className="mb-2.5 text-[13px] text-muted">Repeats</div>
                  <div className="flex gap-1 rounded-xl bg-white/[0.04] p-1">
                    {(
                      [
                        ['none', 'Off'],
                        ['day', 'Daily'],
                        ['week', 'Weekly'],
                        ['month', 'Monthly'],
                        ['custom', 'Custom'],
                      ] as const
                    ).map(([value, label]) => (
                      <button
                        key={value}
                        onClick={() => setRepeat(value)}
                        className={`flex-1 rounded-[9px] py-2 text-center text-sm transition ${
                          repeat === value ? 'bg-accent font-semibold text-black' : 'font-medium text-[#b3ada7]'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {repeat === 'custom' && (
                    <div className="mt-2.5 flex items-center gap-2">
                      <span className="text-sm text-muted">every</span>
                      <input
                        type="number"
                        min={1}
                        inputMode="numeric"
                        value={customN}
                        onChange={(e) => setCustomN(Number(e.target.value))}
                        aria-label="Repeat every N"
                        className="w-16 rounded-xl border border-line bg-bg px-3 py-2 text-base outline-none focus:border-accent"
                      />
                      <select
                        value={customUnit}
                        onChange={(e) => setCustomUnit(e.target.value as Recurrence['unit'])}
                        aria-label="Repeat unit"
                        className="rounded-xl border border-line bg-bg px-3 py-2 text-base outline-none focus:border-accent"
                      >
                        <option value="day">days</option>
                        <option value="week">weeks</option>
                        <option value="month">months</option>
                      </select>
                    </div>
                  )}
                  {repeatActive && (
                    <p className="mt-2.5 text-xs text-muted">
                      Completing this task will add the next occurrence automatically.
                    </p>
                  )}
                </div>
              )}
            </div>
            {notifyWarn && (
              <p className="mt-1.5 text-xs text-amber-400">
                Notifications aren't set up — reminder saved, but it won't alert until notifications are allowed on this device.
              </p>
            )}
          </div>

          <div className="min-w-0 sm:flex-1">
            <span className={SECTION_LABEL}>Organise</span>
            <div className={`${CARD} px-4 py-3.5`}>
              <div className="mb-3.5 flex flex-wrap items-center gap-2">
                {contexts.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => toggleTag(c.id)}
                    className={`rounded-full border px-3 py-1.5 text-[13px] transition ${
                      tags.includes(c.id)
                        ? 'border-accent bg-accent/[0.14] font-medium text-accent'
                        : 'border-white/[0.12] text-[#b3ada7]'
                    }`}
                  >
                    {c.name}
                  </button>
                ))}
                {addingContext ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      addContext();
                    }}
                    className="inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent/[0.08] py-1 pl-3 pr-1"
                  >
                    <input
                      autoFocus
                      value={newContextName}
                      onChange={(e) => setNewContextName(e.target.value)}
                      onBlur={() => {
                        if (!newContextName.trim()) setAddingContext(false);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                          setAddingContext(false);
                          setNewContextName('');
                        }
                      }}
                      placeholder="New context"
                      className="w-24 bg-transparent text-[13px] outline-none placeholder:text-muted"
                    />
                    <button
                      type="submit"
                      disabled={!newContextName.trim()}
                      aria-label="Add context"
                      className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-accent disabled:opacity-30"
                    >
                      ✓
                    </button>
                  </form>
                ) : (
                  <button
                    type="button"
                    onClick={() => setAddingContext(true)}
                    className="rounded-full border border-dashed border-white/[0.18] px-3 py-1.5 text-[13px] text-muted"
                  >
                    + New
                  </button>
                )}
              </div>
              {moveTargets.length > 0 && (
                <div className="border-t border-white/5 pt-3">
                  <button
                    type="button"
                    onClick={() => setMoveOpen((o) => !o)}
                    aria-expanded={moveOpen}
                    className="flex w-full items-center justify-between text-sm"
                  >
                    <span className="text-[#b3ada7]">Move to profile</span>
                    <span className="flex items-center gap-1 font-medium text-[#9a948e]">
                      {currentProfileName}
                      <svg
                        viewBox="0 0 24 24"
                        className={`h-4 w-4 transition ${moveOpen ? 'rotate-90' : ''}`}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                  </button>
                  {moveOpen && (
                    <div className="mt-2 overflow-hidden rounded-xl border border-white/[0.06]">
                      {moveTargets.map((p) => (
                        <button
                          key={p.id ?? 'default'}
                          type="button"
                          onClick={() => move(p.id)}
                          className="block w-full px-4 py-2.5 text-left text-sm text-[#b3ada7] hover:text-accent active:bg-elevated"
                        >
                          {p.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer — mobile: icon delete + full-width save; desktop: Delete · Cancel · Save */}
        <div className="mt-5 flex items-center gap-3 sm:border-t sm:border-white/[0.06] sm:pt-[18px]">
          <button
            onClick={remove}
            aria-label="Delete task"
            className="grid h-[50px] w-[52px] shrink-0 place-items-center rounded-[14px] border border-[#e8674f]/30 text-[#e8674f] sm:h-auto sm:w-auto sm:border-0 sm:px-1 sm:py-2.5 sm:text-sm sm:font-semibold"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5 sm:hidden" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6M10 11v6M14 11v6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="hidden sm:inline">Delete</span>
          </button>
          <span className="hidden flex-1 sm:block" />
          <button
            onClick={onClose}
            className="hidden rounded-[11px] border border-white/[0.14] px-[22px] py-[11px] text-sm font-semibold text-[#b3ada7] sm:block"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={!title.trim()}
            className="h-[50px] flex-1 rounded-[14px] bg-accent font-bold text-black active:scale-[0.99] disabled:opacity-40 sm:h-auto sm:flex-none sm:rounded-[11px] sm:px-[30px] sm:py-[11px] sm:text-sm"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
