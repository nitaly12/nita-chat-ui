/** Spring `UserProfileController`-style profile update (`multipart` `PUT`). */
export const USER_PROFILE_COVER_UPDATE_PATH = "/api/user/profile/update";

/** Multipart part for the cover file or clear URL / empty string (Spring `@RequestPart` / `@RequestParam`). */
export const USER_PROFILE_COVER_FORM_FIELD = "coverImage";

export type PutUserProfileCoverResult = {
  ok: boolean;
  status: number;
  bodyText: string;
};

export type UserProfileCoverPutFormFields = {
  bio: string;
  theme: string;
  /** New cover file from the file input. */
  coverImage: File | string;
  /** Optional; sent so display name can persist in the same request as the cover. */
  displayName?: string;
};

/**
 * Builds a URL suitable for `fetch`: absolute `http(s)://…` when the env origin is absolute;
 * in the browser, relative origins like `/backend` become `http://localhost:3000/backend/…`.
 */
export function resolveChatBackendFetchUrl(origin: string, pathWithQuery: string): string {
  const base = origin.replace(/\/+$/, "");
  const path = pathWithQuery.startsWith("/") ? pathWithQuery : `/${pathWithQuery}`;
  const joined = `${base}${path}`;
  if (/^https?:\/\//i.test(base)) {
    return joined;
  }
  if (typeof window !== "undefined" && window.location?.origin) {
    return new URL(joined, window.location.origin).href;
  }
  return joined;
}

/**
 * `PUT /api/user/profile/update` with `multipart/form-data`.
 * Appends `bio`, `theme`, and `coverImage` (file or string). Does **not** set `Content-Type`
 * so the browser sets `multipart/form-data` with the correct boundary.
 */
export async function putUserProfileCoverUpdate(
  origin: string,
  token: string,
  fields: UserProfileCoverPutFormFields
): Promise<PutUserProfileCoverResult> {
  const url = resolveChatBackendFetchUrl(origin, USER_PROFILE_COVER_UPDATE_PATH);
  const form = new FormData();
  form.append("bio", fields.bio ?? "");
  form.append("theme", fields.theme ?? "light");
  if (fields.displayName != null && String(fields.displayName).trim() !== "") {
    form.append("displayName", String(fields.displayName).trim());
  }
  if (fields.coverImage instanceof File) {
    form.append(USER_PROFILE_COVER_FORM_FIELD, fields.coverImage, fields.coverImage.name || "cover.jpg");
  } else {
    form.append(USER_PROFILE_COVER_FORM_FIELD, fields.coverImage);
  }
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
    body: form,
  });
  const bodyText = await res.text().catch(() => "");
  return { ok: res.ok, status: res.status, bodyText };
}
