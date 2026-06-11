import { useState } from 'react';
import { supabase } from '../lib/supabase';

const isIOS =
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));

const isIOSBrowser =
  isIOS &&
  !(navigator as any).standalone &&
  !window.matchMedia('(display-mode: standalone)').matches;

export function Auth() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [otp, setOtp] = useState('');
  const [otpStatus, setOtpStatus] = useState<'idle' | 'verifying' | 'error'>('idle');

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setStatus('sending');
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin + import.meta.env.BASE_URL },
    });
    if (error) {
      setStatus('error');
      setMessage(error.message);
    } else {
      setStatus('sent');
      setOtp('');
      setOtpStatus('idle');
    }
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    if (otp.length !== 8) return;
    setOtpStatus('verifying');
    const { error } = await supabase.auth.verifyOtp({
      email,
      token: otp,
      type: 'email',
    });
    if (error) setOtpStatus('error');
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 safe-top safe-bottom">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold tracking-tight">Stash</h1>
          <p className="mt-2 text-sm text-muted">Capture now. Sort never.</p>
        </div>

        {status === 'sent' ? (
          <div className="space-y-4">
            <div className="rounded-2xl border border-line bg-surface p-6 text-center">
              <p className="text-sm">
                Check <span className="text-accent">{email}</span> for a sign-in email.
              </p>
              {isIOSBrowser && (
                <p className="mt-3 text-xs text-muted">
                  Enter the 8-digit code from the email below — don't tap the link.
                </p>
              )}
              <button
                className="mt-4 text-xs text-muted underline"
                onClick={() => setStatus('idle')}
              >
                Use a different email
              </button>
            </div>

            {isIOS && (
              <form onSubmit={verifyCode} className="space-y-3">
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={8}
                  placeholder="00000000"
                  value={otp}
                  onChange={(e) => {
                    setOtp(e.target.value.replace(/\D/g, '').slice(0, 8));
                    setOtpStatus('idle');
                  }}
                  className="w-full rounded-xl border border-line bg-surface px-4 py-3 text-center text-2xl tracking-[0.5em] outline-none placeholder:text-muted focus:border-accent"
                />
                <button
                  type="submit"
                  disabled={otp.length !== 8 || otpStatus === 'verifying'}
                  className="w-full rounded-xl bg-accent px-4 py-3 font-medium text-black transition active:scale-[0.99] disabled:opacity-60"
                >
                  {otpStatus === 'verifying' ? 'Verifying…' : 'Sign in with code'}
                </button>
                {otpStatus === 'error' && (
                  <p className="text-center text-sm text-red-400">Invalid or expired code — try again.</p>
                )}
              </form>
            )}
          </div>
        ) : (
          <form onSubmit={sendLink} className="space-y-3">
            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl border border-line bg-surface px-4 py-3 text-base outline-none placeholder:text-muted focus:border-accent"
            />
            <button
              type="submit"
              disabled={status === 'sending'}
              className="w-full rounded-xl bg-accent px-4 py-3 font-medium text-black transition active:scale-[0.99] disabled:opacity-60"
            >
              {status === 'sending' ? 'Sending…' : 'Send magic link'}
            </button>
            {status === 'error' && <p className="text-center text-sm text-red-400">{message}</p>}
          </form>
        )}
      </div>
    </main>
  );
}
