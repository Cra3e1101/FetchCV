// Read the Markdown AST, not rendered DOM text (which can include citation buttons).
function cellText(node) {
  if (node.type === "text") return node.value || "";
  if (node.tagName === "br") return "\n";
  if (node.tagName === "img") return node.properties?.alt || "";
  const text = (node.children || []).map(cellText).join("");
  const href = node.tagName === "a" && node.properties?.href;
  return href && /^(https?:|mailto:)/i.test(href) && text !== href ? `${text} (${href})` : text;
}

export function markdownTableRows(node) {
  if (!node) return [];
  if (node.tagName === "tr") {
    return [(node.children || [])
      .filter(child => child.tagName === "th" || child.tagName === "td")
      .map(cell => cellText(cell).trim())];
  }
  return (node.children || []).flatMap(markdownTableRows);
}

function spreadsheetCell(value) {
  const text = String(value ?? "");
  // Keep signed numbers numeric, but prevent imported text from becoming a formula.
  const number = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?%?$/i.test(text.trim());
  return !number && /^[\s\uFEFF]*[=+@-]/.test(text) ? `'${text}` : text;
}

export function serializeTable(rows, delimiter = ",") {
  return rows.map(row => row.map(value => {
    const text = spreadsheetCell(value);
    return text.includes(delimiter) || /["\r\n]/.test(text)
      ? `"${text.replaceAll('"', '""')}"` : text;
  }).join(delimiter)).join("\r\n");
}
