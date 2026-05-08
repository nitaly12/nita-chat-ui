import { Suspense } from "react";
import ResetPasswordForm from "./ResetPasswordForm";

function ResetFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#dde8e0] via-[#ebe4dc] to-[#d8e4f0] px-4">
      <p className="text-sm text-[#3d5248]">Loading…</p>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<ResetFallback />}>
      <ResetPasswordForm />
    </Suspense>
  );
}
