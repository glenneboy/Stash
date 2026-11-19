import { useLayoutEffect, useRef, useState } from 'react';
import { NoteText } from './NoteText';

// A note is only cut short when it is genuinely long: anything up to
// COLLAPSE_AFTER lines shows in full; beyond that it is clamped to
// CLAMPED_LINES with a fade, and tapping the note expands/collapses it.
const CLAMPED_LINES = 4;
const COLLAPSE_AFTER = 6;

/** The note shown under a task title in the list. */
export function TaskNote({ text, completed }: { text: string; completed: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [long, setLong] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [lineHeight, setLineHeight] = useState(0);

  // Measure the full height to decide whether the note is long enough to
  // clamp. Re-measures on resize (rotation, desktop window width).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const lh = parseFloat(getComputedStyle(el.firstElementChild ?? el).lineHeight) || 22;
      setLineHeight(lh);
      setLong(el.scrollHeight > lh * COLLAPSE_AFTER + 1);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text]);

  const clamped = long && !expanded;

  return (
    <div
      className="mt-0.5"
      onClick={
        long
          ? (e) => {
              // Inside the row's edit button: tapping a long note toggles it
              // instead of opening the editor.
              e.stopPropagation();
              setExpanded((v) => !v);
            }
          : undefined
      }
    >
      <div
        ref={ref}
        className="overflow-hidden"
        style={
          clamped
            ? {
                maxHeight: lineHeight * CLAMPED_LINES,
                maskImage: 'linear-gradient(to bottom, #000 55%, transparent)',
                WebkitMaskImage: 'linear-gradient(to bottom, #000 55%, transparent)',
              }
            : undefined
        }
      >
        <NoteText
          text={text}
          className={`text-sm leading-relaxed ${completed ? 'text-muted' : 'text-[#ABABAB]'}`}
        />
      </div>
      {long && (
        <span className="mt-0.5 inline-block text-xs font-medium text-accent">
          {expanded ? 'Show less' : 'Show more'}
        </span>
      )}
    </div>
  );
}
