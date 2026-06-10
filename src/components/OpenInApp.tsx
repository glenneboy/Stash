export function OpenInApp() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 safe-top safe-bottom">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold tracking-tight">Stash</h1>
          <p className="mt-2 text-sm text-muted">You're signed in.</p>
        </div>
        <div className="rounded-2xl border border-line bg-surface p-6 text-center space-y-3">
          <p className="text-sm">
            Open the <span className="text-accent">Stash</span> app on your home screen to continue.
          </p>
          <p className="text-xs text-muted">
            Tap the Stash icon you added to your iPhone home screen.
          </p>
        </div>
      </div>
    </main>
  );
}
