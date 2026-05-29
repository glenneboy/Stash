import type { Context, Task } from '../types';
import { toggleComplete } from '../lib/store';

interface Props {
  task: Task;
  contexts: Context[];
  onEdit: (task: Task) => void;
}

export function TaskItem({ task, contexts, onEdit }: Props) {
  const tags = task.contexts
    .map((id) => contexts.find((c) => c.id === id)?.name)
    .filter((n): n is string => Boolean(n));

  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <button
        aria-label={task.completed ? 'Mark incomplete' : 'Mark complete'}
        onClick={() => toggleComplete(task.id)}
        className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 transition ${
          task.completed ? 'border-accent bg-accent text-black' : 'border-muted'
        }`}
      >
        {task.completed && (
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="3">
            <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>

      <button onClick={() => onEdit(task)} className="min-w-0 flex-1 text-left">
        <p className={`break-words ${task.completed ? 'text-muted line-through' : ''}`}>{task.title}</p>
        {task.note && <p className="mt-0.5 break-words text-sm text-muted">{task.note}</p>}
        {tags.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {tags.map((name) => (
              <span key={name} className="rounded-full bg-elevated px-2 py-0.5 text-xs text-muted">
                {name}
              </span>
            ))}
          </div>
        )}
      </button>
    </li>
  );
}
