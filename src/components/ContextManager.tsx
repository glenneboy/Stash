import { useState } from 'react';
import type { Context } from '../types';
import { createContext, renameContext, deleteContext } from '../lib/store';

interface Props {
  contexts: Context[];
  onClose: () => void;
}

export function ContextManager({ contexts, onClose }: Props) {
  const [adding, setAdding] = useState('');

  function add(e: React.FormEvent) {
    e.preventDefault();
    if (!adding.trim()) return;
    createContext(adding);
    setAdding('');
  }

  return (
    <div className="fixed inset-0 z-20 flex flex-col justify-end bg-black/60" onClick={onClose}>
      <div
        className="safe-bottom max-h-[80vh] overflow-y-auto rounded-t-3xl border-t border-line bg-surface p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-line" />
        <h2 className="mb-3 text-lg font-semibold">Tags</h2>

        <ul className="space-y-2">
          {contexts.map((c) => (
            <ContextRow key={c.id} context={c} />
          ))}
        </ul>

        <form onSubmit={add} className="mt-4 flex gap-2">
          <input
            value={adding}
            onChange={(e) => setAdding(e.target.value)}
            placeholder="New tag"
            className="min-w-0 flex-1 rounded-xl border border-line bg-bg px-4 py-3 text-base outline-none placeholder:text-muted focus:border-accent"
          />
          <button
            type="submit"
            disabled={!adding.trim()}
            className="rounded-xl bg-accent px-4 py-3 font-medium text-black disabled:opacity-40"
          >
            Add
          </button>
        </form>

        <button onClick={onClose} className="mt-5 w-full rounded-xl border border-line px-4 py-3 text-sm text-muted">
          Done
        </button>
      </div>
    </div>
  );
}

function ContextRow({ context }: { context: Context }) {
  const [name, setName] = useState(context.name);

  function commit() {
    const next = name.trim();
    if (next && next !== context.name) renameContext(context.id, next);
    else setName(context.name);
  }

  return (
    <li className="flex items-center gap-2">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={commit}
        className="min-w-0 flex-1 rounded-xl border border-line bg-bg px-4 py-2.5 text-base outline-none focus:border-accent"
      />
      <button
        onClick={() => deleteContext(context.id)}
        aria-label={`Delete ${context.name}`}
        className="shrink-0 rounded-xl border border-line px-3 py-2.5 text-sm text-red-400"
      >
        Remove
      </button>
    </li>
  );
}
