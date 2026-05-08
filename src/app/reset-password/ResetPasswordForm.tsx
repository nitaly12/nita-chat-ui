"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { chatApi, readAxiosErrorMessage } from "@/chat/api";
import {
  AuthGhibliShell,
  ghibliInputClass,
  ghibliPrimaryButtonClass,
} from "@/components/auth/AuthGhibliShell";

export default function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = useMemo(() => (searchParams.get("token") ?? "").trim(), [searchParams]);

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) {
      setError("This link is missing a token. Open the link from your email again.");
      return;
    }
    if (password.length < 8) {
      setError("Use at least 8 characters for your new password.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await chatApi.resetPasswordWithToken(token, password);
      setSuccess(true);
      setTimeout(() => router.push("/"), 2000);
    } catch (err) {
      setError(readAxiosErrorMessage(err) ?? "Reset failed. The link may have expired.");
    } finally {
      setBusy(false);
    }
  };

  if (!token) {
    return (
      <AuthGhibliShell
        title="Reset password"
        subtitle="Password reset now uses email and a one-time code."
        footer={
          <Link href="/forgot-password" className="font-medium text-[#4a6b7d] underline underline-offset-4">
            Go to forgot password
          </Link>
        }
      >
        <p className="text-center text-sm text-[#3d5248]">
          Open <strong>Forgot password</strong> to receive an OTP, then set a new password. Legacy links with{" "}
          <code className="rounded bg-[#eef1ea] px-1 py-0.5 text-xs">?token=…</code> still work here.
        </p>
      </AuthGhibliShell>
    );
  }

  return (
    <AuthGhibliShell
      title="Choose a new password"
      subtitle="Your reset link can only be used once. Pick a strong password you haven’t used here before."
      footer={
        <Link href="/" className="font-medium text-[#4a6b7d] underline underline-offset-4">
          Cancel and return to sign in
        </Link>
      }
    >
      {success ? (
        <p className="text-center text-sm font-medium text-[#3d5248]">
          Password updated. Redirecting you to sign in…
        </p>
      ) : (
        <form className="space-y-5" onSubmit={(e) => void onSubmit(e)}>
          <input type="hidden" name="token" value={token} readOnly aria-hidden />
          <div className="space-y-2">
            <label htmlFor="reset-pass" className="text-xs font-semibold uppercase tracking-wide text-[#5a6b62]">
              New password
            </label>
            <input
              id="reset-pass"
              type="password"
              name="newPassword"
              autoComplete="new-password"
              className={ghibliInputClass}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="reset-confirm" className="text-xs font-semibold uppercase tracking-wide text-[#5a6b62]">
              Confirm password
            </label>
            <input
              id="reset-confirm"
              type="password"
              name="confirmPassword"
              autoComplete="new-password"
              className={ghibliInputClass}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              disabled={busy}
            />
          </div>
          {error ? (
            <p className="rounded-2xl border border-red-200/80 bg-red-50/90 px-4 py-3 text-sm text-red-800">
              {error}
            </p>
          ) : null}
          <button type="submit" className={ghibliPrimaryButtonClass} disabled={busy}>
            {busy ? "Saving…" : "Update password"}
          </button>
        </form>
      )}
    </AuthGhibliShell>
  );
}
