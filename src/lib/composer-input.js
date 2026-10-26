// Interaction reference: Caho1/open-claude-ui / RichComposerWithMentions.tsx.
// Commands and file limits follow FetchCV's own capabilities and API contract.
export const MAX_COMPOSER_FILES = 10;
export const MAX_COMPOSER_FILE_BYTES = 50 * 1024 * 1024;
export function formatComposerModelName(model) {
  if (!model) return "Select model";
  const id = model.split("/").at(-1);
  const claude = id.match(/^claude-(opus|sonnet|haiku)-(\d+(?:[.-]\d+)?)(?:-\d{8}|-latest)?$/i);
  if (claude) return `${claude[1][0].toUpperCase()}${claude[1].slice(1).toLowerCase()} ${claude[2].replaceAll("-", ".")}`;
  return id.replace(/^gpt-/i, "GPT-");
}
export function formatComposerFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Number((bytes / 1024).toFixed(1))} KB`;
  return `${Number((bytes / (1024 * 1024)).toFixed(1))} MB`;
}
export const COMPOSER_COMMANDS = Object.freeze([
  { id: "resume", name: "/resume", description: "优化简历 · 根据岗位整理真实经历", prompt: "请根据当前岗位和提供的材料优化简历，保留真实经历，不编造事实。" },
  { id: "match", name: "/match", description: "岗位匹配 · 分析优势与待补充信息", prompt: "请结合已提供的简历、经历和岗位要求，分析匹配优势、差距与需要补充的信息。" },
  { id: "interview", name: "/interview", description: "面试准备 · 梳理问题与回答思路", prompt: "请结合当前岗位和已提供的经历准备面试，整理可能的问题、回答思路及需要补充的证据。" },
  { id: "model", name: "/model", description: "切换模型 · 打开已保存的模型连接", action: "model" },
  { id: "attach", name: "/attach", description: "上传文件 · 添加本地材料", action: "attach" },
]);

const TRAILING_PUNCTUATION = /[.,;:!?"'，。；：！？、…]+$/u;

export function getComposerTrigger(value, start = value.length, end = start) {
  if (start !== end) return null;
  const match = value.slice(0, start).match(/(?:^|[\s（(【[，。！？；：、])([/@])([^\s`@]*)$/u);
  if (!match) return null;
  const kind = match[1] === "/" ? "command" : "file";
  const raw = match[2];
  if (kind === "command" && !/^[\p{L}\p{N}_-]*$/u.test(raw)) return null;
  if (raw.length > 1024) return null;
  const query = kind === "file" ? raw.replace(TRAILING_PUNCTUATION, "") : raw;
  // When editing @Pro|ject, replace the rest of that token as well, while
  // preserving separate prose and punctuation after the reference.
  const suffix = query.length !== raw.length ? "" : (value.slice(start).match(kind === "command" ? /^[\p{L}\p{N}_-]*/u : /^[^\s`@，。；：！？、…()[\]{}]*/u)?.[0] || "").replace(TRAILING_PUNCTUATION, "");
  return { kind, query, start: start - raw.length - 1, end: start - (raw.length - query.length) + suffix.length };
}

export function removeComposerTrigger(value, trigger) {
  return { value: value.slice(0, trigger.start) + value.slice(trigger.end), caret: trigger.start };
}

export function composerFileKey(file) {
  const path = String(file?.workspacePath || "").replaceAll("\\", "/");
  return /^[a-z]:\//i.test(path) ? path.toLowerCase() : path;
}

export function uniqueComposerFiles(files) {
  const unique = new Map();
  for (const file of files) {
    if (!file?.workspacePath || file.workspacePath.length > 1024) continue;
    const key = composerFileKey(file);
    if (!unique.has(key)) unique.set(key, { ...file, id: key, name: file.name || file.workspacePath.split(/[\\/]/).pop() });
  }
  return [...unique.values()];
}

// Refs, rather than React state, guard keys delivered in the same event turn.
// A keyup releases the post-composition guard so a deliberate second Enter is
// never delayed. WebKit sometimes reports compositionend before the commit key.
export function createComposerCompositionGuard(isWebKit = false) {
  let composing = false;
  let endedAt = -Infinity;
  return {
    get isComposing() { return composing; },
    start() { composing = true; endedAt = -Infinity; },
    end(timeStamp) { composing = false; endedAt = timeStamp; },
    keyUp(event) { if (event.key === "Enter") endedAt = -Infinity; },
    ignoreKeyDown(event) {
      const native = event.nativeEvent || event;
      if (composing || event.isComposing || native.isComposing || event.keyCode === 229 || native.keyCode === 229) return true;
      const delta = native.timeStamp - endedAt;
      if (event.key === "Enter" && delta >= 0 && delta < (isWebKit ? 500 : 80)) {
        endedAt = -Infinity;
        event.preventDefault();
        return true;
      }
      return false;
    },
  };
}
