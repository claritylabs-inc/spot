// Some models emit a tool call as visible text (`to=functions.get_x {...}` or
// harmony markers) instead of a structured call. The patterns stay narrow so
// ordinary prose never matches.
const LEAKED_TOOL_CALL_PATTERN = new RegExp(
  [
    "to=functions\\.[A-Za-z_]\\w*",
    // A bare snake_case tool name followed shortly by a JSON-ish payload.
    "to=[a-z][a-z0-9]*_[a-z0-9_]+\\b[^\\n{]{0,80}\\{",
    "<\\|(?:channel|call|constrain|start|end|message|return)\\|>",
  ].join("|"),
);

export function containsLeakedToolCall(text: string): boolean {
  return LEAKED_TOOL_CALL_PATTERN.test(text);
}

/** Drops the leaked call and everything after it, which is call payload. */
export function stripLeakedToolCallText(text: string): string {
  const start = LEAKED_TOOL_CALL_PATTERN.exec(text)?.index;
  return start === undefined ? text : text.slice(0, start).trimEnd();
}
