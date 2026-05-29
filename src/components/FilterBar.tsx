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
    <div className="flex items-center gap-2 overflow-x-auto border-b border-line px-4 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <Chip label="All" active={active === ALL_FILTER} onClick={() => onChange(ALL_FILTER)} />
      {contexts.map((c) => (
        <Chip key={c.id} label={c.name} active={active === c.id} onClick={() => onChange(c.id)} />
      ))}
      <button
        onClick={onManage}
        aria-label="Manage contexts"
        className="ml-auto shrink-0 rounded-full border border-line px-3 py-1 text-sm text-muted"
      >
        Edit
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
