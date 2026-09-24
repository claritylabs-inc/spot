function record(value) {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value
        : undefined;
}
function records(value) {
    return Array.isArray(value)
        ? value
            .map(record)
            .filter((item) => Boolean(item))
        : [];
}
function text(value) {
    if (typeof value !== "string")
        return undefined;
    const normalized = value.replace(/\s+/g, " ").trim();
    return normalized && normalized !== "Unknown" ? normalized : undefined;
}
function strings(value) {
    return Array.isArray(value)
        ? [
            ...new Set(value.filter((item) => typeof item === "string" && item.length > 0)),
        ]
        : [];
}
function finiteNumber(value) {
    return typeof value === "number" && Number.isFinite(value)
        ? value
        : undefined;
}
function itemEvidence(proposalDocumentId, value) {
    const sourceNodeIds = strings(value.sourceNodeIds);
    const documentNodeId = text(value.documentNodeId);
    if (documentNodeId && !sourceNodeIds.includes(documentNodeId)) {
        sourceNodeIds.push(documentNodeId);
    }
    const sourceSpanIds = strings(value.sourceSpanIds);
    const pageStart = finiteNumber(value.pageStart) ?? finiteNumber(value.pageNumber);
    const pageEnd = finiteNumber(value.pageEnd) ?? pageStart;
    if (sourceNodeIds.length === 0 &&
        sourceSpanIds.length === 0 &&
        pageStart === undefined) {
        return [];
    }
    return [
        {
            proposalDocumentId,
            sourceNodeIds,
            sourceSpanIds,
            pageStart,
            pageEnd,
        },
    ];
}
function first(values) {
    return values.find((value) => value !== undefined);
}
function keyFor(value, fields) {
    return fields
        .map((field) => text(value[field])?.toLowerCase() ?? String(value[field] ?? ""))
        .join("|");
}
function withEvidence(documents, field, keys) {
    const byKey = new Map();
    for (const extracted of documents) {
        for (const item of records(extracted.document[field])) {
            const key = keyFor(item, keys);
            if (!key.replace(/\|/g, ""))
                continue;
            const evidence = itemEvidence(extracted.proposalDocumentId, item);
            const existing = byKey.get(key);
            if (existing) {
                existing.evidence.push(...evidence);
            }
            else {
                byKey.set(key, { ...item, evidence });
            }
        }
    }
    return [...byKey.values()];
}
function supplementalItems(documents, field) {
    const byKey = new Map();
    for (const extracted of documents) {
        const values = extracted.supplemental?.[field] ?? [];
        for (const item of values) {
            const description = text(item.description);
            if (!description)
                continue;
            const key = `${description.toLowerCase()}|${text(item.category)?.toLowerCase() ?? ""}`;
            const evidence = itemEvidence(extracted.proposalDocumentId, item);
            const existing = byKey.get(key);
            if (existing)
                existing.evidence.push(...evidence);
            else
                byKey.set(key, { ...item, evidence });
        }
    }
    return [...byKey.values()];
}
function scalarEvidence(documents, field) {
    return documents.flatMap((extracted) => {
        const declaration = records(record(extracted.document.declarations)?.fields).find((item) => item.field === field);
        return declaration
            ? itemEvidence(extracted.proposalDocumentId, declaration)
            : [];
    });
}
function partyRows(extracted) {
    const document = extracted.document;
    const parties = [];
    const namedInsured = text(document.insuredName);
    if (namedInsured)
        parties.push({ role: "named_insured", name: namedInsured });
    for (const item of records(document.additionalNamedInsureds)) {
        parties.push({ role: "additional_named_insured", ...item });
    }
    const insurer = record(document.insurer);
    if (insurer)
        parties.push({ role: "insurer", name: insurer.legalName, ...insurer });
    const producer = record(document.producer);
    if (producer)
        parties.push({ role: "producer", name: producer.agencyName, ...producer });
    for (const field of [
        "additionalInsureds",
        "lossPayees",
        "mortgageHolders",
    ]) {
        const role = field === "additionalInsureds"
            ? "additional_insured"
            : field === "lossPayees"
                ? "loss_payee"
                : "mortgage_holder";
        for (const item of records(document[field]))
            parties.push({ role, ...item });
    }
    return parties;
}
export function aggregateProposalDocuments(documents) {
    const quoteDocuments = documents.map((item) => item.document);
    const carrier = first(quoteDocuments.map((item) => text(item.carrier)));
    const quoteNumber = first(quoteDocuments.map((item) => text(item.quoteNumber)));
    const insuredName = first(quoteDocuments.map((item) => text(item.insuredName)));
    const proposedEffectiveDate = first(quoteDocuments.map((item) => text(item.proposedEffectiveDate)));
    const proposedExpirationDate = first(quoteDocuments.map((item) => text(item.proposedExpirationDate)));
    const quoteExpirationDate = first([
        ...quoteDocuments.map((item) => text(item.quoteExpirationDate)),
        ...documents.map((item) => text(item.supplemental?.quoteExpirationDate)),
    ]);
    const premium = first(quoteDocuments.map((item) => text(item.premium)));
    const premiumAmount = first(quoteDocuments.map((item) => finiteNumber(item.premiumAmount)));
    const documentConditions = withEvidence(documents, "conditions", [
        "name",
        "content",
    ]);
    const documentSubjectivities = [
        ...withEvidence(documents, "enrichedSubjectivities", [
            "description",
            "category",
        ]),
        ...withEvidence(documents, "subjectivities", ["description", "category"]),
    ];
    const parties = new Map();
    for (const extracted of documents) {
        for (const party of partyRows(extracted)) {
            const key = keyFor(party, ["role", "name"]);
            const evidence = itemEvidence(extracted.proposalDocumentId, party);
            const existing = parties.get(key);
            if (existing)
                existing.evidence.push(...evidence);
            else
                parties.set(key, { ...party, evidence });
        }
    }
    return {
        carrier,
        quoteNumber,
        insuredName,
        proposedEffectiveDate,
        proposedExpirationDate,
        quoteExpirationDate,
        premium,
        premiumAmount,
        premiums: withEvidence(documents, "premiumBreakdown", ["line", "amount"]),
        coverages: withEvidence(documents, "coverages", [
            "name",
            "limit",
            "deductible",
        ]),
        conditions: [
            ...documentConditions,
            ...supplementalItems(documents, "conditions"),
        ],
        subjectivities: [
            ...documentSubjectivities,
            ...supplementalItems(documents, "subjectivities"),
        ],
        exclusions: withEvidence(documents, "exclusions", ["name", "content"]),
        parties: [...parties.values()],
        evidence: {
            carrier: scalarEvidence(documents, "insurer"),
            quoteNumber: scalarEvidence(documents, "policyNumber"),
            insuredName: scalarEvidence(documents, "namedInsured"),
            proposedEffectiveDate: scalarEvidence(documents, "policyPeriodStart"),
            proposedExpirationDate: scalarEvidence(documents, "policyPeriodEnd"),
            quoteExpirationDate: documents.flatMap((extracted) => extracted.supplemental?.quoteExpirationEvidence
                ? itemEvidence(extracted.proposalDocumentId, extracted.supplemental
                    .quoteExpirationEvidence)
                : []),
        },
    };
}
//# sourceMappingURL=proposalExtraction.js.map