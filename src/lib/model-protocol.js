const DSML_MARKER = String.raw`[|｜]{1,2}\s*DSML\s*[|｜]{1,2}`;
const COMPLETE_DSML_BLOCK = new RegExp(String.raw`<\s*${DSML_MARKER}\s*tool_calls\b[^>]*>[\s\S]*?<\s*\/\s*${DSML_MARKER}\s*tool_calls\s*>`, "gi");
const TRAILING_DSML_BLOCK = new RegExp(String.raw`<\s*${DSML_MARKER}\s*tool_calls\b[^>]*>[\s\S]*$`, "gi");
const DSML_TAG = new RegExp(String.raw`<\s*\/?\s*${DSML_MARKER}[^>]*>`, "gi");
const HAS_DSML = new RegExp(DSML_MARKER, "i");

export function sanitizeAssistantContent(value = "") {
  const source = String(value || "");
  if (!HAS_DSML.test(source)) return source;
  return source
    .replace(COMPLETE_DSML_BLOCK, "")
    .replace(TRAILING_DSML_BLOCK, "")
    .replace(DSML_TAG, "")
    .trim();
}
