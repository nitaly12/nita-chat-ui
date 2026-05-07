/** Apply Tailwind `dark:` mode from API-backed preference only (no localStorage). */
export function applyDocumentLightDark(theme: "light" | "dark"): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", theme === "dark");
}
