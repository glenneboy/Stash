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
  reminder_at: string | null;
  notify_next_at: string | null;
  notify_stage: number;
}
