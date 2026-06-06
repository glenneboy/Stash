import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

// Stage offsets from reminder_at (ms): 0=on-time, then +1h, +1d, +4d, +11d.
const STAGE_OFFSETS_MS = [0, 3_600_000, 86_400_000, 4 * 86_400_000, 11 * 86_400_000];

const CRON_SECRET = Deno.env.get('CRON_SECRET')!;
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')!;
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!;
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:gmdale@yahoo.com';

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

interface DueTask {
  id: string;
  user_id: string;
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

  const nowIso = new Date().toISOString();
  const { data: due, error } = await admin
    .from('tasks')
    .select('id, user_id, title, reminder_at, notify_stage')
    .eq('completed', false)
    .not('notify_next_at', 'is', null)
    .lte('notify_next_at', nowIso)
    .returns<DueTask[]>();
  if (error) return new Response(error.message, { status: 500 });
  if (!due || due.length === 0) return new Response(JSON.stringify({ sent: 0 }), { status: 200 });

  const userIds = [...new Set(due.map((t) => t.user_id))];
  const { data: subs } = await admin
    .from('push_subscriptions')
    .select('user_id, endpoint, p256dh, auth')
    .in('user_id', userIds)
    .returns<(SubRow & { user_id: string })[]>();

  const subsByUser = new Map<string, SubRow[]>();
  for (const s of subs ?? []) {
    const list = subsByUser.get(s.user_id) ?? [];
    list.push({ endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth });
    subsByUser.set(s.user_id, list);
  }

  let sent = 0;
  for (const task of due) {
    const payload = JSON.stringify({ title: 'Reminder', body: task.title, taskId: task.id });
    for (const sub of subsByUser.get(task.user_id) ?? []) {
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
