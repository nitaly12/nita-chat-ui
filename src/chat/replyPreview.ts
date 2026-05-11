/** Fields used to build reply / quote preview text (message or nested parent). */
export type ReplyPreviewSource = {
  content?: string | null;
  contentSnippet?: string | null;
  mediaUrl?: string | null;
  mediaType?: "image" | "voice" | "file" | undefined;
};

function isLikelyVoiceJsonContent(content: string): boolean {
  const t = content.trim();
  if (!t.startsWith("{")) return false;
  try {
    const j = JSON.parse(t) as Record<string, unknown>;
    const typ = String(j.type ?? j.messageType ?? j.message_type ?? "").toLowerCase();
    return typ === "voice";
  } catch {
    return false;
  }
}

/**
 * Preview line for reply UI: prefers `contentSnippet`, then displayable `content`,
 * then attachment labels when there is media but no text.
 */
export function getReplyTargetPreviewText(target: ReplyPreviewSource): string {
  const snippet = (target.contentSnippet ?? "").trim();
  if (snippet) return snippet;
  let text = (target.content ?? "").trim();
  if (text && isLikelyVoiceJsonContent(text)) text = "";
  if (text) return text;
  const hasMedia =
    Boolean((target.mediaUrl ?? "").trim()) ||
    target.mediaType === "image" ||
    target.mediaType === "voice" ||
    target.mediaType === "file";
  if (hasMedia) {
    if (target.mediaType === "image") return "Photo Attachment";
    return "Attachment";
  }
  return "Attachment";
}
