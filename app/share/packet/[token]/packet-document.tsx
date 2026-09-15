"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
} from "react";
import type { Components } from "react-markdown";
import { ArrowUpRight, Download, FileText } from "lucide-react";
import { toast } from "sonner";
import { ProseMarkdown } from "@/components/prose-markdown";
import { PillButton } from "@/components/ui/pill-button";
import { OperationalPanel } from "@/components/ui/operational-panel";
import { SpotWordmark } from "@/components/ui/spot-wordmark";
import { TextLink } from "@/components/ui/text-link";
import { formatDisplayDateTimeUtc } from "@/lib/date-format";
import { typeStyle } from "@/lib/typography";
import { cn } from "@/lib/utils";
import { preparePacketMarkdown, type PacketHeading } from "./packet-markdown";
import type { PacketView } from "./view";

function PacketSection({
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<"div">) {
  return (
    <OperationalPanel
      {...props}
      data-packet-section
      tabIndex={-1}
      className={cn(
        "scroll-mt-8 p-6 outline-none transition-colors duration-150 data-[arrival=true]:border-border-focus data-[arrival=true]:bg-foreground/[0.02] focus-visible:ring-1 focus-visible:ring-border-focus motion-reduce:transition-none print:overflow-visible print:border-0 print:p-0 print:ring-0",
        className,
      )}
    >
      {children}
    </OperationalPanel>
  );
}

const markdownComponents: Components = {
  section: ({ children }) => <PacketSection>{children}</PacketSection>,
};

type Navigate = (id: string) => void;

function OutlineLink({
  id,
  active,
  children,
  primary = false,
  navigate,
}: {
  id: string;
  active: string;
  children: React.ReactNode;
  primary?: boolean;
  navigate: Navigate;
}) {
  return (
    <a
      href={`#${encodeURIComponent(id)}`}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
          return;
        event.preventDefault();
        navigate(id);
      }}
      aria-current={active === id ? "location" : undefined}
      className={cn(
        "flex items-center justify-between gap-3 rounded-md px-3 py-2 wrap-anywhere hover:bg-foreground/[0.03] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus",
        typeStyle(primary ? "body.medium" : "body.default"),
        primary ? "text-foreground" : "text-muted-foreground",
        active === id && "bg-muted text-foreground",
      )}
    >
      {children}
    </a>
  );
}

function HeadingOutline({
  headings,
  active,
  navigate,
}: {
  headings: PacketHeading[];
  active: string;
  navigate: Navigate;
}) {
  return (
    <ul className="space-y-1 pl-4">
      {headings.map((heading) => (
        <li key={heading.id}>
          <OutlineLink id={heading.id} active={active} navigate={navigate}>
            {heading.label}
          </OutlineLink>
          {heading.children.length > 0 && (
            <HeadingOutline
              headings={heading.children}
              active={active}
              navigate={navigate}
            />
          )}
        </li>
      ))}
    </ul>
  );
}

export function PacketDocument({ view }: { view: NonNullable<PacketView> }) {
  const packetMarkdown = useMemo(
    () => preparePacketMarkdown(view.markdown),
    [view.markdown],
  );
  const plugins = useMemo(
    () => [packetMarkdown.rehypePacketSections],
    [packetMarkdown],
  );
  const contactEmail = view.contactEmail;
  const hasContact = Boolean(contactEmail);
  const hasFiles = view.files.length > 0;
  const firstDestination = hasContact ? "contact-spot" : "packet-details";
  const [active, setActive] = useState(firstDestination);
  const contentRef = useRef<HTMLElement>(null);
  const restoredHash = useRef(false);
  const arrival = useRef<HTMLElement | null>(null);
  const arrivalTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  function destination(id: string) {
    let target = document.getElementById(id);
    if (id === "packet-details")
      target =
        target?.querySelector<HTMLElement>("[data-packet-section]") ?? null;
    const section = target?.closest<HTMLElement>("[data-packet-section]");
    if (!target || !section || !contentRef.current?.contains(section))
      return null;
    return {
      section,
      target: target === section.firstElementChild ? section : target,
    };
  }

  function navigate(id: string) {
    const found = destination(id);
    if (!found) return;
    found.target.scrollIntoView({ block: "start" });
    found.section.focus({ preventScroll: true });
    if (arrival.current) delete arrival.current.dataset.arrival;
    clearTimeout(arrivalTimeout.current);
    arrival.current = found.section;
    found.section.dataset.arrival = "true";
    arrivalTimeout.current = setTimeout(() => {
      delete found.section.dataset.arrival;
      arrival.current = null;
    }, 1200);
    const hash = `#${encodeURIComponent(id)}`;
    if (window.location.hash !== hash) window.history.pushState(null, "", hash);
    setActive(id);
  }

  useEffect(() => () => clearTimeout(arrivalTimeout.current), []);

  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const ids = [
      ...(hasContact ? ["contact-spot"] : []),
      "packet-details",
      ...packetMarkdown.headings.map((heading) => heading.id),
      ...(hasFiles ? ["packet-files"] : []),
    ];
    const targets = ids.flatMap((id) => {
      const element = document.getElementById(id);
      return element ? [element] : [];
    });
    let frame = 0;
    function update() {
      frame = 0;
      let current = firstDestination;
      for (const target of targets) {
        if (target.getBoundingClientRect().top <= 64) current = target.id;
      }
      if (
        hasFiles &&
        window.scrollY > 0 &&
        window.scrollY + window.innerHeight >=
          document.documentElement.scrollHeight - 2
      )
        current = "packet-files";
      setActive(current);
    }
    function scheduleUpdate() {
      if (!frame) frame = window.requestAnimationFrame(update);
    }
    function restoreFragment() {
      const id = ids.find(
        (id) => `#${encodeURIComponent(id)}` === window.location.hash,
      );
      if (id) destination(id)?.target.scrollIntoView();
    }
    update();
    if (!restoredHash.current) {
      restoreFragment();
      restoredHash.current = true;
    }
    const observer = new ResizeObserver(scheduleUpdate);
    observer.observe(content);
    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);
    window.addEventListener("hashchange", restoreFragment);
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
      window.removeEventListener("hashchange", restoreFragment);
    };
  }, [packetMarkdown, hasFiles, hasContact, firstDestination]);

  const current =
    active === "packet-details" ||
    (active === "contact-spot" && hasContact) ||
    (active === "packet-files" && hasFiles) ||
    packetMarkdown.headings.some((heading) => heading.id === active)
      ? active
      : firstDestination;

  return (
    <div className="min-h-dvh bg-background text-foreground [&_[id]]:scroll-mt-8">
      <a
        href="#packet-details"
        onClick={(event) => {
          event.preventDefault();
          navigate("packet-details");
        }}
        className={`fixed top-0 left-6 z-20 -translate-y-full rounded-md bg-background p-3 focus:translate-y-2 print:hidden ${typeStyle("control.button")}`}
      >
        Skip to packet details
      </a>
      <div className="mx-auto grid max-w-7xl items-start gap-6 px-6 pt-6 pb-28 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-10 lg:px-8 lg:py-8 print:block print:max-w-none print:p-0">
        <aside className="lg:sticky lg:top-8">
          <div className="flex items-center gap-6 lg:block lg:px-3">
            <SpotWordmark />
            <h1
              className={`text-muted-foreground lg:mt-3 ${typeStyle("body.default")}`}
            >
              Insurance packet
            </h1>
          </div>
          {view.expiresAt !== undefined && (
            <p
              className={`mt-3 text-muted-foreground lg:px-3 ${typeStyle("caption.default")}`}
            >
              Available until {formatDisplayDateTimeUtc(view.expiresAt)}
            </p>
          )}
          <nav
            aria-label="Packet contents"
            className="mt-6 hidden lg:block print:hidden"
          >
            <ul className="flex max-h-[calc(100dvh-14rem)] flex-col gap-4">
              {hasContact && (
                <li className="shrink-0">
                  <OutlineLink
                    id="contact-spot"
                    active={current}
                    primary
                    navigate={navigate}
                  >
                    Contact Spot
                  </OutlineLink>
                </li>
              )}
              <li className="flex min-h-0 flex-col gap-2">
                <OutlineLink
                  id="packet-details"
                  active={current}
                  primary
                  navigate={navigate}
                >
                  Packet details
                </OutlineLink>
                <div className="min-h-0 overflow-y-auto">
                  <HeadingOutline
                    headings={packetMarkdown.outline}
                    active={current}
                    navigate={navigate}
                  />
                </div>
              </li>
              {hasFiles && (
                <li className="shrink-0">
                  <OutlineLink
                    id="packet-files"
                    active={current}
                    primary
                    navigate={navigate}
                  >
                    <span>Files</span>
                    <span className="text-muted-foreground">
                      {view.files.length}
                    </span>
                  </OutlineLink>
                </li>
              )}
            </ul>
          </nav>
          <nav
            aria-label="Jump to packet section"
            className="fixed right-6 bottom-[max(1rem,env(safe-area-inset-bottom))] left-6 z-10 lg:hidden print:hidden"
          >
            <select
              aria-label="Jump to section"
              value={current}
              onChange={(event) => navigate(event.target.value)}
              className={`w-full min-w-0 rounded-full border border-border-emphasized bg-background px-4 py-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus ${typeStyle("control.input")}`}
            >
              {hasContact && <option value="contact-spot">Contact Spot</option>}
              <option value="packet-details">Packet details</option>
              {packetMarkdown.headings.length > 0 && (
                <optgroup label="Packet details">
                  {packetMarkdown.headings.map((heading) => (
                    <option key={heading.id} value={heading.id}>
                      {`${"\u00a0".repeat(Math.max(0, heading.depth - 1) * 2)}${heading.label}`}
                    </option>
                  ))}
                </optgroup>
              )}
              {hasFiles && (
                <option value="packet-files">
                  Files ({view.files.length})
                </option>
              )}
            </select>
          </nav>
        </aside>
        <main ref={contentRef} className="min-w-0 space-y-6 print:mt-6">
          {contactEmail && (
            <PacketSection id="contact-spot">
              <h2 className={typeStyle("heading.section")}>Contact Spot</h2>
              <p
                className={`mt-2 text-muted-foreground ${typeStyle("body.default")}`}
              >
                Send questions, quotes, or additional documents.
              </p>
              <div className="mt-6 flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
                <div className="min-w-0">
                  <p className={typeStyle("body.medium")}>Spot team</p>
                  <p
                    className={`mt-1 wrap-anywhere text-muted-foreground ${typeStyle("body.default")}`}
                  >
                    {contactEmail}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2 print:hidden">
                  <PillButton
                    variant="secondary"
                    className="flex-1 xl:flex-none"
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
                    className="flex-1 xl:flex-none"
                  >
                    Email Spot{" "}
                    <ArrowUpRight aria-hidden="true" className="size-3.5" />
                  </PillButton>
                </div>
              </div>
            </PacketSection>
          )}
          <article id="packet-details" aria-label="Packet details">
            {view.markdown.trim() ? (
              <ProseMarkdown
                gfm
                rehypePlugins={plugins}
                components={markdownComponents}
                className="space-y-5 [&>section>:first-child]:mt-0 [&>section>:last-child]:mb-0 print:space-y-8"
              >
                {view.markdown}
              </ProseMarkdown>
            ) : (
              <PacketSection>
                <p
                  className={`text-muted-foreground ${typeStyle("body.default")}`}
                >
                  No packet details have been shared yet.
                </p>
              </PacketSection>
            )}
          </article>
          {hasFiles && (
            <PacketSection id="packet-files">
              <h2 className={typeStyle("heading.section")}>Files</h2>
              <ul className="mt-4 space-y-4">
                {view.files.map((file) => (
                  <li
                    key={file._id}
                    className="flex flex-wrap items-center gap-3 sm:flex-nowrap"
                  >
                    <span className="flex min-w-0 flex-1 items-center gap-3">
                      <FileText
                        aria-hidden="true"
                        className="size-4 shrink-0 text-muted-foreground"
                      />
                      <span
                        className={`wrap-anywhere ${typeStyle("body.medium")}`}
                      >
                        {file.name}
                      </span>
                    </span>
                    <span className="shrink-0 print:hidden">
                      {file.downloadUrl ? (
                        <PillButton
                          href={file.downloadUrl}
                          download
                          size="compact"
                          variant="secondary"
                        >
                          <Download aria-hidden="true" className="size-3.5" />
                          Download
                        </PillButton>
                      ) : (
                        <span
                          className={`text-muted-foreground ${typeStyle("caption.default")}`}
                        >
                          Listed
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </PacketSection>
          )}
          <footer className="space-y-4 py-4">
            <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
              Spot helps businesses manage their insurance and works with
              brokers to find coverage. We organize company information, prepare
              submissions, and coordinate questions and next steps between
              businesses and their brokers.
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
    </div>
  );
}
