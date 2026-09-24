"use client";

import type { ReactNode } from "react";
import dayjs from "dayjs";
import { ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@claritylabs-inc/ui/components/dropdown-menu";
import { Spinner } from "@claritylabs-inc/ui/components/spinner";
import { typeStyle } from "@/lib/typography";
import { cn } from "@/lib/utils";

export type ChatThreadOption = {
  id: string;
  title: string;
  lastMessageAt?: number;
};

/** In-panel thread header: the title opens a recent-thread switcher. */
export function ChatThreadHeader({
  title,
  threads,
  activeThreadId,
  onSelectThread,
  historyLabel,
  emptyLabel,
  actions,
}: {
  title: string;
  /** `undefined` while loading. */
  threads: ChatThreadOption[] | undefined;
  activeThreadId: string | null;
  onSelectThread: (threadId: string) => void;
  historyLabel: string;
  emptyLabel: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex min-h-12 shrink-0 items-center gap-2 border-b border-border px-3 py-2">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={(props) => (
            <button
              {...props}
              type="button"
              className={cn(
                "flex min-w-0 flex-1 items-center gap-1.5 text-left text-foreground outline-none focus-visible:underline focus-visible:underline-offset-4",
                typeStyle("body.medium"),
              )}
            >
              <span className="truncate">{title}</span>
              <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
            </button>
          )}
        />
        <DropdownMenuContent
          align="start"
          sideOffset={6}
          className="max-h-80 w-72 max-w-[calc(100vw-1.5rem)]"
        >
          <DropdownMenuGroup>
            <DropdownMenuLabel>{historyLabel}</DropdownMenuLabel>
            {threads === undefined ? (
              <DropdownMenuItem disabled className="h-16 justify-center">
                <Spinner className="text-muted-foreground" />
                <span className="sr-only">Loading {historyLabel.toLowerCase()}</span>
              </DropdownMenuItem>
            ) : threads.length === 0 ? (
              <DropdownMenuItem disabled className="py-3">
                {emptyLabel}
              </DropdownMenuItem>
            ) : (
              <DropdownMenuRadioGroup
                value={activeThreadId}
                onValueChange={(threadId) => {
                  if (typeof threadId === "string") onSelectThread(threadId);
                }}
              >
                {threads.map((thread) => (
                  <DropdownMenuRadioItem
                    key={thread.id}
                    value={thread.id}
                    className="items-start py-1.5"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-foreground">
                        {thread.title}
                      </span>
                      {thread.lastMessageAt ? (
                        <span
                          className={cn(
                            "block text-muted-foreground",
                            typeStyle("label.tag"),
                          )}
                        >
                          {dayjs(thread.lastMessageAt).format("MMM D, h:mm A")}
                        </span>
                      ) : null}
                    </span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            )}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {actions}
    </header>
  );
}
