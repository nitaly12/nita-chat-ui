import { Fragment } from "react";

/** Renders plain text with `#hashtags` highlighted like the feed mockup. */
export function PostContentWithHashtags({
  text,
  className = "",
}: {
  text: string;
  className?: string;
}) {
  const parts = text.split(/(#[\w\u00c0-\u024f]+)/gi);
  return (
    <p className={className}>
      {parts.map((part, i) => {
        if (/^#[\w\u00c0-\u024f]+$/i.test(part)) {
          return (
            <span
              key={i}
              className="font-medium text-blue-600 hover:underline dark:text-blue-400"
            >
              {part}
            </span>
          );
        }
        return <Fragment key={i}>{part}</Fragment>;
      })}
    </p>
  );
}
