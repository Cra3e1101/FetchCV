# FetchCV

FetchCV 是本地优先的桌面求职 Agent。它以“个人资料库 → 岗位理解 → 完整经历选择 → JD 定向改写 → 简历预览与复核 → 记录投递”为主线，不把简历事实拆成零散聊天卡片，也不会在用户确认投递前锁死材料。

## 当前能力

- 导入 PDF 简历，识别个人信息、教育、实习、项目、技能，并保存为完整经历实体。
- 保存作品集、网站、代码仓库、证书等其他资料来源。
- 为不同岗位建立独立项目；可粘贴 JD，或导入包含多个岗位的 TXT/Markdown 文件后选择目标岗位。
- 按数据分析、产品或通用方向对经历分为核心、辅助、背景和省略层。
- 在对话中讨论修改，并逐条接受、拒绝或编辑改写建议。
- 模型生成的岗位定位和章节策略会进入岗位简历版本；事实选择与原模板连续性仍由确定性规则校验。
- 在客户端内预览完整简历，再生成 PDF；简历结构兼容已有 resume-editor-prototype 快照。
- 保存多个 OpenAI-compatible / Anthropic-compatible 模型配置并随时切换。
- 由 provider-independent Agent Loop 选择结构化业务工具；工具结果回灌模型后继续决策，并在经历、改写和发布节点暂停等待确认。
- 所有业务工具通过 ToolGateway 执行，受阶段、权限、审批、候选人/岗位范围、幂等和 Trace 约束。
- Agent 可搜索公开网页、读取静态 HTTPS 页面，并从招聘页 JSON-LD/正文导入 JD；已有 JD 必须确认后才覆盖。
- 对话使用真实 SSE 增量输出，可随时停止；停止后不会写入迟到的助手回答。
- Agent 任务由 SQLite 持久队列执行，支持暂停、恢复、重试、取消和进程重启后的孤儿任务恢复；运行期间仍可输入，消息按顺序排队。
- 长对话会压缩旧消息，但 JD、基础/岗位简历结构、已验证事实和材料来源始终固定保留。
- 可加载受控目录下的只读 `SKILL.md`，管理经明确审批的 stdio MCP Server；只读工具使用白名单，受限写工具还需逐工具目标配置、逐次运行审批和版本快照。
- 桌面受控浏览器可打开需要登录态或客户端渲染的公开 HTTPS 页面；遇到登录或验证码时显示隔离窗口并暂停，由用户完成后恢复。
- Agent 可在独立工作区列出/读取/搜索文本，并执行哈希、JSON 校验和文本统计三种固定检查，不接受任意 Shell。
- 对话中的处理状态来自真实模型回合、ToolGateway 调用和任务事件，可折叠查看，不展示或伪造隐藏思维链。
- 普通聊天中的实时、最新、搜索和网页问题会进入只读工具循环，思考区显示真实搜索/读取事件，最终回答保留来源 URL；非实时问题继续使用原有流式对话。
- 只有点击“记录为已投递版本”后才生成投递快照；源简历与后续版本仍可继续修改。
- 资料库将“导入基础简历”和“添加作品/项目资料”分开；完整经历可展开核对，已生成版本可保留后重新选择经历或重新规划。

## 桌面客户端

Windows 可双击 portable EXE；macOS 可安装 DMG 或直接运行 `.app`。安装包内置本地 Agent 服务，不需要打开终端，也不需要单独启动 Swagger 或 Python。当前 macOS 包未使用 Apple Developer ID 签名，首次运行需要右键选择“打开”。

## 开发环境启动

在 macOS、Linux 或 Windows 中均可使用 Node 脚本启动。先进入解压后的项目根目录：

```bash
cd FetchCV
npm run desktop
```

首次在 macOS/Linux 上使用时不要复用其他系统生成的 `node_modules` 或 `backend/.venv`：

```bash
npm ci
python3 -m venv backend/.venv
backend/.venv/bin/python -m pip install -e 'backend[dev]'
```

Windows PowerShell 的对应命令：

```powershell
npm ci
py -3 -m venv backend\.venv
backend\.venv\Scripts\python.exe -m pip install -e "backend[dev]"
npm run desktop
```

不要把其他系统的依赖目录复制到源码包；`npm ci` 和 Python venv 会按当前平台重新安装。

`http://127.0.0.1:8766/docs` 只是后端接口调试页，不是 FetchCV 客户端。

## Mac 验证与打包

```bash
npm run build
npm run check
npm run backend:test
npm run test:sidecar
npm run test:electron
npm run test:real-materials
npm run desktop:package
```

Mac 安装包输出到 `release/`。正式分发前还需要 Apple Developer 签名与 notarization；Apple Silicon 和 Intel 应按目标架构分别构建。

Windows 生成 portable EXE：

```powershell
npm run desktop:package
```

构建结果会写入 `release/`。`release/` 只属于本机构建产物，不应提交到源码仓库。

签名环境可先运行 `npm run signing:check`；配置 Developer ID 与 Apple 公证凭据后使用 `npm run desktop:package:signed`。该命令缺少任一凭据时会直接失败，不会产出冒充正式签名的安装包。

## 模型与隐私

岗位理解、简历策略、改写和普通对话都要求先连接模型，不会使用本地规则冒充模型结果。客户端左下角可新增、切换或删除模型连接。API Key 由 Electron `safeStorage` 加密保存在本机，不写入仓库、SQLite 业务库或渲染页面；从另一台电脑复制过来的加密密钥无法解密时，需要在新电脑重新填写。

`test use/` 仅用于本机真实材料回归，包含个人简历和岗位资料，默认被 `.gitignore` 排除。源码包也不会包含它、SQLite 数据库、构建产物、安装包或参考项目。

Sidecar 仅监听 loopback，并为每次桌面进程生成独立会话令牌。除健康检查外，本地 API、简历和作品集产物都需要该令牌，其他本地网页不能直接读写 FetchCV 数据。

当前 Agent 已接入简历业务工具、静态网页、隔离的可见浏览器、持久任务队列、上下文压缩、Skill、受限工作区工具、受控 MCP 写入和真实事件驱动任务 UI。暂停/取消会关闭进行中的 Provider 传输。验证码不会被自动绕过；任意 Shell、未声明作用域的 MCP 写入和外部系统副作用回滚仍不支持。

网页工具默认只允许公网 HTTPS，并阻断本机/私网、URL 凭据、非标准端口、超大响应和未校验重定向。默认搜索按 Bing、DuckDuckGo 回退；可通过 `FETCHCV_WEB_SEARCH_ENDPOINT` 提供逗号分隔的 HTTPS 端点。

也可在开发环境启用 Claude runtime：

```bash
export FETCHCV_AGENT_RUNTIME=claude
export ANTHROPIC_API_KEY=你的密钥
export FETCHCV_CLAUDE_MODEL=claude-sonnet-4-5
npm run desktop
```

## 目录

```text
src/                         React 桌面界面
electron/                    Electron 窗口、安全存储与 sidecar 生命周期
backend/applyos_api/         FastAPI 接口（内部包名暂保留以兼容已有数据库与脚本）
backend/applyos_domain/      SQLAlchemy 领域模型
backend/applyos_harness/     状态机、审批、事实校验、版本与审计
backend/applyos_agent/       模型 runtime 与 Agent 能力
backend/integrations/        PDF 简历、编辑器快照、PDF 与作品集适配器
tests/                       可重复执行的回归与桌面端检查
```

源码仓库应保留 `src/`、`public/`、`electron/`、`backend/`、`scripts/`、`tests/`、`docs/`、配置文件和锁文件。以下目录由本机生成或含私有材料，不进入 GitHub：`node_modules/`、`backend/.venv/`、`backend/data/`、`dist/`、`release/`、`artifacts/`、`tmp/`、`source-references/` 和 `test use/`。
