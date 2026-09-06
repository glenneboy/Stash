// A named partition of a user's tasks + contexts (e.g. "Work", "Home").
// The implicit Default profile is represented by a null profile_id on rows,
// so existing data (and writes from older app versions) belong to it for free.
export interface Profile {
  id: string;
  name: string;
  created_at: string;
  // The owner: the user who created the profile. Only the owner may share, rename
  // or delete it, and every task/tag inside it is stored owned by them (a DB
  // trigger stamps user_id on write), whoever actually typed it.
  user_id: string;
}

export type MemberStatus = 'pending' | 'accepted';

// One person's access to a shared profile. A row is created by the owner as an
// invite (status 'pending', user_id null because the invitee may not have an
// account yet) and is matched to them by email; accepting stamps user_id and
// flips the status. Reject, revoke and leave all just delete the row.
export interface ProfileMember {
  id: string;
  profile_id: string;
  // Normalised (trimmed + lowercased) so Wife@Gmail.com and wife@gmail.com are one person.
  email: string;
  user_id: string | null;
  status: MemberStatus;
  created_at: string;
}

export interface Context {
  id: string;
  name: string;
  created_at: string;
  // null/absent => the implicit Default profile.
  profile_id: string | null;
}

// How a task repeats. Completing a recurring task spawns the next occurrence
// (due date advanced by the rule) instead of the task being ticked off forever.
export interface Recurrence {
  unit: 'day' | 'week' | 'month';
  interval: number; // >= 1; e.g. { unit: 'week', interval: 2 } = fortnightly
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
  // null/absent => not recurring.
  recur: Recurrence | null;
  // null/absent => the implicit Default profile.
  profile_id: string | null;
}
