import { useEffect } from 'react';
import { useSession } from './hooks/useSession';
import { init, reset } from './lib/store';
import { Auth } from './components/Auth';
import { Home } from './components/Home';
import { OpenInApp } from './components/OpenInApp';

// Captured at module load time, before Supabase clears the URL
const isMagicLinkCallback =
  window.location.hash.includes('access_token') ||
  new URLSearchParams(window.location.search).has('code');

const isIOSBrowser =
  (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent))) &&
  !(navigator as any).standalone &&
  !window.matchMedia('(display-mode: standalone)').matches;

export default function App() {
  const { session, ready } = useSession();

  useEffect(() => {
    if (session) void init();
    else reset();
  }, [session?.user.id]);

  if (!ready) {
    return (
      <main className="grid min-h-screen place-items-center">
        <p className="text-muted">Loading…</p>
      </main>
    );
  }

  if (session && isMagicLinkCallback && isIOSBrowser) return <OpenInApp />;
  if (!session) return <Auth />;
  return <Home />;
}
