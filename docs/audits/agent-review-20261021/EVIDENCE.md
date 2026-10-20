# 证据记录（agent-review-20261021）

## 执行环境与限制

- 2026-10-21：`mcp__workspace__bash` 连续两次返回 `Workspace unavailable ... VM_DISK_SPACE_INSUFFICIENT`。**本轮没有执行任何 shell 命令**，所以命令、退出码、测试摘要都为空。
- 子审查“Pi 上游契约核对”和“Electron/模型配置/打包一致性”均返回 `API Error: 403 预扣费额度失败`，在产出结论前中断。
- 已完成的三个子审查：后端桥接与运行时、MCP 与 Skill、提示词/上下文/面经。它们只使用 Read/Grep/Glob 读码，没有执行代码。
- 没有读取任何密钥文件、APPDATA 或真实用户数据库；没有修改任何业务代码；只在 `docs/audits/agent-review-20261021/` 下新建了 4 个文件。

## 代码状态证据

- `.git/HEAD` → `ref: refs/heads/codex/m3-runtime-contracts`
- `.git/refs/heads/codex/m3-runtime-contracts` → `5d39706acdb97cfd0c53c931c224b0203c206a8e`
- `package.json:6` 版本 0.4.19；`package.json:33-34` 精确锁定 pi-agent-core / pi-ai 0.80.10。

## 主审查员亲自阅读的文件

- `electron/pi-agent-runtime.mjs`（全文 631 行）
- `electron/pi/fetchcv-harness.mjs`（全文）
- `electron/pi/provider-adapter.mjs`（全文）
- `electron/pi/compatible-payload.mjs`（全文）
- `electron/pi/provider-failure.mjs`（全文）
- `package.json`、`README.md:1-80`

## 上游资料

本轮没有成功取回上游仓库或文档，以下链接仅作为下一轮的核对入口：
- https://github.com/earendil-works/pi
- https://pi.dev/
- https://github.com/deepseek-ai/deepseek-harness

## 下一轮必须补齐的验证

1. 释放宿主磁盘空间后，在 `.m1-work/agent-review-20261021-run/` 下：
   - 先阅读 `backend/tests/conftest.py` 和 `tests/*.e2e.mjs`，确认数据路径和副作用；
   - 设置独立的数据根和 `--basetemp`，再运行 `npm run backend:test` 与 `node --test` 单测；
   - 记录每条命令和退出码。
2. 阅读 `node_modules/@earendil-works/pi-agent-core/dist`，逐项核对以下内容，结果用于 F18、F31 和上游映射表：事件名（尤其 `tool_result`）、`setTools` 在工具执行中途调用的语义、`context` 和 `before_provider_payload` 钩子的返回值与异常契约、重试与 abort 的传递。
3. 编写 mock OpenAI-compatible / Anthropic 本地服务，覆盖：流式工具参数、多工具并行、半截响应、429/5xx、取消、`finish_reason=length`。
4. 用 `backend/tests/fixtures/mcp_echo_server.py` 的变体验证 F03、F04、F19、F20。
5. 核对连接测试（`electron/main.mjs:567`）与 `provider-adapter.mjs:normalizeBaseUrl` 的路径一致性，以及开发版和安装版的数据根是否隔离。
