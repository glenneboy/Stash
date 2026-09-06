import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

// Stage offsets from reminder_at (ms): 0=on-time, then +1h, +1d, +4d, +11d.
const STAGE_OFFSETS_MS = [0, 3_600_000, 86_400_000, 4 * 86_400_000, 11 * 86_400_000];

const CRON_SECRET = Deno.env.get('CRON_SECRET');
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY');
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY');
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT');
if (!CRON_SECRET || !VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) {
  throw new Error(
    'Missing required env vars: CRON_SECRET, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT',
  );
}

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

interface DueTask {
  id: string;
  user_id: string;
  profile_id: string | null;
  title: string;
  reminder_at: string;
  notify_stage: number;
}

interface SubRow {
  endpoint: string;
  p256dh: string;
  auth: string;
}

Deno.serve(async (req) => {
  if (req.headers.get('x-cron-secret') !== CRON_SECRET) {
    return new Response('unauthorized', { status: 401 });
  }

  // Single-user, hourly-cadence MVP: we read due rows then advance them per-task without a
  // lock. Overlapping runs (a tick firing before a slow run finishes) could double-send a
  // nudge. Acceptable here; revisit with a CAS/locking UPDATE...RETURNING if this scales.
  const nowIso = new Date().toISOString();
  const { data: due, error } = await admin
    .from('tasks')
    .select('id, user_id, profile_id, title, reminder_at, notify_stage')
    .eq('completed', false)
    .not('notify_next_at', 'is', null)
    .lte('notify_next_at', nowIso)
    .returns<DueTask[]>();
  if (error) return new Response(error.message, { status: 500 });
  if (!due || due.length === 0) return new Response(JSON.stringify({ sent: 0 }), { status: 200 });

  // Fan-out for shared profiles. Under owner-owns-everything, task.user_id is always
  // the profile OWNER — so it alone would buzz only Glenn and never his wife. Resolve
  // the accepted members of every profile in this batch in one query (household scale,
  // but per-task lookups would still be silly) and notify owner + members.
  // A task with a null profile_id is Personal: nobody else can ever see it, so it keeps
  // exactly today's behaviour of notifying its owner and no one else.
  const profileIds = [...new Set(due.map((t) => t.profile_id).filter((p): p is string => !!p))];
  const membersByProfile = new Map<string, string[]>();
  if (profileIds.length > 0) {
    const { data: members, error: membersError } = await admin
      .from('profile_members')
      .select('profile_id, user_id')
      .in('profile_id', profileIds)
      .eq('status', 'accepted')
      .not('user_id', 'is', null)
      .returns<{ profile_id: string; user_id: string }[]>();
    if (membersError) console.error('failed to load profile members', membersError.message);
    for (const m of members ?? []) {
      const list = membersByProfile.get(m.profile_id) ?? [];
      list.push(m.user_id);
      membersByProfile.set(m.profile_id, list);
    }
  }

  // Owner first, then accepted members; deduped so an odd row can't double-buzz anyone.
  const recipientsOf = (task: DueTask): string[] =>
    task.profile_id
      ? [...new Set([task.user_id, ...(membersByProfile.get(task.profile_id) ?? [])])]
      : [task.user_id];

  const userIds = [...new Set(due.flatMap(recipientsOf))];
  const { data: subs, error: subsError } = await admin
    .from('push_subscriptions')
    .select('user_id, endpoint, p256dh, auth')
    .in('user_id', userIds)
    .returns<(SubRow & { user_id: string })[]>();
  if (subsError) console.error('failed to load push subscriptions', subsError.message);

  const subsByUser = new Map<string, SubRow[]>();
  for (const s of subs ?? []) {
    const list = subsByUser.get(s.user_id) ?? [];
    list.push({ endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth });
    subsByUser.set(s.user_id, list);
  }

  let sent = 0;
  for (const task of due) {
    const payload = JSON.stringify({ title: 'Reminder', body: task.title, taskId: task.id });
    const taskSubs = recipientsOf(task).flatMap((uid) => subsByUser.get(uid) ?? []);
    for (const sub of taskSubs) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
        );
        sent++;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await admin.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
        } else {
          console.error('push send failed', { endpoint: sub.endpoint, status });
        }
      }
    }

    // Advance to the next stage, or stop (notify_next_at = null) when exhausted.
    const next = task.notify_stage + 1;
    const patch =
      next < STAGE_OFFSETS_MS.length
        ? {
            notify_stage: next,
            notify_next_at: new Date(
              new Date(task.reminder_at).getTime() + STAGE_OFFSETS_MS[next],
            ).toISOString(),
          }
        : { notify_stage: next, notify_next_at: null };
    await admin.from('tasks').update(patch).eq('id', task.id);
  }

  return new Response(JSON.stringify({ sent, due: due.length }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
