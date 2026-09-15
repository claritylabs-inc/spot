"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { yamlFrontmatter } from "@codemirror/lang-yaml";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { Bold, Heading2, Italic, Link, List } from "lucide-react";
import { ProseMarkdown } from "@/components/prose-markdown";
import { PillButton } from "@/components/ui/pill-button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { parseMarkdownDocument } from "@/convex/lib/markdownDocument";
import { cn } from "@/lib/utils";
import { editableMirrorTypographyStyle, typeStyle } from "@/lib/typography";

const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "var(--background)",
    color: "var(--foreground)",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    overflow: "auto",
    ...editableMirrorTypographyStyle,
  },
  ".cm-content": { padding: "24px 0", caretColor: "var(--foreground)" },
  ".cm-line": { padding: "0 24px" },
  ".cm-cursor": { borderLeftColor: "var(--foreground)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
    {
      backgroundColor: "var(--accent)",
    },
});

const highlighting = syntaxHighlighting(
  HighlightStyle.define([
    { tag: [tags.heading, tags.strong], class: typeStyle("body.strong") },
    {
      tag: [tags.meta, tags.processingInstruction, tags.comment],
      color: "var(--muted-foreground)",
    },
    {
      tag: [tags.link, tags.url],
      color: "var(--foreground)",
      textDecoration: "underline",
    },
    {
      tag: [tags.propertyName, tags.string, tags.number, tags.bool],
      color: "var(--foreground)",
    },
  ]),
);

const formats = [
  {
    label: "Heading",
    icon: Heading2,
    before: "## ",
    after: "",
    placeholder: "Heading",
    line: true,
  },
  {
    label: "Bold",
    icon: Bold,
    before: "**",
    after: "**",
    placeholder: "Bold text",
  },
  {
    label: "Italic",
    icon: Italic,
    before: "_",
    after: "_",
    placeholder: "Italic text",
  },
  {
    label: "Bullet list",
    icon: List,
    before: "- ",
    after: "",
    placeholder: "List item",
    line: true,
  },
  {
    label: "Link",
    icon: Link,
    before: "[",
    after: "](https://example.com)",
    placeholder: "Link text",
  },
];

export function MarkdownEditor({
  value,
  onChange,
  label,
  defaultMode = "write",
  readOnly = false,
  footer,
  toolbarActions,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  defaultMode?: "write" | "preview";
  readOnly?: boolean;
  footer?: ReactNode;
  toolbarActions?: ReactNode;
  className?: string;
}) {
  const editor = useRef<ReactCodeMirrorRef>(null);
  const [requestedMode, setMode] = useState<string>(defaultMode);
  const mode = readOnly ? "preview" : requestedMode;
  const extensions = useMemo(
    () => [
      yamlFrontmatter({ content: markdown() }),
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({ "aria-label": label }),
      editorTheme,
      highlighting,
    ],
    [label],
  );
  let preview = "";
  let previewError = "";
  if (mode === "preview") {
    try {
      preview = parseMarkdownDocument(value).body;
    } catch (error) {
      previewError =
        error instanceof Error
          ? error.message
          : "Could not preview this document";
    }
  }

  function format(item: (typeof formats)[number]) {
    const view = editor.current?.view;
    if (!view) return;
    const { from, to } = view.state.selection.main;
    const start = item.line ? view.state.doc.lineAt(from).from : from;
    const selected = view.state.sliceDoc(start, to) || item.placeholder;
    const insert = item.line
      ? selected
          .split("\n")
          .map((line) => item.before + line)
          .join("\n")
      : item.before + selected + item.after;
    view.dispatch({
      changes: { from: start, to, insert },
      selection: {
        anchor: start + item.before.length,
        head: start + insert.length - item.after.length,
      },
      scrollIntoView: true,
      userEvent: "input",
    });
    view.focus();
  }

  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card focus-within:border-ring",
        className,
      )}
    >
      {!readOnly || toolbarActions ? (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border p-2">
          {!readOnly ? (
            <Tabs
              value={mode}
              onValueChange={(value) => setMode(String(value))}
            >
              <TabsList variant="pill" aria-label="Markdown editor mode">
                <TabsTrigger value="preview">Preview</TabsTrigger>
                <TabsTrigger value="write">Write</TabsTrigger>
              </TabsList>
            </Tabs>
          ) : null}
          {mode === "write" ? (
            <div
              className="flex items-center gap-1"
              role="group"
              aria-label="Markdown formatting"
            >
              {formats.map((item) => (
                <PillButton
                  key={item.label}
                  type="button"
                  variant="ghost"
                  size="compact"
                  iconOnly
                  label={item.label}
                  title={item.label}
                  disabled={mode !== "write"}
                  onClick={() => format(item)}
                >
                  <item.icon className="size-3.5" />
                </PillButton>
              ))}
            </div>
          ) : null}
          {toolbarActions}
        </div>
      ) : null}
      <div className={mode === "write" ? "min-h-0 flex-1" : "hidden"}>
        <CodeMirror
          ref={editor}
          value={value}
          onChange={onChange}
          editable={!readOnly}
          extensions={extensions}
          height="100%"
          minHeight="24rem"
          theme="none"
          indentWithTab={false}
          basicSetup={{
            lineNumbers: false,
            foldGutter: false,
            highlightActiveLine: false,
            highlightActiveLineGutter: false,
          }}
          className={`h-full ${typeStyle("technical.code")}`}
        />
      </div>
      {mode === "preview" ? (
        <div
          role="region"
          aria-label={`${label} preview`}
          className="min-h-0 flex-1 overflow-auto p-6"
        >
          {previewError ? (
            <p role="alert" className={typeStyle("body.default")}>
              {previewError}
            </p>
          ) : (
            <ProseMarkdown gfm>{preview || "No content yet."}</ProseMarkdown>
          )}
        </div>
      ) : null}
      {footer ? (
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border p-4">
          {footer}
        </div>
      ) : null}
    </div>
  );
}
