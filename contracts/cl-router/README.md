# cl-router API contract snapshot

Spot validates its representative cl-router payloads against the checked-in
OpenAPI 3.1 snapshot in this directory. `npm run check:cl-router-contract` is
offline: CI does not clone the private router repository, call a deployed
service, or require router credentials.

The checker enforces three boundaries:

- the snapshot bytes match the SHA-256 recorded in `source.json`;
- the Spot-used operations still reference the expected request and response
  schemas; and
- representative generation, streaming, embedding, JSON transcription,
  capabilities, retrieval, feedback, health, and active admin payloads in
  `fixtures.v1.json` validate with strict Ajv draft-2020-12 checks. Retired
  calibration-seed import and benchmark schemas are intentionally absent;
  active routing quality uses explicit human ratings.

## Refreshing the snapshot

1. In `claritylabs-inc/cl-router`, make the v1 contract change additive,
   regenerate `openapi/cl-router-v1.json` with `npm run openapi:generate`, and
   pass `npm run openapi:check`.
2. From a clean committed router revision, copy the exact
   `openapi/cl-router-v1.json` bytes from that commit to
   `contracts/cl-router/openapi.v1.json` in Spot.
3. Update `source.json` with that full 40-character commit SHA,
   `sourceWorktreeDirty: false`, and the digest from
   `shasum -a 256 contracts/cl-router/openapi.v1.json`. Uncommitted or dirty
   router worktrees are not valid contract-snapshot sources.
4. Update or add fixtures for every Spot-used additive field or operation.
   Do not weaken or delete an existing fixture to accommodate a breaking v1
   change; version the snapshot and checker instead.
5. Run `npm run check:cl-router-contract`, then the normal Spot lint and
   typechecks. Commit the snapshot, provenance, fixtures, and caller changes
   together.

If cl-router changes without a Spot snapshot refresh, its own generated-spec
check catches an uncommitted source snapshot and Spot review should require
the corresponding snapshot update. Spot CI then catches stale operation
bindings, incompatible schemas, invalid fixtures, and manual snapshot edits
whose digest was not deliberately refreshed.
