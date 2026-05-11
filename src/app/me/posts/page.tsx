"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import MyProfileFeed from "@/components/profile/MyProfileFeed";

export default function MyPostsPage() {
  const [token, setToken] = useState("");

  useEffect(() => {
    setToken(typeof window !== "undefined" ? window.localStorage.getItem("accessToken") ?? "" : "");
  }, []);

  if (!token) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#e8efe8] via-[#f2ede6] to-[#e3ecf5] p-8 text-[var(--foreground)] dark:from-slate-950 dark:via-slate-900 dark:to-slate-900">
        <div className="mx-auto max-w-3xl rounded-3xl border border-[var(--feed-border)] bg-[var(--feed-surface)] p-8 shadow-sm">
          <p className="text-slate-600 dark:text-slate-400">You need to be signed in.</p>
          <Link href="/" className="mt-4 inline-block text-blue-600 hover:underline dark:text-blue-400">
            <svg
              className="h-6 w-6 shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M15 18l-6-6 6-6" />
            </svg>
            <span>Back</span>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full bg-gradient-to-br from-[#e8efe8] via-[#f2ede6] to-[#e3ecf5] text-[var(--foreground)] dark:from-slate-950 dark:via-slate-900 dark:to-slate-900">
      <div className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8 xl:px-10 2xl:px-14">
        <Link
          href="/"
          aria-label="Back to messages"
          className="mb-6 inline-flex items-center gap-2 text-sm font-medium text-blue-600 hover:underline dark:text-blue-400"
        >
          <svg
            className="h-6 w-6 shrink-0"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M15 18l-6-6 6-6" />
          </svg>
          <span>Back</span>
        </Link>
        <header className="mt-6 rounded-3xl border border-[var(--feed-border)] bg-[var(--feed-surface)] px-6 py-6 shadow-sm sm:px-8">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">My posts</h1>
          <p className="mt-2 max-w-2xl text-sm text-[var(--feed-placeholder)] sm:text-base">
            Create posts and manage what you have shared.
          </p>
        </header>
        <MyProfileFeed token={token} className="mt-8" />
      </div>
    </div>
  );
}
