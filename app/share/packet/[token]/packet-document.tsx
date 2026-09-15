"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Components } from "react-markdown";
import { Download, FileText } from "lucide-react";
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

const markdownComponents: Components = {
  section: ({ children }) => (
    <OperationalPanel className="p-6 print:overflow-visible print:border-0 print:p-0">
      {children}
    </OperationalPanel>
  ),
};

function OutlineLink({
  id,
  active,
  children,
  primary = false,
}: {
  id: string;
  active: string;
  children: React.ReactNode;
  primary?: boolean;
}) {
  return (
    <a
      href={`#${encodeURIComponent(id)}`}
      aria-current={active === id ? "location" : undefined}
      className={cn(
        "flex items-center justify-between gap-3 rounded-md px-3 py-2 wrap-anywhere hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
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
}: {
  headings: PacketHeading[];
  active: string;
}) {
  return (
    <ul className="space-y-1 pl-4">
      {headings.map((heading) => (
        <li key={heading.id}>
          <OutlineLink id={heading.id} active={active}>
            {heading.label}
          </OutlineLink>
          {heading.children.length > 0 && (
            <HeadingOutline headings={heading.children} active={active} />
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
  const [active, setActive] = useState("packet-details");
  const rootRef = useRef<HTMLDivElement>(null);
  const restoredHash = useRef(false);
  const headerRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLElement>(null);
  const hasFiles = view.files.length > 0;

  useEffect(() => {
    const root = rootRef.current;
    const header = headerRef.current;
    const content = contentRef.current;
    if (!root || !header || !content) return;
    const targets = [
      "packet-details",
      ...packetMarkdown.headings.map((heading) => heading.id),
      ...(hasFiles ? ["packet-files"] : []),
    ].flatMap((id) => {
      const element = window.document.getElementById(id);
      return element ? [element] : [];
    });
    let frame = 0;
    function update() {
      frame = 0;
      if (!header || !root) return;
      root.style.setProperty(
        "--packet-header-height",
        `${header.offsetHeight}px`,
      );
      const threshold = header.getBoundingClientRect().bottom + 48;
      let current = "packet-details";
      for (const target of targets) {
        if (target.getBoundingClientRect().top <= threshold)
          current = target.id;
      }
      if (
        hasFiles &&
        window.scrollY > 0 &&
        window.scrollY + window.innerHeight >=
          window.document.documentElement.scrollHeight - 2
      ) {
        current = "packet-files";
      }
      setActive(current);
    }
    function scheduleUpdate() {
      if (!frame) frame = window.requestAnimationFrame(update);
    }
    update();
    const initialTarget = targets.find(
      (target) => `#${encodeURIComponent(target.id)}` === window.location.hash,
    );
    if (!restoredHash.current) {
      initialTarget?.scrollIntoView();
      restoredHash.current = true;
    }
    const observer = new ResizeObserver(scheduleUpdate);
    observer.observe(header);
    observer.observe(content);
    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, [packetMarkdown, hasFiles]);

  const current =
    active === "packet-details" ||
    (active === "packet-files" && hasFiles) ||
    packetMarkdown.headings.some((heading) => heading.id === active)
      ? active
      : "packet-details";

  return (
    <div
      ref={rootRef}
      className="min-h-dvh bg-background text-foreground [--packet-header-height:6rem] [&_[id]]:scroll-mt-[calc(var(--packet-header-height)+1.5rem)]"
    >
      <a
        href="#packet-details"
        className={`fixed top-0 left-6 z-20 -translate-y-full rounded-md bg-background p-3 focus:translate-y-2 ${typeStyle("control.button")}`}
      >
        Skip to packet details
      </a>
      <header
        ref={headerRef}
        className="sticky top-0 z-10 bg-background print:static"
      >
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-6 px-6 py-6 lg:px-8">
          <SpotWordmark />
          <div className="min-w-0">
            <h1 className={typeStyle("heading.section")}>Insurance packet</h1>
            {view.expiresAt !== undefined && (
              <p
                className={`mt-1 text-muted-foreground ${typeStyle("caption.default")}`}
              >
                Available until {formatDisplayDateTimeUtc(view.expiresAt)}
              </p>
            )}
          </div>
        </div>
        <nav
          aria-label="Jump to packet section"
          className="px-6 pb-4 lg:hidden print:hidden"
        >
          <select
            aria-label="Jump to section"
            value={current}
            onChange={(event) => {
              window.location.hash = encodeURIComponent(event.target.value);
            }}
            className={`w-full min-w-0 rounded-full border border-input bg-muted px-4 py-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${typeStyle("control.input")}`}
          >
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
              <option value="packet-files">Files ({view.files.length})</option>
            )}
          </select>
        </nav>
      </header>
      <div className="mx-auto grid max-w-7xl items-start gap-10 px-6 pb-12 lg:grid-cols-[14rem_minmax(0,1fr)] lg:px-8 print:block print:max-w-none print:px-0">
        <nav
          aria-label="Packet contents"
          className="sticky top-[calc(var(--packet-header-height)+1.5rem)] hidden min-h-0 lg:block print:hidden"
        >
          <ul className="flex max-h-[calc(100dvh-var(--packet-header-height)-3rem)] flex-col gap-4">
            <li className="flex min-h-0 flex-col gap-2">
              <OutlineLink id="packet-details" active={current} primary>
                Packet details
              </OutlineLink>
              <div className="min-h-0 overflow-y-auto">
                <HeadingOutline
                  headings={packetMarkdown.outline}
                  active={current}
                />
              </div>
            </li>
            {hasFiles && (
              <li className="shrink-0">
                <OutlineLink id="packet-files" active={current} primary>
                  <span>Files</span>
                  <span className="text-muted-foreground">
                    {view.files.length}
                  </span>
                </OutlineLink>
              </li>
            )}
          </ul>
        </nav>
        <main ref={contentRef} className="min-w-0 space-y-6">
          <article
            id="packet-details"
            tabIndex={-1}
            aria-label="Packet details"
          >
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
              <OperationalPanel className="p-6">
                <p
                  className={`text-muted-foreground ${typeStyle("body.default")}`}
                >
                  No packet details have been shared yet.
                </p>
              </OperationalPanel>
            )}
          </article>
          {hasFiles && (
            <OperationalPanel className="p-6 print:overflow-visible print:border-0 print:p-0">
              <h2
                id="packet-files"
                tabIndex={-1}
                className={typeStyle("heading.section")}
              >
                Files
              </h2>
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
            </OperationalPanel>
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
