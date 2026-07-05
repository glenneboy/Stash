import { useState } from 'react';
import type { Context, Task } from '../types';
import { exportFilename, shareOrDownloadMarkdown, tasksToMarkdown } from '../lib/export';

interface Props {
  profileName: string;
  tasks: Task[];
  contexts: Context[];
  onClose: () => void;
}

export function ExportSheet({ profileName, tasks, contexts, onClose }: Props) {
  const [exporting, setExporting] = useState(false);
  const openCount = tasks.filter((t) => !t.completed).length;

  async function handleExport() {
    setExporting(true);
    try {
      const markdown = tasksToMarkdown(profileName, tasks, contexts);
      await shareOrDownloadMarkdown(exportFilename(profileName), markdown);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-20 flex flex-col justify-end bg-black/60" onClick={onClose}>
      <div
        className="safe-bottom max-h-[80vh] overflow-y-auto rounded-t-3xl border-t border-line bg-surface p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-line" />
        <h2 className="mb-1 text-lg font-semibold">Export {profileName}</h2>
        <p className="mb-4 text-xs text-muted">
          {openCount} open {openCount === 1 ? 'task' : 'tasks'} as a Markdown file, grouped by tag.
        </p>

        <button
          onClick={handleExport}
          disabled={exporting}
          className="w-full rounded-xl bg-accent px-4 py-3 font-medium text-black disabled:opacity-40"
        >
          {exporting ? 'Exporting…' : 'Export Markdown'}
        </button>

        <button onClick={onClose} className="mt-3 w-full rounded-xl border border-line px-4 py-3 text-sm text-muted">
          Done
        </button>
      </div>
    </div>
  );
}
