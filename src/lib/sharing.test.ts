import { describe, expect, it } from 'vitest';
import type { Profile, ProfileMember } from '../types';
import {
  acceptedMembersOf,
  isOwner,
  isShared,
  isValidEmail,
  membersOf,
  normalizeEmail,
  pendingInvitesFor,
  sharedWithMe,
} from './sharing';

const ME = 'user-me';
const OTHER = 'user-other';

function profile(id: string, userId: string, name = id): Profile {
  return { id, name, created_at: '2026-01-01T00:00:00.000Z', user_id: userId };
}

function member(
  id: string,
  profileId: string,
  email: string,
  status: ProfileMember['status'] = 'pending',
  userId: string | null = null,
): ProfileMember {
  return {
    id,
    profile_id: profileId,
    email,
    user_id: userId,
    status,
    created_at: '2026-01-02T00:00:00.000Z',
    profile_name: `Profile ${profileId}`,
  };
}

describe('normalizeEmail', () => {
  it('trims and lowercases so one person is one invite', () => {
    expect(normalizeEmail('  Wife@Gmail.com ')).toBe('wife@gmail.com');
  });

  it('leaves an already-normalised address alone', () => {
    expect(normalizeEmail('wife@gmail.com')).toBe('wife@gmail.com');
  });
});

describe('isValidEmail', () => {
  it('accepts ordinary addresses, normalising first', () => {
    expect(isValidEmail('wife@gmail.com')).toBe(true);
    expect(isValidEmail('  Son@Example.co.uk  ')).toBe(true);
    expect(isValidEmail('first.last+tag@example.com')).toBe(true);
  });

  it('rejects obvious typos', () => {
    expect(isValidEmail('')).toBe(false);
    expect(isValidEmail('   ')).toBe(false);
    expect(isValidEmail('wife')).toBe(false);
    expect(isValidEmail('wife@gmail')).toBe(false);
    expect(isValidEmail('@gmail.com')).toBe(false);
    expect(isValidEmail('a b@gmail.com')).toBe(false);
    expect(isValidEmail('two@at@gmail.com')).toBe(false);
  });
});

describe('isOwner', () => {
  it('is true only for the profile owner', () => {
    expect(isOwner(profile('trip', ME), ME)).toBe(true);
    expect(isOwner(profile('trip', OTHER), ME)).toBe(false);
  });

  it('is false when identity is not yet known, so owner-only controls stay hidden', () => {
    expect(isOwner(profile('trip', ME), null)).toBe(false);
  });
});

describe('membersOf / acceptedMembersOf', () => {
  const members = [
    member('m1', 'trip', 'wife@gmail.com', 'accepted', OTHER),
    member('m2', 'trip', 'son@gmail.com'),
    member('m3', 'work', 'boss@gmail.com', 'accepted', OTHER),
  ];

  it('scopes to one profile', () => {
    expect(membersOf(members, 'trip').map((m) => m.id)).toEqual(['m1', 'm2']);
  });

  it('filters pending invites out of the accepted list', () => {
    expect(acceptedMembersOf(members, 'trip').map((m) => m.id)).toEqual(['m1']);
  });

  it('returns nothing for a profile with no membership rows', () => {
    expect(membersOf(members, 'ghost')).toEqual([]);
    expect(acceptedMembersOf(members, 'ghost')).toEqual([]);
  });
});

describe('isShared', () => {
  it('is true once at least one invite has been accepted', () => {
    const members = [member('m1', 'trip', 'wife@gmail.com', 'accepted', OTHER)];
    expect(isShared(members, 'trip')).toBe(true);
  });

  it('is false while only invites are outstanding — nobody has access yet', () => {
    const members = [member('m1', 'trip', 'wife@gmail.com')];
    expect(isShared(members, 'trip')).toBe(false);
  });

  it('is false for a profile with no members', () => {
    expect(isShared([], 'trip')).toBe(false);
  });
});

describe('pendingInvitesFor', () => {
  const members = [
    member('m1', 'trip', 'me@gmail.com'),
    member('m2', 'work', 'me@gmail.com', 'accepted', ME),
    member('m3', 'trip', 'someone@gmail.com'),
  ];

  it('returns only my un-accepted invites', () => {
    expect(pendingInvitesFor(members, 'me@gmail.com').map((m) => m.id)).toEqual(['m1']);
  });

  it('matches regardless of the case the address was typed in', () => {
    expect(pendingInvitesFor(members, ' Me@Gmail.com ').map((m) => m.id)).toEqual(['m1']);
    expect(
      pendingInvitesFor([member('m1', 'trip', 'Me@Gmail.com')], 'me@gmail.com').map((m) => m.id),
    ).toEqual(['m1']);
  });

  it('returns nothing when the signed-in email is unknown', () => {
    expect(pendingInvitesFor(members, null)).toEqual([]);
  });
});

describe('sharedWithMe', () => {
  const profiles = [profile('trip', OTHER, 'Trip'), profile('mine', ME, 'Trip')];

  it('returns profiles I can see but do not own', () => {
    expect(sharedWithMe(profiles, ME).map((p) => p.id)).toEqual(['trip']);
  });

  it('badges nothing while identity is unknown', () => {
    expect(sharedWithMe(profiles, null)).toEqual([]);
  });
});
