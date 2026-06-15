// A named partition of a user's tasks + contexts (e.g. "Work", "Home").
// The implicit Default profile is represented by a null profile_id on rows,
// so existing data (and writes from older app versions) belong to it for free.
export interface Profile {
  id: string;
  name: string;
  created_at: string;
}

export interface Context {
  id: string;
  name: string;
  created_at: string;
  // null/absent => the implicit Default profile.
  profile_id: string | null;
}

export interface Task {
  id: string;
  title: string;
  note: string | null;
  contexts: string[];
  completed: boolean;
  created_at: string;
  completed_at: string | null;
  due_on: string | null;
  reminder_at: string | null;
  notify_next_at: string | null;
  notify_stage: number;
  // null/absent => the implicit Default profile.
  profile_id: string | null;
}
