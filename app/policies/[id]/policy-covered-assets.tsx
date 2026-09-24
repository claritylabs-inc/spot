"use client";

import {
  OperationalPanel,
  OperationalPanelHeader,
} from "@claritylabs-inc/ui/components/operational-panel";
import type { CoverageBreakdown } from "@/convex/lib/coverageBreakdown";
import { typeStyle } from "@/lib/typography";

type CoveredAssetKind = CoverageBreakdown["schedules"][number]["kind"];
type CoveredAssetSchedule = CoverageBreakdown["schedules"][number];
type CoveredAssetItem = CoveredAssetSchedule["items"][number];

type CoveredAssetSection = {
  name?: string;
  items: CoveredAssetItem[];
};

type CoveredAssetGroup = {
  kind: CoveredAssetKind;
  title: string;
  sections: CoveredAssetSection[];
};

const KIND_ORDER: CoveredAssetKind[] = [
  "vehicle",
  "property",
  "location",
  "other",
];

const KIND_LABELS: Record<
  CoveredAssetKind,
  { singular: string; plural: string; title: string }
> = {
  vehicle: { singular: "vehicle", plural: "vehicles", title: "Vehicles" },
  property: { singular: "property", plural: "properties", title: "Properties" },
  location: { singular: "location", plural: "locations", title: "Locations" },
  other: {
    singular: "scheduled item",
    plural: "scheduled items",
    title: "Other scheduled items",
  },
};

function normalizedText(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function isAvailableValue(value: string) {
  const normalized = normalizedText(value);
  return ![
    "",
    "-",
    "—",
    "n/a",
    "na",
    "none",
    "not available",
    "not provided",
    "unknown",
  ].includes(normalized);
}

const IDENTITY_LABELS: Record<CoveredAssetKind, RegExp> = {
  vehicle:
    /\b(?:vin|vehicle identification|year|make|model|unit|serial|license|plate|body|vehicle type|description)\b/i,
  property:
    /\b(?:address|location|premises|building|description|occupancy|construction|year built|area|square feet|protection class|sprinkler|alarm)\b/i,
  location:
    /\b(?:address|location|premises|building|description|occupancy|construction|year built|area|square feet|protection class|sprinkler|alarm)\b/i,
  other:
    /\b(?:identifier|description|serial|item|year|make|model|address|location)\b/i,
};

function isIdentityValue(kind: CoveredAssetKind, label: string) {
  return IDENTITY_LABELS[kind].test(label);
}

function displayItem(
  item: CoveredAssetItem,
  kind: CoveredAssetKind,
): CoveredAssetItem {
  const values = item.values.filter(
    (value) =>
      isAvailableValue(value.value) && isIdentityValue(kind, value.label),
  );
  return {
    ...item,
    values,
  };
}

function alignedScheduleItems(schedules: CoveredAssetSchedule[]) {
  const [first, ...rest] = schedules;
  if (!first) return false;
  return rest.every(
    (schedule) =>
      schedule.items.length === first.items.length &&
      schedule.items.every(
        (item, index) =>
          normalizedText(item.label) ===
          normalizedText(first.items[index]?.label ?? ""),
      ),
  );
}

function mergeAlignedItems(
  schedules: CoveredAssetSchedule[],
  kind: CoveredAssetKind,
) {
  const first = schedules[0];
  if (!first) return [];
  return first.items.map((item, index) => {
    const matchingItems = schedules
      .map((schedule) => schedule.items[index])
      .filter((candidate): candidate is CoveredAssetItem => Boolean(candidate));
    const descriptions = [
      ...new Set(
        matchingItems
          .map((candidate) => candidate.description?.trim())
          .filter((value): value is string => Boolean(value)),
      ),
    ];
    const seenValues = new Set<string>();
    const values = matchingItems.flatMap((candidate) =>
      candidate.values.flatMap((value) => {
        if (
          !isAvailableValue(value.value) ||
          !isIdentityValue(kind, value.label)
        ) {
          return [];
        }
        const key = `${normalizedText(value.label)}|${normalizedText(value.value)}`;
        if (seenValues.has(key)) return [];
        seenValues.add(key);
        return [value];
      }),
    );
    return {
      ...item,
      ...(descriptions.length ? { description: descriptions.join(" · ") } : {}),
      values,
    };
  });
}

export function coveredAssetGroups(
  schedules: CoveredAssetSchedule[],
): CoveredAssetGroup[] {
  return KIND_ORDER.flatMap((kind) => {
    const matchingSchedules = schedules.filter(
      (schedule) => schedule.kind === kind && schedule.items.length > 0,
    );
    if (!matchingSchedules.length) return [];
    const sections = alignedScheduleItems(matchingSchedules)
      ? [{ items: mergeAlignedItems(matchingSchedules, kind) }]
      : matchingSchedules.map((schedule) => ({
          name: schedule.name,
          items: schedule.items.map((item) => displayItem(item, kind)),
        }));
    return [{ kind, title: KIND_LABELS[kind].title, sections }];
  });
}

function assetCountLabel(kind: CoveredAssetKind, count: number) {
  const labels = KIND_LABELS[kind];
  return `${count} ${count === 1 ? labels.singular : labels.plural}`;
}

function hasVin(item: CoveredAssetItem) {
  if (
    item.values.some(
      (value) =>
        /\bvin\b|vehicle identification/i.test(value.label) &&
        isAvailableValue(value.value),
    )
  ) {
    return true;
  }
  return /\b(?:vin\s*[:#-]?\s*)?[A-HJ-NPR-Z0-9]{17}\b/i.test(
    `${item.label} ${item.description ?? ""}`,
  );
}

function hasAddress(item: CoveredAssetItem) {
  if (
    item.values.some(
      (value) =>
        /\baddress\b|\bpremises\b|\blocation\b/i.test(value.label) &&
        isAvailableValue(value.value),
    )
  ) {
    return true;
  }
  return /\b\d{1,6}\s+[^,\n]*(?:street|st|road|rd|avenue|ave|boulevard|blvd|drive|dr|lane|ln|way|highway|hwy|parkway|pkwy|court|ct|place|pl)\b/i.test(
    `${item.label} ${item.description ?? ""}`,
  );
}

function missingIdentifierText(
  kind: CoveredAssetKind,
  item: CoveredAssetItem,
) {
  if (kind === "vehicle" && !hasVin(item)) {
    return "VIN not specified in policy schedule";
  }
  if ((kind === "property" || kind === "location") && !hasAddress(item)) {
    return "Address not specified in policy schedule";
  }
  return undefined;
}

function ItemFacts({
  kind,
  item,
}: {
  kind: CoveredAssetKind;
  item: CoveredAssetItem;
}) {
  const missingIdentifier = missingIdentifierText(kind, item);
  if (!item.values.length && !missingIdentifier) return null;
  return (
    <dd className={`flex min-w-0 flex-wrap gap-x-4 gap-y-1 text-foreground @xl/covered-assets:justify-end ${typeStyle("body.default")}`}>
      {item.values.map((value, index) => (
        <span key={`${value.label}:${value.value}:${index}`}>
          <span className="text-muted-foreground">{value.label}</span>{" "}
          <span className={`${typeStyle("data.numeric")}`}>{value.value}</span>
        </span>
      ))}
      {missingIdentifier ? (
        <span className="text-muted-foreground">{missingIdentifier}</span>
      ) : null}
    </dd>
  );
}

export function PolicyCoveredAssets({
  schedules,
}: {
  schedules: CoveredAssetSchedule[];
}) {
  const groups = coveredAssetGroups(schedules);
  if (!groups.length) return null;

  return (
    <OperationalPanel className="mb-6 @container/covered-assets">
      <OperationalPanelHeader title="Covered property & vehicles" />
      <div className="divide-y divide-border">
        {groups.map((group) => (
          <section key={group.kind} className="px-4 py-3">
            <div className="flex items-baseline justify-between gap-4">
              <h3 className={`text-foreground ${typeStyle("heading.micro")}`}>
                {group.title}
              </h3>
              {group.sections.length === 1 ? (
                <span className={`shrink-0 text-muted-foreground ${typeStyle("body.default")}`}>
                  {assetCountLabel(group.kind, group.sections[0].items.length)}
                </span>
              ) : null}
            </div>
            <div className="mt-2">
              {group.sections.map((section, sectionIndex) => (
                <div
                  key={section.name ?? `${group.kind}:${sectionIndex}`}
                  className="border-t border-border py-2.5 first:border-t-0 first:pt-0 last:pb-0"
                >
                  {section.name ? (
                    <div className="mb-2 flex items-baseline justify-between gap-4">
                      <p className={`min-w-0 text-muted-foreground ${typeStyle("body.default")}`}>
                        {section.name}
                      </p>
                      <span className={`shrink-0 text-muted-foreground ${typeStyle("body.default")}`}>
                        {assetCountLabel(group.kind, section.items.length)}
                      </span>
                    </div>
                  ) : null}
                  <dl className="divide-y divide-border">
                    {section.items.map((item, itemIndex) => (
                      <div
                        key={`${item.label}:${itemIndex}`}
                        className="grid min-w-0 gap-1.5 py-2 first:pt-0 last:pb-0 @xl/covered-assets:grid-cols-[minmax(10rem,0.65fr)_minmax(0,1fr)] @xl/covered-assets:gap-6"
                      >
                        <dt className={`min-w-0 text-foreground ${typeStyle("body.default")}`}>
                          <span className={`${typeStyle("body.medium")}`}>{item.label}</span>
                          {item.description ? (
                            <span className="mt-0.5 block text-muted-foreground">
                              {item.description}
                            </span>
                          ) : null}
                        </dt>
                        <ItemFacts kind={group.kind} item={item} />
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </OperationalPanel>
  );
}
