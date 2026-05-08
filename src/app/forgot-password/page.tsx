"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { chatApi, readAxiosErrorMessage } from "@/chat/api";
import {
  AuthGhibliShell,
  ghibliGhostButtonClass,
  ghibliInputClass,
  ghibliPrimaryButtonClass,
} from "@/components/auth/AuthGhibliShell";

type Step = "email" | "otp" | "password";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) {
      setError("Please enter your email address.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await chatApi.requestPasswordReset(trimmed);
      setOtp("");
      setStep("otp");
    } catch (err) {
      setError(readAxiosErrorMessage(err) ?? "Could not send the code. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const verifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = otp.trim();
    if (!code) {
      setError("Enter the code from your email.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await chatApi.verifyPasswordResetOtp(email.trim(), code);
      setPassword("");
      setConfirmPassword("");
      setStep("password");
    } catch (err) {
      const fromApi = readAxiosErrorMessage(err);
      const fromErr = err instanceof Error ? err.message : null;
      setError(fromApi ?? fromErr ?? "Invalid or expired code.");
    } finally {
      setBusy(false);
    }
  };

  const saveNewPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      setError("Use at least 8 characters for your new password.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await chatApi.resetPasswordWithOtp(email.trim(), otp.trim(), password);
      router.push("/?passwordReset=1");
    } catch (err) {
      setError(readAxiosErrorMessage(err) ?? "Could not update password. Request a new code.");
    } finally {
      setBusy(false);
    }
  };

  const subtitle =
    step === "email"
      ? "We’ll send a one-time code to your Gmail (or inbox) if an account exists for that address."
      : step === "otp"
        ? `Enter the code we sent to ${email.trim() || "your email"}.`
        : "Choose a new password. You’ll sign in on the next screen.";

  return (
    <AuthGhibliShell
      title="Forgot password"
      subtitle={subtitle}
      footer={
        <Link
          href="/"
          className="font-medium text-[#4a6b7d] underline decoration-[#4a6b7d]/30 underline-offset-4 hover:text-[#3d5a6a]"
        >
          Return to sign in
        </Link>
      }
    >
      {step === "email" ? (
        <form className="space-y-5" onSubmit={(e) => void sendOtp(e)}>
          <div className="space-y-2">
            <label htmlFor="forgot-email" className="text-xs font-semibold uppercase tracking-wide text-[#5a6b62]">
              Email
            </label>
            <input
              id="forgot-email"
              type="email"
              name="email"
              autoComplete="email"
              className={ghibliInputClass}
              placeholder="you@gmail.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={busy}
            />
          </div>
          {error ? (
            <p className="rounded-2xl border border-red-200/80 bg-red-50/90 px-4 py-3 text-sm text-red-800">
              {error}
            </p>
          ) : null}
          <button type="submit" className={ghibliPrimaryButtonClass} disabled={busy}>
            {busy ? "Sending…" : "Send OTP"}
          </button>
        </form>
      ) : null}

      {step === "otp" ? (
        <form className="space-y-5" onSubmit={(e) => void verifyOtp(e)}>
          <div className="space-y-2">
            <label htmlFor="forgot-otp" className="text-xs font-semibold uppercase tracking-wide text-[#5a6b62]">
              One-time code
            </label>
            <input
              id="forgot-otp"
              type="text"
              name="otp"
              inputMode="numeric"
              autoComplete="one-time-code"
              className={ghibliInputClass}
              placeholder="6-digit code"
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
              disabled={busy}
            />
          </div>
          {error ? (
            <p className="rounded-2xl border border-red-200/80 bg-red-50/90 px-4 py-3 text-sm text-red-800">
              {error}
            </p>
          ) : null}
          <button type="submit" className={ghibliPrimaryButtonClass} disabled={busy}>
            {busy ? "Checking…" : "Verify"}
          </button>
          <button
            type="button"
            className={ghibliGhostButtonClass}
            disabled={busy}
            onClick={() => {
              setStep("email");
              setError(null);
              setOtp("");
            }}
          >
            Use a different email
          </button>
        </form>
      ) : null}

      {step === "password" ? (
        <form className="space-y-5" onSubmit={(e) => void saveNewPassword(e)}>
          <p className="rounded-2xl border border-[#b8c9bc]/60 bg-[#eef4ef]/80 px-4 py-3 text-sm text-[#3d5248]">
            Code verified. Set your new password below, then sign in on the home page.
          </p>
          <div className="space-y-2">
            <label htmlFor="new-pass" className="text-xs font-semibold uppercase tracking-wide text-[#5a6b62]">
              New password
            </label>
            <input
              id="new-pass"
              type="password"
              autoComplete="new-password"
              className={ghibliInputClass}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="new-pass-confirm" className="text-xs font-semibold uppercase tracking-wide text-[#5a6b62]">
              Confirm password
            </label>
            <input
              id="new-pass-confirm"
              type="password"
              autoComplete="new-password"
              className={ghibliInputClass}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={busy}
            />
          </div>
          {error ? (
            <p className="rounded-2xl border border-red-200/80 bg-red-50/90 px-4 py-3 text-sm text-red-800">
              {error}
            </p>
          ) : null}
          <button type="submit" className={ghibliPrimaryButtonClass} disabled={busy}>
            {busy ? "Saving…" : "Save new password"}
          </button>
        </form>
      ) : null}
    </AuthGhibliShell>
  );
}
