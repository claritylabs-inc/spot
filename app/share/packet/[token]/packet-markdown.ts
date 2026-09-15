import type { Element, Root, RootContent } from "hast";
import type { RootContent as MarkdownNode } from "mdast";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";

export type PacketHeading = {
  id: string;
  label: string;
  depth: number;
  children: PacketHeading[];
};

function headingText(node: MarkdownNode): string {
  if ("children" in node) return node.children.map(headingText).join("");
  if ("value" in node) return node.value;
  if (node.type === "image" || node.type === "imageReference")
    return node.alt ?? "";
  return "";
}

export function preparePacketMarkdown(markdown: string) {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown);
  const headings: PacketHeading[] = [];
  const outline: PacketHeading[] = [];
  const parents: PacketHeading[] = [];
  const ids = new Set<string>();
  const headingIds = new Map<number | undefined, string>();

  function collect(nodes: MarkdownNode[]) {
    for (const node of nodes) {
      if (node.type === "heading") {
        const label = headingText(node).trim();
        const slug =
          label
            .toLowerCase()
            .replace(/[^\p{L}\p{N}]+/gu, "-")
            .replace(/^-|-$/g, "") || "section";
        const base = `packet-heading-${slug}`;
        let id = base;
        for (let suffix = 2; ids.has(id); suffix++) id = `${base}-${suffix}`;
        ids.add(id);
        headingIds.set(node.position?.start.offset, id);
        const heading: PacketHeading = {
          id,
          label: label || "Untitled section",
          depth: node.depth,
          children: [],
        };
        while (
          parents.length &&
          parents[parents.length - 1].depth >= node.depth
        )
          parents.pop();
        (parents.at(-1)?.children ?? outline).push(heading);
        parents.push(heading);
        headings.push(heading);
      }
      if ("children" in node) collect(node.children);
    }
  }
  collect(tree.children);

  function rehypePacketSections() {
    return (root: Root) => {
      function addAnchors(nodes: RootContent[]) {
        for (const node of nodes) {
          if (node.type !== "element") continue;
          if (/^h[1-6]$/.test(node.tagName)) {
            node.properties.id = headingIds.get(node.position?.start.offset);
          }
          addAnchors(node.children);
        }
      }
      addAnchors(root.children);
      const sections: Element[] = [];
      let section: Element | undefined;
      let hasBody = false;
      for (const node of root.children) {
        if (node.type === "doctype") continue;
        if (node.type === "text" && !node.value.trim()) continue;
        const heading =
          node.type === "element" && /^h[1-6]$/.test(node.tagName);
        const boundary =
          node.type === "element" && /^h[12]$/.test(node.tagName);
        if (!section || (boundary && hasBody)) {
          section = {
            type: "element",
            tagName: "section",
            properties: {},
            children: [],
          };
          sections.push(section);
          hasBody = false;
        }
        section.children.push(node);
        if (!heading) hasBody = true;
      }
      root.children = sections;
    };
  }

  return { headings, outline, rehypePacketSections };
}
