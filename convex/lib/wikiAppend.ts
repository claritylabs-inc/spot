/** The current document with a section appended after a blank line. */
export function appendWikiSection(current: string, section: string) {
  const trimmed = section.trim();
  if (!trimmed) throw new Error("Provide the section to append");
  return `${current.trimEnd()}${current.trim() ? "\n\n" : ""}${trimmed}\n`;
}
