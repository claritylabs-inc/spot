"use client";

import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { Bold, Heading2, Italic, Link, List } from "lucide-react";
import { PillButton } from "@/components/ui/pill-button";
import { Input } from "@claritylabs-inc/ui/components/input";
import {
  ProseMarkdown,
  PROSE_MARKDOWN_STYLES,
} from "@/components/prose-markdown";
import { equivalentMarkdown } from "@/lib/markdown-editor";
import { markdownEditorExtensions } from "./markdown-editor-extensions";

export function MarkdownDocumentEditor({
  value,
  onChange,
  label,
  readOnly,
  onEditSource,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  readOnly: boolean;
  onEditSource: () => void;
}) {
  const lastValue = useRef(value);
  const [lossless, setLossless] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [link, setLink] = useState("");
  const editor = useEditor({
    extensions: markdownEditorExtensions(),
    content: value,
    contentType: "markdown",
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
      setLossless(equivalentMarkdown(value, editor.getMarkdown()));
    },
    onUpdate({ editor }) {
      if (!editor.isEditable) return;
      const next = editor.getMarkdown();
      lastValue.current = next;
      onChange(next);
    },
  });

  useEffect(() => {
    if (!editor || value === lastValue.current) return;
    editor.commands.setContent(value, {
      contentType: "markdown",
      emitUpdate: false,
    });
    lastValue.current = value;
    setLossless(equivalentMarkdown(value, editor.getMarkdown()));
  }, [editor, value]);

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
