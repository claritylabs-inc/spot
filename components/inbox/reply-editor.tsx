"use client";

import { useEffect, useRef } from "react";
import { EditorContent, Extension, Node, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Collaboration, { isChangeOrigin } from "@tiptap/extension-collaboration";
import { NodeSelection, Plugin, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Loader2 } from "lucide-react";

import { LogoIcon } from "@/components/ui/logo-icon";
import { Kbd } from "@/components/ui/kbd";
import { PillButton } from "@/components/ui/pill-button";
import { takeSeed, useSharedFragment } from "@/hooks/use-shared-value";
import { leadsSharedRoom, mergeText, noteTeammateChange } from "@/lib/collab/doc";
import { findTextLinks } from "@/lib/text-links";
import { cn } from "@/lib/utils";
import { typeStyle } from "@/lib/typography";

/** How long a browser not leading the room waits for the leader to apply outside text. */
const FOLLOWER_APPLY_DELAY_MS = 1_500;

/** A fact Spot could not fill, written `[needs: hint]` in the reply text. */
const BLANK_PATTERN = /\[needs:\s*([^\]]+)\]/g;

export type BlankSuggestion = { blank: string; value: string; source: string };

/** The hints of each blank in `text`, in order. */
export function replyBlanks(text: string) {
  return [...text.matchAll(BLANK_PATTERN)].map((match) => match[1].trim());
}

const Blank = Node.create({
  name: "blank",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { hint: { default: "" }, suggestion: { default: null } };
  },
  parseHTML() {
    return [{ tag: "span[data-blank]" }];
  },
  renderHTML({ node }) {
    const suggestion = node.attrs.suggestion as string | null;
    return [
      "span",
      {
        "data-blank": "",
        "data-suggested": suggestion ? "" : undefined,
        title: suggestion ? `Suggested for: ${node.attrs.hint}` : "Click and type to fill in",
      },
      suggestion ?? (node.attrs.hint as string),
    ];
  },
  renderText({ node }) {
    return `[needs: ${node.attrs.hint}]`;
  },
  addKeyboardShortcuts() {
    return {
      Tab: ({ editor }) => selectBlank(editor, 1),
      "Shift-Tab": ({ editor }) => selectBlank(editor, -1),
    };
  },
});

function linkDecorations(doc: PMNode) {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    for (const link of findTextLinks(node.text))
      decorations.push(
        Decoration.inline(pos + link.start, pos + link.end, {
          nodeName: "a",
          href: link.href,
          class: "reply-editor-link",
          title: `${link.href}\n⌘-click to open`,
        }),
      );
  });
  return DecorationSet.create(doc, decorations);
}

/** Web addresses in the text show as links; ⌘- or Ctrl-click opens one in a new tab. */
const TextLinks = Extension.create({
  name: "textLinks",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        state: {
          init: (_, state) => linkDecorations(state.doc),
          apply: (tr, decorations) =>
            tr.docChanged ? linkDecorations(tr.doc) : decorations,
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
          handleClick: (_view, _pos, event) => {
            if (!(event.metaKey || event.ctrlKey)) return false;
            const link =
              event.target instanceof Element
                ? event.target.closest<HTMLAnchorElement>("a.reply-editor-link")
                : null;
            if (!link) return false;
            window.open(link.href, "_blank", "noopener,noreferrer");
            return true;
          },
        },
      }),
    ];
  },
});

/** Selects the next (or previous) blank after the cursor, wrapping around. */
function selectBlank(editor: Editor, direction: 1 | -1) {
  const positions: number[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "blank") positions.push(pos);
  });
  if (positions.length === 0) return false;
  const { from } = editor.state.selection;
  const ordered = direction === 1 ? positions : [...positions].reverse();
  const target =
    ordered.find((pos) => (direction === 1 ? pos > from : pos < from)) ?? ordered[0];
  editor.view.dispatch(
    editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, target)).scrollIntoView(),
  );
  return true;
}

function toDoc(text: string) {
  return {
    type: "doc",
    content: text.split("\n").map((line) => {
      const content: object[] = [];
      let last = 0;
      for (const match of line.matchAll(BLANK_PATTERN)) {
        if (match.index > last) content.push({ type: "text", text: line.slice(last, match.index) });
        content.push({ type: "blank", attrs: { hint: match[1].trim() } });
        last = match.index + match[0].length;
      }
      if (last < line.length) content.push({ type: "text", text: line.slice(last) });
      return { type: "paragraph", content };
    }),
  };
}

function toText(doc: PMNode) {
  const lines: string[] = [];
  doc.forEach((paragraph) => {
    let line = "";
    paragraph.forEach((child) => {
      line += child.type.name === "blank" ? `[needs: ${child.attrs.hint}]` : (child.text ?? "");
    });
    lines.push(line);
  });
  return lines.join("\n");
}

/** Shows each suggestion in its blank; blanks keep their `[needs:]` text until accepted. */
function applySuggestions(editor: Editor, suggestions: BlankSuggestion[]) {
  const values = new Map(suggestions.map((item) => [item.blank, item.value]));
  const tr = editor.state.tr;
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== "blank") return;
    const suggestion = values.get(node.attrs.hint) ?? null;
    if (suggestion !== node.attrs.suggestion)
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, suggestion });
  });
  if (tr.docChanged) editor.view.dispatch(tr.setMeta("addToHistory", false));
}

/**
 * Plain-text reply editor whose `[needs: …]` blanks render as fill-in lines.
 * Click or Tab to a blank and type to replace it; a blank with a suggestion
 * shows it and can be accepted from the bar below the text.
 */
export function ReplyEditor({
  value,
  onChange,
  placeholder,
  autoFocus,
  disabled,
  readOnly,
  suggestions,
  suggesting,
  onFocusChange,
  onSubmit,
  onEscape,
  className,
  scrollClassName,
  footer,
  collabKey = null,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  autoFocus?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  suggestions: BlankSuggestion[];
  suggesting: boolean;
  onFocusChange: (focused: boolean) => void;
  onSubmit: () => void;
  onEscape: () => void;
  className?: string;
  /** Overrides the text area's height limit, e.g. to fill an artifact. */
  scrollClassName?: string;
  footer?: string;
  /** Written together with teammates on the page through this shared document. */
  collabKey?: string | null;
}) {
  const callbacks = useRef({ onChange, onFocusChange, onSubmit, onEscape, accept: (): boolean => false });
  useEffect(() => {
    callbacks.current = { onChange, onFocusChange, onSubmit, onEscape, accept };
  });
  const fragment = useSharedFragment(collabKey);
  // The text this editor last reported or took from outside.
  const lastValue = useRef(value);
  // The last text shared with teammates: unsaved edits made before joining a
  // document a teammate started are measured from it and merged in.
  const synced = useRef(value);
  const joining = useRef<{ base: string; local: string } | null>(null);
  function mergeOnJoin(current: Editor) {
    const join = joining.current;
    if (current.isDestroyed || !join) return;
    joining.current = null;
    const room = toText(current.state.doc);
    const merged = mergeText(join.base, join.local, room);
    synced.current = merged;
    if (merged !== room) current.commands.setContent(toDoc(merged));
  }

  // Shared, the content comes from the room's document; the editor is rebuilt
  // when the page joins or leaves the room.
  const editor = useEditor({
    immediatelyRender: false,
    autofocus: autoFocus ? "end" : false,
    editable: !disabled && !readOnly,
    extensions: [
      StarterKit.configure({
        blockquote: false,
        bold: false,
        bulletList: false,
        code: false,
        codeBlock: false,
        heading: false,
        horizontalRule: false,
        italic: false,
        link: false,
        listItem: false,
        listKeymap: false,
        orderedList: false,
        strike: false,
        underline: false,
        hardBreak: false,
        trailingNode: false,
        ...(fragment ? { undoRedo: false as const } : {}),
      }),
      Blank,
      TextLinks,
      ...(fragment ? [Collaboration.configure({ fragment })] : []),
    ],
    ...(fragment ? {} : { content: toDoc(value) }),
    editorProps: {
      attributes: { "aria-label": "Reply", "aria-multiline": "true", role: "textbox" },
      // Pasted text becomes plain lines and blanks, never formatting.
      clipboardTextParser: (text, $context, _plain, view) =>
        view.state.schema.nodeFromJSON(toDoc(text.replace(/\r\n/g, "\n"))).slice(0),
      handleKeyDown: (_view, event) => {
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          callbacks.current.onSubmit();
          return true;
        }
        if (event.key === "Enter" && !event.shiftKey && callbacks.current.accept()) {
          event.preventDefault();
          return true;
        }
        if (event.key === "Escape") callbacks.current.onEscape();
        return false;
      },
    },
    onCreate: ({ editor }) => {
      // The browser that started the shared document fills it; any other
      // merges its unsaved edits into it once it is shown.
      if (fragment && takeSeed(fragment))
        editor.commands.setContent(toDoc(lastValue.current), { emitUpdate: false });
      else if (fragment && lastValue.current !== synced.current)
        joining.current = { base: synced.current, local: lastValue.current };
    },
    onUpdate: ({ editor, transaction }) => {
      const teammate = isChangeOrigin(transaction);
      // Not inside this update: the merge dispatches its own change.
      if (teammate && joining.current) window.setTimeout(() => mergeOnJoin(editor), 0);
      const next = toText(editor.state.doc);
      if (next === lastValue.current) return;
      lastValue.current = next;
      if (fragment) synced.current = next;
      if (teammate) noteTeammateChange();
      callbacks.current.onChange(next);
    },
    onFocus: () => callbacks.current.onFocusChange(true),
    onBlur: () => callbacks.current.onFocusChange(false),
  }, [fragment]);

  // Text set from outside (a Spot suggestion, a cleared send) replaces the
  // document. A rebuilt editor takes its content from the room or `value`
  // itself; pushing `value` in again would race the room. Shared, the leading
  // browser applies it and the room carries it to the rest, since two
  // browsers writing the same text would double it; others apply what never
  // arrived after a moment.
  const appliedTo = useRef(editor);
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    if (appliedTo.current !== editor) {
      appliedTo.current = editor;
      return;
    }
    const apply = () => {
      if (editor.isDestroyed) return;
      if (value === lastValue.current || toText(editor.state.doc) === value) return;
      editor.commands.setContent(toDoc(value), { emitUpdate: false });
      lastValue.current = value;
      synced.current = value;
    };
    if (!fragment || leadsSharedRoom()) return apply();
    const timer = window.setTimeout(apply, FOLLOWER_APPLY_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [editor, fragment, value]);
  useEffect(() => {
    editor?.setEditable(!disabled && !readOnly);
  }, [editor, disabled, readOnly]);
  useEffect(() => {
    if (editor) applySuggestions(editor, suggestions);
  }, [editor, suggestions, value]);

  const selected = useEditorState({
    editor,
    selector: ({ editor }) => {
      const selection = editor?.state.selection;
      if (!(selection instanceof NodeSelection) || selection.node.type.name !== "blank") return null;
      return {
        pos: selection.from,
        hint: selection.node.attrs.hint as string,
        suggestion: selection.node.attrs.suggestion as string | null,
      };
    },
  });
  const source = selected
    ? suggestions.find((item) => item.blank === selected.hint)?.source
    : undefined;

  /** Puts the suggestion in place of the selected blank, then moves to the next blank. */
  function accept() {
    if (!editor || !selected?.suggestion) return false;
    const { state } = editor;
    const tr = state.tr.replaceWith(selected.pos, selected.pos + 1, state.schema.text(selected.suggestion));
    editor.view.dispatch(
      tr.setSelection(TextSelection.create(tr.doc, selected.pos + selected.suggestion.length)),
    );
    editor.commands.focus();
    selectBlank(editor, 1);
    return true;
  }

  function skip() {
    if (!editor) return;
    editor.commands.focus();
    selectBlank(editor, 1);
  }

  return (
    <div className={cn("relative", className)}>
      {!value ? (
        <span
          aria-hidden
          className={`pointer-events-none absolute top-2.5 left-4 text-muted-foreground/60 ${typeStyle("body.default")}`}
        >
          {placeholder}
        </span>
      ) : null}
      <div className={cn("max-h-72 overflow-y-auto px-4 pt-2.5 pb-2", scrollClassName)}>
        <EditorContent
          editor={editor}
          className={cn(
            "reply-editor [&_.ProseMirror]:min-h-6 [&_.ProseMirror]:outline-none [&_.ProseMirror]:whitespace-pre-wrap [&_p]:min-h-[1lh]",
            typeStyle("body.default"),
          )}
        />
        {footer ? (
          <p className={`mt-3 whitespace-pre-line text-muted-foreground ${typeStyle("body.default")}`}>{footer}</p>
        ) : null}
      </div>
      {selected ? (
        <div
          className={`mx-4 mb-2 flex min-h-8 items-center gap-2 rounded-md bg-muted/60 py-1 pr-1 pl-2.5 text-muted-foreground ${typeStyle("caption.default")}`}
        >
          {selected.suggestion ? (
            <>
              <LogoIcon size={12} className="shrink-0" />
              <span className="min-w-0 truncate">
                Suggested{source ? ` from ${source}` : ""}
              </span>
              <span className="ml-auto flex shrink-0 items-center gap-1">
                <PillButton
                  type="button"
                  size="xs"
                  variant="ghost"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={skip}
                >
                  Skip
                </PillButton>
                <PillButton
                  type="button"
                  size="xs"
                  variant="secondary"
                  onMouseDown={(event) => event.preventDefault()}
                  shortcut={["enter"]}
                  onClick={accept}
                >
                  Accept
                </PillButton>
              </span>
            </>
          ) : (
            <>
              <span className="min-w-0 truncate">
                Type the <span className="text-foreground">{selected.hint}</span>
              </span>
              <span className="ml-auto flex shrink-0 items-center gap-1.5 pr-1.5">
                {suggesting ? (
                  <>
                    <Loader2 className="size-3 animate-spin" />
                    Checking client records
                  </>
                ) : (
                  <>
                    <Kbd keys={["tab"]} /> next blank
                  </>
                )}
              </span>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
