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
      <div className="min-h-screen bg-[var(--background)] p-8 text-[var(--foreground)]">
        <p className="text-slate-600 dark:text-slate-400">You need to be signed in.</p>
        <Link href="/" className="mt-4 inline-block text-blue-600 hover:underline dark:text-blue-400">
          ← Back to messages
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full bg-[var(--background)] text-[var(--foreground)]">
      <div className="w-full px-4 py-6 sm:px-6 lg:px-8 xl:px-10 2xl:px-14">
        <Link
          href="/"
          className="inline-flex text-sm font-medium text-blue-600 hover:underline dark:text-blue-400"
        >
          ← Back to messages
        </Link>
        <header className="mt-6 border-b border-[color-mix(in_srgb,var(--foreground)_8%,transparent)] pb-6">
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
