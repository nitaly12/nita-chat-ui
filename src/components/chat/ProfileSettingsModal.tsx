"use client";

import { useCallback, useEffect, useState } from "react";
import { chatApi, readAxiosErrorMessage } from "@/chat/api";
import { applyDocumentLightDark } from "../../chat/profileTheme";
import type { MyUserProfile } from "@/chat/types";

export type ProfileSettingsModalProps = {
  open: boolean;
  token: string;
  onClose: () => void;
  /** Fired after Save or after theme / photo changes that round-trip to the API (fresh profile). */
  onSaved?: (profile: MyUserProfile) => void;
};

/**
 * Profile settings dialog: loads `GET /api/users/me` on open, uploads photos immediately,
 * persists theme + display name via `PUT /api/users/me`. Theme toggles update the DB and `html.dark`.
 * No profile data is read from localStorage — always from the API.
 */
export default function ProfileSettingsModal({ open, token, onClose, onSaved }: ProfileSettingsModalProps) {
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);

  const applyProfile = useCallback((p: MyUserProfile) => {
    setDisplayName(p.displayName ?? p.username ?? "");
    setTheme(p.theme);
    setAvatarUrl(p.avatarUrl);
    applyDocumentLightDark(p.theme);
  }, []);

  const loadProfile = useCallback(async () => {
    if (!open || !token) return;
    setLoadError(null);
    setFormError(null);
    setLoading(true);
    try {
      const p = await chatApi.getMyProfile(token);
      applyProfile(p);
    } catch (e) {
      setLoadError(readAxiosErrorMessage(e) ?? "Could not load profile.");
    } finally {
      setLoading(false);
    }
  }, [open, token, applyProfile]);

  useEffect(() => {
    if (!open || !token) return;
    void loadProfile();
  }, [open, token, loadProfile]);

  useEffect(() => {
    if (!open) {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordMessage(null);
    }
  }, [open]);

  const persistThemeToApi = useCallback(
    async (next: "light" | "dark", previous: "light" | "dark") => {
      try {
        await chatApi.updateMyProfile(token, { theme: next });
        const refreshed = await chatApi.getMyProfile(token);
        applyProfile(refreshed);
        onSaved?.(refreshed);
      } catch (e) {
        setTheme(previous);
        applyDocumentLightDark(previous);
        setFormError(readAxiosErrorMessage(e) ?? "Could not save theme.");
      }
    },
    [token, applyProfile, onSaved]
  );

  const onThemeSelect = (next: "light" | "dark") => {
    if (next === theme) return;
    const previous = theme;
    setTheme(next);
    applyDocumentLightDark(next);
    void persistThemeToApi(next, previous);
  };

  const onAvatarSelected = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setFormError("Please choose an image file.");
      return;
    }
    if (file.size > 900_000) {
      setFormError("Use an image under about 900 KB.");
      return;
    }
    setFormError(null);
    setUploadBusy(true);
    try {
      const uploadedUrl = await chatApi.uploadProfileImageWithFetch(token, file);
      await chatApi.updateMyProfile(token, { avatarUrl: uploadedUrl });
      const refreshed = await chatApi.getMyProfile(token);
      setAvatarUrl(refreshed.avatarUrl);
      onSaved?.(refreshed);
    } catch (e) {
      setFormError(readAxiosErrorMessage(e) ?? "Photo upload failed.");
    } finally {
      setUploadBusy(false);
    }
  };

  const onChangePassword = async () => {
    const cur = currentPassword;
    const next = newPassword.trim();
    const confirm = confirmPassword.trim();
    if (!cur || !next) {
      setPasswordMessage("Enter your current password and a new password.");
      return;
    }
    if (next.length < 8) {
      setPasswordMessage("New password must be at least 8 characters.");
      return;
    }
    if (next !== confirm) {
      setPasswordMessage("New password and confirmation do not match.");
      return;
    }
    setPasswordMessage(null);
    setPasswordBusy(true);
    try {
      await chatApi.changePassword(token, cur, next);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordMessage("Password updated.");
    } catch (e) {
      setPasswordMessage(readAxiosErrorMessage(e) ?? "Could not change password.");
    } finally {
      setPasswordBusy(false);
    }
  };

  const onSave = async () => {
    const name = displayName.trim();
    if (!name) {
      setFormError("Display name is required.");
      return;
    }
    setFormError(null);
    setSaveBusy(true);
    try {
      await chatApi.updateMyProfile(token, { displayName: name, theme });
      const refreshed = await chatApi.getMyProfile(token);
      applyProfile(refreshed);
      onSaved?.(refreshed);
      onClose();
    } catch (e) {
      setFormError(readAxiosErrorMessage(e) ?? "Save failed.");
    } finally {
      setSaveBusy(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-[420px] overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-2xl dark:border-slate-600 dark:bg-slate-900"
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-settings-title"
        aria-busy={loading || saveBusy || uploadBusy || passwordBusy}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white px-6 py-2 dark:border-slate-700 dark:from-slate-900 dark:to-slate-900">
          <div className="flex items-center justify-between gap-3">
            <h2 id="profile-settings-title" className="text-lg font-semibold tracking-tight text-slate-900 dark:text-white">
              Profile settings
            </h2>
            <button
              type="button"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-200/80 text-slate-600 hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600"
              aria-label="Close"
              onClick={onClose}
            >
              ×
            </button>
          </div>
        </div>

        <div className="space-y-2 px-6 py-6">
          {loadError ? (
            <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200">
              {loadError}
            </p>
          ) : null}

          <div className="flex flex-col items-center">
            <div className="relative">
              <div className="flex h-28 w-28 items-center justify-center overflow-hidden rounded-full border-4 border-white bg-slate-100 shadow-lg ring-2 ring-slate-200 dark:border-slate-800 dark:bg-slate-800 dark:ring-slate-600">
                {loading ? (
                  <span className="text-sm text-slate-500">…</span>
                ) : avatarUrl ? (
                  <img
                    src={avatarUrl}
                    alt=""
                    className="h-full w-full object-cover"
                    loading="eager"
                    decoding="async"
                  />
                ) : (
                  <span className="text-3xl font-semibold text-slate-500 dark:text-slate-300">
                    {(displayName || "?").slice(0, 1).toUpperCase()}
                  </span>
                )}
              </div>
              <label className="absolute bottom-0 right-0 flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-blue-600 text-lg text-white shadow-md ring-2 ring-white hover:bg-blue-700 dark:ring-slate-900">
                <span aria-hidden>📷</span>
                <input
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  disabled={uploadBusy || loading || !!loadError}
                  onChange={(e) => {
                    void onAvatarSelected(e.target.files);
                    e.target.value = "";
                  }}
                />
              </label>
            </div>
            <p className="mt-3 text-center text-xs text-slate-500 dark:text-slate-400">
              {uploadBusy ? "Uploading…" : "New photos upload immediately to the server."}
            </p>
          </div>

          <div className="space-y-2">
            <label htmlFor="profile-display-name" className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Name
            </label>
            <input
              id="profile-display-name"
              className="w-full rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm text-slate-900 outline-none ring-0 transition focus:border-blue-500 focus:bg-white dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-blue-400"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Your name"
              autoComplete="nickname"
              disabled={loading || !!loadError}
            />
          </div>

          <div className="space-y-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Appearance
            </span>
            <div className="flex rounded-xl border border-slate-200 p-1 dark:border-slate-600">
              {(["light", "dark"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`flex-1 rounded-lg py-2.5 text-sm font-semibold capitalize transition ${
                    theme === t
                      ? "bg-blue-600 text-white shadow dark:bg-blue-500"
                      : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                  }`}
                  disabled={loading || !!loadError}
                  onClick={() => onThemeSelect(t)}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-600 dark:bg-slate-800/50">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Change password
            </span>
            <input
              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-[#7d9b84] focus:ring-2 focus:ring-[#7d9b84]/30 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
              type="password"
              autoComplete="current-password"
              placeholder="Current password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              disabled={loading || !!loadError || passwordBusy}
            />
            <input
              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-[#7d9b84] focus:ring-2 focus:ring-[#7d9b84]/30 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
              type="password"
              autoComplete="new-password"
              placeholder="New password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              disabled={loading || !!loadError || passwordBusy}
            />
            <input
              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-[#7d9b84] focus:ring-2 focus:ring-[#7d9b84]/30 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
              type="password"
              autoComplete="new-password"
              placeholder="Confirm new password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={loading || !!loadError || passwordBusy}
            />
            {passwordMessage ? (
              <p
                className={`text-sm ${
                  passwordMessage.startsWith("Password updated")
                    ? "text-emerald-700 dark:text-emerald-400"
                    : "text-red-600 dark:text-red-400"
                }`}
              >
                {passwordMessage}
              </p>
            ) : null}
            <button
              type="button"
              className="w-full rounded-xl bg-[#5a7a62] py-2.5 text-sm font-semibold text-white shadow hover:bg-[#4d6b54] disabled:opacity-50 dark:bg-[#6d8a74] dark:hover:bg-[#5a7a62]"
              disabled={loading || !!loadError || passwordBusy}
              onClick={() => void onChangePassword()}
            >
              {passwordBusy ? "Updating…" : "Update password"}
            </button>
          </div> */}

          {formError ? <p className="text-sm text-red-600 dark:text-red-400">{formError}</p> : null}

          <div className="flex gap-3 border-t border-slate-100 pt-4 dark:border-slate-700">
            <button
              type="button"
              className="flex-1 rounded-xl border border-slate-200 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="button"
              className="flex-1 rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white shadow hover:bg-blue-700 disabled:opacity-50 dark:bg-blue-500 dark:hover:bg-blue-600"
              disabled={saveBusy || loading || !!loadError}
              onClick={() => void onSave()}
            >
              {saveBusy ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
