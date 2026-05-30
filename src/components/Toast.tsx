import { useStore } from '../lib/useStore';
import { runUndo, dismissToast } from '../lib/store';

export function Toast() {
  const { toast } = useStore();
  if (!toast) return null;

  return (
    <div className="safe-bottom pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center px-4 pb-4">
      <div className="pointer-events-auto flex items-center gap-4 rounded-xl border border-line bg-elevated px-4 py-3 shadow-lg">
        <span className="text-sm">{toast.message}</span>
        <button onClick={runUndo} className="text-sm font-medium text-accent">
          Undo
        </button>
        <button onClick={dismissToast} aria-label="Dismiss" className="text-muted">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 6l12 12M6 18L18 6" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}
