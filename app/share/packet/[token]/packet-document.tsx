"use client";
import {
  Children,
  isValidElement,
  useMemo,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import type { Components, ExtraProps } from "react-markdown";
import { ArrowUpRight } from "lucide-react";
import { toast } from "sonner";
import { ProseMarkdown } from "@/components/prose-markdown";
import { PillButton } from "@/components/ui/pill-button";
import { OperationalPanel } from "@claritylabs-inc/ui/components/operational-panel";
import { SpotWordmark } from "@claritylabs-inc/ui/components/brand/spot-wordmark";
import { TextLink } from "@/components/ui/text-link";
import { formatDisplayDateTimeUtc } from "@/lib/date-format";
import { splitSubmissionNotes } from "@/lib/intake-application";
import { hideApplicationControlMarkers } from "@/lib/intake-markdown-presentation";
import { typeStyle } from "@/lib/typography";
import { cn } from "@/lib/utils";
import { preparePacketMarkdown } from "./packet-markdown";
import type { PacketView } from "./view";

type HeadingTag = "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
type HeadingRole = "heading.section" | "heading.item" | "heading.micro";

/** Maps authored heading levels onto typography roles; levels differ by size only. */
function packetHeadings(roles: Record<HeadingTag, HeadingRole>): Components {
  return Object.fromEntries(
    (Object.keys(roles) as HeadingTag[]).map((Tag) => [
      Tag,
      function PacketHeading({
        node,
        className,
        ...props
      }: ComponentPropsWithoutRef<HeadingTag> & { node?: unknown }) {
        void node;
        return (
          <Tag
            {...props}
            data-prose-heading=""
            className={cn(typeStyle(roles[Tag]), className)}
          />
        );
      },
    ]),
  );
}

/** Application: each top-level heading opens a section; coverages and groups sit below it. */
const applicationHeadings = packetHeadings({
  h1: "heading.section",
  h2: "heading.section",
  h3: "heading.micro",
  h4: "heading.micro",
  h5: "heading.micro",
  h6: "heading.micro",
});

/** Submission notes sit under their card title, so they start one level down. */
const noteHeadings = packetHeadings({
  h1: "heading.item",
  h2: "heading.item",
  h3: "heading.micro",
  h4: "heading.micro",
  h5: "heading.micro",
  h6: "heading.micro",
});

const NOTE_PROSE_SPACING =
  "[&_h1]:mt-7 [&_h1]:mb-2 [&_h2]:mt-7 [&_h2]:mb-2 [&_h3]:mt-5 [&_h3]:mb-1.5 [&_h4]:mt-5 [&_h4]:mb-1.5 [&_h5]:mt-5 [&_h5]:mb-1.5 [&_h6]:mt-5 [&_h6]:mb-1.5 [&_p]:my-3 [&_ul]:my-3 [&_ol]:my-3";

const APPLICATION_PROSE_SPACING =
  "[&>section+section]:mt-10 [&>section+section]:border-t [&>section+section]:border-border [&>section+section]:pt-10 [&_h1]:mb-4 [&_h2]:mb-4 [&_h3]:mt-8 [&_h3]:mb-3 [&_h2+h3]:mt-0 [&_h4]:mt-6 [&_h4]:mb-2 [&_h5]:mt-5 [&_h5]:mb-2 [&_h6]:mt-5 [&_h6]:mb-2 [&_h1:first-child]:mt-0 [&_h2:first-child]:mt-0 [&_h3:first-child]:mt-0";

/** One label/value line in the application's two-column list. */
function Pair({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:gap-6">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 whitespace-pre-wrap break-words">{children}</dd>
    </div>
  );
}

function PairList({
  separated = false,
  children,
}: {
  separated?: boolean;
  children: ReactNode;
}) {
  return (
    <dl
      className={cn(
        "my-0 grid gap-y-3 [&+dl]:mt-3",
        separated &&
          "[&+dl]:mt-6 [&+dl]:border-t [&+dl]:border-border/60 [&+dl]:pt-6",
      )}
    >
      {children}
    </dl>
  );
}

type PacketFile = NonNullable<PacketView>["files"][number];
function PacketFilePairs({ files }: { files: PacketFile[] }) {
  const groups = [
    { category: "requirements", label: "Insurance requirements" },
    { category: "policy", label: "Current policies" },
    { category: "loss_runs", label: "Loss runs / claims history" },
    { category: "supporting", label: "Other documents" },
  ];
  return groups.map((group) => {
    const documents = files.filter(
      (file) => (file.documentCategory ?? "supporting") === group.category,
    );
    if (!documents.length) return null;
    return (
      <Pair key={group.category} label={group.label}>
        <span className="block space-y-1">
          {documents.map((file) =>
            file.downloadUrl ? (
              <a
                key={file._id}
                href={file.downloadUrl}
                target="_blank"
                rel="noreferrer"
                className="block break-words underline underline-offset-2"
              >
                {file.name}
              </a>
            ) : (
              <span key={file._id} className="block break-words">
                {file.name}
                <span
                  className={`ml-2 text-muted-foreground ${typeStyle("caption.default")}`}
                >
                  Listed
                </span>
              </span>
            ),
          )}
        </span>
      </Pair>
    );
  });
}
function filesForPart(files: PacketFile[], part: unknown) {
  const categories =
    part === "coverage"
      ? ["requirements", "policy"]
      : part === "request"
        ? ["requirements", "supporting"]
        : part === "history"
          ? ["policy", "loss_runs"]
          : [];
  return files.filter((file) =>
    categories.includes(file.documentCategory ?? "supporting"),
  );
}

function cellText(node: ExtraProps["node"]): string {
  if (!node) return "";
  return node.children
    .map((child) =>
      child.type === "text"
        ? child.value
        : child.type === "element"
          ? cellText(child)
          : "",
    )
    .join("");
}

/** Without a managed application block, all shared prose stays as request details. */
function packetParts(markdown: string) {
  const { notes, application } = splitSubmissionNotes(markdown);
  if (!application) return { notes: "", details: markdown, application: false };
  return {
    // The card supplies the heading; a leading generic one would repeat it.
    notes: notes
      .trim()
      .replace(
        /^#{1,3} (?:request|notes|submission notes|additional context)\s*\n+/i,
        "",
      ),
    details: application,
    application: true,
  };
}

function DocumentSection({
  title,
  children,
  ...props
}: ComponentPropsWithoutRef<"section"> & { title: string }) {
  return (
    <section {...props} className="scroll-mt-8">
      <h2 className={typeStyle("heading.section")}>{title}</h2>
      <OperationalPanel className="mt-3 p-6 sm:p-8 print:border-0 print:p-0">
        {children}
      </OperationalPanel>
    </section>
  );
}

export function PacketDocument({ view }: { view: NonNullable<PacketView> }) {
  const parts = useMemo(() => packetParts(view.markdown), [view.markdown]);
  const presentedMarkdown = hideApplicationControlMarkers(
    parts.details,
  ).replace(/^#{1,2} Request\s*\n+(?=#{2,6} Contact details\b)/gm, "");
  const packetMarkdown = useMemo(
    () => preparePacketMarkdown(presentedMarkdown),
    [presentedMarkdown],
  );
  const plugins = useMemo(
    () => [packetMarkdown.rehypePacketSections],
    [packetMarkdown],
  );
  const applicationComponents = useMemo<Components>(
    () => ({
      ...applicationHeadings,
      table: ({ node, children }) => {
        const files = filesForPart(
          view.files,
          node?.properties?.dataRequestFilePart,
        );
        const firstLabel = node
          ? cellText(
              node.children
                .flatMap((group) =>
                  group.type === "element" && group.tagName === "tbody"
                    ? group.children
                    : [],
                )
                .find((row) => row.type === "element")
                ?.children.find(
                  (cell) => cell.type === "element",
                ) as ExtraProps["node"],
            )
          : "";
        return (
          <PairList
            separated={/^(?:Location|Property|Vehicle)\b/.test(firstLabel)}
          >
            {children}
            {files.length > 0 && <PacketFilePairs files={files} />}
          </PairList>
        );
      },
      thead: () => null,
      tbody: ({ children }) => <>{children}</>,
      tr: ({ children }) => {
        const cells = Children.toArray(children)
          .filter(isValidElement)
          .map((cell) => (cell.props as { children?: ReactNode }).children);
        return <Pair label={cells[0]}>{cells[1]}</Pair>;
      },
      section: ({ children, node }) => {
        const files = node?.properties?.dataFilesInTable
          ? []
          : filesForPart(view.files, node?.properties?.dataRequestPart);
        return (
          <section className="scroll-mt-8">
            {children}
            {files.length > 0 && (
              <PairList>
                <PacketFilePairs files={files} />
              </PairList>
            )}
          </section>
        );
      },
    }),
    [view.files],
  );
  const contactEmail = view.contactEmail;

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <main className="mx-auto max-w-3xl space-y-10 px-6 pt-8 pb-20 sm:pt-12 print:max-w-none print:p-0">
        <header className="space-y-8">
          <SpotWordmark />
          <div className="space-y-2">
            <h1 className={`text-balance ${typeStyle("heading.page")}`}>
              {view.title}
            </h1>
            <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
              Prepared by Spot for {view.recipientLabel}
              {view.expiresAt !== undefined &&
                ` · Available until ${formatDisplayDateTimeUtc(view.expiresAt)}`}
            </p>
          </div>
        </header>
        {contactEmail && (
          <OperationalPanel className="space-y-4 p-6 print:border-0 print:p-0">
            <div className="min-w-0 space-y-1">
              <p className={typeStyle("body.medium")}>
                Send questions, quotes, or documents to the Spot team
              </p>
              <p
                className={`wrap-anywhere text-muted-foreground ${typeStyle("body.default")}`}
              >
                {contactEmail}
              </p>
            </div>
            <div className="flex gap-2 print:hidden">
              <PillButton
                variant="secondary"
                className="flex-1 sm:flex-none"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(contactEmail);
                    toast.success("Email copied");
                  } catch {
                    toast.error(
                      "Could not copy the email. Select and copy the address above.",
                    );
                  }
                }}
              >
                Copy email
              </PillButton>
              <PillButton
                href={`mailto:${contactEmail}`}
                className="flex-1 sm:flex-none"
              >
                Email Spot{" "}
                <ArrowUpRight aria-hidden="true" className="size-3.5" />
              </PillButton>
            </div>
          </OperationalPanel>
        )}
        {parts.notes && (
          <DocumentSection id="submission-notes" title="Submission notes">
            <ProseMarkdown
              gfm
              breaks
              components={noteHeadings}
              className={NOTE_PROSE_SPACING}
            >
              {parts.notes}
            </ProseMarkdown>
          </DocumentSection>
        )}
        <DocumentSection
          id="packet-details"
          title={parts.application ? "Application" : "Request details"}
        >
          {view.markdown.trim() ? (
            <ProseMarkdown
              gfm
              rehypePlugins={plugins}
              components={applicationComponents}
              className={APPLICATION_PROSE_SPACING}
            >
              {presentedMarkdown}
            </ProseMarkdown>
          ) : (
            <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
              No request details have been shared yet.
            </p>
          )}
        </DocumentSection>
        {view.files.length > 0 && (
          <DocumentSection id="packet-files" title="All files">
            <PairList>
              <PacketFilePairs files={view.files} />
            </PairList>
          </DocumentSection>
        )}
        <footer className="space-y-3 border-t border-border pt-8">
          <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
            Spot helps businesses manage their insurance and works with
            providers to find coverage. We organize company information, prepare
            submissions, and coordinate questions and next steps between
            businesses and their providers.
          </p>
          <TextLink
            href="https://spot.insure/partners/brokers"
            target="_blank"
            rel="noopener noreferrer"
          >
            Become a partner
          </TextLink>
        </footer>
      </main>
    </div>
  );
}
