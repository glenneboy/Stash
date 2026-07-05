import type { Context, Task } from '../types';

const UNCATEGORIZED_HEADING = 'Uncategorized';

/**
 * Render a profile's tasks as Markdown, one `##` heading per context with the
 * tasks under it as bullets. A task in multiple contexts repeats under each
 * (matches the app's own filter-by-context behavior); untagged tasks land in
 * a trailing "Uncategorized" section. Completed tasks are always excluded —
 * this is a snapshot of what's left to do, not a history.
 */
export function tasksToMarkdown(profileName: string, tasks: Task[], contexts: Context[]): string {
  const open = tasks.filter((t) => !t.completed);
  const byContext = new Map(contexts.map((c) => [c.id, c.name]));

  const sections = new Map<string, Task[]>();
  for (const context of [...contexts].sort((a, b) => a.name.localeCompare(b.name))) {
    sections.set(context.name, []);
  }
  const uncategorized: Task[] = [];

  for (const task of open) {
    const names = task.contexts.map((id) => byContext.get(id)).filter((n): n is string => !!n);
    if (names.length === 0) {
      uncategorized.push(task);
      continue;
    }
    for (const name of names) {
      sections.get(name)?.push(task);
    }
  }

  const lines: string[] = [`# ${profileName}`, '', `_Exported ${new Date().toLocaleDateString()}_`];

  for (const [name, sectionTasks] of sections) {
    if (sectionTasks.length === 0) continue;
    lines.push('', `## ${name}`, '');
    lines.push(sectionTasks.map((t) => `- ${t.title}`).join('\n\n'));
  }

  if (uncategorized.length > 0) {
    lines.push('', `## ${UNCATEGORIZED_HEADING}`, '');
    lines.push(uncategorized.map((t) => `- ${t.title}`).join('\n\n'));
  }

  return lines.join('\n') + '\n';
}

export function exportFilename(profileName: string): string {
  const slug = profileName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'profile';
  const date = new Date().toISOString().slice(0, 10);
  return `${slug}-${date}.md`;
}

/**
 * Share/download a Markdown export. Prefers the native share sheet (best on
 * mobile — Save to Files, AirDrop, etc.) and falls back to a plain file
 * download where the Web Share API or file sharing isn't supported.
 */
export async function shareOrDownloadMarkdown(filename: string, markdown: string): Promise<void> {
  const file = new File([markdown], filename, { type: 'text/markdown' });

  const nav = navigator as Navigator & { canShare?: (data: { files: File[] }) => boolean };
  if (nav.canShare?.({ files: [file] }) && navigator.share) {
    try {
      await navigator.share({ files: [file], title: filename });
      return;
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return; // user cancelled
      // fall through to download on any other share failure
    }
  }

  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
