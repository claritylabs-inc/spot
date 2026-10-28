"use client";

import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { Bold, Heading2, Italic, Link, List } from "lucide-react";
import { PillButton } from "@/components/ui/pill-button";
import { Input } from "@claritylabs-inc/ui/components/input";
import {
  ProseMarkdown,
  PROSE_MARKDOWN_STYLES,
} from "@/components/prose-markdown";
import { isChangeOrigin } from "@tiptap/extension-collaboration";
import { takeSeed, useSharedFragment } from "@/hooks/use-shared-value";
import { mergeText, noteTeammateChange } from "@/lib/collab/doc";
import { canonicalMarkdown, equivalentMarkdown } from "@/lib/markdown-editor";
import { markdownEditorExtensions } from "./markdown-editor-extensions";

/**
 * Replaces only what changed, so an outside edit (a teammate's) keeps the
 * caret and selection where they were. Does not emit an update.
 */
function replaceContent(editor: Editor, markdown: string) {
  const next = editor.markdown
    ? editor.schema.nodeFromJSON(editor.markdown.parse(markdown))
    : null;
  if (!next) {
    editor.commands.setContent(markdown, {
      contentType: "markdown",
      emitUpdate: false,
    });
    return;
  }
  const current = editor.state.doc;
  const start = current.content.findDiffStart(next.content);
  const end = start === null ? null : current.content.findDiffEnd(next.content);
  if (start === null || !end) return;
  // Repeated content can make the two ends cross the start; push them back.
  const overlap = start - Math.min(end.a, end.b);
  const endA = end.a + Math.max(0, overlap);
  const endB = end.b + Math.max(0, overlap);
  editor.view.dispatch(
    editor.state.tr
      .replace(start, endA, next.slice(start, endB))
      .setMeta("preventUpdate", true)
      .setMeta("addToHistory", false),
  );
}

export function MarkdownDocumentEditor({
  value,
  onChange,
  label,
  readOnly,
  onEditSource,
  collabKey = null,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  readOnly: boolean;
  onEditSource: () => void;
  /** Edited together with teammates on the page through this shared document. */
  collabKey?: string | null;
}) {
  const lastValue = useRef(value);
  // Markdown this editor produced: the parent echoes it back renders later
  // (far behind while a teammate types fast), and applying a late echo would
  // undo newer typing. Shared, echoes are compared by meaning, since a parent
  // may reformat them (dropping a just-typed trailing space).
  const produced = useRef(new Set<string>());
  const fragment = useSharedFragment(collabKey);
  // The last text this editor shared with teammates (or took from outside):
  // what its unsaved edits are measured from when it joins a document a
  // teammate started, so they are merged in rather than replaced.
  const synced = useRef(value);
  const joining = useRef<{ base: string; local: string } | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });
  // Runs on the first change from the room after joining: the teammate's
  // content is now shown.
  function mergeOnJoin() {
    const current = editorRef.current;
    const join = joining.current;
    if (!current || current.isDestroyed || !join) return;
    joining.current = null;
    const room = current.getMarkdown();
    const merged = mergeText(join.base, join.local, room);
    synced.current = merged;
    if (merged === room) return;
    replaceContent(current, merged);
    const next = current.getMarkdown();
    lastValue.current = next;
    synced.current = next;
    onChangeRef.current(next);
  }

  const [lossless, setLossless] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [link, setLink] = useState("");
  // Shared, the content comes from the room's document; the editor is rebuilt
  // when the page joins or leaves the room.
  const editor = useEditor(
    {
      extensions: markdownEditorExtensions(fragment),
      ...(fragment ? {} : { content: value, contentType: "markdown" as const }),
      immediatelyRender: false,
      editable: false,
      editorProps: {
        attributes: {
          role: "textbox",
          "aria-label": label,
          "aria-multiline": "true",
          class: `${PROSE_MARKDOWN_STYLES} min-h-96 p-6 outline-none [&_a]:underline [&_a]:underline-offset-2 [&_img]:max-w-full [&_.tableWrapper]:overflow-x-auto [&_ul[data-type=taskList]]:list-none [&_li[data-type=taskItem]]:flex [&_li[data-type=taskItem]]:items-start [&_li[data-type=taskItem]]:gap-2 [&_li[data-type=taskItem]>label]:mt-1 [&_li[data-type=taskItem]>div]:min-w-0 [&_li[data-type=taskItem]>div]:flex-1`,
        },
        handlePaste(view, event) {
          const text = event.clipboardData?.getData("text/plain");
          if (
            !text ||
            event.clipboardData?.getData("text/html") ||
            view.state.selection.$from.parent.type.spec.code
          )
            return false;
          if (!editor?.markdown) return false;
          const parsed = editor.markdown.parse(text);
          if (!equivalentMarkdown(text, editor.markdown.serialize(parsed)))
            return false;
          editor.commands.insertContent(text, { contentType: "markdown" });
          return true;
        },
      },
      onCreate({ editor }) {
        editorRef.current = editor;
        // The browser that started the shared document fills it; any other
        // merges its unsaved edits into it once it is shown.
        if (fragment && takeSeed(fragment)) {
          editor.commands.setContent(lastValue.current, {
            contentType: "markdown",
            emitUpdate: false,
          });
        } else if (fragment && lastValue.current !== synced.current) {
          joining.current = {
            base: synced.current,
            local: lastValue.current,
          };
        }
        setLossless(
          !!editor.markdown &&
            equivalentMarkdown(
              value,
              editor.markdown.serialize(editor.markdown.parse(value)),
            ),
        );
      },
      onUpdate({ editor, transaction }) {
        // A teammate's change arrives through Yjs even before this editor is
        // editable, and is saved by their browser.
        const teammate = isChangeOrigin(transaction);
        // Not inside this update: the merge dispatches its own change.
        if (teammate && joining.current) window.setTimeout(mergeOnJoin, 0);
        if (!editor.isEditable && !teammate) return;
        const next = editor.getMarkdown();
        if (next === lastValue.current) return;
        lastValue.current = next;
        produced.current.add(fragment ? canonicalMarkdown(next) : next);
        if (produced.current.size > 2000) {
          produced.current.delete(produced.current.values().next().value!);
        }
        if (fragment) synced.current = next;
        if (teammate) noteTeammateChange();
        onChange(next);
      },
    },
    [fragment],
  );

  // A rebuilt editor (joining or leaving the room) takes its content from the
  // room or from `value` itself; pushing `value` in again would race the room.
  const appliedTo = useRef(editor);
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    if (appliedTo.current !== editor) {
      appliedTo.current = editor;
      lastValue.current = value;
      return;
    }
    if (
      value === lastValue.current ||
      produced.current.has(fragment ? canonicalMarkdown(value) : value)
    )
      return;
    replaceContent(editor, value);
    lastValue.current = value;
    synced.current = value;
    setLossless(equivalentMarkdown(value, editor.getMarkdown()));
  }, [editor, fragment, value]);

  useEffect(() => {
    editor?.setEditable(!readOnly && lossless, false);
  }, [editor, lossless, readOnly]);

  if (readOnly || (editor && !lossless)) {
    return (
      <div className="space-y-4 p-6">
        <ProseMarkdown gfm>{value}</ProseMarkdown>
        {!readOnly ? (
          <PillButton variant="secondary" onClick={onEditSource}>
            Edit Markdown
          </PillButton>
        ) : null}
      </div>
    );
  }

  return (
    <>
      <EditorContent editor={editor} />
      {editor ? (
        <BubbleMenu
          editor={editor}
          options={{ placement: "top", offset: 8 }}
          className="z-50 flex max-w-[calc(100vw-2rem)] flex-wrap items-center gap-1 rounded-lg border border-border-emphasized bg-popover p-1 shadow-md"
        >
          <div
            role="toolbar"
            aria-label="Markdown formatting"
            className="flex items-center gap-1"
          >
            <PillButton
              size="compact"
              variant="ghost"
              iconOnly
              label="Bold"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => editor.chain().focus().toggleBold().run()}
            >
              <Bold className="size-4" />
            </PillButton>
            <PillButton
              size="compact"
              variant="ghost"
              iconOnly
              label="Italic"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => editor.chain().focus().toggleItalic().run()}
            >
              <Italic className="size-4" />
            </PillButton>
            <PillButton
              size="compact"
              variant="ghost"
              iconOnly
              label="Heading"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() =>
                editor.chain().focus().toggleHeading({ level: 2 }).run()
              }
            >
              <Heading2 className="size-4" />
            </PillButton>
            <PillButton
              size="compact"
              variant="ghost"
              iconOnly
              label="Bullet list"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => editor.chain().focus().toggleBulletList().run()}
            >
              <List className="size-4" />
            </PillButton>
            <PillButton
              size="compact"
              variant="ghost"
              iconOnly
              label="Link"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setLink(String(editor.getAttributes("link").href ?? ""));
                setLinkOpen(!linkOpen);
              }}
            >
              <Link className="size-4" />
            </PillButton>
          </div>
          {linkOpen ? (
            <form
              className="flex w-full items-center gap-2 p-1"
              onSubmit={(event) => {
                event.preventDefault();
                if (link.trim())
                  editor
                    .chain()
                    .focus()
                    .extendMarkRange("link")
                    .setLink({ href: link.trim() })
                    .run();
                else editor.chain().focus().unsetLink().run();
                setLinkOpen(false);
              }}
            >
              <Input
                aria-label="Link URL"
                value={link}
                onChange={(event) => setLink(event.target.value)}
                placeholder="https://example.com"
              />
              <PillButton type="submit" size="compact" variant="secondary">
                Apply
              </PillButton>
            </form>
          ) : null}
        </BubbleMenu>
      ) : null}
    </>
  );
}
