# 证据记录（architecture-review-20261021）

## 审查边界

- **执行方式：** 只读审查。全程只使用 Read / Grep / Glob 和两次 web_fetch。shell 不可用（磁盘空间不足导致 VM 无法启动），因此没有运行任何命令或测试，也无法执行 git status。
- **代码状态：** `.git/HEAD` 指向 `refs/heads/codex/m3-runtime-contracts`，该引用为 `5d39706acdb97cfd0c53c931c224b0203c206a8e`。工作区是否有未提交改动**未知**。
- **对上一轮报告的处理：** `docs/audits/agent-review-20261021/` 原样保留，未作修改。

## 依赖版本

- `package.json:33-34`：`@earendil-works/pi-agent-core` 0.80.10、`@earendil-works/pi-ai` 0.80.10。
- `package-lock.json:807-834`：两个包均为 0.80.10，各只有一份，没有嵌套副本。源为 registry.npmmirror.com。
- `node_modules/@earendil-works/pi-agent-core/package.json:3, 31-35`：版本 0.80.10，依赖 `pi-ai ^0.80.10`，MIT 许可证。仓库字段指向 `earendil-works/pi`。
- **上游最新：** v0.99.2，来源 https://github.com/earendil-works/pi/releases （2026-10-21 检索；页面过大，只提取了版本号，没有阅读 changelog）。
- **DeepSeek Harness：** https://github.com/deepseek-ai/deepseek-harness （2026-10-21 检索）。自述为 “DeepSeek Harness: Everything is a Plugin”，由 Cordis 驱动，使用 pnpm，处于 developer preview，会有破坏兼容的变更。本仓库中没有依赖它，也没有代码来自它；只有文档和 `src/styles.css:3148` 的布局注释引用它。项目内部的既有决策见 `docs/FETCHCV_V2_HARNESS_REVIEW_R3_20260921.md:68-70`。

## 亲自阅读的上游源码（pi 0.80.10，本地 node_modules）

| 文件 | 位置 | 用途 |
|---|---|---|
| pi-agent-core `dist/harness/agent-harness.d.ts` | 全文 | API 面 |
| pi-agent-core `dist/harness/types.d.ts` | 全文；关键位置 :408-416, :465-466, :504-524, :587-617 | 事件、钩子、选项定义 |
| pi-agent-core `dist/harness/agent-harness.js` | :100-589, :795-924 | emitOwn / emitAny / emitHook、createTurnState、createLoopConfig、executeTurn、prompt、steer、setTools、abort、subscribe |
| pi-agent-core `dist/agent-loop.js` | :380-539；grep :49-137, :289-290 | prepare / execute / finalize 工具、tool_execution_end 结构、执行模式 |
| pi-ai `dist/api/openai-completions.js` | :60-399, :1015-1104；grep :449-576 | 流解析、重试传递、compat 探测与覆盖、buildParams |
| pi-ai `dist/api/simple-options.js` | 全文 | maxTokens 默认值、thinking 预算 |
| pi-ai `dist/api/anthropic-messages.js` | grep :368, :476-481, :644-684, :746-768, :895-914 | baseURL、签名、thinking.display |

## 亲自阅读的项目源码

- `electron/pi-agent-runtime.mjs`（全文）
- `electron/pi/fetchcv-harness.mjs`（全文）、`provider-adapter.mjs`、`compatible-payload.mjs`、`provider-failure.mjs`、`context-budget.mjs`、`context-policy.mjs`、`request-record.mjs`（均为全文）
- `shared/model-profile.mjs`（全文）
- `electron/main.mjs`：:1-100、:160-824
- `electron/sidecar.mjs`（全文）、`electron/workspace-application.mjs`（全文）
- `scripts/build-electron-runtime.mjs`（全文）
- `packages/app/workspace-agent-service.mjs`（全文）、`workspace-agent-bridge.mjs`（:15-114、:205-260）、`workspace-cutover.mjs`（全文）
- `backend/applyos_harness/permissions.py`：:93-105、:110-409
- `backend/applyos_agent/mcp_tools.py`（全文）
- `backend/applyos_agent/prompt_contract.py`（全文）
- `backend/applyos_agent/interview_tools.py`：:548-587、:1205-1305
- `backend/applyos_agent/pi_domain_tools.py`：:194-233
- `backend/applyos_api/pi_bridge.py`：:45-179、:505-615、:732-771、:820-919
- `backend/applyos_api/main.py`：grep :1182-1207
- `.m1-evidence/prompt-optimization-20261021/`：grep `before/pi_bridge.py:389, 405-406` 以及 README:7
- `tests/`：grep，确认宿主层测试使用假 harness（`pi-agent-runtime.test.mjs:35, 64, 153, 206, 263`），而 `pi-single-loop` / `runtime-parity` / `provider-budget` 测试使用真实 harness

## 未读取或未覆盖的内容（盲区）

- 子审查给出线索、但主审本人没有阅读的文件：`backend/applyos_harness/pipeline.py`、`approval.py`、`validation.py`、`policy.py`、`state_machine.py`，`backend/applyos_agent/skills.py`、`capabilities.py`、`context.py`、`runtime.py`，`backend/applyos_api/conversations.py`、`turn_input.py`，以及 `src/` 下的 UI 组件。
- Pi 0.80.10 → 0.99.2 的 changelog。
- PyInstaller 的配置（`scripts/build-sidecar.mjs`）及安装包实际内容。
- 现有测试的实际运行结果（本轮按要求不执行）。

## 子审查的使用说明

上一轮有 3 份子审查结论。本轮只把它们当作线索：凡是写入“静态确认”的条目，都经过主审重新阅读对应源码；其余条目在 FINDINGS_REVIEWED.json 中标为“待复核线索”。本轮没有再启动新的子审查。
