import { useEffect } from 'react';
import { useSession } from './hooks/useSession';
import { init, reset } from './lib/store';
import { Auth } from './components/Auth';
import { Home } from './components/Home';

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

  if (!session) return <Auth />;
  return <Home />;
}
