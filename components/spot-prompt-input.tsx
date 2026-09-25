"use client";

import { TagRemoveButton } from "@claritylabs-inc/ui/components/tag-remove-button";

import {
  useCallback,
  useRef,
  useImperativeHandle,
  forwardRef,
  useState,
  useMemo,
  useEffect,
} from "react";
import { createPortal } from "react-dom";
import type { DragEvent as ReactDragEvent } from "react";
import {
  ArrowUp,
  BadgeCheck,
  FileText,
  Inbox,
  Paperclip,
  Square,
} from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputTools,
  usePromptInputAttachments,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import { PillButton } from "@/components/ui/pill-button";
import { cn } from "@/lib/utils";
import { Spinner } from "@claritylabs-inc/ui/components/spinner";
import type { ChatStatus } from "ai";
import { useCachedAgentTargets } from "@/lib/sync/spot-cached-queries";
import {
  PromptReferenceTag,
  promptReferenceMarker,
} from "@/components/prompt-reference-tag";
import { typeStyle } from "@/lib/typography";

const inputOverlayFadeStyle = {
  backgroundImage:
    "linear-gradient(to bottom, transparent 0%, color-mix(in srgb, var(--chat-surface, var(--background)) 80%, transparent) 100%)",
} satisfies React.CSSProperties;

const INPUT_INTENT_RADIUS = 180;
const INPUT_INTENT_EPSILON = 0.01;
const PREPARED_ACTION_INTENT_THRESHOLD = 0.34;

function InputOverlayFade() {
  return <div className="absolute inset-0" style={inputOverlayFadeStyle} />;
}

// Inner component — must render inside <PromptInput> to access LocalAttachmentsContext
function AttachmentActionButtons() {
  const attachments = usePromptInputAttachments();

  const handleAttach = useCallback(() => {
    attachments.openFileDialog();
  }, [attachments]);

  return (
    <>
      <PillButton
        type="button"
        size="compact"
        variant="icon"
        onClick={handleAttach}
        label="Add photos or files"
      >
        <Paperclip className="size-3.5" />
      </PillButton>
    </>
  );
}

function attachmentKindLabel(file: { filename?: string; mediaType?: string }) {
  const mediaType = file.mediaType?.toLowerCase() ?? "";
  const filename = file.filename?.toLowerCase() ?? "";
  if (mediaType.includes("pdf") || filename.endsWith(".pdf")) return "PDF";
  if (
    mediaType.includes("spreadsheet") ||
    mediaType.includes("csv") ||
    filename.endsWith(".csv") ||
    filename.endsWith(".xlsx") ||
    filename.endsWith(".xls")
  ) {
    return "Spreadsheet";
  }
  if (
    mediaType.includes("word") ||
    filename.endsWith(".doc") ||
    filename.endsWith(".docx")
  ) {
    return "Document";
  }
  if (mediaType.startsWith("image/")) return "Image";
  if (filename.endsWith(".eml") || filename.endsWith(".msg")) return "Email";
  return "Attachment";
}

function AttachmentTags({
  roomyOnMobile = false,
  detailed = false,
}: {
  roomyOnMobile?: boolean;
  detailed?: boolean;
}) {
  const attachments = usePromptInputAttachments();

  if (attachments.files.length === 0) {
    return null;
  }

  return (
    <div
      className={cn(
        "order-first flex w-full flex-wrap justify-start self-start gap-2",
        roomyOnMobile ? "px-4 sm:px-3 pt-3 pb-0" : "px-3 pt-3 pb-0",
      )}
    >
      {attachments.files.map((file) => (
        <span
          key={file.id}
          className={cn(
            `inline-flex max-w-full items-center gap-1.5 bg-foreground/5 text-foreground/75 ${typeStyle("caption.medium")}`,
            detailed ? "rounded-lg px-2.5 py-1.5" : "rounded-full px-2.5 py-1",
          )}
        >
          <Paperclip className="size-3 shrink-0 text-muted-foreground" />
          <span className="min-w-0">
            <span
              className="block max-w-45 truncate sm:max-w-60"
              title={file.filename}
            >
              {file.filename}
            </span>
            {detailed ? (
              <span
                className={`block text-muted-foreground/45 ${typeStyle("caption.default")}`}
              >
                {attachmentKindLabel(file)}
              </span>
            ) : null}
          </span>
          <TagRemoveButton
            label={`Remove ${file.filename}`}
            onClick={() => attachments.remove(file.id)}
          />
        </span>
      ))}
    </div>
  );
}

type PromptReference = NonNullable<PromptInputMessage["references"]>[number];
type PromptTargetKind = PromptReference["kind"];

type PromptTextToken = {
  type: "text";
  id: string;
  text: string;
};

type PromptReferenceToken = {
  type: "reference";
  id: string;
  reference: PromptReference;
};

type PromptToken = PromptTextToken | PromptReferenceToken;
type PromptTokensAction =
  | PromptToken[]
  | ((current: PromptToken[]) => PromptToken[]);

type PromptTrigger = {
  marker: "@" | "/";
  query: string;
  start: number;
  end: number;
  textTokenId: string;
  preparedKinds?: PromptTargetKind[];
};

type MentionTarget = PromptReference & {
  sublabel?: string;
};

const PREPARED_POLICY_TARGET_KINDS: PromptTargetKind[] = ["policy"];
const PREPARED_REQUIREMENT_TARGET_KINDS: PromptTargetKind[] = ["requirement"];
const PREPARED_MAILBOX_TARGET_KINDS: PromptTargetKind[] = ["mailbox"];

let promptTokenIdCounter = 0;

function nextPromptTokenId(prefix: string) {
  promptTokenIdCounter += 1;
  return `${prefix}-${promptTokenIdCounter}`;
}

function createTextToken(
  text = "",
  id = nextPromptTokenId("text"),
): PromptTextToken {
  return { type: "text", id, text };
}

function createReferenceToken(
  reference: PromptReference,
  id = nextPromptTokenId("reference"),
): PromptReferenceToken {
  return {
    type: "reference",
    id,
    reference,
  };
}

function initialPromptTokens(defaultReferences?: PromptReference[]) {
  if (!defaultReferences || defaultReferences.length === 0) {
    return [createTextToken("", "initial-text-0")];
  }

  const tokens: PromptToken[] = [createTextToken("", "initial-text-0")];
  defaultReferences.forEach((reference, index) => {
    tokens.push(
      createReferenceToken(reference, `initial-reference-${index}`),
      createTextToken("", `initial-text-${index + 1}`),
    );
  });
  return tokens;
}

function promptTokensWithText(
  text: string,
  defaultReferences?: PromptReference[],
) {
  const tokens = initialPromptTokens(defaultReferences);
  const textTokenId = firstTextTokenId(tokens);
  return tokens.map((token) =>
    token.type === "text" && token.id === textTokenId
      ? { ...token, text }
      : token,
  );
}

function firstTextTokenId(tokens: PromptToken[]) {
  return tokens.find((token) => token.type === "text")?.id ?? "";
}

function referenceKey(reference: PromptReference) {
  return `${reference.kind}:${reference.id}`;
}

function promptTokensToReferences(tokens: PromptToken[]) {
  const seen = new Set<string>();
  const references: PromptReference[] = [];

  tokens.forEach((token) => {
    if (token.type !== "reference") return;
    const key = referenceKey(token.reference);
    if (seen.has(key)) return;
    seen.add(key);
    references.push(token.reference);
  });

  return references;
}

function shouldSeparatePromptPieces(current: string, next: string) {
  if (!current || !next) return false;
  return !/\s$/.test(current) && !/^[\s,.;:!?)]/.test(next);
}

function promptTokensToText(tokens: PromptToken[]) {
  return tokens.reduce((text, token) => {
    const piece =
      token.type === "text"
        ? token.text
        : `${promptReferenceMarker(token.reference.kind)}${token.reference.label}`;
    if (!piece) return text;
    return `${text}${shouldSeparatePromptPieces(text, piece) ? " " : ""}${piece}`;
  }, "");
}

function promptTokensAreTextEmpty(tokens: PromptToken[]) {
  return tokens.every(
    (token) => token.type !== "text" || token.text.trim().length === 0,
  );
}

function mergeDefaultReferencesIntoTokens(
  tokens: PromptToken[],
  defaultReferences?: PromptReference[],
) {
  if (!defaultReferences || defaultReferences.length === 0) return tokens;

  const defaultReferencesByKey = new Map(
    defaultReferences.map((reference) => [referenceKey(reference), reference]),
  );
  const existingReferenceKeys = new Set<string>();
  let changed = false;
  const nextTokens = tokens.map((token) => {
    if (token.type !== "reference") return token;
    const key = referenceKey(token.reference);
    existingReferenceKeys.add(key);
    const defaultReference = defaultReferencesByKey.get(key);
    if (!defaultReference || defaultReference.label === token.reference.label) {
      return token;
    }
    changed = true;
    return { ...token, reference: defaultReference };
  });

  const missingReferences = defaultReferences.filter(
    (reference) => !existingReferenceKeys.has(referenceKey(reference)),
  );
  if (missingReferences.length === 0) return changed ? nextTokens : tokens;

  const firstTextIndex = nextTokens.findIndex((token) => token.type === "text");
  const insertTokens = missingReferences.flatMap((reference) => [
    createReferenceToken(reference),
    createTextToken(),
  ]);

  if (firstTextIndex === -1) {
    return [createTextToken(), ...insertTokens];
  }

  return [
    ...nextTokens.slice(0, firstTextIndex + 1),
    ...insertTokens,
    ...nextTokens.slice(firstTextIndex + 1),
  ];
}

function targetKindsForTrigger(trigger: PromptTrigger): PromptTargetKind[] {
  if (trigger.preparedKinds) return trigger.preparedKinds;
  if (trigger.marker === "/") return PREPARED_MAILBOX_TARGET_KINDS;
  return ["policy", "requirement"];
}

function targetScopeLabel(kinds: PromptTargetKind[]) {
  const hasPolicyTargets = kinds.includes("policy");
  const hasRequirementTargets = kinds.includes("requirement");
  const hasMailboxTargets = kinds.includes("mailbox");

  if (hasPolicyTargets && hasRequirementTargets) {
    return "Policies and compliance requirements";
  }
  if (hasPolicyTargets) return "Policies";
  if (hasRequirementTargets) return "Compliance requirements";
  if (hasMailboxTargets) return "Mailboxes";
  return null;
}

function referenceIcon(kind: PromptReference["kind"]) {
  if (kind === "requirement") return <BadgeCheck className="size-3.5" />;
  if (kind === "mailbox") return <Inbox className="size-3.5" />;
  return <FileText className="size-3.5" />;
}

function mergeTextAroundReference(
  tokens: PromptToken[],
  referenceIndex: number,
): { tokens: PromptToken[]; focus?: { textTokenId: string; cursor: number } } {
  const before = tokens[referenceIndex - 1];
  const after = tokens[referenceIndex + 1];

  if (before?.type === "text" && after?.type === "text") {
    const merged = createTextToken(`${before.text}${after.text}`);
    return {
      tokens: [
        ...tokens.slice(0, referenceIndex - 1),
        merged,
        ...tokens.slice(referenceIndex + 2),
      ],
      focus: { textTokenId: merged.id, cursor: before.text.length },
    };
  }

  const nextTokens = tokens.filter((_, index) => index !== referenceIndex);
  return {
    tokens: nextTokens.length > 0 ? nextTokens : [createTextToken()],
  };
}

// CSS `field-sizing: content` keeps segment width and height in one sizing path;
// JS measurement caused caret and wrapping jitter here.
function PromptTextSegment({
  token,
  placeholder,
  isCommandVariant,
  roomyOnMobile,
  registerRef,
  onFocus,
  onChange,
  onKeyDown,
}: {
  token: PromptTextToken;
  placeholder?: string;
  isCommandVariant: boolean;
  roomyOnMobile: boolean;
  registerRef: (id: string, node: HTMLTextAreaElement | null) => void;
  onFocus: () => void;
  onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
}) {
  const isPlaceholderSegment = Boolean(placeholder);

  return (
    <PromptInputTextarea
      ref={(node) => registerRef(token.id, node)}
      name={`prompt-segment-${token.id}`}
      placeholder={placeholder ?? ""}
      rows={1}
      value={token.text}
      onChange={onChange}
      onFocus={onFocus}
      onKeyDown={onKeyDown}
      className={cn(
        `max-w-full p-0 placeholder:text-muted-foreground/40 ${typeStyle("control.input")}`,
        isPlaceholderSegment
          ? isCommandVariant
            ? "min-h-24 min-w-56 flex-[1_1_14rem]"
            : roomyOnMobile
              ? "min-h-14 min-w-36 flex-[1_1_12rem] sm:min-h-6"
              : "min-h-6 min-w-36 flex-[1_1_12rem]"
          : "min-h-6 w-auto min-w-px flex-none self-start",
      )}
    />
  );
}

function PreparedInputActions({
  visible,
  hasPolicyTargets,
  hasRequirementTargets,
  hasMailboxTargets,
  onOpenTargetPicker,
}: {
  visible: boolean;
  hasPolicyTargets: boolean;
  hasRequirementTargets: boolean;
  hasMailboxTargets: boolean;
  onOpenTargetPicker: (marker: "@" | "/", kinds: PromptTargetKind[]) => void;
}) {
  const actions: Array<{
    id: string;
    label: string;
    icon: React.ReactNode;
    onSelect: () => void;
  }> = [];

  if (hasPolicyTargets) {
    actions.push({
      id: "policy",
      label: "Policy",
      icon: <FileText className="size-3.5" />,
      onSelect: () => {
        onOpenTargetPicker("@", PREPARED_POLICY_TARGET_KINDS);
      },
    });
  }

  if (hasRequirementTargets) {
    actions.push({
      id: "requirement",
      label: "Requirement",
      icon: <BadgeCheck className="size-3.5" />,
      onSelect: () => {
        onOpenTargetPicker("@", PREPARED_REQUIREMENT_TARGET_KINDS);
      },
    });
  }

  if (hasMailboxTargets) {
    actions.push({
      id: "mailbox",
      label: "Mailbox",
      icon: <Inbox className="size-3.5" />,
      onSelect: () => {
        onOpenTargetPicker("/", PREPARED_MAILBOX_TARGET_KINDS);
      },
    });
  }

  if (actions.length === 0) {
    return null;
  }

  return (
    <div
      aria-label="Prepared prompt actions"
      aria-hidden={!visible}
      data-spot-prepared-actions
      className={cn(
        "flex min-w-0 items-center overflow-hidden transition-[max-width,opacity,transform,margin] duration-0 ease-linear",
        visible
          ? "mr-1 max-w-[min(24rem,100%)] translate-y-0 opacity-100"
          : "mr-0 max-w-0 -translate-y-0.5 opacity-0 pointer-events-none",
      )}
    >
      <div className="flex min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {actions.map((action) => (
          <PillButton
            key={action.id}
            type="button"
            aria-label={action.label}
            tabIndex={visible ? 0 : -1}
            onMouseDown={(event) => event.preventDefault()}
            onClick={(event) => {
              event.preventDefault();
              action.onSelect();
            }}
            variant="secondary"
            size="compact"
          >
            {action.icon}
            <span className="hidden sm:inline">{action.label}</span>
          </PillButton>
        ))}
      </div>
    </div>
  );
}

function findActiveTrigger(
  value: string,
  cursor: number,
  textTokenId: string,
): PromptTrigger | null {
  const prefix = value.slice(0, cursor);
  const match = prefix.match(/(^|\s)([@/])([^\s@/]*)$/);
  if (!match) return null;
  const marker = match[2] as "@" | "/";
  const query = match[3] ?? "";
  return {
    marker,
    query,
    start: prefix.length - marker.length - query.length,
    end: cursor,
    textTokenId,
  };
}

export interface SpotPromptInputHandle {
  setValueAndFocus: (value: string) => void;
  focus: () => void;
}

export interface SpotPromptInputProps {
  onSubmit: (message: PromptInputMessage) => void | Promise<void>;
  placeholder?: string;
  showAttach?: boolean;
  attachmentAccept?: string;
  multipleAttachments?: boolean;
  maxFiles?: number;
  maxFileSize?: number;
  onAttachmentError?: (message: string) => void;
  defaultReferences?: PromptReference[];
  roomyOnMobile?: boolean;
  disabled?: boolean;
  status?: ChatStatus;
  submittedLabel?: string;
  onStop?: () => void;
  orgId?: Id<"organizations">;
  /** `dock` is the agent dock's flat single-row composer. */
  variant?: "default" | "command" | "dock";
  /** Leading footer slot, e.g. the agent dock's page-context chip. */
  contextChip?: React.ReactNode;
  /** Trailing controls before attach, e.g. the page-context toggle. */
  toolbarEnd?: React.ReactNode;
}

export const SpotPromptInput = forwardRef<
  SpotPromptInputHandle,
  SpotPromptInputProps
>(function SpotPromptInput(
  {
    onSubmit,
    placeholder = "Ask Spot...",
    showAttach = true,
    attachmentAccept,
    multipleAttachments = false,
    maxFiles,
    maxFileSize,
    onAttachmentError,
    defaultReferences,
    roomyOnMobile = false,
    disabled = false,
    status,
    submittedLabel = "Sending",
    onStop,
    orgId,
    variant = "default",
    contextChip,
    toolbarEnd,
  },
  ref,
) {
  const isCommandVariant = variant === "command";
  const isDockVariant = variant === "dock";
  const wrapperRef = useRef<HTMLDivElement>(null);
  const textAreaRefs = useRef(new Map<string, HTMLTextAreaElement>());
  const pendingFocusRef = useRef<{
    textTokenId: string;
    cursor: number;
  } | null>(null);
  const pointerFrameRef = useRef<number | null>(null);
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [pointerIntent, setPointerIntent] = useState(0);
  const [isComposerFocused, setIsComposerFocused] = useState(false);
  const [tokenState, setTokenState] = useState(() => {
    const initialTokens = initialPromptTokens(defaultReferences);
    return {
      tokens: initialTokens,
      activeTextTokenId: firstTextTokenId(initialTokens),
    };
  });
  const tokens = tokenState.tokens;
  const activeTextTokenId = tokenState.activeTextTokenId;
  const setTokens = useCallback((action: PromptTokensAction) => {
    setTokenState((current) => ({
      ...current,
      tokens: typeof action === "function" ? action(current.tokens) : action,
    }));
  }, []);
  const setActiveTextTokenId = useCallback((textTokenId: string) => {
    setTokenState((current) =>
      current.activeTextTokenId === textTokenId
        ? current
        : { ...current, activeTextTokenId: textTokenId },
    );
  }, []);
  const [activeTrigger, setActiveTrigger] = useState<PromptTrigger | null>(
    null,
  );
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [pickerRect, setPickerRect] = useState<{
    left: number;
    width: number;
    top?: number;
    bottom?: number;
    maxHeight: number;
  } | null>(null);
  const targets = useCachedAgentTargets(orgId);
  const references = useMemo(() => promptTokensToReferences(tokens), [tokens]);
  const messageText = useMemo(() => promptTokensToText(tokens), [tokens]);
  const isPromptEmpty =
    references.length === 0 && promptTokensAreTextEmpty(tokens);
  const defaultReferencesSignature = useMemo(
    () =>
      (defaultReferences ?? [])
        .map(
          (reference) =>
            `${referenceKey(reference)}:${encodeURIComponent(reference.label)}`,
        )
        .join("|"),
    [defaultReferences],
  );
  const defaultReferencesSignatureRef = useRef(defaultReferencesSignature);

  const mentionTargets = useMemo<MentionTarget[]>(() => {
    if (!targets) return [];
    return [
      ...targets.policies,
      ...targets.requirements,
      ...targets.mailboxes,
    ].map((target) => ({
      kind: target.kind,
      id: target.id,
      label: target.label,
      sublabel: target.sublabel,
    }));
  }, [targets]);

  const suggestions = useMemo(() => {
    if (!activeTrigger) return [];
    const allowedKinds = targetKindsForTrigger(activeTrigger);
    const query = activeTrigger.query.toLowerCase();
    return mentionTargets
      .filter((target) => allowedKinds.includes(target.kind))
      .filter((target) => {
        if (!query) return true;
        return `${target.label} ${target.sublabel ?? ""} ${target.kind}`
          .toLowerCase()
          .includes(query);
      })
      .slice(0, 8);
  }, [activeTrigger, mentionTargets]);

  const updatePickerRect = useCallback(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper || !activeTrigger || suggestions.length === 0) {
      setPickerRect(null);
      return;
    }
    const rect = wrapper.getBoundingClientRect();
    const gap = isCommandVariant ? 6 : 8;
    const viewportPadding = 16;
    const availableBelow =
      window.innerHeight - rect.bottom - gap - viewportPadding;
    const availableAbove = rect.top - gap - viewportPadding;
    setPickerRect({
      left: rect.left,
      width: rect.width,
      ...(isCommandVariant
        ? { top: rect.bottom + gap }
        : { bottom: Math.max(0, window.innerHeight - rect.top + gap) }),
      maxHeight: Math.max(
        120,
        isCommandVariant ? availableBelow : availableAbove,
      ),
    });
  }, [activeTrigger, isCommandVariant, suggestions.length]);

  useEffect(() => {
    updatePickerRect();
  }, [updatePickerRect, tokens, references.length]);

  useEffect(() => {
    if (!defaultReferencesSignature) {
      defaultReferencesSignatureRef.current = "";
      return;
    }
    if (defaultReferencesSignatureRef.current === defaultReferencesSignature) {
      return;
    }
    defaultReferencesSignatureRef.current = defaultReferencesSignature;
    setTokens((current) =>
      mergeDefaultReferencesIntoTokens(current, defaultReferences),
    );
  }, [defaultReferences, defaultReferencesSignature, setTokens]);

  useEffect(() => {
    if (!activeTrigger || suggestions.length === 0) return;
    window.addEventListener("resize", updatePickerRect);
    window.addEventListener("scroll", updatePickerRect, true);
    return () => {
      window.removeEventListener("resize", updatePickerRect);
      window.removeEventListener("scroll", updatePickerRect, true);
    };
  }, [activeTrigger, suggestions.length, updatePickerRect]);

  const registerTextAreaRef = useCallback(
    (id: string, node: HTMLTextAreaElement | null) => {
      if (node) {
        textAreaRefs.current.set(id, node);
      } else {
        textAreaRefs.current.delete(id);
      }
    },
    [],
  );

  useEffect(() => {
    const pending = pendingFocusRef.current;
    if (!pending) return;
    const textArea = textAreaRefs.current.get(pending.textTokenId);
    if (!textArea) return;

    pendingFocusRef.current = null;
    requestAnimationFrame(() => {
      textArea.focus();
      textArea.setSelectionRange(pending.cursor, pending.cursor);
    });
  }, [tokens]);

  const queueTextFocus = useCallback((textTokenId: string, cursor: number) => {
    pendingFocusRef.current = { textTokenId, cursor };
  }, []);

  const updateTriggerFromTextarea = useCallback(
    (textarea: HTMLTextAreaElement, textTokenId: string) => {
      const trigger = findActiveTrigger(
        textarea.value,
        textarea.selectionStart,
        textTokenId,
      );
      setActiveTrigger((current) => {
        if (!trigger) return null;
        if (
          current?.preparedKinds &&
          current.marker === trigger.marker &&
          current.start === trigger.start &&
          current.textTokenId === trigger.textTokenId
        ) {
          return { ...trigger, preparedKinds: current.preparedKinds };
        }
        return trigger;
      });
      setSelectedIndex(0);
    },
    [],
  );

  const openPreparedTargetPicker = useCallback(
    (marker: "@" | "/", kinds: PromptTargetKind[]) => {
      const textToken =
        tokens.find(
          (token): token is PromptTextToken =>
            token.type === "text" && token.id === activeTextTokenId,
        ) ??
        tokens.find((token): token is PromptTextToken => token.type === "text");
      if (!textToken) return;
      const trigger: PromptTrigger = {
        marker,
        query: "",
        start: 0,
        end: marker.length,
        textTokenId: textToken.id,
        preparedKinds: kinds,
      };
      setTokens((current) =>
        current.map((token) =>
          token.type === "text" && token.id === textToken.id
            ? { ...token, text: marker }
            : token,
        ),
      );
      setActiveTextTokenId(textToken.id);
      setActiveTrigger(trigger);
      setSelectedIndex(0);
      queueTextFocus(textToken.id, marker.length);
    },
    [
      activeTextTokenId,
      queueTextFocus,
      setActiveTextTokenId,
      setTokens,
      tokens,
    ],
  );

  const selectTarget = useCallback(
    (target: MentionTarget) => {
      if (!activeTrigger) return;
      setTokens((current) => {
        const textIndex = current.findIndex(
          (token) =>
            token.type === "text" && token.id === activeTrigger.textTokenId,
        );
        const textToken = current[textIndex];
        if (textIndex === -1 || textToken?.type !== "text") return current;

        const before = textToken.text.slice(0, activeTrigger.start);
        const after = textToken.text.slice(activeTrigger.end);
        const reference: PromptReference = {
          kind: target.kind,
          id: target.id,
          label: target.label,
        };
        const existingReference = current.some(
          (token) =>
            token.type === "reference" &&
            referenceKey(token.reference) === referenceKey(reference),
        );

        if (existingReference) {
          const nextText = `${before}${after}`;
          queueTextFocus(textToken.id, before.length);
          return current.map((token) =>
            token.type === "text" && token.id === textToken.id
              ? { ...token, text: nextText }
              : token,
          );
        }

        const beforeToken = createTextToken(before);
        const referenceToken = createReferenceToken(reference);
        const afterToken = createTextToken(after);
        queueTextFocus(afterToken.id, 0);
        return [
          ...current.slice(0, textIndex),
          beforeToken,
          referenceToken,
          afterToken,
          ...current.slice(textIndex + 1),
        ];
      });
      setActiveTrigger(null);
      setSelectedIndex(0);
    },
    [activeTrigger, queueTextFocus, setTokens],
  );

  const removeReferenceToken = useCallback(
    (referenceTokenId: string) => {
      setTokens((current) => {
        const referenceIndex = current.findIndex(
          (token) =>
            token.type === "reference" && token.id === referenceTokenId,
        );
        if (referenceIndex === -1) return current;
        const result = mergeTextAroundReference(current, referenceIndex);
        if (result.focus) {
          queueTextFocus(result.focus.textTokenId, result.focus.cursor);
        }
        return result.tokens;
      });
      setActiveTrigger(null);
    },
    [queueTextFocus, setTokens],
  );

  const handleTextChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>, textTokenId: string) => {
      const nextText = event.currentTarget.value;
      setTokens((current) =>
        current.map((token) =>
          token.type === "text" && token.id === textTokenId
            ? { ...token, text: nextText }
            : token,
        ),
      );
      updateTriggerFromTextarea(event.currentTarget, textTokenId);
    },
    [setTokens, updateTriggerFromTextarea],
  );

  const handleTextKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>, textTokenId: string) => {
      setActiveTextTokenId(textTokenId);

      const cursorStart = event.currentTarget.selectionStart;
      const cursorEnd = event.currentTarget.selectionEnd;
      const isCollapsedSelection = cursorStart === cursorEnd;
      const currentText = event.currentTarget.value;

      if (
        !activeTrigger &&
        isCollapsedSelection &&
        event.key === "Backspace" &&
        cursorStart === 0
      ) {
        const textIndex = tokens.findIndex(
          (token) => token.type === "text" && token.id === textTokenId,
        );
        const previousToken = tokens[textIndex - 1];
        if (previousToken?.type === "reference") {
          event.preventDefault();
          const result = mergeTextAroundReference(tokens, textIndex - 1);
          if (result.focus) {
            queueTextFocus(result.focus.textTokenId, result.focus.cursor);
          }
          setTokens(result.tokens);
          return;
        }
      }

      if (
        !activeTrigger &&
        isCollapsedSelection &&
        event.key === "Delete" &&
        cursorStart === currentText.length
      ) {
        const textIndex = tokens.findIndex(
          (token) => token.type === "text" && token.id === textTokenId,
        );
        const nextToken = tokens[textIndex + 1];
        if (nextToken?.type === "reference") {
          event.preventDefault();
          const result = mergeTextAroundReference(tokens, textIndex + 1);
          if (result.focus) {
            queueTextFocus(result.focus.textTokenId, result.focus.cursor);
          }
          setTokens(result.tokens);
          return;
        }
      }

      if (
        !activeTrigger ||
        activeTrigger.textTokenId !== textTokenId ||
        suggestions.length === 0
      ) {
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedIndex((index) => (index + 1) % suggestions.length);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedIndex(
          (index) => (index - 1 + suggestions.length) % suggestions.length,
        );
      } else if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        const target = suggestions[selectedIndex] ?? suggestions[0];
        if (target) selectTarget(target);
      } else if (event.key === "Escape") {
        event.preventDefault();
        if (
          activeTrigger.preparedKinds &&
          currentText === activeTrigger.marker
        ) {
          setTokens((current) =>
            current.map((token) =>
              token.type === "text" && token.id === textTokenId
                ? { ...token, text: "" }
                : token,
            ),
          );
          queueTextFocus(textTokenId, 0);
          setActiveTrigger(null);
          return;
        }
        setActiveTrigger(null);
      }
    },
    [
      activeTrigger,
      queueTextFocus,
      selectTarget,
      selectedIndex,
      setActiveTextTokenId,
      setTokens,
      suggestions,
      tokens,
    ],
  );

  const handleDragState = useCallback(
    (event: ReactDragEvent<HTMLFormElement>) => {
      if (!event.dataTransfer.types.includes("Files")) {
        return false;
      }

      event.preventDefault();
      return true;
    },
    [],
  );

  const handleDragEnter = useCallback(
    (event: ReactDragEvent<HTMLFormElement>) => {
      if (handleDragState(event)) {
        setIsDraggingFiles(true);
      }
    },
    [handleDragState],
  );

  const handleDragOver = useCallback(
    (event: ReactDragEvent<HTMLFormElement>) => {
      if (handleDragState(event)) {
        event.dataTransfer.dropEffect = "copy";
        if (!isDraggingFiles) {
          setIsDraggingFiles(true);
        }
      }
    },
    [handleDragState, isDraggingFiles],
  );

  const handleDragLeave = useCallback(
    (event: ReactDragEvent<HTMLFormElement>) => {
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
        return;
      }

      setIsDraggingFiles(false);
    },
    [],
  );

  const handleDrop = useCallback(() => {
    setIsDraggingFiles(false);
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      setValueAndFocus: (v: string) => {
        const nextTokens = promptTokensWithText(v, defaultReferences);
        const textTokenId = firstTextTokenId(nextTokens);
        setTokens(nextTokens);
        setActiveTextTokenId(textTokenId);
        setActiveTrigger(null);
        queueTextFocus(textTokenId, v.length);
      },
      focus: () => {
        const textTokenId = activeTextTokenId || firstTextTokenId(tokens);
        textAreaRefs.current.get(textTokenId)?.focus();
      },
    }),
    [
      activeTextTokenId,
      defaultReferences,
      queueTextFocus,
      setActiveTextTokenId,
      setTokens,
      tokens,
    ],
  );

  const isGenerating = status === "submitted" || status === "streaming";

  const handleSubmit = useCallback(
    async (message: PromptInputMessage) => {
      if (disabled) return;
      const selectedReferences = references;
      await onSubmit({
        ...message,
        references:
          selectedReferences.length > 0 ? selectedReferences : undefined,
      });
      const nextTokens = initialPromptTokens(defaultReferences);
      const textTokenId = firstTextTokenId(nextTokens);
      setTokens(nextTokens);
      setActiveTextTokenId(textTokenId);
      setActiveTrigger(null);
    },
    [
      defaultReferences,
      disabled,
      onSubmit,
      references,
      setActiveTextTokenId,
      setTokens,
    ],
  );

  const handleStopClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      onStop?.();
    },
    [onStop],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const finePointer = window.matchMedia("(pointer: fine)");
    if (!finePointer.matches) return;

    const scheduleIntentUpdate = () => {
      if (pointerFrameRef.current !== null) return;
      pointerFrameRef.current = window.requestAnimationFrame(() => {
        pointerFrameRef.current = null;
        const point = lastPointerRef.current;
        const wrapper = wrapperRef.current;
        if (!point || !wrapper) {
          setPointerIntent(0);
          return;
        }

        const rect = wrapper.getBoundingClientRect();
        const dx = Math.max(rect.left - point.x, 0, point.x - rect.right);
        const dy = Math.max(rect.top - point.y, 0, point.y - rect.bottom);
        const distance = Math.hypot(dx, dy);
        const next = Math.max(0, 1 - distance / INPUT_INTENT_RADIUS) ** 2;
        setPointerIntent((current) =>
          Math.abs(current - next) < INPUT_INTENT_EPSILON ? current : next,
        );
      });
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      lastPointerRef.current = { x: event.clientX, y: event.clientY };
      scheduleIntentUpdate();
    };

    const clearPointerIntent = () => {
      lastPointerRef.current = null;
      if (pointerFrameRef.current !== null) {
        window.cancelAnimationFrame(pointerFrameRef.current);
        pointerFrameRef.current = null;
      }
      setPointerIntent(0);
    };

    window.addEventListener("pointermove", handlePointerMove, {
      passive: true,
    });
    window.addEventListener("resize", scheduleIntentUpdate);
    window.addEventListener("scroll", scheduleIntentUpdate, true);
    window.addEventListener("blur", clearPointerIntent);
    document.addEventListener("mouseleave", clearPointerIntent);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("resize", scheduleIntentUpdate);
      window.removeEventListener("scroll", scheduleIntentUpdate, true);
      window.removeEventListener("blur", clearPointerIntent);
      document.removeEventListener("mouseleave", clearPointerIntent);
      if (pointerFrameRef.current !== null) {
        window.cancelAnimationFrame(pointerFrameRef.current);
      }
    };
  }, []);

  const handleWrapperFocusCapture = useCallback(() => {
    setIsComposerFocused(true);
  }, []);

  const handleWrapperBlurCapture = useCallback(
    (event: React.FocusEvent<HTMLDivElement>) => {
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
        return;
      }
      setIsComposerFocused(false);
      setActiveTrigger(null);
    },
    [],
  );
  const hasPolicyTargets = (targets?.policies.length ?? 0) > 0;
  const hasRequirementTargets = (targets?.requirements.length ?? 0) > 0;
  const hasMailboxTargets = (targets?.mailboxes.length ?? 0) > 0;
  const hasPreparedActions =
    hasPolicyTargets || hasRequirementTargets || hasMailboxTargets;
  const showPreparedActions =
    hasPreparedActions &&
    (pointerIntent >= PREPARED_ACTION_INTENT_THRESHOLD || isComposerFocused) &&
    isPromptEmpty &&
    !activeTrigger &&
    !disabled &&
    !isGenerating &&
    !isDraggingFiles;
  const activeTargetScopeLabel = activeTrigger
    ? targetScopeLabel(targetKindsForTrigger(activeTrigger))
    : null;
  const isSearchDropdownOpen = Boolean(activeTrigger && suggestions.length > 0);
  const pickerPortalRoot =
    typeof document === "undefined" ? null : document.body;

  const submitControls = (
    <div className="flex items-center gap-1">
      {toolbarEnd}
      {showAttach && <AttachmentActionButtons />}
      {isGenerating && onStop ? (
        <PillButton
          type="button"
          size="compact"
          onClick={handleStopClick}
          roomyOnMobile={roomyOnMobile}
        >
          <Square
            className={
              roomyOnMobile
                ? "size-3.5 fill-current sm:size-3"
                : "size-3 fill-current"
            }
          />
          Stop
        </PillButton>
      ) : isDockVariant ? (
        <PillButton
          type="submit"
          size="compact"
          iconOnly
          label="Send"
          disabled={disabled || isGenerating}
        >
          {status === "submitted" ? (
            <Spinner className="size-3.5" />
          ) : (
            <ArrowUp className="size-3.5" />
          )}
        </PillButton>
      ) : (
        <PillButton
          type="submit"
          size="compact"
          disabled={disabled || isGenerating}
          roomyOnMobile={roomyOnMobile}
        >
          {status === "submitted" ? (
            <>
              <Spinner
                className={
                  roomyOnMobile
                    ? "size-4 sm:size-3.5"
                    : "size-3.5"
                }
              />
              {submittedLabel}
            </>
          ) : (
            <>
              <ArrowUp
                className={
                  roomyOnMobile
                    ? "size-4 sm:size-3.5"
                    : "size-3.5"
                }
              />
              Send
            </>
          )}
        </PillButton>
      )}
    </div>
  );

  const tokenEditor = (
  <div
    className={cn(
      "flex w-full flex-wrap content-start items-center gap-x-1 gap-y-1",
      isDockVariant
        ? "min-h-6 min-w-0 flex-1"
        : isCommandVariant
        ? "min-h-28 px-4 pb-2 pt-4"
        : roomyOnMobile
          ? "min-h-22 px-4 pb-2 pt-3 sm:min-h-6 sm:px-3 sm:pb-1 sm:pt-2.5"
          : "min-h-6 px-3 pb-1 pt-2.5",
    )}
    onClick={(event) => {
      if ((event.target as HTMLElement).closest("textarea,button")) {
        return;
      }
      const textTokenId = activeTextTokenId || firstTextTokenId(tokens);
      textAreaRefs.current.get(textTokenId)?.focus();
    }}
  >
    <input readOnly type="hidden" name="message" value={messageText} />
    {tokens.map((token) =>
      token.type === "reference" ? (
        isSearchDropdownOpen ? null : (
          <PromptReferenceTag
            key={token.id}
            kind={token.reference.kind}
            label={token.reference.label}
            onRemove={() => removeReferenceToken(token.id)}
          />
        )
      ) : (
        <PromptTextSegment
          key={token.id}
          token={token}
          placeholder={
            isPromptEmpty && token.id === firstTextTokenId(tokens)
              ? placeholder
              : undefined
          }
          isCommandVariant={isCommandVariant}
          roomyOnMobile={roomyOnMobile}
          registerRef={registerTextAreaRef}
          onFocus={() => {
            setActiveTextTokenId(token.id);
            const textArea = textAreaRefs.current.get(token.id);
            if (textArea) {
              updateTriggerFromTextarea(textArea, token.id);
            }
          }}
          onChange={(event) => handleTextChange(event, token.id)}
          onKeyDown={(event) => handleTextKeyDown(event, token.id)}
        />
      ),
    )}
  </div>
  );

  return (
    <div
      ref={wrapperRef}
      className="relative w-full"
      onFocusCapture={handleWrapperFocusCapture}
      onBlurCapture={handleWrapperBlurCapture}
    >
      {pickerPortalRoot && activeTrigger && suggestions.length > 0 && pickerRect
        ? createPortal(
            <div
              className="fixed z-[60] overflow-hidden rounded-xl border border-input bg-popover p-1.5 shadow-lg shadow-black/[0.08]"
              style={{
                left: pickerRect.left,
                width: pickerRect.width,
                maxHeight: pickerRect.maxHeight,
                ...(pickerRect.top !== undefined
                  ? { top: pickerRect.top }
                  : { bottom: pickerRect.bottom }),
              }}
            >
              <div
                className="overflow-auto"
                style={{ maxHeight: pickerRect.maxHeight }}
              >
                {suggestions.map((target, index) => (
                  <button
                    key={`${target.kind}-${target.id}`}
                    type="button"
                    onMouseDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                    }}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      selectTarget(target);
                    }}
                    className={cn(
                      "flex min-h-10 w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors",
                      index === selectedIndex
                        ? "bg-foreground/[0.06] text-foreground"
                        : "text-foreground/85 hover:bg-foreground/[0.04] hover:text-foreground",
                    )}
                  >
                    <span className="flex w-5 shrink-0 items-center justify-center text-muted-foreground">
                      {referenceIcon(target.kind)}
                    </span>
                    <span
                      className={`min-w-0 flex-1 truncate ${typeStyle("body.medium")}`}
                    >
                      {target.label}
                    </span>
                  </button>
                ))}
              </div>
            </div>,
            pickerPortalRoot,
          )
        : null}
      <PromptInput
        onSubmit={handleSubmit}
        accept={attachmentAccept}
        multiple={multipleAttachments}
        maxFiles={maxFiles}
        maxFileSize={maxFileSize}
        onError={(error) => onAttachmentError?.(error.message)}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        className={cn(
          "overflow-hidden **:data-[slot=input-group]:!border-0 **:data-[slot=input-group]:!ring-0 **:data-[slot=input-group]:rounded-none **:data-[slot=input-group]:bg-transparent **:data-[slot=input-group]:!shadow-none",
          isDockVariant
            ? "rounded-none border-0 bg-transparent **:data-[slot=input-group]:h-auto **:data-[slot=input-group]:flex-col"
            : "rounded-xl border bg-card transition-[background-color,border-color,box-shadow] duration-100 hover:border-border-hover focus-within:border-border-focus",
          isCommandVariant
            ? "border-border-emphasized shadow-lg shadow-black/[0.08] dark:shadow-black/30"
            : !isDockVariant && "border-border shadow-none focus-within:shadow-none",
          isDraggingFiles && "border-primary/40 bg-primary/5",
        )}
      >
        <AttachmentTags
          roomyOnMobile={roomyOnMobile || isCommandVariant}
          detailed={isCommandVariant}
        />
        {isDockVariant ? (
          <div className="flex w-full min-w-0 items-center gap-2 py-2">
            {contextChip}
            {tokenEditor}
            {submitControls}
          </div>
        ) : (
          <>
            {tokenEditor}
            <PromptInputFooter
              className={
                isCommandVariant
                  ? "overflow-hidden px-3 pb-3 pt-1"
                  : roomyOnMobile
                    ? "overflow-hidden px-3 sm:px-2 pb-2 sm:pb-1.5 pt-0.5 sm:pt-0"
                    : "overflow-hidden px-2 pb-1.5 pt-0"
              }
            >
              <PromptInputTools className="min-w-0 flex-1 overflow-hidden">
                {contextChip}
                <PreparedInputActions
                  visible={showPreparedActions}
                  hasPolicyTargets={hasPolicyTargets}
                  hasRequirementTargets={hasRequirementTargets}
                  hasMailboxTargets={hasMailboxTargets}
                  onOpenTargetPicker={openPreparedTargetPicker}
                />
                <div
                  className={cn(
                    "flex min-w-0 items-center gap-1.5 overflow-hidden transition-[max-width,opacity,transform,margin] duration-0 ease-linear",
                    showPreparedActions
                      ? "ml-0 max-w-0 -translate-y-0.5 opacity-0 pointer-events-none"
                      : roomyOnMobile
                        ? "ml-1.5 max-w-96 translate-y-0 opacity-100 sm:ml-1"
                        : "ml-1 max-w-96 translate-y-0 opacity-100",
                  )}
                >
                  {activeTargetScopeLabel ? (
                    <span
                      className={`min-w-0 truncate text-muted-foreground/45 ${typeStyle("caption.medium")}`}
                    >
                      {activeTargetScopeLabel}
                    </span>
                  ) : null}
                </div>
              </PromptInputTools>

              <PromptInputTools className="shrink-0">
                {submitControls}
              </PromptInputTools>
            </PromptInputFooter>
          </>
        )}
      </PromptInput>
    </div>
  );
});

/**
 * Overlay footer layout for chat pages where the input sits above scrollable content.
 */
/** Composer pinned under the transcript, on the chat surface. */
export function ChatInputOverlay({
  children,
  composerRef,
}: {
  children: React.ReactNode;
  /** The opaque composer area, excluding the fade above it. */
  composerRef?: React.Ref<HTMLDivElement>;
}) {
  return (
    <div className="absolute bottom-0 left-0 right-0 z-10 pointer-events-none">
      <div className="relative h-8" aria-hidden="true">
        <InputOverlayFade />
      </div>
      <div
        ref={composerRef}
        className="pointer-events-auto border-t border-border bg-(--chat-surface,var(--background)) px-3 md:px-4"
      >
        {children}
      </div>
    </div>
  );
}
