"use client";

import { useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Code2, FileText } from "lucide-react";
import { stringify } from "yaml";
import { PillButton } from "@/components/ui/pill-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@claritylabs-inc/ui/components/dropdown-menu";
import { replaceEditorBody, splitEditorMarkdown } from "@/lib/markdown-editor";
import { cn } from "@/lib/utils";
import { typeStyle } from "@/lib/typography";
import { MarkdownDocumentEditor } from "./markdown-document-editor";
import { MarkdownSourceEditor } from "./markdown-source-editor";

export function MarkdownEditor({
  value,
  onChange,
  label,
  readOnly = false,
  footer,
  toolbarActions,
  toolbarTarget,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  readOnly?: boolean;
  footer?: ReactNode;
  toolbarActions?: ReactNode;
  toolbarTarget?: HTMLElement | null;
  className?: string;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [view, setView] = useState("document");
  const [editYaml, setEditYaml] = useState(false);
  const document = useMemo(() => splitEditorMarkdown(value), [value]);
  const sourceView =
    view === "markdown" ||
    Boolean(document.error && (!editYaml || !document.prefix));
  const toolbar = (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {toolbarActions}
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger
          render={
            <PillButton
              size="compact"
              variant="secondary"
              expandLabel
              label={sourceView ? "Markdown" : "Document"}
              aria-label="Document view"
            />
          }
        >
          {sourceView ? (
            <Code2 className="size-3.5" />
          ) : (
            <FileText className="size-3.5" />
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuRadioGroup
            value={sourceView ? "markdown" : "document"}
            onValueChange={(nextView) => {
              setView(nextView);
              setMenuOpen(false);
            }}
          >
            <DropdownMenuRadioItem
              value="document"
              disabled={Boolean(document.error)}
            >
              Document
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="markdown">
              Markdown
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );

  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card",
        className,
      )}
    >
      {toolbarTarget ? (
        createPortal(toolbar, toolbarTarget)
      ) : (
        <div className="flex justify-end border-b border-border p-2">
          {toolbar}
        </div>
      )}
      {document.error ? (
        <p
          role="alert"
          className={`px-6 pt-4 text-destructive ${typeStyle("body.default")}`}
        >
          {document.error}
        </p>
      ) : null}
      <div hidden={!sourceView}>
        <MarkdownSourceEditor
          value={value}
          onChange={onChange}
          label={`${label} source`}
          readOnly={readOnly}
        />
      </div>
      <div hidden={sourceView}>
        {document.prefix ? (
          <details className="group border-b border-border">
            <summary
              className={`flex cursor-pointer list-none items-center gap-2 px-6 py-4 text-muted-foreground [&::-webkit-details-marker]:hidden ${typeStyle("body.default")}`}
            >
              <ChevronDown className="size-3.5 -rotate-90 group-open:rotate-0" />
              Properties
            </summary>
            {editYaml && !readOnly ? (
              <MarkdownSourceEditor
                label={`${label} YAML front matter`}
                value={document.yaml}
                frontmatter
                onChange={(yaml) =>
                  onChange(
                    `---\n${yaml}${yaml.endsWith("\n") ? "" : "\n"}---\n${document.body}`,
                  )
                }
              />
            ) : (
              <dl className="space-y-3 px-6 pb-4">
                {Object.entries(document.frontmatter).map(([key, item]) => (
                  <div
                    key={key}
                    className="grid gap-1 sm:grid-cols-[minmax(8rem,1fr)_3fr] sm:gap-4"
                  >
                    <dt
                      className={`break-words text-muted-foreground ${typeStyle("label.field")}`}
                    >
                      {key}
                    </dt>
                    <dd
                      className={`min-w-0 whitespace-pre-wrap break-words ${typeStyle("body.default")}`}
                    >
                      {typeof item === "string"
                        ? item
                        : stringify(item).trimEnd()}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
            {!readOnly ? (
              <div className="flex justify-end px-6 pb-4">
                <PillButton
                  size="compact"
                  variant="secondary"
                  onClick={() => setEditYaml(!editYaml)}
                >
                  {editYaml ? "Show properties" : "Edit YAML"}
                </PillButton>
              </div>
            ) : null}
          </details>
        ) : null}
        <MarkdownDocumentEditor
          value={document.body}
          onChange={(body) => onChange(replaceEditorBody(value, body))}
          label={label}
          readOnly={readOnly || sourceView || Boolean(document.error)}
          onEditSource={() => setView("markdown")}
        />
      </div>
      {footer ? (
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border p-4">
          {footer}
        </div>
      ) : null}
    </div>
  );
}
