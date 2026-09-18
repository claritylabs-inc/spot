import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { TableKit } from "@tiptap/extension-table";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import Image from "@tiptap/extension-image";

export function markdownEditorExtensions() {
  return [
    StarterKit.configure({
      underline: false,
      trailingNode: false,
      link: { openOnClick: false, autolink: false },
    }),
    Markdown,
    TableKit,
    TaskList,
    TaskItem.configure({ nested: true }),
    Image.configure({ inline: true }),
  ];
}
