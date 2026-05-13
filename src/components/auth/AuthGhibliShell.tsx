import type { ReactNode } from "react";
import Link from "next/link";

export type AuthGhibliShellProps = {
  title: string;
  subtitle?: string;
  children: ReactNode;
  /** Shown under the card (e.g. back to login) */
  footer?: ReactNode;
};

export function AuthGhibliShell({ title, subtitle, children, footer }: AuthGhibliShellProps) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#f6f7f9] px-4 py-10 sm:px-6">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 -left-32 h-80 w-80 rounded-full bg-[#c8dccd] opacity-60 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-32 -right-32 h-96 w-96 rounded-full bg-[#dbe4ef] opacity-60 blur-3xl"
      />

      <div className="relative w-full max-w-md">
        <div className="mb-6">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 transition hover:text-slate-900"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
            Back to app
          </Link>
        </div>

        <div className="rounded-2xl border border-black/5 bg-white p-8 shadow-[0_20px_60px_-20px_rgba(15,23,42,0.18)] sm:p-10">
          <div className="mb-7 flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#2c3d33] text-base font-semibold text-white">
              M
            </span>
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-[#0f172a]">{title}</h1>
              {subtitle ? (
                <p className="mt-0.5 text-sm leading-relaxed text-slate-500">{subtitle}</p>
              ) : null}
            </div>
          </div>

          {children}
        </div>

        {footer ? (
          <div className="mt-6 text-center text-sm text-slate-500">{footer}</div>
        ) : null}
      </div>
    </div>
  );
}

export const ghibliInputClass =
  "w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#7d9b84] focus:ring-4 focus:ring-[#7d9b84]/15";

export const ghibliPrimaryButtonClass =
  "w-full rounded-lg bg-[#2c3d33] py-2.5 text-sm font-semibold text-white transition hover:bg-[#1e2b24] focus:outline-none focus:ring-4 focus:ring-[#2c3d33]/20 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60";

export const ghibliGhostButtonClass =
  "w-full rounded-lg border border-slate-200 bg-white py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50";
