import { describe, expect, it } from 'vitest';
import { parseInline, parseNote, stripMarkdown } from './markdown';

describe('parseInline', () => {
  it('parses bold, italic and underline', () => {
    expect(parseInline('a **b** *c* _d_ __e__')).toEqual([
      { type: 'text', text: 'a ' },
      { type: 'bold', children: [{ type: 'text', text: 'b' }] },
      { type: 'text', text: ' ' },
      { type: 'italic', children: [{ type: 'text', text: 'c' }] },
      { type: 'text', text: ' ' },
      { type: 'italic', children: [{ type: 'text', text: 'd' }] },
      { type: 'text', text: ' ' },
      { type: 'underline', children: [{ type: 'text', text: 'e' }] },
    ]);
  });

  it('nests', () => {
    expect(parseInline('**bold _both_**')[0]).toEqual({
      type: 'bold',
      children: [{ type: 'text', text: 'bold ' }, { type: 'italic', children: [{ type: 'text', text: 'both' }] }],
    });
  });

  it('leaves arithmetic, snake_case and unclosed markers literal', () => {
    for (const s of ['2 * 3 * 4', 'snake_case_name', '**unclosed', 'a * b']) {
      expect(parseInline(s)).toEqual([{ type: 'text', text: s }]);
    }
  });
});

describe('parseNote', () => {
  it('keeps every line, including blank ones', () => {
    const blocks = parseNote('one\n\ntwo');
    expect(blocks.map((b) => b.type)).toEqual(['line', 'line', 'line']);
    expect(blocks[1]).toEqual({ type: 'line', children: [] });
  });

  it('groups consecutive bullets into one list', () => {
    const blocks = parseNote('Make dua for:\n- my mum\n* me\n• my wife\ndone');
    expect(blocks.map((b) => b.type)).toEqual(['line', 'list', 'line']);
    expect(blocks[1].type === 'list' && blocks[1].items.length).toBe(3);
  });

  it('handles CRLF', () => {
    expect(parseNote('a\r\nb')).toHaveLength(2);
  });
});

it('stripMarkdown drops markers', () => {
  expect(stripMarkdown('**hi** _there_\n- x')).toBe('hi there\n• x');
});
