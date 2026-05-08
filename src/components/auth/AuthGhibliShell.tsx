import type { ReactNode } from "react";
import Link from "next/link";

export type AuthGhibliShellProps = {
  title: string;
  subtitle?: string;
  children: ReactNode;
  /** Shown under the card (e.g. back to login) */
  footer?: ReactNode;
};

/**
 * Soft, studio-inspired palette: sage, cream, and dusty sky — readable and calm on mobile.
 */
export function AuthGhibliShell({ title, subtitle, children, footer }: AuthGhibliShellProps) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-[#dde8e0] via-[#ebe4dc] to-[#d8e4f0] px-4 py-10 sm:px-6 sm:py-14">
      <div className="mx-auto w-full max-w-md">
        <div className="mb-8 text-center">
          <Link
            href="/"
            className="inline-block text-sm font-medium text-[#4a6b7d] underline decoration-[#4a6b7d]/30 underline-offset-4 transition hover:text-[#3d5a6a]"
          >
            ← Back to app
          </Link>
          <h1 className="mt-6 font-serif text-2xl font-semibold tracking-tight text-[#2c3d33] sm:text-3xl">
            {title}
          </h1>
          {subtitle ? (
            <p className="mt-2 text-pretty text-sm leading-relaxed text-[#4a5c52] sm:text-base">
              {subtitle}
            </p>
          ) : null}
        </div>

        <div className="rounded-3xl border border-[#b8c9bc]/70 bg-[#faf8f3]/95 p-6 shadow-[0_20px_50px_-12px_rgba(60,80,70,0.18)] backdrop-blur-sm sm:p-8">
          {children}
        </div>

        {footer ? <div className="mt-8 text-center text-sm text-[#4a5c52]">{footer}</div> : null}
      </div>
    </div>
  );
}

export const ghibliInputClass =
  "w-full rounded-2xl border border-[#b8c9bc] bg-[#fefcf8] px-4 py-3 text-sm text-[#2c3d33] shadow-inner shadow-[#c5d4c8]/20 outline-none transition placeholder:text-[#7a8f82] focus:border-[#7d9b84] focus:ring-2 focus:ring-[#7d9b84]/35";

export const ghibliPrimaryButtonClass =
  "w-full rounded-2xl bg-[#7d9b84] py-3.5 text-sm font-semibold text-white shadow-md shadow-[#5a7a62]/25 transition hover:bg-[#6d8a74] disabled:cursor-not-allowed disabled:opacity-55";

export const ghibliGhostButtonClass =
  "w-full rounded-2xl border border-[#b8c9bc] bg-white/60 py-3.5 text-sm font-semibold text-[#3d5248] transition hover:bg-[#f5f2eb] disabled:opacity-50";
