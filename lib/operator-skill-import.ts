import JSZip from "jszip";

import {
  SKILL_INSTRUCTIONS_PATH,
  SKILL_LIMITS,
  classifySkillFile,
  decodeSkillText,
  isSkippedSkillPath,
  normalizeSkillPath,
  parseSkillInstructions,
  skillPortabilityWarnings,
  stripSkillRoot,
  type SkillFileKind,
} from "@/convex/lib/operatorSkills";

/**
 * Browser half of a skill import: reads a zip, a picked or dropped folder, or
 * pasted SKILL.md into the files to upload and a preview. The server checks
 * every rule again (`operatorSkills.importSkill`).
 */
export type SkillImportFile = {
  path: string;
  data: Blob;
  size: number;
  kind: SkillFileKind;
};

export type SkillImportDraft = {
  sourceLabel: string;
  name?: string;
  description?: string;
  files: SkillImportFile[];
  totalBytes: number;
  warnings: string[];
  /** Blocks the import; shown instead of the preview. */
  error?: string;
};

type RawEntry = { path: string; read: () => Promise<Uint8Array> };

async function buildDraft(
  entries: RawEntry[],
  sourceLabel: string,
): Promise<SkillImportDraft> {
  const empty = { sourceLabel, files: [], totalBytes: 0, warnings: [] };
  const kept: RawEntry[] = [];
  let skipped = 0;
  for (const entry of entries) {
    const path = normalizeSkillPath(entry.path);
    if (!path)
      return {
        ...empty,
        error: `"${entry.path.slice(0, 120)}" is an absolute or parent path. Skills can only contain relative paths.`,
      };
    if (isSkippedSkillPath(path)) skipped += 1;
    else kept.push({ ...entry, path });
  }
  const { strip } = stripSkillRoot(kept.map((entry) => entry.path));
  const rooted = kept.map((entry) => ({ ...entry, path: strip(entry.path) }));
  if (!rooted.some((entry) => entry.path === SKILL_INSTRUCTIONS_PATH))
    return { ...empty, error: "No SKILL.md found at the top of the skill." };
  if (rooted.length > SKILL_LIMITS.maxFiles)
    return {
      ...empty,
      error: `This skill has ${rooted.length} files; the limit is ${SKILL_LIMITS.maxFiles}.`,
    };

  const files: SkillImportFile[] = [];
  let totalBytes = 0;
  let instructions: ReturnType<typeof parseSkillInstructions> | undefined;
  let instructionsError: string | undefined;
  for (const entry of rooted.sort((a, b) => a.path.localeCompare(b.path))) {
    const bytes = await entry.read();
    totalBytes += bytes.byteLength;
    if (totalBytes > SKILL_LIMITS.maxTotalBytes)
      return { ...empty, error: "This skill is larger than 5 MiB." };
    const text = decodeSkillText(bytes);
    if (entry.path === SKILL_INSTRUCTIONS_PATH) {
      try {
        if (text === null) throw new Error("SKILL.md must be UTF-8 text.");
        instructions = parseSkillInstructions(text);
      } catch (error) {
        instructionsError =
          error instanceof Error ? error.message : "SKILL.md could not be read.";
      }
    }
    files.push({
      path: entry.path,
      data: new Blob([bytes as BlobPart]),
      size: bytes.byteLength,
      kind: classifySkillFile(entry.path, bytes.subarray(0, 2), text !== null),
    });
  }
  const scripts = files.filter((file) => file.kind === "script").length;
  const warnings = [
    ...(instructions?.warnings ?? []),
    ...(instructions ? skillPortabilityWarnings(instructions.body) : []),
    ...(scripts
      ? [
          `${scripts} script${scripts === 1 ? "" : "s"} will be stored but can't run in Spot yet; the agent will say so when a step needs one.`,
        ]
      : []),
    ...(skipped
      ? [
          `Skipped ${skipped} file${skipped === 1 ? "" : "s"} from version control, dependency or system folders.`,
        ]
      : []),
  ];
  return {
    sourceLabel,
    name: instructions?.name,
    description: instructions?.description,
    files,
    totalBytes,
    warnings,
    ...(instructionsError ? { error: instructionsError } : {}),
  };
}

export async function draftFromZip(file: File) {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch {
    return {
      sourceLabel: file.name,
      files: [],
      totalBytes: 0,
      warnings: [],
      error: `${file.name} is not a readable zip file.`,
    } satisfies SkillImportDraft;
  }
  const entries = Object.values(zip.files)
    .filter((entry) => !entry.dir)
    .map((entry) => ({
      path: entry.name,
      read: () => entry.async("uint8array"),
    }));
  return buildDraft(entries, file.name);
}

/** Files from a folder input (`webkitRelativePath`) or a dropped folder. */
export async function draftFromFiles(
  files: Array<{ path: string; file: File }>,
  sourceLabel: string,
) {
  return buildDraft(
    files.map(({ path, file }) => ({
      path,
      read: async () => new Uint8Array(await file.arrayBuffer()),
    })),
    sourceLabel,
  );
}

export async function draftFromPaste(text: string) {
  const bytes = new TextEncoder().encode(text);
  return buildDraft(
    [{ path: SKILL_INSTRUCTIONS_PATH, read: async () => bytes }],
    "Pasted SKILL.md",
  );
}

/**
 * Files inside folders dropped on the import zone, with paths relative to the
 * drop, or null when the drop holds no folder (plain files or a zip).
 */
export async function droppedFolderFiles(
  items: DataTransferItemList,
): Promise<{ label: string; files: Array<{ path: string; file: File }> } | null> {
  const roots = Array.from(items)
    .map((item) => item.webkitGetAsEntry())
    .filter((entry): entry is FileSystemEntry => entry !== null);
  const folder = roots.find(
    (entry): entry is FileSystemDirectoryEntry => entry.isDirectory,
  );
  if (!folder) return null;
  const files: Array<{ path: string; file: File }> = [];
  const walk = async (entry: FileSystemEntry): Promise<void> => {
    if (files.length > SKILL_LIMITS.maxFiles * 5) return;
    const path = entry.fullPath.replace(/^\//, "");
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) =>
        (entry as FileSystemFileEntry).file(resolve, reject),
      );
      files.push({ path, file });
      return;
    }
    if (!entry.isDirectory || isSkippedSkillPath(path)) return;
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
        reader.readEntries(resolve, reject),
      );
      if (!batch.length) break;
      for (const child of batch) await walk(child);
    }
  };
  await walk(folder);
  return { label: folder.name, files };
}
