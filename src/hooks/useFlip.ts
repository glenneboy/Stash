import { useLayoutEffect, useRef, type RefObject } from 'react';
import { prefersReducedMotion } from '../lib/feedback';

type Positions = Map<string, number>;

function measure(list: HTMLElement | null): Positions {
  const out: Positions = new Map();
  list?.querySelectorAll<HTMLElement>(':scope > [data-task-id]').forEach((el) => {
    out.set(el.dataset.taskId!, el.offsetTop);
  });
  return out;
}

/**
 * FLIP layout animation for a list of `[data-task-id]` rows. Whenever `key`
 * (the rows' order) changes, rows that moved slide from their old spot and
 * new rows fade in, instead of jumping.
 *
 * The "before" positions are read during render, while the DOM still shows
 * the old layout — so they're always current, even if rows changed height
 * since the last reorder. offsetTop ignores transforms, so an in-flight
 * animation never skews the measurement.
 */
export function useFlip(listRef: RefObject<HTMLElement>, key: string): void {
  const lastKey = useRef(key);
  const before = useRef<Positions | null>(null);
  if (key !== lastKey.current) {
    lastKey.current = key;
    before.current = measure(listRef.current);
  }

  useLayoutEffect(() => {
    const prev = before.current;
    before.current = null;
    const list = listRef.current;
    if (!prev || !list || prev.size === 0 || prefersReducedMotion()) return;
    list.querySelectorAll<HTMLElement>(':scope > [data-task-id]').forEach((el) => {
      if (typeof el.animate !== 'function') return;
      const old = prev.get(el.dataset.taskId!);
      if (old === undefined) {
        el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'ease-out' });
      } else if (old !== el.offsetTop) {
        el.animate([{ transform: `translateY(${old - el.offsetTop}px)` }, { transform: 'none' }], {
          duration: 240,
          easing: 'cubic-bezier(.2,.8,.2,1)',
        });
      }
    });
  }, [key, listRef]);
}
