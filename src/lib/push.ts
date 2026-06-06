import { supabase } from './supabase';

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

export type PushResult = 'granted' | 'denied' | 'unsupported' | 'error';

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

// Request notification permission (if needed), subscribe this device to push,
// and persist the subscription. Safe to call repeatedly — reuses any existing sub.
export async function ensurePushSubscription(): Promise<PushResult> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !VAPID_PUBLIC_KEY) {
    return 'unsupported';
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return 'denied';

  const reg = await navigator.serviceWorker.ready;
  // Reuses any existing subscription. (We generate the VAPID key once and never rotate it,
  // so we don't need to compare applicationServerKeys here.)
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }
  return (await saveSubscription(sub)) ? 'granted' : 'error';
}

async function saveSubscription(sub: PushSubscription): Promise<boolean> {
  const json = sub.toJSON();
  if (!json.keys?.p256dh || !json.keys?.auth) return false;
  const { data } = await supabase.auth.getUser();
  const user_id = data.user?.id;
  if (!user_id) return false;
  const { error } = await supabase
    .from('push_subscriptions')
    .upsert(
      { user_id, endpoint: sub.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth },
      { onConflict: 'endpoint' },
    );
  if (error) {
    console.error('Failed to save push subscription', error);
    return false;
  }
  return true;
}
