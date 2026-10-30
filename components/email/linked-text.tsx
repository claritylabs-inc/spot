import { Fragment } from "react";

import { findTextLinks } from "@/lib/text-links";

/** Plain text with its web addresses as links that open in a new tab. */
export function LinkedText({ text }: { text: string }) {
  const links = findTextLinks(text);
  if (links.length === 0) return text;
  let last = 0;
  return links.map((link, index) => {
    const before = text.slice(last, link.start);
    last = link.end;
    return (
      <Fragment key={link.start}>
        {before}
        <a
          href={link.href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-700 underline underline-offset-2 dark:text-blue-300"
        >
          {text.slice(link.start, link.end)}
        </a>
        {index === links.length - 1 ? text.slice(link.end) : null}
      </Fragment>
    );
  });
}
