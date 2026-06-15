import { useState } from 'react';
import type { Profile } from '../types';
import { createProfile, renameProfile, deleteProfile } from '../lib/store';
import { DEFAULT_PROFILE_NAME } from '../lib/profiles';

interface Props {
  profiles: Profile[];
  onClose: () => void;
}

export function ProfileManager({ profiles, onClose }: Props) {
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
              holds your original tasks, and can't be renamed or removed. */}
          <li className="flex items-center gap-2">
            <span className="min-w-0 flex-1 rounded-xl border border-line bg-bg px-4 py-2.5 text-base text-muted">
              {DEFAULT_PROFILE_NAME}
            </span>
            <span className="shrink-0 px-3 py-2.5 text-xs text-muted">Default</span>
          </li>
          {profiles.map((p) => (
            <ProfileRow key={p.id} profile={p} />
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

function ProfileRow({ profile }: { profile: Profile }) {
  const [name, setName] = useState(profile.name);

  function commit() {
    const next = name.trim();
    if (next && next !== profile.name) renameProfile(profile.id, next);
    else setName(profile.name);
  }

  function remove() {
    if (!confirm(`Delete the "${profile.name}" profile and all of its tasks and tags? This can't be undone.`)) return;
    deleteProfile(profile.id);
  }

  return (
    <li className="flex items-center gap-2">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={commit}
        className="min-w-0 flex-1 rounded-xl border border-line bg-bg px-4 py-2.5 text-base outline-none focus:border-accent"
      />
      <button
        onClick={remove}
        aria-label={`Delete ${profile.name}`}
        className="shrink-0 rounded-xl border border-line px-3 py-2.5 text-sm text-red-400"
      >
        Remove
      </button>
    </li>
  );
}
