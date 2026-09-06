import { useState } from 'react';
import type { Profile, ProfileMember } from '../types';
import { createProfile, renameProfile, deleteProfile, inviteMember, revokeMember, leaveProfile } from '../lib/store';
import { isOwner, isValidEmail, membersOf, acceptedMembersOf } from '../lib/sharing';
import { DEFAULT_PROFILE_NAME, isProfileShared } from '../lib/profiles';
import { SharedBadge } from './Home';

interface Props {
  profiles: Profile[];
  members: ProfileMember[];
  userId: string | null;
  onClose: () => void;
}

export function ProfileManager({ profiles, members, userId, onClose }: Props) {
  const [adding, setAdding] = useState('');

  function add(e: React.FormEvent) {
    e.preventDefault();
    if (!adding.trim()) return;
    createProfile(adding);
    setAdding('');
  }

  return (
    <div className="fixed inset-0 z-20 flex flex-col justify-end bg-black/60" onClick={onClose}>
      <div
        className="safe-bottom max-h-[80vh] overflow-y-auto rounded-t-3xl border-t border-line bg-surface p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-line" />
        <h2 className="mb-1 text-lg font-semibold">Profiles</h2>
        <p className="mb-3 text-xs text-muted">Each profile keeps its own separate tasks and tags.</p>

        <ul className="space-y-2">
          {/* The Default ("Personal") profile is the implicit null bucket — always present,
              holds your original tasks, and can't be renamed, removed or shared. */}
          <li className="flex items-center gap-2">
            <span className="min-w-0 flex-1 rounded-xl border border-line bg-bg px-4 py-2.5 text-base text-muted">
              {DEFAULT_PROFILE_NAME}
            </span>
            <span className="shrink-0 px-3 py-2.5 text-xs text-muted">Default</span>
          </li>
          {profiles.map((p) => (
            <ProfileRow
              key={p.id}
              profile={p}
              members={membersOf(members, p.id)}
              own={isOwner(p, userId)}
              shared={isProfileShared(p, members, userId)}
            />
          ))}
        </ul>

        <form onSubmit={add} className="mt-4 flex gap-2">
          <input
            value={adding}
            onChange={(e) => setAdding(e.target.value)}
            placeholder="New profile"
            className="min-w-0 flex-1 rounded-xl border border-line bg-bg px-4 py-3 text-base outline-none placeholder:text-muted focus:border-accent"
          />
          <button
            type="submit"
            disabled={!adding.trim()}
            className="rounded-xl bg-accent px-4 py-3 font-medium text-black disabled:opacity-40"
          >
            Add
          </button>
        </form>

        <button onClick={onClose} className="mt-5 w-full rounded-xl border border-line px-4 py-3 text-sm text-muted">
          Done
        </button>
      </div>
    </div>
  );
}

function ProfileRow({
  profile,
  members,
  own,
  shared,
}: {
  profile: Profile;
  members: ProfileMember[];
  own: boolean;
  shared: boolean;
}) {
  const [name, setName] = useState(profile.name);
  const [shareOpen, setShareOpen] = useState(false);

  function commit() {
    const next = name.trim();
    if (next && next !== profile.name) renameProfile(profile.id, next);
    else setName(profile.name);
  }

  function remove() {
    const accepted = acceptedMembersOf(members, profile.id);
    const message =
      accepted.length > 0
        ? `Delete "${profile.name}"? ${accepted.map((m) => m.email).join(', ')} will lose everything in it — every task and tag, for everyone. This can't be undone.`
        : `Delete the "${profile.name}" profile and all of its tasks and tags? This can't be undone.`;
    if (!confirm(message)) return;
    deleteProfile(profile.id);
  }

  function leave() {
    if (!confirm(`Leave "${profile.name}"? You'll lose access to its tasks and tags.`)) return;
    void leaveProfile(profile.id);
  }

  if (!own) {
    // A profile I don't own gets no rename, delete or share affordance — only
    // the option to remove myself from it.
    return (
      <li className="flex items-center gap-2">
        <span className="flex min-w-0 flex-1 items-center gap-1.5 rounded-xl border border-line bg-bg px-4 py-2.5 text-base">
          <span className="truncate">{profile.name}</span>
          {shared && <SharedBadge />}
        </span>
        <button
          onClick={leave}
          aria-label={`Leave ${profile.name}`}
          className="shrink-0 rounded-xl border border-line px-3 py-2.5 text-sm text-red-400"
        >
          Leave
        </button>
      </li>
    );
  }

  return (
    <li className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={commit}
            className="min-w-0 flex-1 rounded-xl border border-line bg-bg px-4 py-2.5 text-base outline-none focus:border-accent"
          />
          {shared && <SharedBadge />}
        </div>
        <button
          onClick={() => setShareOpen((o) => !o)}
          aria-label={shareOpen ? `Hide sharing for ${profile.name}` : `Share ${profile.name}`}
          className={`shrink-0 rounded-xl border border-line px-3 py-2.5 text-sm ${shareOpen ? 'text-accent' : 'text-muted'}`}
        >
          Share
        </button>
        <button
          onClick={remove}
          aria-label={`Delete ${profile.name}`}
          className="shrink-0 rounded-xl border border-line px-3 py-2.5 text-sm text-red-400"
        >
          Remove
        </button>
      </div>
      {shareOpen && <SharePanel profile={profile} members={members} />}
    </li>
  );
}

function SharePanel({ profile, members }: { profile: Profile; members: ProfileMember[] }) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const pending = members.filter((m) => m.status === 'pending');
  const accepted = members.filter((m) => m.status === 'accepted');

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!isValidEmail(trimmed)) {
      setError('Enter a valid email address.');
      return;
    }
    setError(null);
    setInviting(true);
    try {
      await inviteMember(profile.id, trimmed);
      setEmail('');
    } finally {
      setInviting(false);
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-line bg-bg p-3">
      <form onSubmit={invite} className="flex gap-2">
        <input
          type="email"
          inputMode="email"
          autoCapitalize="none"
          autoCorrect="off"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Invite by email"
          className="min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none placeholder:text-muted focus:border-accent"
        />
        <button
          type="submit"
          disabled={!email.trim() || inviting}
          className="shrink-0 rounded-xl bg-accent px-3 py-2 text-sm font-medium text-black disabled:opacity-40"
        >
          Invite
        </button>
      </form>
      {error && <p className="text-xs text-red-400">{error}</p>}

      {pending.length === 0 && accepted.length === 0 ? (
        <p className="text-xs text-muted">No one else has access yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {pending.map((m) => (
            <MemberRow key={m.id} member={m} statusLabel="Pending" removeLabel="Cancel invite" />
          ))}
          {accepted.map((m) => (
            <MemberRow key={m.id} member={m} removeLabel="Remove" />
          ))}
        </ul>
      )}
    </div>
  );
}

function MemberRow({
  member,
  statusLabel,
  removeLabel,
}: {
  member: ProfileMember;
  statusLabel?: string;
  removeLabel: string;
}) {
  const [busy, setBusy] = useState(false);

  async function remove() {
    setBusy(true);
    try {
      await revokeMember(member.id);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex items-center gap-2 text-sm">
      <span className="min-w-0 flex-1 truncate text-muted" title={member.email}>
        {member.email}
      </span>
      {statusLabel && <span className="shrink-0 text-xs text-muted">{statusLabel}</span>}
      <button
        onClick={remove}
        disabled={busy}
        aria-label={`${removeLabel} for ${member.email}`}
        className="shrink-0 text-xs text-red-400 disabled:opacity-40"
      >
        {removeLabel}
      </button>
    </li>
  );
}
