// @vitest-environment happy-dom

import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { expect, test } from "vitest";
import { preparePacketMarkdown } from "../app/share/packet/[token]/packet-markdown";

test("section cards preserve cross-section references, quoted evidence, tables, and code", () => {
  const markdown = `Introductory evidence before any heading.

## Coverage
See the [report][source]. Do **not** bind without authorization.

| Coverage | Limit |
| --- | --- |
| Property | $2,800,000 |

> ### Quoted condition
> Subject to inspection.

\`\`\`md
## This is code, not a section
\`\`\`

## Documents
[source]: https://example.com/report.pdf

![Roof report][source]
`;
  const packet = preparePacketMarkdown(markdown);
  function render(transformed: boolean) {
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={transformed ? [packet.rehypePacketSections] : []}
      >
        {markdown}
      </Markdown>,
    );
    return container;
  }
  const original = render(false);
  const cards = render(true);
  const evidence = (container: HTMLElement) =>
    Array.from(
      container.querySelectorAll("p, th, td, pre, a, img"),
      (node) => ({
        tag: node.tagName,
        text: node.textContent,
        href: node.getAttribute("href"),
        src: node.getAttribute("src"),
      }),
    );
  expect(evidence(cards)).toEqual(evidence(original));
  expect(cards.querySelector("a")?.href).toBe("https://example.com/report.pdf");
  expect(packet.headings.map((heading) => heading.label)).toEqual([
    "Coverage",
    "Quoted condition",
    "Documents",
  ]);
  expect(cards.querySelector("blockquote h3")?.id).toBe(packet.headings[1].id);
});

test("duplicate and non-ASCII headings remain independently addressable, including skipped levels", () => {
  const markdown =
    "## Évidence\nA\n\n#### Roof\nB\n\n## Évidence\nC\n\n## Évidence-2\nD\n\n## Files\nE";
  const packet = preparePacketMarkdown(markdown);
  expect(new Set(packet.headings.map((heading) => heading.id)).size).toBe(5);
  expect(packet.outline[0].children[0].label).toBe("Roof");
  const container = document.createElement("div");
  container.innerHTML = renderToStaticMarkup(
    <Markdown rehypePlugins={[packet.rehypePacketSections]}>
      {markdown}
    </Markdown>,
  );
  for (const heading of packet.headings) {
    expect(container.querySelector(`[id="${heading.id}"]`)?.textContent).toBe(
      heading.label,
    );
    expect(heading.id).not.toBe("packet-files");
  }
});
