"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
import CodeMirror, { ExternalChange } from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { yaml, yamlFrontmatter } from "@codemirror/lang-yaml";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { editorFrontmatterRange } from "@/lib/markdown-editor";
import { textSplice } from "@/lib/collab/doc";
import { tags } from "@lezer/highlight";
import {
  editableMirrorTypographyStyle,
  markdownSyntaxTypographyStyles,
  typeStyle,
} from "@/lib/typography";

const theme = EditorView.theme({
  "&": { backgroundColor: "transparent", color: "var(--foreground)" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { overflow: "auto", ...editableMirrorTypographyStyle },
  ".cm-content": { padding: "24px 0", caretColor: "var(--foreground)" },
  ".cm-line": { padding: "0 24px" },
  ".cm-frontmatter-start": { paddingTop: "24px", marginTop: "-24px" },
  ".cm-frontmatter-end": {
    paddingBottom: "24px",
    marginBottom: "12px",
    borderBottom: "1px solid var(--border)",
  },
  ".cm-cursor": { borderLeftColor: "var(--foreground)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
    {
      backgroundColor: "var(--accent)",
    },
});

function frontmatterDecorations(view: EditorView) {
  const range = editorFrontmatterRange(view.state.doc.toString());
  if (!range) return Decoration.none;
  const lastLine = view.state.doc.lineAt(range.closingStart).number;
  return Decoration.set([
    Decoration.line({ attributes: { class: "cm-frontmatter-start" } }).range(0),
    Decoration.line({ attributes: { class: "cm-frontmatter-end" } }).range(
      view.state.doc.line(lastLine).from,
    ),
  ]);
}

const separatedFrontmatter = ViewPlugin.fromClass(
  class {
    decorations;
    constructor(view: EditorView) {
      this.decorations = frontmatterDecorations(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged)
        this.decorations = frontmatterDecorations(update.view);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

const highlighting = syntaxHighlighting(
  HighlightStyle.define([
    {
      tag: [tags.heading, tags.strong],
      ...markdownSyntaxTypographyStyles.strong,
    },
    { tag: tags.emphasis, ...markdownSyntaxTypographyStyles.emphasis },
  ]),
);

export function MarkdownSourceEditor({
  value,
  onChange,
  label,
  readOnly,
  frontmatter = false,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  readOnly?: boolean;
  frontmatter?: boolean;
}) {
  const extensions = useMemo(
    () => [
      frontmatter ? yaml() : yamlFrontmatter({ content: markdown() }),
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({ "aria-label": label }),
      theme,
      highlighting,
      ...(frontmatter ? [] : [separatedFrontmatter]),
    ],
    [frontmatter, label],
  );
  // CodeMirror replaces its whole document when `value` changes, moving the
  // caret. Apply outside changes (a teammate's edit) as the smallest splice
  // first, before its own sync runs, so the caret stays where it was.
  const viewRef = useRef<EditorView | null>(null);
  useLayoutEffect(() => {
    const view = viewRef.current;
    const current = view?.state.doc.toString();
    if (!view || current === undefined || current === value) return;
    view.dispatch({
      changes: textSplice(current, value),
      annotations: [ExternalChange.of(true)],
    });
  }, [value]);
  return (
    <CodeMirror
      value={value}
      onCreateEditor={(view) => {
        viewRef.current = view;
      }}
      onChange={onChange}
      editable={!readOnly}
      extensions={extensions}
      minHeight={frontmatter ? "8rem" : "24rem"}
      theme="none"
      indentWithTab={false}
      basicSetup={{
        lineNumbers: false,
        foldGutter: false,
        highlightActiveLine: false,
        highlightActiveLineGutter: false,
        syntaxHighlighting: false,
      }}
      className={typeStyle("technical.code")}
    />
  );
}
