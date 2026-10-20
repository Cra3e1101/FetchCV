function isSelectableField(element) {
  if (!(element instanceof Element)) return false;
  if (element.matches("textarea, input:not([type=button]):not([type=submit]):not([type=reset]):not([type=checkbox]):not([type=radio]):not([type=file])")) return element;
  return element.closest("[contenteditable=\"true\"]") || null;
}

function selectEditable(element) {
  const field = isSelectableField(element);
  if (!field) return false;
  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
    field.select();
    return true;
  }
  const selection = field.ownerDocument.getSelection();
  const range = field.ownerDocument.createRange();
  range.selectNodeContents(field);
  selection?.removeAllRanges();
  selection?.addRange(range);
  return true;
}

export function selectAllInActiveEditor(target = document.activeElement) {
  if (selectEditable(target)) return true;
  if (target instanceof HTMLIFrameElement && target.contentDocument) {
    return selectAllInActiveEditor(target.contentDocument.activeElement);
  }
  return selectEditable(document.activeElement);
}

export function installSelectAllShortcut() {
  const handleKeyDown = (event) => {
    if (!(event.metaKey || event.ctrlKey) || event.altKey || event.key.toLowerCase() !== "a") return;
    if (!selectAllInActiveEditor(event.target)) return;
    event.preventDefault();
  };
  window.addEventListener("keydown", handleKeyDown, true);
  return () => window.removeEventListener("keydown", handleKeyDown, true);
}
