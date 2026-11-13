import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { NoteText } from './NoteText';

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  minRows?: number;
}

const BULLET_LINE = /^(\s*)([-*•])\s+(.*)$/;

/**
 * Plain textarea that grows with its content, keeps Return as a newline, and
 * offers B / I / U / bullet buttons so markdown is easy to type on a phone.
 * Return on a bullet line continues the list; Return on an empty bullet ends it.
 */
export function NoteEditor({ value, onChange, placeholder, className = '', minRows = 2 }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [preview, setPreview] = useState(false);
  // Selection to restore once React has committed a programmatic edit.
  const pendingSel = useRef<[number, number] | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
    if (pendingSel.current) {
      el.focus();
      el.setSelectionRange(...pendingSel.current);
      pendingSel.current = null;
    }
  }, [value, preview]);

  // Apply an edit then restore the selection after React re-renders.
  function apply(next: string, selStart: number, selEnd = selStart) {
    pendingSel.current = [selStart, selEnd];
    onChange(next);
  }

  function wrap(token: string) {
    const el = ref.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e } = el;
    const selected = value.slice(s, e);
    // Toggle off if the selection is already wrapped.
    if (value.slice(s - token.length, s) === token && value.slice(e, e + token.length) === token) {
      apply(value.slice(0, s - token.length) + selected + value.slice(e + token.length), s - token.length, e - token.length);
      return;
    }
    apply(value.slice(0, s) + token + selected + token + value.slice(e), s + token.length, e + token.length);
  }

  function toggleBullet() {
    const el = ref.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e } = el;
    const lineStart = value.lastIndexOf('\n', s - 1) + 1;
    const nextBreak = value.indexOf('\n', e);
    const lineEnd = nextBreak === -1 ? value.length : nextBreak;
    const lines = value.slice(lineStart, lineEnd).split('\n');
    const allBulleted = lines.every((l) => BULLET_LINE.test(l));
    const changed = lines.map((l) => (allBulleted ? l.replace(/^(\s*)[-*•]\s+/, '$1') : `- ${l}`)).join('\n');
    const next = value.slice(0, lineStart) + changed + value.slice(lineEnd);
    const delta = changed.length - (lineEnd - lineStart);
    apply(next, lineStart === s ? s : s + (allBulleted ? -2 : 2), e + delta);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
    const el = e.currentTarget;
    const s = el.selectionStart;
    if (s !== el.selectionEnd) return;
    const lineStart = value.lastIndexOf('\n', s - 1) + 1;
    const m = value.slice(lineStart, s).match(BULLET_LINE);
    if (!m) return; // plain newline — let the browser handle it
    e.preventDefault();
    if (!m[3].trim()) {
      // Empty bullet: drop the marker and leave the list.
      apply(value.slice(0, lineStart) + value.slice(s), lineStart);
      return;
    }
    const insert = `\n${m[1]}${m[2]} `;
    apply(value.slice(0, s) + insert + value.slice(s), s + insert.length);
  }

  const btn =
    'grid h-8 min-w-8 place-items-center rounded-lg px-2 text-sm text-muted transition active:bg-white/10 hover:text-white';

  return (
    <div className={className}>
      {preview ? (
        <button type="button" onClick={() => setPreview(false)} className="block w-full text-left">
          {value.trim() ? (
            <NoteText text={value} className="text-sm leading-relaxed text-[#9a948e]" />
          ) : (
            <span className="text-sm text-muted">{placeholder}</span>
          )}
        </button>
      ) : (
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          rows={minRows}
          enterKeyHint="enter"
          className="block w-full resize-none overflow-hidden bg-transparent text-sm leading-relaxed text-[#9a948e] outline-none placeholder:text-muted"
        />
      )}
      <div className="-ml-2 mt-1 flex items-center gap-0.5">
        {/* onMouseDown preventDefault keeps the textarea focused (and the keyboard up) */}
        <button type="button" aria-label="Bold" disabled={preview} onMouseDown={(e) => e.preventDefault()} onClick={() => wrap('**')} className={`${btn} font-bold`}>
          B
        </button>
        <button type="button" aria-label="Italic" disabled={preview} onMouseDown={(e) => e.preventDefault()} onClick={() => wrap('*')} className={`${btn} font-serif italic`}>
          I
        </button>
        <button type="button" aria-label="Underline" disabled={preview} onMouseDown={(e) => e.preventDefault()} onClick={() => wrap('__')} className={`${btn} underline underline-offset-2`}>
          U
        </button>
        <button type="button" aria-label="Bullet list" disabled={preview} onMouseDown={(e) => e.preventDefault()} onClick={toggleBullet} className={btn}>
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M9 6h11M9 12h11M9 18h11" strokeLinecap="round" />
            <circle cx="4" cy="6" r="1" fill="currentColor" />
            <circle cx="4" cy="12" r="1" fill="currentColor" />
            <circle cx="4" cy="18" r="1" fill="currentColor" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => setPreview((p) => !p)}
          className={`${btn} ml-auto text-xs ${preview ? 'text-accent' : ''}`}
        >
          {preview ? 'Edit' : 'Preview'}
        </button>
      </div>
    </div>
  );
}
