"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { chatApi, readAxiosErrorMessage } from "@/chat/api";
import { applyDocumentLightDark } from "../../chat/profileTheme";
import {
  PROFILE_SETTINGS_LEGACY_COVER_KEY,
  PROFILE_SETTINGS_MAX_BIO,
} from "@/components/profile/profileSettingsConstants";
import { useProfileCoverDraft } from "@/components/profile/useProfileCoverDraft";
import { validateImageFile } from "@/components/profile/validateProfileImage";
import { WatercolorBackdrop } from "@/components/profile/WatercolorBackdrop";
import { SafeRemoteImage } from "@/components/ui/SafeRemoteImage";
import type { MyUserProfile } from "@/chat/types";

export type ProfileSettingsModalProps = {
  open: boolean;
  token: string;
  onClose: () => void;
  /** Fired after Save or after theme / photo changes that round-trip to the API (fresh profile). */
  onSaved?: (profile: MyUserProfile) => void;
};

type MenuKey = "notifications" | "security" | "language" | "deactivate" | null;

type ProfileImageLightbox = { src: string; label: string; variant: "cover" | "avatar" };

/** Reference UI: primary teal + soft gold accent on avatar ring. */
const SETTINGS_ACCENT = "#1E7F73";

function ChevronRight({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M9 18l6-6-6-6" />
    </svg>
  );
}

/**
 * Settings dialog: loads `GET /api/users/me` on open, uploads avatar via `/api/uploads` + JSON `PUT`.
 * Persists `displayName`, `bio`, `theme`, and `avatarUrl` via `PUT /api/users/me`.
 * Cover: pick a file for a local preview; on **Save changes** with a new cover, one **`PUT /api/user/profile/update`**
 * using **`FormData`**: `bio`, `theme`, `displayName`, and file part **`coverImage`** (no manual `Content-Type`).
 * Other saves use `PUT /api/users/me` then optional cover clear via the same multipart endpoint.
 */
export default function ProfileSettingsModal({ open, token, onClose, onSaved }: ProfileSettingsModalProps) {
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [bio, setBio] = useState("");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const cover = useProfileCoverDraft();
  const [uploadBusy, setUploadBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState<MenuKey>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const [imageLightbox, setImageLightbox] = useState<ProfileImageLightbox | null>(null);
  const coverFileInputRef = useRef<HTMLInputElement>(null);

  const applyProfile = useCallback((p: MyUserProfile) => {
    setDisplayName(p.displayName ?? p.username ?? "");
    setUsername((p.username ?? "").trim());
    setBio(p.bio ?? "");
    setTheme(p.theme);
    setAvatarUrl(p.avatarUrl);
    setCoverUrl(p.coverPhotoUrl ?? null);
    applyDocumentLightDark(p.theme);
  }, []);

  const loadProfile = useCallback(async () => {
    if (!open || !token) return;
    setLoadError(null);
    setFormError(null);
    cover.reset();
    setLoading(true);
    try {
      const p = await chatApi.getMyProfile(token);
      applyProfile(p);
      if (typeof window !== "undefined") {
        window.localStorage.removeItem(PROFILE_SETTINGS_LEGACY_COVER_KEY);
      }
    } catch (e) {
      setLoadError(readAxiosErrorMessage(e) ?? "Could not load profile.");
    } finally {
      setLoading(false);
    }
  }, [open, token, applyProfile, cover.reset]);

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
      setMenuOpen(null);
      setImageLightbox(null);
      cover.reset();
    }
  }, [open, cover.reset]);

  useEffect(() => {
    if (!imageLightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setImageLightbox(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [imageLightbox]);

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
    const err = validateImageFile(file, { maxBytes: 900_000, label: "profile photo" });
    if (err) {
      setFormError(err);
      return;
    }
    setFormError(null);
    setUploadBusy(true);
    try {
      const uploadedUrl = await chatApi.uploadProfileImageWithFetch(token, file);
      await chatApi.updateMyProfile(token, { avatarUrl: uploadedUrl });
      const refreshed = await chatApi.getMyProfile(token);
      applyProfile(refreshed);
      onSaved?.(refreshed);
    } catch (e) {
      setFormError(readAxiosErrorMessage(e) ?? "Photo upload failed.");
    } finally {
      setUploadBusy(false);
    }
  };

  const onCoverSelected = (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    const err = validateImageFile(file, { maxBytes: 2_000_000, label: "cover" });
    if (err) {
      setFormError(err);
      return;
    }
    setFormError(null);
    cover.pickFile(file);
  };

  const onCoverSecondary = () => {
    setFormError(null);
    cover.secondaryAction(Boolean(coverUrl));
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
    const bioTrim = bio.slice(0, PROFILE_SETTINGS_MAX_BIO).trim();
    setFormError(null);
    setSaveBusy(true);
    try {
      let lastProfile: MyUserProfile;
      if (cover.selectedFile) {
        lastProfile = await chatApi.saveProfileCoverWithUpload(token, {
          displayName: name,
          bio: bioTrim,
          theme,
          file: cover.selectedFile,
        });
      } else {
        await chatApi.updateMyProfile(token, { displayName: name, theme, bio: bioTrim });
        if (cover.removalPending) {
          lastProfile = await chatApi.updateUserProfileCover(token, {
            bio: bioTrim,
            theme,
            coverImageUrl: null,
          });
        } else {
          lastProfile = await chatApi.getMyProfile(token);
        }
      }
      applyProfile(lastProfile);
      cover.reset();
      onSaved?.(lastProfile);
      onClose();
    } catch (e) {
      setFormError(readAxiosErrorMessage(e) ?? "Save failed.");
    } finally {
      setSaveBusy(false);
    }
  };

  const toggleMenu = (key: Exclude<MenuKey, null>) => {
    setMenuOpen((prev) => (prev === key ? null : key));
  };

  const handleBioChange = (v: string) => {
    if (v.length <= PROFILE_SETTINGS_MAX_BIO) setBio(v);
    else setBio(v.slice(0, PROFILE_SETTINGS_MAX_BIO));
  };

  if (!open) return null;

  const coverPreviewVisible = cover.effectivePreviewUrl(coverUrl);
  const canActOnCover = cover.canUseSecondary(coverUrl);

  const cardClass =
    "rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)] dark:border-slate-700 dark:bg-slate-900/90 dark:shadow-none";

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 p-3 sm:p-5"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-[1.25rem] border border-slate-200/90 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-950 sm:rounded-3xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-settings-title"
        aria-busy={loading || saveBusy || uploadBusy || passwordBusy}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="relative shrink-0">
          {coverPreviewVisible ? (
            <button
              type="button"
              className="relative block h-[7.5rem] w-full cursor-zoom-in overflow-hidden p-0 outline-none transition hover:opacity-[0.97] focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent sm:h-40"
              aria-label="View cover photo full screen"
              disabled={loading || !!loadError}
              onClick={() =>
                setImageLightbox({
                  src: coverPreviewVisible,
                  label: "Cover photo",
                  variant: "cover",
                })
              }
            >
              <img
                src={coverPreviewVisible}
                alt=""
                className="h-full w-full object-cover"
                loading="lazy"
              />
            </button>
          ) : (
            <WatercolorBackdrop className="h-[7.5rem] w-full sm:h-40" />
          )}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/45 via-black/15 to-transparent" />
          <div className="absolute inset-x-0 top-0 flex items-center justify-between gap-3 px-4 pt-3 sm:px-5 sm:pt-4">
            <span className="w-9 shrink-0 sm:w-10" aria-hidden />
            <h2
              id="profile-settings-title"
              className="flex-1 text-center text-xl font-bold tracking-tight text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.45)]"
            >
              Settings
            </h2>
            <button
              type="button"
              className="pointer-events-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/20 text-lg font-light leading-none text-white shadow-md ring-1 ring-white/35 backdrop-blur-sm transition hover:bg-white/30"
              aria-label="Close"
              onClick={onClose}
            >
              ×
            </button>
          </div>
        </div>

        <div className="relative z-10 -mt-14 flex justify-center sm:-mt-[4.25rem]">
          <div className="relative">
            {avatarUrl ? (
              <button
                type="button"
                className="relative block cursor-zoom-in rounded-full p-0 outline-none ring-[#1E7F73]/40 ring-offset-2 ring-offset-white transition hover:opacity-[0.97] focus-visible:ring-2 dark:ring-offset-slate-950"
                aria-label="View profile photo full screen"
                disabled={loading || !!loadError}
                onClick={() =>
                  setImageLightbox({
                    src: avatarUrl,
                    label: "Profile photo",
                    variant: "avatar",
                  })
                }
              >
                <div className="relative flex h-[7.25rem] w-[7.25rem] items-center justify-center overflow-hidden rounded-full border-4 border-white bg-slate-100 shadow-lg ring-2 ring-slate-200 dark:border-slate-800 dark:bg-slate-800 dark:ring-slate-600 sm:h-[7.75rem] sm:w-[7.75rem]">
                  <SafeRemoteImage
                    src={avatarUrl}
                    alt=""
                    className="h-full w-full object-cover"
                    variant="avatar"
                    loading="eager"
                    decoding="async"
                  />
                </div>
              </button>
            ) : (
              <div className="relative flex h-[7.25rem] w-[7.25rem] items-center justify-center overflow-hidden rounded-full border-4 border-white bg-slate-100 shadow-lg ring-2 ring-slate-200 dark:border-slate-800 dark:bg-slate-800 dark:ring-slate-600 sm:h-[7.75rem] sm:w-[7.75rem]">
                {loading ? (
                  <span className="text-sm text-slate-500">…</span>
                ) : (
                  <span className="text-3xl font-semibold text-slate-500 dark:text-slate-300">
                    {(displayName || "?").slice(0, 1).toUpperCase()}
                  </span>
                )}
              </div>
            )}
            <label
              className="absolute -bottom-0.5 -right-0.5 z-10 flex h-9 w-9 cursor-pointer items-center justify-center rounded-full text-sm text-white shadow-md transition hover:opacity-95"
              style={{ backgroundColor: SETTINGS_ACCENT }}
            >
              <span aria-hidden>📷</span>
              <span className="sr-only">Change profile photo</span>
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
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-white dark:bg-slate-950">
          <div className="mx-auto max-w-xl space-y-5 px-4 pb-2 pt-1 sm:px-6 sm:pt-2">
            {/* Profile fields */}
            <div className={`${cardClass} space-y-5`}>
              {loadError ? (
                <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200">
                  {loadError}
                </p>
              ) : null}

              <p className="text-center text-xs font-medium text-slate-500 dark:text-slate-400">
                {uploadBusy
                  ? "Uploading…"
                  : "Tap your photo to view it full screen, or the camera to change it."}
              </p>

              <div className="space-y-2">
                <label htmlFor="profile-display-name" className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  Name
                </label>
                <input
                  id="profile-display-name"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-[#1E7F73] focus:bg-white focus:ring-2 focus:ring-[#1E7F73]/25 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-teal-500"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Your name"
                  autoComplete="nickname"
                  disabled={loading || !!loadError}
                />
              </div>

              <div className="space-y-2">
                <span className="text-sm font-bold text-slate-900 dark:text-slate-100">Username</span>
                <div className="flex w-full items-center overflow-hidden rounded-xl border border-slate-200 bg-slate-100/90 dark:border-slate-600 dark:bg-slate-800/80">
                  <span className="shrink-0 px-3 text-sm font-semibold text-slate-500 dark:text-slate-400" aria-hidden>
                    @
                  </span>
                  <input
                    readOnly
                    className="min-w-0 flex-1 cursor-default bg-transparent py-3 pr-4 text-sm text-slate-800 outline-none dark:text-slate-200"
                    value={username || ""}
                    aria-label="Username"
                    disabled={loading || !!loadError}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label htmlFor="profile-bio" className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  Bio
                </label>
                <div className="relative">
                  <textarea
                    id="profile-bio"
                    rows={5}
                    className="w-full resize-y rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-3 pb-8 text-sm text-slate-900 outline-none transition focus:border-[#1E7F73] focus:bg-white focus:ring-2 focus:ring-[#1E7F73]/25 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-teal-500"
                    value={bio}
                    onChange={(e) => handleBioChange(e.target.value)}
                    placeholder="Tell people about you…"
                    disabled={loading || !!loadError}
                  />
                  <span className="pointer-events-none absolute bottom-2 right-3 text-xs text-slate-400 dark:text-slate-500">
                    {bio.length} characters
                  </span>
                </div>
              </div>

              {/* <details className="rounded-xl border border-slate-200/80 bg-slate-50/50 px-3 py-2 text-xs text-slate-600 dark:border-slate-600 dark:bg-slate-800/40 dark:text-slate-400">
                <summary className="cursor-pointer font-semibold text-slate-700 dark:text-slate-300">
                  Branding kit prompt (for designers / AI)
                </summary>
                <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words font-sans text-[11px] leading-relaxed">
                  {PROFILE_BRANDING_KIT_PROMPT}
                </pre>
              </details> */}
            </div>

            <div className={cardClass}>
              <p className="text-sm font-bold text-slate-900 dark:text-slate-100">Edit cover photo</p>
                <div className="mt-4 flex flex-col gap-4">
                  <div className="aspect-[3/1] w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-100 dark:border-slate-600 dark:bg-slate-800">
                    {coverPreviewVisible ? (
                      <button
                        type="button"
                        className="relative block h-full w-full cursor-zoom-in p-0 text-left outline-none ring-[#1E7F73] ring-offset-2 transition hover:opacity-[0.98] focus-visible:ring-2 dark:ring-offset-slate-900"
                        aria-label="View cover photo full screen"
                        disabled={loading || !!loadError}
                        onClick={() =>
                          setImageLightbox({
                            src: coverPreviewVisible,
                            label: "Cover photo",
                            variant: "cover",
                          })
                        }
                      >
                        <SafeRemoteImage
                          src={coverPreviewVisible}
                          alt=""
                          className="h-full w-full object-cover"
                          variant="cover"
                          loading="lazy"
                        />
                      </button>
                    ) : (
                      <WatercolorBackdrop className="h-full w-full" />
                    )}
                  </div>
                  <input
                    ref={coverFileInputRef}
                    id="profile-settings-cover-file"
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    tabIndex={-1}
                    disabled={saveBusy || loading || !!loadError}
                    onChange={(e) => {
                      onCoverSelected(e.target.files);
                      e.target.value = "";
                    }}
                  />
                  <div className="flex w-full flex-col gap-2">
                    <button
                      type="button"
                      className="inline-flex w-full cursor-pointer items-center justify-center rounded-2xl bg-[#1E7F73] px-4 py-3 text-center text-sm font-semibold text-white shadow-sm transition hover:bg-[#196a60] disabled:opacity-50"
                      disabled={saveBusy || loading || !!loadError}
                      onClick={() => coverFileInputRef.current?.click()}
                    >
                      Change cover photo
                    </button>
                    <button
                      type="button"
                      className="w-full rounded-2xl bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-200/90 disabled:opacity-50 dark:bg-slate-700 dark:text-slate-100 dark:hover:bg-slate-600"
                      disabled={!canActOnCover || saveBusy || loading || !!loadError}
                      onClick={onCoverSecondary}
                    >
                      {cover.secondaryLabel()}
                    </button>
                    <p className="text-center text-xs text-slate-500 dark:text-slate-400">
                      Preview updates immediately. Your cover is sent when you tap Save changes.
                    </p>
                  </div>
                </div>
              </div>

              <div className={`${cardClass} flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between`}>
                <span className="text-sm font-bold text-slate-900 dark:text-slate-100">Appearance</span>
                <div className="flex w-full max-w-none flex-1 rounded-2xl border border-slate-200 p-1 dark:border-slate-600 sm:max-w-[240px]">
                  {(["light", "dark"] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      className={`flex-1 rounded-xl py-2.5 text-sm font-semibold capitalize transition ${
                        theme === t
                          ? "bg-[#1E7F73] text-white shadow-sm"
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

              <div className={`${cardClass} overflow-hidden p-0`}>
                <ul className="divide-y divide-slate-100 dark:divide-slate-700">
                  <li>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left text-sm font-medium text-slate-800 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800/80"
                      onClick={() => toggleMenu("notifications")}
                    >
                      Notifications
                      <ChevronRight
                        className={`shrink-0 text-slate-400 transition ${menuOpen === "notifications" ? "rotate-90" : ""}`}
                      />
                    </button>
                    {menuOpen === "notifications" ? (
                      <div className="border-t border-slate-100 bg-slate-50/80 px-5 py-3 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-400">
                        Notification preferences are coming soon.
                      </div>
                    ) : null}
                  </li>
                  <li>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left text-sm font-medium text-slate-800 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800/80"
                      onClick={() => toggleMenu("language")}
                    >
                      <span>
                        Language <span className="font-normal text-slate-500">(English)</span>
                      </span>
                      <ChevronRight
                        className={`shrink-0 text-slate-400 transition ${menuOpen === "language" ? "rotate-90" : ""}`}
                      />
                    </button>
                    {menuOpen === "language" ? (
                      <div className="border-t border-slate-100 bg-slate-50/80 px-5 py-3 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-400">
                        Only English is available for now.
                      </div>
                    ) : null}
                  </li>
                  <li>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left text-sm font-medium text-slate-800 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800/80"
                      onClick={() => toggleMenu("security")}
                    >
                      Security &amp; Login
                      <ChevronRight
                        className={`shrink-0 text-slate-400 transition ${menuOpen === "security" ? "rotate-90" : ""}`}
                      />
                    </button>
                    {menuOpen === "security" ? (
                      <div className="space-y-3 border-t border-slate-100 bg-slate-50/80 px-5 py-4 dark:border-slate-700 dark:bg-slate-800/50">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                          Change password
                        </p>
                        <input
                          className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-[#1E7F73] focus:ring-2 focus:ring-[#1E7F73]/20 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                          type="password"
                          autoComplete="current-password"
                          placeholder="Current password"
                          value={currentPassword}
                          onChange={(e) => setCurrentPassword(e.target.value)}
                          disabled={loading || !!loadError || passwordBusy}
                        />
                        <input
                          className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-[#1E7F73] focus:ring-2 focus:ring-[#1E7F73]/20 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                          type="password"
                          autoComplete="new-password"
                          placeholder="New password"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          disabled={loading || !!loadError || passwordBusy}
                        />
                        <input
                          className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-[#1E7F73] focus:ring-2 focus:ring-[#1E7F73]/20 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
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
                          className="w-full rounded-xl bg-[#1E7F73] py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#196a60] disabled:opacity-50"
                          disabled={loading || !!loadError || passwordBusy}
                          onClick={() => void onChangePassword()}
                        >
                          {passwordBusy ? "Updating…" : "Update password"}
                        </button>
                      </div>
                    ) : null}
                  </li>
                  <li>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left text-sm font-medium text-slate-800 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800/80"
                      onClick={() => toggleMenu("deactivate")}
                    >
                      Deactivate account
                      <ChevronRight
                        className={`shrink-0 text-slate-400 transition ${menuOpen === "deactivate" ? "rotate-90" : ""}`}
                      />
                    </button>
                    {menuOpen === "deactivate" ? (
                      <div className="border-t border-slate-100 bg-amber-50/80 px-5 py-3 text-xs text-amber-950 dark:border-slate-700 dark:bg-amber-950/30 dark:text-amber-100">
                        Account deactivation is not wired yet. Contact support if you need to close your account.
                      </div>
                    ) : null}
                  </li>
                </ul>
              </div>
          </div>

          {formError ? (
            <p className="px-4 pb-2 text-center text-sm text-red-600 dark:text-red-400 sm:px-6">{formError}</p>
          ) : null}

          <div className="sticky bottom-0 flex flex-col gap-3 border-t border-slate-200/80 bg-white/95 px-4 py-4 backdrop-blur-md dark:border-slate-700 dark:bg-slate-950/95 sm:px-6">
            <button
              type="button"
              className="w-full rounded-2xl bg-[#1E7F73] py-3.5 text-sm font-semibold text-white shadow-md transition hover:bg-[#196a60] disabled:opacity-50"
              disabled={saveBusy || loading || !!loadError}
              onClick={() => void onSave()}
            >
              {saveBusy ? "Saving…" : "Save changes"}
            </button>
            <button
              type="button"
              className="w-full rounded-2xl border border-slate-200 bg-white py-3.5 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              onClick={onClose}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>

      {imageLightbox ? (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/88 p-4 sm:p-8"
          role="dialog"
          aria-modal="true"
          aria-label={imageLightbox.label}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setImageLightbox(null);
          }}
        >
          <button
            type="button"
            className="absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-2xl leading-none text-white ring-1 ring-white/30 backdrop-blur-sm transition hover:bg-white/20"
            aria-label="Close"
            onClick={() => setImageLightbox(null)}
          >
            ×
          </button>
          <SafeRemoteImage
            src={imageLightbox.src}
            alt=""
            variant={imageLightbox.variant === "avatar" ? "avatar" : "cover"}
            className={`max-h-[min(92vh,100%)] max-w-full shadow-2xl ${
              imageLightbox.variant === "avatar"
                ? "max-h-[min(70vh,560px)] max-w-[min(70vh,560px)] object-cover"
                : "object-contain"
            }`}
            loading="eager"
            decoding="async"
          />
        </div>
      ) : null}
    </div>
  );
}
