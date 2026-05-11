/** Stable DOM id for a chat message row (`msg-` + safe fragment). */
export function messageElementDomId(messageId: string): string {
  return `msg-${String(messageId).replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

const HIGHLIGHT_MS = 2200;

function findMessageRowEl(parentId: string): HTMLElement | null {
  const trimmed = String(parentId).trim();
  if (!trimmed) return null;
  const byId = document.getElementById(messageElementDomId(trimmed));
  if (byId) return byId;
  for (const n of document.querySelectorAll<HTMLElement>("[data-msg-id]")) {
    if (n.getAttribute("data-msg-id") === trimmed) return n;
  }
  return null;
}

/** Nearest scrollable ancestor (e.g. chat message list `overflow-y-auto`). */
function findScrollParent(el: HTMLElement): HTMLElement | null {
  let p: HTMLElement | null = el.parentElement;
  while (p && p !== document.documentElement) {
    const { overflowY } = getComputedStyle(p);
    if (overflowY === "auto" || overflowY === "scroll") return p;
    p = p.parentElement;
  }
  return null;
}

function scrollRowIntoScroller(el: HTMLElement): void {
  const scroller = findScrollParent(el);
  if (!scroller) {
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  const elRect = el.getBoundingClientRect();
  const scRect = scroller.getBoundingClientRect();
  const centerDelta =
    elRect.top + elRect.height / 2 - (scRect.top + scRect.height / 2);
  const maxTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  const nextTop = Math.min(Math.max(0, scroller.scrollTop + centerDelta), maxTop);
  scroller.scrollTo({ top: nextTop, behavior: "smooth" });
}

/**
 * Scrolls the message row into view and briefly outlines it. Uses the same id scheme as
 * {@link messageElementDomId}, plus a `data-msg-id` attribute fallback when ids differ only by formatting.
 */
export function scrollToMessage(parentId: string): void {
  const el = findMessageRowEl(parentId);
  if (!el) return;
  scrollRowIntoScroller(el);
  const prevOutline = el.style.outline;
  const prevOffset = el.style.outlineOffset;
  const prevRadius = el.style.borderRadius;
  const prevTransition = el.style.transition;
  el.style.transition = "outline 0.2s, outline-offset 0.2s";
  el.style.outline = "rgba(251, 191, 36, 0.95) solid 1px";
  el.style.outlineOffset = "1px";
  el.style.borderRadius = "0.8rem";
  window.setTimeout(() => {
    el.style.outline = prevOutline;
    el.style.outlineOffset = prevOffset;
    el.style.borderRadius = prevRadius;
    el.style.transition = prevTransition;
  }, HIGHLIGHT_MS);
}
