import { useEffect, useRef } from 'react';

interface Props {
  /** Saves and closes. Omit when the form can't be saved as-is (e.g. empty title). */
  onSave?: () => void;
  onDiscard: () => void;
  onKeepEditing: () => void;
  saveLabel?: string;
}

/**
 * Small action sheet that rises over the bottom of a dirty sheet when the user tries
 * to leave it: Save · Discard · Keep editing. Tapping the scrim keeps editing.
 */
export function DiscardPrompt({ onSave, onDiscard, onKeepEditing, saveLabel = 'Save changes' }: Props) {
  const primaryRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    primaryRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <div
      className="fixed inset-0 z-40 flex flex-col justify-end bg-black/40 animate-fade sm:items-center sm:justify-center"
      onClick={(e) => {
        e.stopPropagation();
        onKeepEditing();
      }}
      role="presentation"
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="discard-title"
        aria-describedby="discard-desc"
        onClick={(e) => e.stopPropagation()}
        className="safe-bottom w-full animate-rise rounded-t-3xl border-t border-line bg-elevated px-4 pb-4 pt-5 shadow-2xl sm:max-w-[360px] sm:rounded-2xl sm:border"
      >
        <div className="mb-4 px-1 text-center">
          <h2 id="discard-title" className="text-[15px] font-semibold">
            Unsaved changes
          </h2>
          <p id="discard-desc" className="mt-1 text-[13px] text-muted">
            Save your edits before closing?
          </p>
        </div>
        <div className="space-y-2">
          {onSave && (
            <button
              ref={primaryRef}
              onClick={onSave}
              className="h-12 w-full rounded-[14px] bg-accent outline-none text-[15px] font-bold text-black active:scale-[0.99]"
            >
              {saveLabel}
            </button>
          )}
          <button
            ref={onSave ? undefined : primaryRef}
            onClick={onDiscard}
            className="h-12 w-full rounded-[14px] border border-[#e8674f]/30 text-[15px] font-semibold text-[#e8674f]"
          >
            Discard
          </button>
          <button onClick={onKeepEditing} className="h-11 w-full text-[14px] font-medium text-muted">
            Keep editing
          </button>
        </div>
      </div>
    </div>
  );
}
