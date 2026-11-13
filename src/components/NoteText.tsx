import { Fragment, type ReactNode } from 'react';
import { parseNote, type Inline } from '../lib/markdown';

function renderInline(nodes: Inline[]): ReactNode[] {
  return nodes.map((n, i) => {
    switch (n.type) {
      case 'text':
        return <Fragment key={i}>{n.text}</Fragment>;
      case 'bold':
        return <strong key={i} className="font-semibold text-[#c9c3bd]">{renderInline(n.children)}</strong>;
      case 'italic':
        return <em key={i}>{renderInline(n.children)}</em>;
      case 'underline':
        return <u key={i} className="underline-offset-2">{renderInline(n.children)}</u>;
    }
  });
}

/** Renders a task note: limited markdown, every typed line break kept. */
export function NoteText({ text, className = '' }: { text: string; className?: string }) {
  return (
    <div className={`break-words ${className}`}>
      {parseNote(text).map((block, i) =>
        block.type === 'list' ? (
          <ul key={i} className="my-0.5 list-disc space-y-0.5 pl-5 marker:text-muted">
            {block.items.map((item, j) => (
              <li key={j}>{renderInline(item)}</li>
            ))}
          </ul>
        ) : (
          // Blank lines keep their height so paragraph gaps survive.
          <p key={i} className="whitespace-pre-wrap">
            {block.children.length ? renderInline(block.children) : <br />}
          </p>
        ),
      )}
    </div>
  );
}
