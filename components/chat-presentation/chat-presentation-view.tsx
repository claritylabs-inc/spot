"use client";

import {
  Component,
  useCallback,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { defineRegistry, JSONUIProvider, Renderer } from "@json-render/react";
import { chatPresentationCatalog } from "@/lib/chat-presentation-catalog";
import {
  parseChatPresentation,
  type PresentationReference,
} from "@/lib/chat-presentation";
import { typeStyle } from "@/lib/typography";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import {
  PresentationContext,
  type EvidenceInspection,
  type PresentationFollowUp,
} from "./context";
import { ProseMarkdown } from "@/components/prose-markdown";
import {
  OperationalLabelValueList,
  OperationalLabelValueRow,
} from "@/components/ui/operational-panel";
import { ReferenceLink, referenceHref, Sources } from "./references";
import {
  ChoiceGroup,
  ClarificationForm,
  FollowUpButton,
  RecordSelector,
} from "./forms";
import {
  ComparisonTable,
  FactList,
  FindingsList,
  RecordList,
  RequirementMatrix,
} from "./results";

const { registry } = defineRegistry(chatPresentationCatalog, {
  components: {
    Stack: ({ children }) => <div className="space-y-4">{children}</div>,
    Section: ({ props, children }) => (
      <section className="space-y-3">
        {props.title ? (
          <h3 className={typeStyle("heading.item")}>{props.title}</h3>
        ) : null}
        {children}
      </section>
    ),
    Text: ({ props }) => (
      <ProseMarkdown gfm breaks>
        {props.text}
      </ProseMarkdown>
    ),
    FactList: ({ props }) => <FactList {...props} />,
    ComparisonTable: ({ props }) => <ComparisonTable {...props} />,
    RecordList: ({ props }) => <RecordList {...props} />,
    FindingsList: ({ props }) => <FindingsList {...props} />,
    RequirementMatrix: ({ props }) => <RequirementMatrix {...props} />,
    DateList: ({ props }) => <FactList facts={props.dates} />,
    SourceReference: ({ props }) => <ReferenceLink {...props} />,
    FileReference: ({ props }) => <ReferenceLink {...props} />,
    ChoiceGroup: ({ props }) => <ChoiceGroup {...props} />,
    RecordSelector: ({ props }) => <RecordSelector {...props} />,
    ClarificationForm: ({ props }) => <ClarificationForm {...props} />,
    ActionGroup: ({ props }) => (
      <div className="flex flex-wrap gap-2">
        {props.actions.map((action, index) =>
          action.referenceId ? (
            <ReferenceLink
              key={index}
              referenceId={action.referenceId}
              label={action.label}
            />
          ) : action.followUp ? (
            <FollowUpButton
              key={index}
              message={action.followUp}
              label={action.label}
            />
          ) : null,
        )}
      </div>
    ),
  },
});

class PresentationBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export function ChatPresentationView({
  presentation,
  onFollowUp,
  disabled = false,
  audience = "client",
  organizationId,
  answer = null,
  structuredReferences = false,
}: {
  presentation: unknown;
  onFollowUp?: PresentationFollowUp;
  disabled?: boolean;
  audience?: "operator" | "client";
  organizationId?: string;
  answer?: ReactNode;
  structuredReferences?: boolean;
}) {
  const parsed = useMemo(
    () => parseChatPresentation(presentation),
    [presentation],
  );
  const [selected, setSelected] = useState<
    | { kind: "record"; reference: PresentationReference; detail?: string }
    | { kind: "evidence"; evidence: EvidenceInspection }
    | null
  >(null);
  const openRecord = useCallback(
    (reference: PresentationReference, detail?: string) =>
      setSelected({ kind: "record", reference, detail }),
    [],
  );
  const openEvidence = useCallback(
    (evidence: EvidenceInspection) =>
      setSelected({ kind: "evidence", evidence }),
    [],
  );
  const closeRecord = useCallback(() => setSelected(null), []);
  const inFlight = useRef(false);
  const [sending, setSending] = useState(false);
  const followUp = useCallback(
    async (message: string, selectedReferences?: PresentationReference[]) => {
      if (disabled || !onFollowUp || inFlight.current)
        throw new Error("Wait for the current task to finish.");
      inFlight.current = true;
      setSending(true);
      try {
        await onFollowUp(message, selectedReferences);
      } finally {
        inFlight.current = false;
        setSending(false);
      }
    },
    [disabled, onFollowUp],
  );
  const context = useMemo(
    () => ({
      references: new Map(
        parsed?.references.map((reference) => [reference.id, reference]),
      ),
      disabled: disabled || sending,
      audience,
      organizationId,
      structuredReferences,
      openEvidence,
      onFollowUp: onFollowUp ? followUp : undefined,
      openRecord,
      closeRecord,
    }),
    [
      parsed,
      disabled,
      sending,
      audience,
      organizationId,
      structuredReferences,
      openEvidence,
      onFollowUp,
      followUp,
      openRecord,
      closeRecord,
    ],
  );
  if (
    !parsed ||
    !Object.values(parsed.spec.elements).some((element) => {
      if (element.type === "Stack") return false;
      if (element.type === "Section")
        return Boolean(element.props.title?.trim());
      if (element.type === "Text") return Boolean(element.props.text.trim());
      return true;
    })
  )
    return answer;
  return (
    <div className="space-y-4">
      {answer}
      <PresentationBoundary key={parsed.sourceRevision}>
        <PresentationContext.Provider value={context}>
          <div
            className={`min-w-0 max-w-full space-y-4 [overflow-wrap:anywhere] ${typeStyle("body.default")}`}
          >
            <JSONUIProvider registry={registry}>
              <Renderer spec={parsed.spec} registry={registry} />
            </JSONUIProvider>
          </div>
          {selected ? (
            <div className="fixed inset-y-0 right-0 z-50 w-full max-w-md bg-background">
              <SettingsDrawer
                open
                onOpenChange={(open) => {
                  if (!open) setSelected(null);
                }}
                title={
                  selected.kind === "evidence"
                    ? selected.evidence.title
                    : selected.reference.label
                }
                footer={
                  selected.kind === "evidence" ? (
                    <Sources ids={selected.evidence.sourceIds} />
                  ) : referenceHref(selected.reference) ||
                    selected.reference.kind === "file" ||
                    selected.reference.kind === "policy" ||
                    selected.reference.policyId ? (
                    <ReferenceLink
                      referenceId={selected.reference.id}
                      label={
                        selected.reference.kind === "file"
                          ? "Open file"
                          : "Open record"
                      }
                    />
                  ) : undefined
                }
              >
                {selected.kind === "evidence" ? (
                  <OperationalLabelValueList>
                    {selected.evidence.values.map((value, index) => (
                      <OperationalLabelValueRow
                        key={index}
                        label={value.label}
                        value={value.value || "—"}
                      />
                    ))}
                  </OperationalLabelValueList>
                ) : (
                  <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">
                    {selected.detail ?? selected.reference.label}
                  </p>
                )}
              </SettingsDrawer>
            </div>
          ) : null}
        </PresentationContext.Provider>
      </PresentationBoundary>
    </div>
  );
}
