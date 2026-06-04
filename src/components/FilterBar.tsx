import type { Context, Filter } from '../types';
import { ALL_FILTER } from '../types';

interface Props {
  contexts: Context[];
  active: Filter;
  onChange: (f: Filter) => void;
  onManage: () => void;
}

export function FilterBar({ contexts, active, onChange, onManage }: Props) {
  return (
    <div className="flex items-center border-b border-line px-4 py-2">
      <div className="relative min-w-0 flex-1">
        <div className="flex items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <Chip label="All" active={active === ALL_FILTER} onClick={() => onChange(ALL_FILTER)} />
          {contexts.map((c) => (
            <Chip key={c.id} label={c.name} active={active === c.id} onClick={() => onChange(c.id)} />
          ))}
        </div>
        <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-r from-transparent to-bg" />
      </div>
      <button
        onClick={onManage}
        aria-label="Manage tags"
        className="ml-2 shrink-0 rounded-full border border-line p-2 text-muted"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 20h9" strokeLinecap="round" />
          <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  );
}

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition ${
        active ? 'bg-accent text-black' : 'bg-surface text-muted'
      }`}
    >
      {label}
    </button>
  );
}
