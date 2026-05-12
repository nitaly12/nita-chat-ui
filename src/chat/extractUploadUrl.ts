/**
 * Reads a media URL from typical Spring / generic upload JSON responses.
 */
export function extractUploadUrlFromResponse(body: Record<string, unknown>): string {
  const uploadedUrlRaw =
    body.url ??
    body.fileUrl ??
    body.mediaUrl ??
    body.path ??
    body.location ??
    body.data;
  const uploadedUrl =
    typeof uploadedUrlRaw === "string" && uploadedUrlRaw.trim().length > 0
      ? uploadedUrlRaw.trim()
      : "";
  return uploadedUrl;
}
