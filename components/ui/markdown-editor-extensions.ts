import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { TableKit } from "@tiptap/extension-table";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import Image from "@tiptap/extension-image";
import Collaboration from "@tiptap/extension-collaboration";
import type * as Y from "yjs";

/** With a shared `fragment`, the document is edited together through Yjs, which also owns undo. */
export function markdownEditorExtensions(fragment?: Y.XmlFragment | null) {
  return [
    StarterKit.configure({
      underline: false,
      trailingNode: false,
      link: { openOnClick: false, autolink: false },
      ...(fragment ? { undoRedo: false } : {}),
    }),
    ...(fragment ? [Collaboration.configure({ fragment })] : []),
    Markdown,
    TableKit,
    TaskList,
    TaskItem.configure({ nested: true }),
    Image.configure({ inline: true }),
  ];
}
