// @vitest-environment happy-dom

import { Editor } from "@tiptap/react";
import { describe, expect, it } from "vitest";
import { markdownEditorExtensions } from "../components/ui/markdown-editor-extensions";
import {
  equivalentMarkdown,
  replaceEditorBody,
  splitEditorMarkdown,
} from "../lib/markdown-editor";

function roundTrip(body: string) {
  const editor = new Editor({
    extensions: markdownEditorExtensions(),
    content: body,
    contentType: "markdown",
  });
  const result = editor.getMarkdown();
  editor.destroy();
  return result;
}

describe("Markdown document editing preserves authored content", () => {
  it("keeps YAML comments, quoting, nesting, visibility, and CRLF bytes when editing prose", () => {
    const prefix =
      '\uFEFF---\r\n# Manual metadata\r\nvisibility: private\r\nname: "Example"\r\ntags:\r\n  - renewal\r\n---  \r\n';
    const document = prefix + "## Old notes\r\nOriginal.";
    expect(splitEditorMarkdown(document).body).toBe(
      "## Old notes\r\nOriginal.",
    );
    expect(replaceEditorBody(document, "## Notes\nChanged.")).toBe(
      prefix + "## Notes\nChanged.",
    );
  });

  it("retains the body while incomplete YAML remains editable", () => {
    const result = splitEditorMarkdown(
      "---\naccount: [\n---\n## Notes\nKeep this.",
    );
    expect(result.error).toBeTruthy();
    expect(result.yaml).toBe("account: [\n");
    expect(result.body).toBe("## Notes\nKeep this.");
    expect(splitEditorMarkdown("---\naccount: [")).toMatchObject({
      body: "---\naccount: [",
      prefix: "",
    });
  });

  it("round-trips headings, emphasis, links, tables, lists, tasks, quotes, and code without losing meaning", () => {
    const body =
      '# Notes\n\n**Bold**, *italic*, ~~removed~~ and [evidence](https://example.com "Source").\n\n| Item | Value |\n| --- | --- |\n| Limit | $1,000 |\n\n- First\n- Second\n\n1. One\n2. Two\n\n- [x] Verified\n- [ ] Follow up\n\n> Quoted evidence\n\n```js\nconst x = 1;\n```';
    expect(equivalentMarkdown(body, roundTrip(body))).toBe(true);
  });

  it.each([
    "Keep this.\n\n<!-- Internal comment -->",
    "See [evidence][source].\n\n[source]: https://example.com",
    "A note[^1].\n\n[^1]: Source detail.",
    "<details><summary>Evidence</summary>Keep all of this.</details>",
  ])(
    "requires source editing when conversion would change authored constructs: %s",
    (body) => {
      expect(equivalentMarkdown(body, roundTrip(body))).toBe(false);
    },
  );
});
