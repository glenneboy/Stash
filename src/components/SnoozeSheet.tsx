import { useEffect } from 'react';
import { laterTodayAvailable, snoozeDay, type SnoozeTarget } from '../lib/snooze';
import { toDayString } from '../lib/recur';

interface Props {
  /** How many tasks are being snoozed (for the heading). */
  count: number;
  onPick: (target: SnoozeTarget) => void;
  /** Offered at the bottom, since swipe-left used to delete. */
  onDelete?: () => void;
  onClose: () => void;
}

/** Action sheet: push one or more tasks to later today / tomorrow / weekend / next week / a date. */
export function SnoozeSheet({ count, onPick, onDelete, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const now = new Date();
  const later = new Date(now.getTime() + 3 * 3_600_000);
  const options: { target: SnoozeTarget; label: string; sub: string }[] = [
    ...(laterTodayAvailable(now)
      ? [{
          target: { kind: 'later' } as SnoozeTarget,
          label: 'Later today',
          sub: later.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }),
        }]
      : []),
    { target: { kind: 'tomorrow' }, label: 'Tomorrow', sub: shortDay(snoozeDay({ kind: 'tomorrow' }, now)) },
    { target: { kind: 'weekend' }, label: now.getDay() === 6 || now.getDay() === 0 ? 'Next weekend' : 'This weekend', sub: shortDay(snoozeDay({ kind: 'weekend' }, now)) },
    { target: { kind: 'nextweek' }, label: 'Next week', sub: shortDay(snoozeDay({ kind: 'nextweek' }, now)) },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40 animate-fade sm:items-center sm:justify-center"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="snooze-title"
        onClick={(e) => e.stopPropagation()}
        className="safe-bottom w-full animate-rise rounded-t-3xl border-t border-line bg-elevated px-4 pb-4 pt-5 shadow-2xl sm:max-w-[360px] sm:rounded-2xl sm:border"
      >
        <h2 id="snooze-title" className="mb-3 px-1 text-center text-[15px] font-semibold">
          {count === 1 ? 'Snooze until…' : `Snooze ${count} tasks until…`}
        </h2>
        <ul className="overflow-hidden rounded-[14px] border border-line">
          {options.map((o) => (
            <li key={o.label} className="border-b border-line last:border-b-0">
              <button
                onClick={() => onPick(o.target)}
                className="flex h-12 w-full items-center justify-between px-4 text-[15px] active:bg-surface"
              >
                <span>{o.label}</span>
                <span className="text-[13px] text-muted">{o.sub}</span>
              </button>
            </li>
          ))}
          <li>
            <label className="flex h-12 w-full items-center justify-between gap-3 px-4 text-[15px]">
              <span>Pick a date</span>
              <input
                type="date"
                min={toDayString(now)}
                onChange={(e) => e.target.value && onPick({ kind: 'date', dueOn: e.target.value })}
                className="min-w-0 bg-transparent text-right text-[13px] text-muted outline-none [color-scheme:dark]"
              />
            </label>
          </li>
        </ul>
        <div className="mt-3 space-y-2">
          {onDelete && (
            <button
              onClick={onDelete}
              className="h-12 w-full rounded-[14px] border border-[#e8674f]/30 text-[15px] font-semibold text-[#e8674f]"
            >
              Delete
            </button>
          )}
          <button onClick={onClose} className="h-11 w-full text-[14px] font-medium text-muted">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

/** "Thu 26 Nov" — the sheet's row labels already say today/tomorrow. */
function shortDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}
