"use client";

import dayjs from "dayjs";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { typeStyle } from "@/lib/typography";

export function BrokerActivity({
  brokerOrgId,
}: {
  brokerOrgId: Id<"organizations">;
}) {
  const events = useQuery(api.brokerProfiles.activity, { brokerOrgId });
  if (events === undefined)
    return (
      <p role="status" className="text-muted-foreground">
        Loading activity…
      </p>
    );
  if (!events.length)
    return <p className="text-muted-foreground">No recorded activity.</p>;
  return (
    <ol aria-label="Insurance provider activity" className="space-y-0">
      {events.map((event, index) => {
        const day = dayjs(event.at).format("MMM D, YYYY");
        const newDay =
          index === 0 ||
          day !== dayjs(events[index - 1].at).format("MMM D, YYYY");
        return (
          <li key={event.id}>
            {newDay ? (
              <p
                className={`pb-3 pt-5 text-muted-foreground ${typeStyle("label.field")}`}
              >
                {day}
              </p>
            ) : null}
            <div className="relative ml-1 border-l border-border-subtle pb-6 pl-5">
              <span
                aria-hidden
                className="absolute -left-1 top-1.5 size-2 rounded-full bg-muted-foreground"
              />
              <p className={typeStyle("body.medium")}>{event.title}</p>
              <time
                dateTime={dayjs(event.at).toISOString()}
                className={`text-muted-foreground ${typeStyle("caption.default")}`}
              >
                {dayjs(event.at).format("h:mm A")}
              </time>
              {event.detail ? (
                <p
                  className={`mt-1 break-words text-muted-foreground ${typeStyle("body.default")}`}
                >
                  {event.detail}
                </p>
              ) : null}
              {event.requestId && event.clientOrgId ? (
                <Link
                  href={`/operator/clients/${event.clientOrgId}/procurement/${event.requestId}`}
                  className={`mt-1 block underline underline-offset-4 ${typeStyle("body.default")}`}
                >
                  View request
                </Link>
              ) : null}
            </div>
          </li>
        );
      })}
      {events.length === 100 ? (
        <li className="text-muted-foreground">
          Showing the latest 100 recorded events.
        </li>
      ) : null}
    </ol>
  );
}
