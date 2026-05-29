export interface Context {
  id: string;
  name: string;
  created_at: string;
}

export interface Task {
  id: string;
  title: string;
  note: string | null;
  contexts: string[];
  completed: boolean;
  created_at: string;
  completed_at: string | null;
}

export const ALL_FILTER = 'all' as const;
export type Filter = typeof ALL_FILTER | string;
