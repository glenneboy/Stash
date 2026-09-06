import type { Profile, ProfileMember } from '../types';

// ── Profile sharing ──────────────────────────────────────────
// Pure helpers over the membership list. Everything here is presentation logic:
// the security boundary is RLS in the database, never these functions.

// Invites are addressed to an email, and the same person may type it with
// different case or stray spaces, so every comparison goes through this.
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// A deliberately loose shape check — enough to catch a fat-fingered address
// before it becomes a pending invite nobody will ever accept. Real validation is
// impossible client-side, and the app never reveals whether an address exists.
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email));
}

// Owner-only affordances (share, rename, delete) hang off this. A null userId
// (identity not yet resolved) is never an owner — better to hide a control than
// to offer one the database will refuse.
export function isOwner(profile: Profile, userId: string | null): boolean {
  return userId !== null && profile.user_id === userId;
}

export function membersOf(members: ProfileMember[], profileId: string): ProfileMember[] {
  return members.filter((m) => m.profile_id === profileId);
}

export function acceptedMembersOf(members: ProfileMember[], profileId: string): ProfileMember[] {
  return membersOf(members, profileId).filter((m) => m.status === 'accepted');
}

// "Shared" means somebody actually has access — a profile with only pending
// invites out is still private, so it carries no badge yet.
export function isShared(members: ProfileMember[], profileId: string): boolean {
  return acceptedMembersOf(members, profileId).length > 0;
}

// Invites addressed to me and not yet accepted, for the pending-invite cards.
// Matched by email (not user_id) because an invite can predate my account.
export function pendingInvitesFor(members: ProfileMember[], email: string | null): ProfileMember[] {
  if (!email) return [];
  const key = normalizeEmail(email);
  return members.filter((m) => m.status === 'pending' && normalizeEmail(m.email) === key);
}

// Profiles I can see but do not own — shown with the shared badge, and without
// rename/delete/share controls.
export function sharedWithMe(profiles: Profile[], userId: string | null): Profile[] {
  if (!userId) return [];
  return profiles.filter((p) => p.user_id !== userId);
}
