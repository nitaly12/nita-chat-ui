export type ImagePickRules = {
  maxBytes: number;
  /** e.g. "Profile photo" / "Cover" — used in error strings */
  label: string;
};

/** Returns an error message, or `null` if the file is acceptable. */
export function validateImageFile(file: File, rules: ImagePickRules): string | null {
  if (!file.type.startsWith("image/")) {
    return `Please choose an image file for ${rules.label}.`;
  }
  if (file.size > rules.maxBytes) {
    const mb = (rules.maxBytes / 1_000_000).toFixed(1).replace(/\.0$/, "");
    return `Use an image under about ${mb} MB for ${rules.label}.`;
  }
  return null;
}
