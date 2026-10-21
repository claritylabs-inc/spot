"""Audit a question-only CSV import against the reviewed intake reference concepts.

Usage: python3 scripts/intake/import-quote-question-reference.py INPUT.csv [PRIVATE_REVIEW.json]
No model calls. Only aggregate counts/hashes are committed. The optional private
review contains question text (never answers/accounts) and must stay outside Git.
Pattern matches identify topics for review; they do not certify semantic equivalence.
"""
import csv
import hashlib
import json
import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PACK = ROOT / "docs/procurement/acord-intake/quote-question-reference.json"


def normalize(value):
    value = unicodedata.normalize("NFKC", value).casefold()
    return re.sub(r"[^\w]+", " ", value, flags=re.UNICODE).strip()


def source_coverage_hints(value):
    """Package labels are hints only; a cyber question may be mislabeled auto."""
    value = value.casefold()
    patterns = {
        "general_liability": r"\b(?:cgl|gl|bop)\b|general liability|event.*liability|exhibitor liability|commercial package",
        "property": r"\bproperty\b|\bbop\b|commercial package|builder.?s risk",
        "commercial_auto": r"commercial auto|\bhnoa\b|non.owned auto|\bauto\b",
        "professional_liability": r"e&o|professional liability|tech e.?o",
        "cyber": r"\bcyber\b",
        "workers_compensation": r"workers.? compensation|\bwc\b",
        "umbrella": r"umbrella|\bexcess\b",
        "other": r"d&o|epli|rent guarantee|loan protection|parametric|renters",
    }
    # Personal auto is outside this commercial question bank.
    if "personal auto" in value:
        return []
    return [coverage for coverage, pattern in patterns.items() if re.search(pattern, value)]


def main():
    source = Path(sys.argv[1])
    references = json.loads(PACK.read_text())["references"]
    questions = {}
    exact = set()
    row_count = 0
    with source.open(newline="", encoding="utf-8-sig") as handle:
        for row in csv.DictReader(handle):
            question = row["question"].strip()
            if not question:
                continue
            row_count += 1
            exact.add(question)
            key = normalize(question)
            entry = questions.setdefault(key, {"question": question, "occurrences": 0, "sourceCoverageIds": set()})
            entry["occurrences"] += 1
            entry["sourceCoverageIds"].update(source_coverage_hints(row.get("coverage_line", "")))
    counts = {reference["id"]: 0 for reference in references}
    review = []
    for key, entry in questions.items():
        candidates = [r for r in references if re.search(r["matchPattern"], key, re.I)]
        for reference in candidates:
            counts[reference["id"]] += entry["occurrences"]
        review.append({
            **entry,
            "sourceCoverageIds": sorted(entry["sourceCoverageIds"]),
            "questionHash": hashlib.sha256(key.encode()).hexdigest(),
            "candidateConcepts": [r["id"] for r in candidates],
            "candidateCoverageIds": sorted({c for r in candidates for c in r["coverageIds"]}),
            "status": "review_topic_matches" if candidates else "unmapped_requires_review",
        })
    report = {
        "version": "quote-reference-import-v1",
        "sourceSha256": hashlib.sha256(source.read_bytes()).hexdigest(),
        "sourceRows": row_count,
        "exactUniqueQuestions": len(exact),
        "normalizedUniqueQuestions": len(questions),
        "normalization": "NFKC, casefold, punctuation/whitespace collapse; numbers and periods retained",
        "reviewedReferenceConcepts": len(references),
        "topicMatchedUniqueQuestions": sum(bool(row["candidateConcepts"]) for row in review),
        "unmappedUniqueQuestions": sum(not row["candidateConcepts"] for row in review),
        "sourceCoverageMappedUniqueQuestions": sum(bool(row["sourceCoverageIds"]) for row in review),
        "sourceCoverageUnmappedUniqueQuestions": sum(not row["sourceCoverageIds"] for row in review),
        "sourceOccurrencesByConcept": counts,
        "policy": "Only reviewed generic concepts enter runtime. Topic matches are not automatic semantic merges or mandatory carrier requirements. No source answers, accounts, names, paths or raw questions are included in this report.",
    }
    destination = PACK.with_name("quote-question-reference-import.json")
    destination.write_text(json.dumps(report, indent=2) + "\n")
    if len(sys.argv) > 2:
        Path(sys.argv[2]).write_text(json.dumps(review, indent=2) + "\n")
    print(json.dumps({k: v for k, v in report.items() if k != "sourceOccurrencesByConcept"}, indent=2))


if __name__ == "__main__":
    main()
