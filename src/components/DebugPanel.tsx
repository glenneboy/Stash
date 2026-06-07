import { useState } from 'react';
import { useStore } from '../lib/useStore';

// TEMP — visible reminder-sync trail for diagnosing #12. Delete this file and its
// one render call in Home.tsx once the persistence bug is found.
export function DebugPanel() {
  const { debugLog, pending, online, syncing } = useStore();
  const [open, setOpen] = useState(false);

  return (
    <div className="fixed bottom-20 right-3 z-30">
      {open && (
        <div className="mb-2 max-h-72 w-80 max-w-[90vw] overflow-y-auto rounded-xl border border-line bg-elevated p-2 font-mono text-[10px] leading-tight text-muted shadow-lg">
          <p className="mb-1 text-white">
            online={String(online)} syncing={String(syncing)} pending={pending}
          </p>
          {debugLog.length === 0 ? (
            <p>(no events yet)</p>
          ) : (
            debugLog.map((line, i) => <p key={i} className="whitespace-pre-wrap">{line}</p>)
          )}
        </div>
      )}
      <button
        onClick={() => setOpen((o) => !o)}
        className="rounded-full border border-line bg-elevated px-3 py-1.5 text-[10px] text-muted shadow-lg"
      >
        debug{pending > 0 ? ` (${pending})` : ''}
      </button>
    </div>
  );
}
