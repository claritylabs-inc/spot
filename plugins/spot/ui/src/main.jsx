import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { useApp } from "@modelcontextprotocol/ext-apps/react";
import { applyHostStyleVariables } from "@modelcontextprotocol/ext-apps";
import ReactMarkdown from "react-markdown";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

const MAX_HOST_FILE_BYTES = 12 * 1024 * 1024;
const SNAPSHOT_KEY = "spot.workspace.snapshot.v1";
const ENTRYPOINT_TOOLS = new Set(["open_spot_workspace", "open_spot_record", "open_spot_file"]);
const VIEW_ORDER = [
  "policies",
  "certificates",
  "compliance",
  "requests",
  "files",
  "company",
  "mailbox",
  "proposals",
  "activity",
  "settings",
];
const VIEW_LABELS = {
  policies: "Policies",
  certificates: "Certificates",
  compliance: "Compliance",
  requests: "Requests",
  files: "Files",
  company: "Company",
  mailbox: "Mailbox",
  proposals: "Proposals",
  activity: "Activity",
  settings: "Settings",
};
const NAV_GROUPS = [
  { label: "Workspace", views: ["policies", "certificates", "compliance", "requests", "files", "company"] },
  { label: "Operations", views: ["mailbox", "proposals", "activity"] },
  { label: "Account", views: ["settings"] },
];

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function getSnapshot() {
  try {
    const value = JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || "null");
    if (!isRecord(value)) return null;
    return {
      view: VIEW_ORDER.includes(value.view) ? value.view : undefined,
      recordId: typeof value.recordId === "string" ? value.recordId : undefined,
      activeOrganizationId: typeof value.activeOrganizationId === "string" ? value.activeOrganizationId : null,
    };
  } catch {
    return null;
  }
}

function saveSnapshot(snapshot) {
  try {
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify({
      view: snapshot.view,
      recordId: snapshot.recordId || undefined,
      activeOrganizationId: snapshot.activeOrganizationId || null,
    }));
  } catch {
    // Storage is a convenience only. Private data is never stored here.
  }
}

function stringValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value, null, 2);
}

function titleCase(value) {
  return String(value)
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function looksLikeMarkdownKey(key) {
  return /markdown|content|body|description|narrative|summary|quote|text|prose|notes/i.test(key);
}

function compactId(value) {
  const text = String(value || "");
  return text.length > 18 ? `${text.slice(0, 8)}…${text.slice(-6)}` : text;
}

function getToolMeta(result) {
  return result?._meta?.["spot/workspace"] || result?.structuredContent?.workspace || null;
}

function parseLegacyResult(result) {
  const text = result?.content?.find((item) => item?.type === "text")?.text;
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function getEnvelope(result) {
  const meta = getToolMeta(result);
  if (meta?.context && Array.isArray(meta.tools)) return meta;
  const structured = result?.structuredContent;
  if (structured?.context && Array.isArray(structured.tools)) return structured;
  const legacy = parseLegacyResult(result);
  if (legacy?.context && Array.isArray(legacy.tools)) return legacy;
  return null;
}

function resultMessage(result) {
  if (!result) return "";
  if (result.isError) return parseLegacyResult(result)?.error || "The host rejected that request.";
  const parsed = result?._meta?.["spot/result"] || parseLegacyResult(result);
  if (typeof parsed === "string") return parsed;
  if (isRecord(parsed) && typeof parsed.message === "string") return parsed.message;
  if (isRecord(parsed) && typeof parsed.summary === "string") return parsed.summary;
  return "Action completed.";
}

function isAuthorizationError(error) {
  const text = String(error?.message || error || "").toLowerCase();
  return /unauthor|forbidden|permission|access denied|not allowed|scope|membership|stale|expired/.test(text);
}

function safeArgs(value) {
  return isRecord(value) ? value : {};
}

function useSpotHost() {
  const [input, setInput] = useState({});
  const [initialResult, setInitialResult] = useState(null);
  const [hostContext, setHostContext] = useState({});
  const state = useApp({
    appInfo: { name: "Spot workspace", version: "0.1.0" },
    capabilities: { availableDisplayModes: ["inline", "fullscreen", "pip"] },
    autoResize: true,
    onAppCreated: (app) => {
      app.addEventListener("toolinput", (event) => setInput(safeArgs(event?.arguments)));
      app.addEventListener("toolresult", (result) => setInitialResult(result));
      app.addEventListener("hostcontextchanged", (context) => setHostContext((current) => ({ ...current, ...context })));
      app.onteardown = async () => ({});
    },
  });

  useEffect(() => {
    if (state.app) setHostContext(state.app.getHostContext() || {});
  }, [state.app]);

  useEffect(() => {
    const styles = hostContext?.styles;
    if (styles?.variables) applyHostStyleVariables(styles.variables);
    document.documentElement.dataset.theme = hostContext?.theme || "light";
  }, [hostContext]);

  return { ...state, input, initialResult, hostContext };
}

function useWorkspace() {
  const host = useSpotHost();
  const [envelope, setEnvelope] = useState(() => getEnvelope(host.initialResult));
  const [resultData, setResultData] = useState(() => getEnvelope(host.initialResult)?.data ?? null);
  const [inputFile, setInputFile] = useState(null);
  const [view, setView] = useState(() => getSnapshot()?.view || "policies");
  const [recordId, setRecordId] = useState(() => getSnapshot()?.recordId || undefined);
  const [activeOrganizationId, setActiveOrganizationId] = useState(() => getSnapshot()?.activeOrganizationId || null);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState(null);
  const [lastAction, setLastAction] = useState(null);
  const restored = useRef(false);
  const snapshot = useRef(getSnapshot());

  const acceptWorkspaceResult = useCallback((result, fallbackView) => {
    const next = getEnvelope(result);
    if (!next) return false;
    setEnvelope(next);
    setResultData(next.data ?? null);
    if (next.view && VIEW_ORDER.includes(next.view)) setView(next.view);
    else if (fallbackView) setView(fallbackView);
    if (next.recordId !== undefined) setRecordId(next.recordId || undefined);
    if (next.context?.activeOrganizationId !== undefined) setActiveOrganizationId(next.context.activeOrganizationId || null);
    setNotice(null);
    return true;
  }, []);

  useEffect(() => {
    if (host.initialResult) acceptWorkspaceResult(host.initialResult, host.input?.view);
  }, [host.initialResult, host.input?.view, acceptWorkspaceResult]);

  useEffect(() => {
    const deepLink = host.hostContext?.["openai/deepLink"]?.url;
    if (!deepLink) return;
    try {
      const parsed = new URL(deepLink, "https://spot.invalid");
      const nextView = parsed.searchParams.get("view") || parsed.pathname.split("/").filter(Boolean)[0];
      if (VIEW_ORDER.includes(nextView)) setView(nextView);
      if (parsed.searchParams.get("recordId")) setRecordId(parsed.searchParams.get("recordId"));
    } catch {
      // An unsupported deep-link shape falls back to the current workspace.
    }
  }, [host.hostContext]);

  const tools = envelope?.tools || [];
  const toolMap = useMemo(() => new Map(tools.map((tool) => [tool.name, tool])), [tools]);

  const clearPrivateState = useCallback(() => {
    setEnvelope(null);
    setResultData(null);
    setInputFile(null);
    setLastAction(null);
  }, []);

  const callTool = useCallback(async (name, args = {}, options = {}) => {
    if (!host.app || !host.isConnected) throw new Error("Spot is still connecting to the host.");
    if (!toolMap.has(name)) throw new Error(`The host did not provide ${name} for this workspace.`);
    setBusy(name);
    setNotice(null);
    try {
      const result = await host.app.callServerTool({ name, arguments: safeArgs(args) });
      if (result?.isError) {
        const message = resultMessage(result);
        if (isAuthorizationError(message)) clearPrivateState();
        throw new Error(message);
      }
      const wasWorkspace = acceptWorkspaceResult(result, options.fallbackView);
      if (!wasWorkspace) setLastAction({ name, message: resultMessage(result), result });
      return result;
    } catch (error) {
      if (isAuthorizationError(error)) clearPrivateState();
      setNotice({ tone: "error", message: String(error?.message || error) });
      throw error;
    } finally {
      setBusy("");
    }
  }, [acceptWorkspaceResult, clearPrivateState, host.app, host.isConnected, toolMap]);

  const navigate = useCallback(async (nextView, nextRecordId, organizationId = activeOrganizationId) => {
    setView(nextView);
    setRecordId(nextRecordId || undefined);
    setActiveOrganizationId(organizationId || null);
    saveSnapshot({ view: nextView, recordId: nextRecordId, activeOrganizationId: organizationId });
    if (!host.app || !host.isConnected) return;
    if (nextView === view && nextRecordId === recordId && organizationId === activeOrganizationId) return;
    if (!toolMap.has("read_spot_workspace")) {
      setNotice({ tone: "info", message: "Navigation is available, but this host did not provide the read-only workspace tool." });
      return;
    }
    clearPrivateState();
    try {
      await callTool("read_spot_workspace", {
        view: nextView,
        ...(nextRecordId ? { recordId: nextRecordId } : {}),
        ...(organizationId ? { organizationId } : {}),
      }, { fallbackView: nextView });
    } catch {
      // callTool has already surfaced the host error and cleared unauthorized state.
    }
  }, [activeOrganizationId, callTool, clearPrivateState, host.app, host.isConnected, recordId, toolMap, view]);

  useEffect(() => {
    if (!host.app || !host.isConnected || restored.current || !snapshot.current) return;
    restored.current = true;
    const saved = snapshot.current;
    if (!toolMap.has("read_spot_workspace")) return;
    callTool("read_spot_workspace", {
      ...(saved.view ? { view: saved.view } : {}),
      ...(saved.recordId ? { recordId: saved.recordId } : {}),
      ...(saved.activeOrganizationId ? { organizationId: saved.activeOrganizationId } : {}),
    }, { fallbackView: saved.view }).catch(() => {});
  }, [callTool, host.app, host.isConnected, toolMap]);

  useEffect(() => {
    if (!host.input?.file) return;
    setInputFile(host.input.file);
    setView("files");
  }, [host.input]);

  useEffect(() => {
    const entrypoint = host.hostContext?.toolInfo?.tool?.name;
    if (!ENTRYPOINT_TOOLS.has(entrypoint)) return;
    const args = host.input || {};
    if (args.view && VIEW_ORDER.includes(args.view)) setView(args.view);
    if (typeof args.recordId === "string") setRecordId(args.recordId);
    if (typeof args.organizationId === "string") setActiveOrganizationId(args.organizationId);
  }, [host.hostContext, host.input]);

  return {
    ...host,
    envelope,
    data: resultData,
    tools,
    toolMap,
    inputFile,
    setInputFile,
    view,
    recordId,
    activeOrganizationId,
    setActiveOrganizationId,
    busy,
    notice,
    setNotice,
    lastAction,
    callTool,
    navigate,
  };
}

function Icon({ name, size = 18 }) {
  const paths = {
    grid: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
    shield: "M12 3 19 6v5c0 4.8-3 8.2-7 10-4-1.8-7-5.2-7-10V6l7-3Z M9 12l2 2 4-4",
    certificate: "M7 4h10v12H7z M9 8h6M9 11h4 M10 16v4l2-1 2 1v-4",
    check: "M5 12l4 4L19 6",
    file: "M6 3h8l4 4v14H6z M14 3v5h5 M9 12h6M9 16h6",
    building: "M4 21V5l8-2 8 2v16 M8 8h1M15 8h1M8 12h1M15 12h1M8 16h1M15 16h1 M10 21v-4h4v4",
    mail: "M4 6h16v12H4z M4 7l8 6 8-6",
    activity: "M4 12h4l2-7 4 14 2-7h4",
    settings: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0-5v3m0 12v3m9-9h-3M6 12H3m15.4-6.4-2.1 2.1M7.7 16.3l-2.1 2.1m12.8 0-2.1-2.1M7.7 7.7 5.6 5.6",
    arrow: "M5 12h14M13 6l6 6-6 6",
    back: "M19 12H5M11 6l-6 6 6 6",
    search: "m20 20-4.5-4.5M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14Z",
    plus: "M12 5v14M5 12h14",
    download: "M12 4v11m0 0 4-4m-4 4-4-4M5 20h14",
    expand: "M8 3H3v5M16 3h5v5M21 16v5h-5M3 16v5h5",
    menu: "M4 7h16M4 12h16M4 17h16",
    close: "m6 6 12 12M18 6 6 18",
    lock: "M6 10h12v10H6zM8 10V7a4 4 0 0 1 8 0v3",
    refresh: "M20 11a8 8 0 1 0 1 4M20 5v6h-6",
  };
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name] || paths.grid} /></svg>;
}

function Button({ children, variant = "secondary", icon, onClick, disabled, type = "button", title }) {
  return <button type={type} title={title} className={`button button-${variant}`} onClick={onClick} disabled={disabled}>{icon ? <Icon name={icon} size={15} /> : null}<span>{children}</span></button>;
}

function EmptyState({ title, description, action }) {
  return <div className="empty-state"><div className="empty-mark"><Icon name="grid" size={20} /></div><h3>{title}</h3><p>{description}</p>{action}</div>;
}

function getRows(data) {
  if (Array.isArray(data)) return data;
  if (!isRecord(data)) return [];
  for (const key of ["items", "records", "results", "policies", "certificates", "requirements", "requests", "files", "messages", "proposals", "activities", "artifacts"]) {
    if (Array.isArray(data[key])) return data[key];
  }
  return [];
}

function getId(record) {
  if (!isRecord(record)) return undefined;
  return record.id || record._id || record.policyId || record.requestId || record.certificateId || record.fileId || record.proposalId || record.runId;
}

function getRecordTitle(record, fallback = "Untitled record") {
  if (!isRecord(record)) return stringValue(record) || fallback;
  return record.title || record.name || record.displayName || record.filename || record.subject || record.policyNumber || record.carrierName || fallback;
}

function getRecordSubtitle(record) {
  if (!isRecord(record)) return "";
  return record.subtitle || record.status || record.type || record.email || record.updatedAt || record.effectiveDate || record.policyNumber || "";
}

function StatusPill({ value }) {
  if (!value) return null;
  const text = String(value);
  const tone = /active|approved|complete|current|ready|pass|valid|issued|open/i.test(text) ? "positive" : /pending|review|draft|processing|running/i.test(text) ? "warning" : /fail|error|expired|denied|closed/i.test(text) ? "negative" : "neutral";
  return <span className={`status-pill status-${tone}`}>{titleCase(text)}</span>;
}

function Prose({ value }) {
  if (!value) return null;
  return <div className="prose"><ReactMarkdown skipHtml>{String(value)}</ReactMarkdown></div>;
}

function KeyValueGrid({ record, omit = [] }) {
  if (!isRecord(record)) return null;
  const entries = Object.entries(record).filter(([key, value]) => !omit.includes(key) && value !== null && value !== undefined && typeof value !== "object" && value !== "");
  return <div className="key-grid">{entries.slice(0, 16).map(([key, value]) => <div className="key-cell" key={key}><span>{titleCase(key)}</span><strong>{/status|state|phase|result/i.test(key) ? <StatusPill value={value} /> : stringValue(value)}</strong></div>)}</div>;
}

function RecordCard({ record, onOpen }) {
  const id = getId(record);
  return <button className="record-card" onClick={() => onOpen(id)} disabled={!id}>
    <div className="record-card-top"><div className="record-icon"><Icon name="file" size={17} /></div><StatusPill value={record?.status || record?.state} /></div>
    <div className="record-card-title">{getRecordTitle(record)}</div>
    <div className="record-card-subtitle">{getRecordSubtitle(record)}</div>
    <div className="record-card-footer"><span>{id ? compactId(id) : "Record"}</span><Icon name="arrow" size={15} /></div>
  </button>;
}

function References({ value, onPage }) {
  const refs = Array.isArray(value) ? value : [];
  if (!refs.length) return null;
  return <div className="references"><div className="section-label">Sources</div>{refs.slice(0, 12).map((ref, index) => {
    const page = Number(ref?.page || ref?.pageNumber || ref?.printedPage || 0);
    return <button className="reference" key={`${page}-${index}`} onClick={() => page && onPage?.(page)}><span className="reference-page">{page ? `p. ${page}` : "Source"}</span><span>{ref?.quote || ref?.label || ref?.title || ref?.source || "Open source reference"}</span><Icon name="arrow" size={13} /></button>;
  })}</div>;
}

function findReferences(value) {
  if (!isRecord(value)) return [];
  for (const key of ["references", "citations", "sources", "evidence", "sourceReferences"]) if (Array.isArray(value[key])) return value[key];
  return [];
}

function findFirstObject(value, keys) {
  if (!isRecord(value)) return null;
  for (const key of keys) if (isRecord(value[key])) return value[key];
  return value;
}

function DetailView({ view, data, recordId, onBack, onNavigate, onFile, onPage, canWrite, tools, onTool, busy }) {
  const record = findFirstObject(data, ["record", "policy", "certificate", "request", "proposal", "company", "document", "detail"]);
  const rows = getRows(data);
  const selected = recordId && rows.find((row) => String(getId(row)) === String(recordId));
  const detail = selected || record || (rows.length === 1 ? rows[0] : null);
  const title = getRecordTitle(detail, `${VIEW_LABELS[view]} detail`);
  const markdown = detail && (detail.markdown || detail.content || detail.body || detail.description || detail.narrative);
  const relevantWrites = tools.filter((tool) => !tool?.annotations?.readOnlyHint && matchesView(tool, view));
  return <div className="detail-view">
    <div className="detail-header"><Button icon="back" onClick={onBack}>Back to {VIEW_LABELS[view]}</Button><div className="detail-heading"><div className="eyebrow">{VIEW_LABELS[view]}</div><h1>{title}</h1><div className="detail-subtitle">{getRecordSubtitle(detail)}</div></div><div className="detail-actions">{canWrite && relevantWrites.slice(0, 2).map((tool) => <Button key={tool.name} variant="dark" disabled={busy === tool.name} onClick={() => onTool(tool)}>{busy === tool.name ? "Working…" : tool.title || titleCase(tool.name)}</Button>)}</div></div>
    {!detail ? <EmptyState title="Record unavailable" description="This record may have moved, or the host did not return it in the current scope." /> : <>
      <div className="detail-grid"><div className="detail-main"><section className="panel"><div className="panel-heading"><div><div className="section-label">Record overview</div><h2>{title}</h2></div><StatusPill value={detail.status || detail.state || detail.result} /></div><KeyValueGrid record={detail} omit={["markdown", "content", "body", "description", "narrative", "references", "citations", "sources"]} />{markdown ? <Prose value={markdown} /> : <ObjectInspector value={detail} />}</section><EmbeddedFiles data={detail} onFile={onFile} /><References value={(findReferences(detail).length ? findReferences(detail) : findReferences(data))} onPage={onPage} /></div><aside className="detail-side"><RelatedLinks data={data} onNavigate={onNavigate} /><ToolExplorer tools={relevantWrites} canWrite={canWrite} onTool={onTool} /></aside></div>
    </>}
  </div>;
}

function EmbeddedFiles({ data, onFile }) {
  const files = isRecord(data) && Array.isArray(data.files) ? data.files.filter((file) => file?.resourceUri) : [];
  if (!files.length) return null;
  return <section className="references embedded-files"><div className="section-label">Packet files</div>{files.slice(0, 20).map((file, index) => <button className="reference" key={file.resourceUri || index} onClick={() => onFile(file)}><span className="reference-page"><Icon name="file" size={14} /></span><span><strong>{file.name || "Saved file"}</strong><small>{file.visibility || file.kind || "Host resource"}</small></span><Icon name="arrow" size={13} /></button>)}</section>;
}

function matchesView(tool, view) {
  const name = `${tool?.name || ""} ${tool?.title || ""} ${tool?.description || ""}`.toLowerCase();
  const terms = {
    policies: ["polic", "coverage", "declaration"],
    certificates: ["certificate", "coi", "endorsement"],
    compliance: ["compliance", "requirement", "evidence"],
    requests: ["request", "procurement", "packet"],
    files: ["file", "artifact", "snapshot", "release", "import"],
    company: ["company", "organization", "wiki", "document", "profile"],
    mailbox: ["mail", "message", "draft", "email"],
    proposals: ["proposal", "approval", "review", "bid"],
    activity: ["run", "activity", "job", "task", "cancel"],
    settings: ["organization", "member", "setting", "connection", "channel"],
  };
  return (terms[view] || []).some((term) => name.includes(term));
}

function RelatedLinks({ data, onNavigate }) {
  const links = isRecord(data) && Array.isArray(data.related) ? data.related : [];
  if (!links.length) return null;
  return <section className="panel compact-panel"><div className="section-label">Related</div>{links.slice(0, 8).map((link, index) => <button className="related-link" key={index} onClick={() => onNavigate(link.view || "files", getId(link))}><span>{getRecordTitle(link, "Related record")}</span><Icon name="arrow" size={14} /></button>)}</section>;
}

function ObjectInspector({ value, depth = 0 }) {
  if (value === null || value === undefined || value === "") return <span className="muted">No additional detail.</span>;
  if (typeof value !== "object") return looksLikeMarkdownKey("value") ? <Prose value={value} /> : <span>{stringValue(value)}</span>;
  if (Array.isArray(value)) return <div className="inspector-list">{value.slice(0, 30).map((item, index) => <div className="inspector-row" key={index}><ObjectInspector value={item} depth={depth + 1} /></div>)}</div>;
  if (depth > 2) return <pre className="json-block">{JSON.stringify(value, null, 2)}</pre>;
  return <div className="inspector">{Object.entries(value).filter(([, item]) => item !== null && item !== undefined && item !== "").map(([key, item]) => <div className="inspector-entry" key={key}><span>{titleCase(key)}</span><div>{typeof item === "string" && looksLikeMarkdownKey(key) ? <Prose value={item} /> : <ObjectInspector value={item} depth={depth + 1} />}</div></div>)}</div>;
}

function WorkspaceList({ view, data, recordId, onOpen, onRefresh, onTool, tools, busy, canWrite }) {
  const rows = getRows(data);
  const title = VIEW_LABELS[view];
  const readTools = tools.filter((tool) => tool?.annotations?.readOnlyHint && matchesView(tool, view));
  const writeTools = tools.filter((tool) => !tool?.annotations?.readOnlyHint && matchesView(tool, view));
  if (recordId) return null;
  return <div className="list-view"><div className="page-header"><div><div className="eyebrow">Spot workspace</div><h1>{title}</h1><p>{viewDescription(view)}</p></div><div className="page-actions">{readTools.slice(0, 1).map((tool) => <Button key={tool.name} icon="refresh" onClick={() => onTool(tool)} disabled={busy === tool.name}>{busy === tool.name ? "Refreshing…" : "Refresh"}</Button>)}{canWrite && writeTools.slice(0, 1).map((tool) => <Button key={tool.name} variant="dark" icon="plus" onClick={() => onTool(tool)}>{tool.title || "New"}</Button>)}</div></div>{rows.length ? <div className="record-grid">{rows.map((record, index) => <RecordCard key={getId(record) || index} record={record} onOpen={(id) => onOpen(id)} />)}</div> : <EmptyState title={`No ${title.toLowerCase()} in this scope`} description="Choose another organization or use an available read tool to load records." action={readTools[0] ? <Button icon="refresh" onClick={() => onTool(readTools[0])}>Load {title.toLowerCase()}</Button> : null} />}</div>;
}

function viewDescription(view) {
  return {
    policies: "Keep policy evidence, coverage, and source references in one place.",
    certificates: "Review certificate artifacts and endorsement work with their source policy.",
    compliance: "Compare requirements against grounded policy and certificate evidence.",
    requests: "Track procurement requests, shared narratives, and current packet files.",
    files: "View saved workspace files and explicitly released or imported artifacts.",
    company: "Keep the company profile and shared wiki current with revision-aware edits.",
    mailbox: "Search connected mailboxes and inspect messages without importing them automatically.",
    proposals: "Review proposals, findings, and exact approval actions.",
    activity: "Follow durable operations without replaying starts or writes.",
    settings: "Choose the organization scope and review the capabilities available to this host.",
  }[view] || "A focused view of the Spot workspace.";
}

function getSchemaProperties(tool) {
  return Object.entries(tool?.inputSchema?.properties || {});
}

function defaultFormValue(schema) {
  if (schema?.default !== undefined) return schema.default;
  if (schema?.enum?.length) return schema.enum[0];
  if (schema?.type === "boolean") return false;
  if (schema?.type === "number" || schema?.type === "integer") return "";
  if (schema?.type === "array" || schema?.type === "object") return "";
  return "";
}

function buildInitialForm(tool, values = {}) {
  return Object.fromEntries(getSchemaProperties(tool).map(([key, schema]) => [key, values[key] !== undefined ? values[key] : defaultFormValue(schema)]));
}

function coerceFormValue(value, schema) {
  if (schema?.type === "boolean") return Boolean(value);
  if (schema?.type === "number") return value === "" ? undefined : Number(value);
  if (schema?.type === "integer") return value === "" ? undefined : Math.round(Number(value));
  if (schema?.type === "array" || schema?.type === "object") {
    try { return value === "" ? undefined : JSON.parse(value); } catch { return value; }
  }
  return value;
}

function ToolForm({ tool, onSubmit, onCancel }) {
  const [values, setValues] = useState(() => buildInitialForm(tool));
  const properties = getSchemaProperties(tool);
  const required = tool?.inputSchema?.required || [];
  return <form className="tool-form" onSubmit={(event) => { event.preventDefault(); onSubmit(Object.fromEntries(properties.map(([key, schema]) => [key, coerceFormValue(values[key], schema)]).filter(([, value]) => value !== undefined))); }}><div className="tool-form-intro"><div className="eyebrow">Available host action</div><h3>{tool.title || titleCase(tool.name)}</h3><p>{tool.description || "Use the fields below to call the scoped Spot tool."}</p></div>{properties.length ? properties.map(([key, schema]) => <label className="field" key={key}><span>{schema.title || titleCase(key)} {required.includes(key) ? <em>Required</em> : null}</span>{schema.enum ? <select value={values[key]} onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))}>{schema.enum.map((option) => <option key={option} value={option}>{option}</option>)}</select> : schema.type === "boolean" ? <input type="checkbox" checked={Boolean(values[key])} onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.checked }))} /> : schema.type === "array" || schema.type === "object" || /body|content|markdown|text|message|query/i.test(key) ? <textarea rows={/body|content|markdown|text/i.test(key) ? 7 : 3} value={stringValue(values[key])} onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))} placeholder={schema.description || ""} /> : <input type={schema.type === "number" || schema.type === "integer" ? "number" : "text"} value={stringValue(values[key])} onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))} placeholder={schema.description || ""} />}</label>) : <div className="muted">This tool accepts no additional fields.</div>}<div className="form-actions"><Button onClick={onCancel}>Cancel</Button><Button type="submit" variant="dark">Review action</Button></div></form>;
}

function ToolExplorer({ tools, canWrite, onTool }) {
  const visible = tools.filter((tool) => canWrite || tool?.annotations?.readOnlyHint);
  if (!visible.length) return null;
  return <section className="panel compact-panel tool-list"><div className="section-label">Available actions</div>{visible.slice(0, 5).map((tool) => <button className="tool-row" key={tool.name} onClick={() => onTool(tool)}><span><strong>{tool.title || titleCase(tool.name)}</strong><small>{tool.description || "Scoped Spot tool"}</small></span><Icon name="arrow" size={14} /></button>)}</section>;
}

function ConfirmationModal({ tool, args, onConfirm, onCancel, busy }) {
  return <div className="modal-backdrop" role="presentation"><div className="modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title"><div className="modal-header"><div><div className="eyebrow">Review before sending</div><h2 id="confirm-title">{tool.title || titleCase(tool.name)}</h2></div><button className="icon-button" onClick={onCancel} aria-label="Close"><Icon name="close" /></button></div><p>{tool.description || "This action may change workspace state. Check the payload before continuing."}</p><pre className="json-block review-json">{JSON.stringify(args, null, 2)}</pre><div className="notice notice-info"><Icon name="lock" size={15} /><span>Backend authorization and exact approval still apply. This review does not approve a write by itself.</span></div><div className="form-actions"><Button onClick={onCancel}>Cancel</Button><Button variant="dark" onClick={onConfirm} disabled={busy}>Confirm action</Button></div></div></div>;
}

function ActionHost({ tool, workspace, onClose }) {
  const [confirmation, setConfirmation] = useState(null);
  const isReadOnly = Boolean(tool?.annotations?.readOnlyHint);
  const submit = async (args) => {
    if (!isReadOnly) { setConfirmation(args); return; }
    await workspace.callTool(tool.name, args).catch(() => {});
    onClose();
  };
  const confirm = async () => {
    await workspace.callTool(tool.name, confirmation).catch(() => {});
    setConfirmation(null);
    onClose();
  };
  return <div className="modal-backdrop" role="presentation"><div className="modal tool-modal" role="dialog" aria-modal="true"><div className="modal-header"><div><div className="eyebrow">Tool explorer</div><h2>{tool.title || titleCase(tool.name)}</h2></div><button className="icon-button" onClick={onClose} aria-label="Close"><Icon name="close" /></button></div><ToolForm tool={tool} onSubmit={submit} onCancel={onClose} />{confirmation ? <ConfirmationModal tool={tool} args={confirmation} onConfirm={confirm} onCancel={() => setConfirmation(null)} busy={workspace.busy === tool.name} /> : null}</div></div>;
}

function OrganizationSwitcher({ context, activeOrganizationId, onChange }) {
  const organizations = context?.organizations || [];
  if (!organizations.length) return null;
  return <label className="org-switcher"><span>Organization</span><select value={activeOrganizationId || context.activeOrganizationId || ""} onChange={(event) => onChange(event.target.value || null)}>{organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}</select></label>;
}

function Sidebar({ workspace, open, onClose }) {
  const context = workspace.envelope?.context;
  const allowedViews = context?.views?.length ? context.views : VIEW_ORDER;
  const principal = context?.principal;
  return <aside className={`sidebar ${open ? "sidebar-open" : ""}`}><div className="brand-row"><div className="brand-mark">S</div><div><strong>Spot</strong><small>Workspace</small></div><button className="icon-button mobile-close" onClick={onClose} aria-label="Close navigation"><Icon name="close" size={17} /></button></div><OrganizationSwitcher context={context} activeOrganizationId={workspace.activeOrganizationId} onChange={(organizationId) => workspace.navigate(workspace.view, workspace.recordId, organizationId)} /><div className="nav-scroll">{NAV_GROUPS.map((group) => { const views = group.views.filter((candidate) => allowedViews.includes(candidate)); if (!views.length) return null; return <div className="nav-group" key={group.label}><div className="nav-label">{group.label}</div>{views.map((candidate) => <button key={candidate} className={`nav-item ${workspace.view === candidate ? "nav-active" : ""}`} onClick={() => { onClose(); workspace.navigate(candidate); }}><Icon name={candidate === "policies" ? "shield" : candidate === "certificates" ? "certificate" : candidate === "compliance" ? "check" : candidate === "company" ? "building" : candidate === "mailbox" ? "mail" : candidate === "activity" ? "activity" : candidate === "settings" ? "settings" : "file"} size={17} /><span>{VIEW_LABELS[candidate]}</span></button>)}</div>; })}</div><div className="sidebar-footer"><div className="principal-dot">{principal?.kind === "operator" ? "O" : principal?.kind === "broker" ? "B" : "C"}</div><div><strong>{principal?.role || "Workspace member"}</strong><small>{principal?.canWrite ? "Can make changes" : "Read-only access"}</small></div></div></aside>;
}

function Header({ workspace, onMenu }) {
  const context = workspace.envelope?.context;
  const modes = workspace.hostContext?.availableDisplayModes || [];
  const currentMode = workspace.hostContext?.displayMode || "inline";
  const toggleDisplay = async () => {
    const next = currentMode === "fullscreen" ? "inline" : "fullscreen";
    if (workspace.app && modes.includes(next)) await workspace.app.requestDisplayMode({ mode: next }).catch(() => {});
    else workspace.setNotice({ tone: "info", message: "This host does not support fullscreen display." });
  };
  return <header className="topbar"><button className="icon-button menu-button" onClick={onMenu} aria-label="Open navigation"><Icon name="menu" /></button><div className="crumb"><span>Spot workspace</span><span className="crumb-separator">/</span><strong>{VIEW_LABELS[workspace.view]}</strong>{workspace.recordId ? <><span className="crumb-separator">/</span><span>{compactId(workspace.recordId)}</span></> : null}</div><div className="topbar-actions">{context?.websiteUrl ? <Button onClick={() => workspace.app?.openLink({ url: context.websiteUrl }).catch(() => {})}>Website</Button> : null}<Button icon="expand" onClick={toggleDisplay} title="Change display mode">{currentMode === "fullscreen" ? "Inline" : "Expand"}</Button></div></header>;
}

function Notice({ notice, onDismiss }) {
  if (!notice) return null;
  return <div className={`notice notice-${notice.tone || "info"}`}><span>{notice.message}</span><button className="notice-close" onClick={onDismiss} aria-label="Dismiss"><Icon name="close" size={14} /></button></div>;
}

function FileData({ file, workspace, onPage }) {
  const [status, setStatus] = useState("idle");
  const [contents, setContents] = useState(null);
  const [error, setError] = useState("");
  const read = async () => {
    if (!file?.resourceUri || !workspace.app) return;
    setStatus("loading"); setError("");
    try {
      const result = await workspace.app.readServerResource({ uri: file.resourceUri, _meta: { "openai/resource": { representation: isPdf ? "blob" : "text" } } });
      const content = result?.contents?.[0];
      if (!content) throw new Error("The host returned no file contents.");
      if (typeof content.blob === "string") {
        const bytes = decodeBase64Bounded(content.blob);
        setContents({ bytes, text: null });
      } else setContents({ bytes: null, text: content.text || "" });
      setStatus("ready");
    } catch (readError) { setStatus("error"); setError(String(readError?.message || readError)); }
  };
  const download = async () => {
    if (!file?.resourceUri || !workspace.app) return;
    await workspace.app.downloadFile({ contents: [{ type: "resource_link", uri: file.resourceUri, name: file.name }] }).catch((downloadError) => setError(String(downloadError?.message || downloadError)));
  };
  const isPdf = /\.pdf$/i.test(file?.name || "");
  return <section className="panel file-panel"><div className="file-heading"><div><div className="section-label">Host file</div><h2>{file?.name || "Untitled file"}</h2><p className="muted">Read through the host resource API. The app never fetches the opaque URI directly.</p></div><div className="file-actions"><Button onClick={read} disabled={status === "loading"}>{status === "loading" ? "Reading…" : "Read"}</Button><Button icon="download" onClick={download}>Download</Button></div></div>{error ? <div className="notice notice-error">{error}</div> : null}{status === "idle" ? <EmptyState title="File is unopened" description="Reading and downloading are separate host-mediated actions." /> : null}{status === "ready" && contents ? (isPdf && contents.bytes ? <PdfViewer bytes={contents.bytes} onPage={onPage} /> : <div className="file-content">{contents.text ? <Prose value={contents.text} /> : <pre className="json-block">Binary file loaded. Use Download to save it.</pre>}</div>) : null}</section>;
}

function decodeBase64Bounded(value) {
  if (typeof value !== "string" || value.length > Math.ceil(MAX_HOST_FILE_BYTES * 4 / 3) + 16) throw new Error("The host file exceeds the 12 MB safety limit.");
  const binary = atob(value);
  if (binary.length > MAX_HOST_FILE_BYTES) throw new Error("The host file exceeds the 12 MB safety limit.");
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function PdfViewer({ bytes, onPage }) {
  const [pageCount, setPageCount] = useState(0);
  const [error, setError] = useState("");
  const pages = useRef([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const document = await pdfjsLib.getDocument({ data: bytes, disableWorker: true }).promise;
        if (!cancelled) setPageCount(document.numPages);
        for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
          const page = await document.getPage(pageNumber);
          const canvas = pages.current[pageNumber - 1];
          if (!canvas || cancelled) continue;
          const viewport = page.getViewport({ scale: Math.min(1.6, Math.max(1, 760 / page.getViewport({ scale: 1 }).width)) });
          canvas.width = viewport.width; canvas.height = viewport.height;
          await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
        }
      } catch (pdfError) { if (!cancelled) setError(String(pdfError?.message || pdfError)); }
    })();
    return () => { cancelled = true; };
  }, [bytes]);
  if (error) return <div className="notice notice-error">Could not render this PDF: {error}</div>;
  return <div className="pdf-viewer"><div className="pdf-toolbar"><span>{pageCount ? `${pageCount} page${pageCount === 1 ? "" : "s"}` : "Rendering PDF…"}</span><span className="muted">Cited pages are navigable from source references.</span></div>{Array.from({ length: pageCount }, (_, index) => <div className="pdf-page" id={`pdf-page-${index + 1}`} key={index}><div className="pdf-page-label">Page {index + 1}</div><canvas ref={(element) => { pages.current[index] = element; }} onClick={() => onPage?.(index + 1)} /></div>)}</div>;
}

function CompanyView({ data, workspace, canWrite, tools }) {
  const document = findFirstObject(data, ["document", "wiki", "company"]);
  const initial = document?.content || document?.markdown || document?.body || "";
  const [draft, setDraft] = useState(initial);
  const [tab, setTab] = useState(document?.filename === "private.md" ? "private.md" : "public.md");
  useEffect(() => setDraft(initial), [initial]);
  const saveTool = tools.find((tool) => !tool.annotations?.readOnlyHint && /markdown|document|wiki|company/i.test(`${tool.name} ${tool.title || ""}`));
  const save = () => {
    if (!saveTool) return;
    const properties = Object.fromEntries(getSchemaProperties(saveTool));
    const args = {};
    for (const key of Object.keys(properties)) {
      if (/content|markdown|body|text|prose/i.test(key)) args[key] = draft;
      else if (/file|filename|name/i.test(key)) args[key] = tab;
      else if (/revision|version|etag/i.test(key) && document?.revision !== undefined) args[key] = document.revision;
      else if (/id|document/i.test(key) && document?.id) args[key] = document.id;
    }
    workspace.callTool(saveTool.name, args).catch(() => {});
  };
  return <div className="company-view"><div className="page-header"><div><div className="eyebrow">Company</div><h1>Company wiki</h1><p>Markdown is the source of company prose. Access is controlled by the host and the filename.</p></div><div className="page-actions">{canWrite && saveTool ? <Button variant="dark" onClick={save}>Save revision</Button> : null}</div></div><div className="editor-tabs"><button className={tab === "public.md" ? "tab-active" : ""} onClick={() => setTab("public.md")}>public.md <small>Shared</small></button><button className={tab === "private.md" ? "tab-active" : ""} onClick={() => setTab("private.md")}>private.md <small>Operator</small></button></div><div className="editor-layout"><div className="panel editor-panel"><div className="panel-heading"><div><div className="section-label">{tab}</div><h2>{canWrite ? "Edit carefully" : "Read-only preview"}</h2></div>{document?.revision !== undefined ? <span className="muted">Revision {document.revision}</span> : null}</div>{canWrite ? <textarea className="markdown-editor" value={draft} onChange={(event) => setDraft(event.target.value)} aria-label={`${tab} markdown`} /> : <Prose value={draft} />}</div><aside className="panel editor-side"><div className="section-label">Preview</div><Prose value={draft || "Nothing saved yet."} /><div className="notice notice-info">Opening or switching views does not write. Save is an explicit revision-aware action.</div></aside></div></div>;
}

function MailboxView({ data, workspace, tools }) {
  const [query, setQuery] = useState("");
  const searchTool = tools.find((tool) => tool.annotations?.readOnlyHint && /mail|message|email/i.test(`${tool.name} ${tool.title || ""}`));
  const search = () => {
    if (!searchTool) return;
    const props = Object.fromEntries(getSchemaProperties(searchTool));
    const args = {};
    for (const key of Object.keys(props)) if (/query|search|q|term/i.test(key)) args[key] = query; else if (/limit|pageSize/i.test(key)) args[key] = 25;
    workspace.callTool(searchTool.name, args).catch(() => {});
  };
  const rows = getRows(data);
  return <div className="mailbox-view"><div className="page-header"><div><div className="eyebrow">Connected mailbox</div><h1>Mailbox</h1><p>Search live connected mail. Results remain evidence until you explicitly save or import them.</p></div></div><div className="searchbar"><Icon name="search" size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search sender, subject, or message" onKeyDown={(event) => event.key === "Enter" && search()} /><Button variant="dark" onClick={search} disabled={!searchTool}>Search</Button></div>{rows.length ? <div className="message-list">{rows.map((message, index) => <div className="message-row" key={getId(message) || index}><div className="message-dot" /><div className="message-copy"><strong>{message.subject || message.title || "Untitled message"}</strong><span>{message.from || message.sender || message.email || ""}</span><p>{message.snippet || message.preview || message.body || ""}</p></div><div className="message-date">{message.date || message.receivedAt || ""}</div></div>)}</div> : <EmptyState title="Search when you need evidence" description="No mailbox message is copied into the workspace automatically." />}</div>;
}

function SettingsView({ workspace }) {
  const context = workspace.envelope?.context;
  const organizations = context?.organizations || [];
  return <div className="settings-view"><div className="page-header"><div><div className="eyebrow">Account</div><h1>Settings</h1><p>Workspace scope and host capability information.</p></div></div><div className="settings-grid"><section className="panel"><div className="section-label">Active scope</div><h2>Organization</h2><p className="muted">Changing scope revalidates the selected view through the host.</p><OrganizationSwitcher context={context} activeOrganizationId={workspace.activeOrganizationId} onChange={(id) => workspace.navigate(workspace.view, workspace.recordId, id)} />{organizations.map((organization) => <div className="organization-row" key={organization.id}><div className="org-avatar">{organization.name?.slice(0, 1) || "O"}</div><div><strong>{organization.name}</strong><small>{organization.type || "Organization"} · {compactId(organization.id)}</small></div></div>)}</section><section className="panel"><div className="section-label">Access</div><h2>{context?.principal?.role || "Workspace member"}</h2><div className="access-callout"><span className={context?.principal?.canWrite ? "access-dot access-write" : "access-dot"} /><div><strong>{context?.principal?.canWrite ? "Write access enabled" : "Read-only access"}</strong><p>{context?.principal?.canWrite ? "Writes still pass through backend authorization and exact approval." : "Write actions are hidden from this view."}</p></div></div><div className="capability-list"><div><span>Available views</span><strong>{context?.views?.length || 0}</strong></div><div><span>Host tools</span><strong>{workspace.tools.length}</strong></div><div><span>Display mode</span><strong>{workspace.hostContext?.displayMode || "inline"}</strong></div></div></section></div></div>;
}

function ActivityView({ data, workspace }) {
  const runId = isRecord(data) ? data.runId || data.id : undefined;
  const status = isRecord(data) ? data.status || data.state : undefined;
  const tool = workspace.tools.find((candidate) => candidate.name === "get_operator_run" || /get.*run/i.test(candidate.name));
  useEffect(() => {
    if (!runId || !tool || !/running|pending|queued|active|processing/i.test(String(status || ""))) return undefined;
    const timer = window.setInterval(() => {
      const properties = Object.fromEntries(getSchemaProperties(tool));
      const args = {};
      for (const key of Object.keys(properties)) if (/run|job|task|id/i.test(key)) args[key] = runId;
      workspace.callTool(tool.name, args).catch(() => {});
    }, 4000);
    return () => window.clearInterval(timer);
  }, [data, runId, status, tool, workspace]);
  return <div className="activity-view"><div className="page-header"><div><div className="eyebrow">Durable operations</div><h1>Activity</h1><p>Progress is read from the existing durable run. Spot never replays a start or write from this screen.</p></div></div>{data ? <section className="panel run-card"><div className="run-top"><div><div className="section-label">Run {compactId(runId)}</div><h2>{data.title || data.task || "Spot operation"}</h2></div><StatusPill value={status || "unknown"} /></div><div className="progress-track"><div className="progress-value" style={{ width: `${Math.min(100, Math.max(4, Number(data.progress || 0)))}%` }} /></div><KeyValueGrid record={data} /></section> : <EmptyState title="No active operation" description="When Spot starts a durable operation, its existing run can be followed here." />}</div>;
}

function WorkspaceView({ workspace, selectedTool, setSelectedTool }) {
  const context = workspace.envelope?.context;
  const canWrite = Boolean(context?.principal?.canWrite);
  const data = workspace.data;
  const selectedFile = workspace.inputFile || workspace.envelope?.file || (isRecord(data) ? data.file : null);
  const open = (id) => workspace.navigate(workspace.view, id);
  const detail = workspace.recordId && workspace.view !== "files";
  const page = (pageNumber) => { const element = document.getElementById(`pdf-page-${pageNumber}`); element?.scrollIntoView({ behavior: "smooth", block: "start" }); };
  const openFile = (file) => { workspace.setInputFile(file); workspace.navigate("files"); };
  const onTool = (tool) => setSelectedTool(tool);
  if (workspace.view === "settings") return <SettingsView workspace={workspace} />;
  if (workspace.view === "company") return <CompanyView data={data} workspace={workspace} canWrite={canWrite} tools={workspace.tools} />;
  if (workspace.view === "mailbox") return <MailboxView data={data} workspace={workspace} tools={workspace.tools} />;
  if (workspace.view === "activity") return <ActivityView data={data} workspace={workspace} />;
  if (workspace.view === "files" && selectedFile) return <div className="files-view"><div className="page-header"><div><div className="eyebrow">Workspace files</div><h1>Files</h1><p>Open a saved file or use an explicit tool action for imports and releases.</p></div></div><FileData file={selectedFile} workspace={workspace} onPage={page} /></div>;
  if (workspace.view === "files" && workspace.recordId) {
    const fileRecord = getRows(data).find((candidate) => String(getId(candidate)) === String(workspace.recordId) && candidate?.resourceUri);
    if (fileRecord) return <div className="files-view"><div className="page-header"><div><div className="eyebrow">Workspace files</div><h1>Files</h1><p>Open a saved file or use an explicit tool action for imports and releases.</p></div></div><FileData file={fileRecord} workspace={workspace} onPage={page} /></div>;
  }
  if (detail) return <DetailView view={workspace.view} data={data} recordId={workspace.recordId} onBack={() => workspace.navigate(workspace.view)} onNavigate={workspace.navigate} onFile={openFile} onPage={page} canWrite={canWrite} tools={workspace.tools} onTool={onTool} busy={workspace.busy} />;
  return <WorkspaceList view={workspace.view} data={data} recordId={workspace.recordId} onOpen={open} onRefresh={(tool) => workspace.callTool(tool.name, {}).catch(() => {})} onTool={onTool} tools={workspace.tools} busy={workspace.busy} canWrite={canWrite} />;
}

function App() {
  const workspace = useWorkspace();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [selectedTool, setSelectedTool] = useState(null);
  const connected = workspace.isConnected;
  const loading = connected && !workspace.envelope && !workspace.notice;
  return <div className="app-shell"><Sidebar workspace={workspace} open={sidebarOpen} onClose={() => setSidebarOpen(false)} /><div className="app-main"><Header workspace={workspace} onMenu={() => setSidebarOpen(true)} /><main className="workspace-content"><Notice notice={workspace.notice} onDismiss={() => workspace.setNotice(null)} />{workspace.error ? <div className="connection-state"><div className="empty-mark"><Icon name="lock" /></div><h2>Spot workspace unavailable</h2><p>{workspace.error.message || "The host could not initialize the app."}</p></div> : loading ? <div className="connection-state"><div className="spinner" /><p>Connecting to Spot…</p></div> : <WorkspaceView workspace={workspace} selectedTool={selectedTool} setSelectedTool={setSelectedTool} />}{workspace.lastAction ? <div className="action-toast"><StatusPill value="Complete" /><span>{workspace.lastAction.message}</span><button onClick={() => workspace.setNotice(null)}>Dismiss</button></div> : null}</main></div>{selectedTool ? <ActionHost tool={selectedTool} workspace={workspace} onClose={() => setSelectedTool(null)} /> : null}<style>{STYLES}</style></div>;
}

const STYLES = `
:root { --ink:#171716; --muted:#706f69; --line:#deded8; --soft:#f4f4f0; --paper:#fffefa; --black:#111110; --green:#dcefe2; --green-ink:#25553a; --yellow:#f8edc9; --yellow-ink:#6e5314; --red:#f8dfdc; --red-ink:#7e2f28; }
:root[data-theme="dark"] { --ink:#f4f4f0; --muted:#aaa9a0; --line:#3b3b37; --soft:#232321; --paper:#1b1b19; --black:#f4f4f0; --green:#244b34; --green-ink:#cbe7d2; --yellow:#55461d; --yellow-ink:#f6dd98; --red:#542a27; --red-ink:#ffc9c2; }
* { box-sizing:border-box; } body { color:var(--ink); background:var(--soft); } button { border:0; } .app-shell { min-height:100vh; display:flex; background:var(--soft); color:var(--ink); } .sidebar { width:244px; flex:0 0 244px; background:var(--paper); border-right:1px solid var(--line); display:flex; flex-direction:column; min-height:100vh; } .brand-row { display:flex; align-items:center; gap:10px; padding:22px 20px 19px; border-bottom:1px solid var(--line); } .brand-row strong { display:block; font-size:15px; letter-spacing:-.02em; } .brand-row small, .sidebar-footer small { display:block; color:var(--muted); font-size:11px; margin-top:2px; } .brand-mark { width:29px; height:29px; border-radius:8px; background:var(--black); color:var(--paper); display:grid; place-items:center; font-weight:700; font-size:14px; } .org-switcher { display:block; padding:16px 16px 14px; border-bottom:1px solid var(--line); } .org-switcher span { display:block; color:var(--muted); font-size:10px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; margin:0 4px 6px; } select, input, textarea { border:1px solid var(--line); color:var(--ink); background:var(--paper); border-radius:8px; outline:none; } select:focus, input:focus, textarea:focus { border-color:var(--ink); box-shadow:0 0 0 2px color-mix(in srgb, var(--ink) 12%, transparent); } .org-switcher select { width:100%; padding:9px 10px; font-size:12px; } .nav-scroll { flex:1; padding:16px 10px; overflow:auto; } .nav-group { margin-bottom:21px; } .nav-label, .section-label, .eyebrow { color:var(--muted); font-size:10px; font-weight:750; letter-spacing:.09em; text-transform:uppercase; } .nav-label { padding:0 11px 7px; } .nav-item { width:100%; display:flex; gap:11px; align-items:center; text-align:left; border-radius:7px; padding:9px 11px; background:transparent; color:var(--muted); font-size:13px; margin-bottom:2px; } .nav-item:hover, .nav-active { color:var(--ink); background:var(--soft); } .nav-active { font-weight:700; } .sidebar-footer { border-top:1px solid var(--line); padding:14px 17px 18px; display:flex; align-items:center; gap:9px; } .principal-dot, .org-avatar { display:grid; place-items:center; width:27px; height:27px; border-radius:50%; background:var(--soft); color:var(--muted); font-size:11px; font-weight:800; } .sidebar-footer strong { display:block; font-size:12px; } .app-main { min-width:0; flex:1; } .topbar { height:65px; display:flex; align-items:center; gap:18px; padding:0 31px; background:var(--paper); border-bottom:1px solid var(--line); } .crumb { display:flex; gap:9px; align-items:center; min-width:0; font-size:12px; color:var(--muted); } .crumb strong { color:var(--ink); } .crumb-separator { color:var(--line); } .topbar-actions { display:flex; gap:8px; margin-left:auto; } .icon-button, .notice-close { display:grid; place-items:center; background:transparent; color:var(--muted); padding:5px; border-radius:6px; } .icon-button:hover, .notice-close:hover { background:var(--soft); color:var(--ink); } .menu-button, .mobile-close { display:none; } .workspace-content { max-width:1380px; padding:38px 42px 80px; margin:0 auto; } .page-header { display:flex; justify-content:space-between; gap:24px; align-items:flex-start; margin-bottom:28px; } h1, h2, h3, p { margin-top:0; } h1 { font-size:32px; letter-spacing:-.05em; margin:7px 0 7px; line-height:1.05; } h2 { font-size:19px; letter-spacing:-.035em; margin:5px 0 9px; } h3 { font-size:15px; margin:10px 0 6px; } p { color:var(--muted); font-size:13px; line-height:1.55; margin-bottom:0; } .page-header p { max-width:590px; } .page-actions, .detail-actions, .file-actions { display:flex; gap:8px; flex-wrap:wrap; } .button { min-height:34px; display:inline-flex; align-items:center; justify-content:center; gap:7px; padding:8px 12px; border:1px solid var(--line); border-radius:7px; background:var(--paper); color:var(--ink); font-size:12px; font-weight:650; white-space:nowrap; } .button:hover:not(:disabled) { border-color:var(--ink); } .button:disabled { opacity:.5; cursor:not-allowed; } .button-dark { background:var(--black); border-color:var(--black); color:var(--paper); } .button-dark:hover:not(:disabled) { opacity:.86; } .button-danger { background:var(--red); color:var(--red-ink); border-color:transparent; } .record-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(214px,1fr)); gap:12px; } .record-card { text-align:left; min-height:171px; background:var(--paper); border:1px solid var(--line); border-radius:10px; padding:15px; color:var(--ink); transition:transform .14s ease, box-shadow .14s ease; } .record-card:hover { transform:translateY(-2px); box-shadow:0 6px 20px #0000000b; } .record-card-top { display:flex; justify-content:space-between; min-height:28px; } .record-icon { width:28px; height:28px; display:grid; place-items:center; border:1px solid var(--line); border-radius:7px; color:var(--muted); } .record-card-title { margin-top:19px; font-size:14px; font-weight:700; line-height:1.25; } .record-card-subtitle { color:var(--muted); font-size:11px; margin-top:5px; min-height:17px; } .record-card-footer { display:flex; justify-content:space-between; align-items:center; color:var(--muted); font-size:10px; margin-top:18px; } .status-pill { display:inline-flex; align-items:center; width:max-content; max-width:140px; padding:4px 7px; border-radius:99px; font-size:10px; line-height:1; font-weight:750; white-space:nowrap; } .status-neutral { background:var(--soft); color:var(--muted); } .status-positive { background:var(--green); color:var(--green-ink); } .status-warning { background:var(--yellow); color:var(--yellow-ink); } .status-negative { background:var(--red); color:var(--red-ink); } .empty-state { padding:64px 20px; text-align:center; border:1px dashed var(--line); border-radius:10px; margin-top:18px; } .empty-state h3 { margin-top:13px; } .empty-state p { max-width:400px; margin:0 auto 17px; } .empty-mark { width:42px; height:42px; margin:0 auto; display:grid; place-items:center; color:var(--muted); border:1px solid var(--line); border-radius:12px; background:var(--paper); } .connection-state { min-height:50vh; display:grid; place-items:center; align-content:center; gap:9px; text-align:center; } .connection-state .empty-mark { margin-bottom:7px; } .spinner { width:22px; height:22px; border:2px solid var(--line); border-top-color:var(--ink); border-radius:50%; animation:spin .8s linear infinite; } @keyframes spin { to { transform:rotate(360deg); } } .notice { display:flex; align-items:flex-start; gap:8px; padding:11px 13px; border-radius:8px; margin-bottom:18px; font-size:12px; line-height:1.45; } .notice-info { background:var(--soft); color:var(--muted); } .notice-error { background:var(--red); color:var(--red-ink); } .notice-warning { background:var(--yellow); color:var(--yellow-ink); } .notice-close { margin-left:auto; flex:0 0 auto; } .detail-header { display:flex; align-items:flex-start; gap:18px; margin-bottom:25px; flex-wrap:wrap; } .detail-heading { flex:1; min-width:220px; } .detail-heading h1 { margin-top:6px; } .detail-subtitle { color:var(--muted); font-size:12px; } .detail-grid { display:grid; grid-template-columns:minmax(0,1fr) 285px; gap:17px; align-items:start; } .detail-main { min-width:0; } .panel { background:var(--paper); border:1px solid var(--line); border-radius:10px; padding:21px; } .compact-panel { padding:16px; margin-bottom:12px; } .panel-heading { display:flex; justify-content:space-between; gap:15px; align-items:flex-start; margin-bottom:18px; } .key-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:1px; background:var(--line); border:1px solid var(--line); border-radius:7px; overflow:hidden; margin:18px 0; } .key-cell { background:var(--paper); padding:11px 12px; min-width:0; } .key-cell span { display:block; color:var(--muted); font-size:10px; margin-bottom:4px; } .key-cell strong { display:block; font-size:12px; font-weight:650; overflow-wrap:anywhere; } .prose { color:var(--ink); font-size:13px; line-height:1.65; } .prose > :first-child { margin-top:0; } .prose > :last-child { margin-bottom:0; } .prose h1, .prose h2, .prose h3 { font-size:16px; margin-top:21px; } .prose p { color:var(--ink); font-size:13px; margin:0 0 11px; } .prose ul, .prose ol { padding-left:20px; } .prose a { color:inherit; text-decoration:underline; } .references { margin-top:14px; border:1px solid var(--line); border-radius:10px; background:var(--paper); padding:15px; } .reference { width:100%; display:flex; gap:8px; align-items:center; text-align:left; color:var(--ink); background:transparent; padding:9px 0; border-bottom:1px solid var(--line); font-size:11px; } .reference:last-child { border-bottom:0; } .reference-page { color:var(--muted); font-weight:750; min-width:36px; } .reference > span:nth-child(2) { flex:1; } .reference svg { color:var(--muted); } .related-link, .tool-row { width:100%; display:flex; justify-content:space-between; gap:10px; text-align:left; color:var(--ink); background:transparent; border-bottom:1px solid var(--line); padding:11px 0; } .related-link:last-child, .tool-row:last-child { border-bottom:0; } .tool-row span { min-width:0; } .tool-row strong, .tool-row small { display:block; } .tool-row strong { font-size:11px; } .tool-row small { color:var(--muted); font-size:10px; line-height:1.35; margin-top:3px; } .inspector { display:grid; gap:10px; } .inspector-entry { display:grid; grid-template-columns:minmax(105px, .35fr) minmax(0, 1fr); gap:14px; border-top:1px solid var(--line); padding-top:10px; } .inspector-entry > span { color:var(--muted); font-size:11px; } .inspector-entry > div { font-size:12px; overflow-wrap:anywhere; } .inspector-list { display:grid; gap:7px; } .inspector-row { padding:8px; background:var(--soft); border-radius:6px; } .json-block { overflow:auto; max-height:330px; padding:12px; border-radius:7px; background:var(--soft); color:var(--ink); font:11px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; white-space:pre-wrap; overflow-wrap:anywhere; } .muted { color:var(--muted); font-size:11px; } .modal-backdrop { position:fixed; inset:0; z-index:10; display:grid; place-items:center; padding:20px; background:#0000005a; } .modal { width:min(570px,100%); max-height:calc(100vh - 40px); overflow:auto; background:var(--paper); color:var(--ink); border:1px solid var(--line); border-radius:12px; padding:22px; box-shadow:0 20px 70px #0005; } .modal-header { display:flex; justify-content:space-between; gap:15px; align-items:flex-start; margin-bottom:14px; } .modal-header h2 { margin-top:7px; } .tool-form-intro { border-bottom:1px solid var(--line); padding-bottom:15px; margin-bottom:16px; } .field { display:block; margin:14px 0; } .field > span { display:block; font-size:12px; font-weight:700; margin-bottom:6px; } .field em { color:var(--muted); font-style:normal; font-size:10px; font-weight:500; margin-left:4px; } .field input:not([type=checkbox]), .field textarea, .field select { display:block; width:100%; padding:9px 10px; font-size:12px; } .field input[type=checkbox] { width:16px; height:16px; accent-color:var(--ink); } .form-actions { display:flex; justify-content:flex-end; gap:8px; margin-top:20px; } .tool-modal > .modal-backdrop { position:static; padding:0; background:transparent; } .review-json { max-height:220px; } .file-heading { display:flex; justify-content:space-between; align-items:flex-start; gap:15px; margin-bottom:18px; } .file-content { border-top:1px solid var(--line); padding-top:19px; } .pdf-viewer { border-top:1px solid var(--line); padding-top:15px; } .pdf-toolbar { display:flex; justify-content:space-between; gap:10px; font-size:11px; margin-bottom:12px; } .pdf-page { position:relative; display:flex; justify-content:center; padding:28px 12px 20px; margin:0 auto 15px; background:#ecece8; border:1px solid var(--line); border-radius:7px; overflow:auto; } .pdf-page-label { position:absolute; left:12px; top:8px; color:#777; font-size:10px; } .pdf-page canvas { max-width:100%; height:auto; box-shadow:0 2px 10px #0002; background:white; } .editor-tabs { display:flex; gap:5px; border-bottom:1px solid var(--line); margin-bottom:14px; } .editor-tabs button { background:transparent; color:var(--muted); padding:10px 12px; border-bottom:2px solid transparent; font-size:12px; } .editor-tabs button.tab-active { color:var(--ink); border-color:var(--ink); font-weight:700; } .editor-tabs small { margin-left:4px; color:var(--muted); font-size:10px; } .editor-layout { display:grid; grid-template-columns:minmax(0,1.1fr) minmax(260px,.9fr); gap:14px; } .markdown-editor { display:block; width:100%; min-height:430px; border:0; resize:vertical; border-radius:6px; background:var(--soft); padding:14px; color:var(--ink); font:12px/1.65 ui-monospace, SFMono-Regular, Menlo, monospace; } .editor-side { min-height:430px; } .searchbar { display:flex; align-items:center; gap:10px; border:1px solid var(--line); background:var(--paper); border-radius:8px; padding:5px 6px 5px 13px; margin-bottom:17px; } .searchbar input { min-width:0; flex:1; border:0; padding:7px 0; background:transparent; } .searchbar input:focus { box-shadow:none; } .message-list { background:var(--paper); border:1px solid var(--line); border-radius:10px; overflow:hidden; } .message-row { display:flex; gap:11px; padding:15px 17px; border-bottom:1px solid var(--line); align-items:flex-start; } .message-row:last-child { border-bottom:0; } .message-dot { width:7px; height:7px; border-radius:50%; background:var(--ink); margin-top:6px; flex:0 0 auto; } .message-copy { min-width:0; flex:1; } .message-copy strong, .message-copy span { display:block; font-size:12px; } .message-copy span, .message-date { color:var(--muted); font-size:10px; margin-top:3px; } .message-copy p { font-size:11px; margin-top:7px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; } .message-date { white-space:nowrap; } .settings-grid { display:grid; grid-template-columns:1fr 1fr; gap:14px; } .settings-grid .org-switcher { padding:0 0 13px; margin:13px 0; border-bottom:1px solid var(--line); } .organization-row { display:flex; align-items:center; gap:10px; padding:11px 0; border-bottom:1px solid var(--line); } .organization-row:last-child { border-bottom:0; } .organization-row strong, .organization-row small { display:block; font-size:12px; } .organization-row small { color:var(--muted); font-size:10px; margin-top:3px; } .access-callout { display:flex; gap:10px; padding:14px; border-radius:8px; background:var(--soft); margin:17px 0; } .access-dot { width:8px; height:8px; flex:0 0 auto; margin-top:5px; border-radius:50%; background:var(--muted); } .access-write { background:#4e9d6a; } .access-callout strong { font-size:12px; } .access-callout p { font-size:11px; margin-top:3px; } .capability-list { border-top:1px solid var(--line); } .capability-list div { display:flex; justify-content:space-between; border-bottom:1px solid var(--line); padding:11px 0; font-size:11px; } .capability-list div:last-child { border-bottom:0; } .capability-list span { color:var(--muted); } .run-top { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:18px; } .progress-track { height:6px; background:var(--soft); border-radius:99px; overflow:hidden; margin-bottom:19px; } .progress-value { height:100%; background:var(--ink); border-radius:99px; transition:width .3s ease; } .action-toast { position:fixed; right:22px; bottom:22px; z-index:5; display:flex; align-items:center; gap:9px; max-width:390px; padding:11px 13px; border:1px solid var(--line); border-radius:9px; background:var(--paper); box-shadow:0 8px 30px #0002; font-size:11px; } .action-toast button { background:transparent; color:var(--muted); font-size:10px; margin-left:auto; }
@media (max-width:800px) { .sidebar { position:fixed; z-index:8; inset:0 auto 0 0; transform:translateX(-102%); transition:transform .2s ease; box-shadow:8px 0 25px #0002; } .sidebar-open { transform:translateX(0); } .menu-button, .mobile-close { display:grid; } .mobile-close { margin-left:auto; } .topbar { padding:0 17px; gap:10px; height:57px; } .crumb { font-size:11px; } .topbar-actions .button:first-child { display:none; } .workspace-content { padding:26px 17px 60px; } .page-header { display:block; } .page-actions { margin-top:17px; } h1 { font-size:28px; } .detail-grid, .editor-layout, .settings-grid { grid-template-columns:1fr; } .detail-actions { width:100%; } .file-heading { display:block; } .file-actions { margin-top:15px; } .key-grid { grid-template-columns:1fr; } .pdf-toolbar { display:block; } .pdf-toolbar .muted { display:block; margin-top:5px; } }
`;

createRoot(document.getElementById("root")).render(<App />);

