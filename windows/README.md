# FetchCV

FetchCV 是本地优先的 Windows 桌面求职 Agent。它把个人资料、目标岗位、简历版本、面试情报和真实工具记录组织在同一个岗位工作区中，帮助用户完成：

```text
读取原简历
→ 理解并调研岗位
→ 找到可复用的真实经历
→ 提出有证据的改写建议
→ 请求用户确认
→ 修改同一份简历模板
→ 校验事实与岗位要求覆盖
→ 导出 PDF / Word
→ 准备面试
```

FetchCV 不是关键词拼接器，也不是在聊天界面外硬编码一套伪 Agent 流程。桌面端使用单一 Pi Agent Loop，由模型根据完整语义决定直接回答还是调用工具；所有工具统一经过 FetchCV ToolGateway 的权限、审批、作用域、幂等、版本和审计约束。

## 当前版本

- 产品版本：`0.4.19`
- 平台：Windows 10/11 x64
- 前端：React 18、Vite、Electron、Radix UI、Framer Motion
- Agent Runtime：`@earendil-works/pi-agent-core`、`@earendil-works/pi-ai`
- 本地 Sidecar：FastAPI、SQLAlchemy、SQLite
- 当前验证：
  - ESLint 通过
  - Vite 生产构建通过
  - Python 后端：141 项通过，2 项按环境跳过
  - 前端与 Pi Runtime：84 项通过
  - packaged E2E 已通过：窗口约 1.06 秒可见、Sidecar 约 2.68 秒健康、Agent 约 2.92 秒可用
  - 生产依赖改为编译后的 Electron/Pi Runtime bundle；安装包由 157.15 MiB 降至 122.89 MiB，减少约 21.8%

## 核心能力

### 个人资料库

- 导入 PDF 简历，本地提取个人信息、教育、实习、项目、技能和奖项。
- 入库前可逐项修正模块、标题、组织、角色、日期和正文，也可删除、排序或标记无法确认。
 - AI 增强识别默认关闭；选择后仍先完成本地解析，用户必须展开核对实际脱敏外发文本并再次确认，才会调用模型；不上传原 PDF、头像和本地文件路径。
- 保存作品集、网站、代码仓库、证书和其他求职材料。
- 基础简历与岗位简历分离，岗位优化不会覆盖原始资料。

### 岗位 Agent

- 每个岗位拥有独立对话、任务、活动状态、滚动位置、审批草稿和简历版本。
- 支持粘贴 JD、导入文本文件或从公开招聘网页读取岗位内容。
- Agent 先向用户解释岗位理解，再提出经历使用策略和改写建议。
- 改写建议显示对应 JD、事实依据和风险级别；用户可采用、拒绝或编辑后采用。
- 取消是明确终态；重试、暂停、恢复和进程重启不会伪装成同一个任务继续运行。
- 任务绑定实际 Provider 与模型快照，切换默认模型不会篡改正在运行任务的身份。
- 桌面状态由真实事件映射为连接、流式回答、工具执行、等待审批、暂停、失败和就绪，不再用一个 `busy` 文案概括所有状态。
- 模型流式片段按动画帧批量刷新，减少长回答期间对整个对话树的重复渲染。

### 简历工作台

- 保留既有简历结构和成熟表达，只在有事实依据时调整重点与措辞。
- 同一份编辑器快照驱动编辑、预览和 PDF 输出，避免预览与后台版本不一致。
- 独立导出岗位版或基础版 PDF。
- 独立导出单栏、可编辑、适合 ATS 解析的 Word 文件，不替代原排版 PDF。
- 岗位要求使用可解释的“支持 / 部分支持 / 暂无证据”矩阵，不虚构 ATS 通过率。

### 面试情报与知识库

- 完成岗位材料后可进入独立“面试”工作区。
- 先检索本地面试知识库，再发现公开面经来源。
- 小红书作为重点来源时使用只读、无账号优先、有限预算和熔断策略；遇到登录、验证码或访问限制立即停止，不绕过平台控制。
- 面经按来源、发布日期和岗位相关性保存，展示原始链接与本地证据副本。
- 根据多篇原文归纳共性问题、出现频次、证据引文和准备建议；单一来源会明确提示证据有限。
- 牛客、知乎等公开来源用于补充，不冒充小红书原始证据。

### 通用 Agent 与网页能力

- 普通问题也进入同一模型循环，而不是只允许岗位流程问题。
- 实时天气、新闻和最新信息不注册固定业务关键词或专用天气代码。模型按语义选择通用 `search_web`、`read_web_page` 等只读工具。
- 网页工具只允许公网 HTTPS，阻断本机、私网、URL 凭据、危险端口、超大响应和未校验重定向。
- 动态网页可在 Agent 内使用受控浏览器读取；不会无故弹出系统浏览器。
- Firecrawl 是可选 Web Provider，不是 Skill 本身，也不是必须的云服务。自托管实例可不使用 Firecrawl 云 API Key。

### Skill、MCP 与本地工作区

- 可从受控目录加载 `SKILL.md`；新 Skill 默认关闭，授权绑定文件哈希，内容变化后自动撤销信任。
- MCP Server 可配置 stdio 或 HTTP 连接，但 Server 自报“只读”不会自动获得权限。
- MCP 工具逐项授权；写工具还需要目标范围和运行时审批。
- Agent 可在隔离工作区列出、读取和搜索文本文件，并运行预定义校验工具。
- 当前不开放任意 Shell，也不允许未声明作用域的写操作。

## Agent 架构

```text
React / Electron Desktop
        │
        ▼
Single Pi Agent Loop
  ├─ provider-independent model stream
  ├─ structured tool calls
  ├─ steering / follow-up queue
  └─ context transformation
        │
        ▼
FetchCV ToolGateway
  ├─ permission and approval
  ├─ candidate / job / file scope
  ├─ stable operation_id
  ├─ idempotency and outcome_unknown
  ├─ trace and evidence
  └─ version boundary
        │
        ▼
FastAPI + SQLite
  ├─ resumes / jobs / runs / proposals
  ├─ tasks / tool invocations / approvals
  ├─ interview sources / briefs
  └─ PDF / DOCX / workspace adapters
```

Pi 只负责观察上下文、选择工具、读取结果并继续决策。Python Sidecar 不运行第二套模型循环。状态机、审批、事实校验、文件边界和副作用恢复由确定性代码负责。

## 安全与隐私

- API Key 由 Electron `safeStorage` / Windows DPAPI 加密，只保存在本机。
- Key 不写入源码、业务 SQLite、Trace、任务快照或渲染页面。
- 模型出口递归处理姓名、邮箱、电话、证件号、本地路径、Bearer/Basic、Cookie、API Key、私钥和 URL Query Secret。
- Sidecar 只监听 loopback，并使用每次桌面进程生成的控制令牌。
- 写操作使用稳定 `operation_id`。无法确认是否执行成功时进入 `outcome_unknown`，不得自动重放。
- MCP Schema 或注解变化会清空旧授权；Skill 内容变化会自动停用。
- `test use/` 包含本机真实回归材料，必须保持在 `.gitignore` 中，不得上传 GitHub。

## 外观与可访问性

- 浅色、深色和跟随系统三种模式保存在本地设置文件中，应用启动后立即恢复。
- 界面密度和主题色与明暗模式共用同一外观配置，不再依赖先打开设置页才生效。
- 深色模式只改变桌面工作区；正式简历 PDF / Word 保持文档自身的白色纸张与排版。
- 运行状态、列表位移和折叠动效遵循 `prefers-reduced-motion`，不展示伪进度或隐藏思维链。

## 开发环境

在 PowerShell 中执行：

```powershell
Set-Location "D:\hesan\Desktop\VSCODES\FetchCV_Windows"
npm ci
python -m venv backend\.venv
backend\.venv\Scripts\python.exe -m pip install -e "backend[dev]"
npm run desktop
```

不要复用 macOS 生成的 `node_modules`、Python 虚拟环境、Sidecar 或 `.app`。

`http://127.0.0.1:8766/docs` 是 Sidecar 调试接口，不是 FetchCV 客户端。

## 测试与打包

```powershell
npm run check
npm run build
npm run test:unit
npm run test:electron
npm run desktop:package
npm run test:packaged
```

安装包输出：

```text
release/FetchCV-Setup-0.4.19-win-x64.exe
release/win-unpacked/FetchCV.exe
```

只有 `npm run test:packaged` 通过后，安装包才可视为发布候选。公开分发前还需要 Windows Authenticode 代码签名。

桌面打包不会复制整棵 `node_modules`：Electron 主进程与实际使用的 Pi/OpenAI/Anthropic 路径会先编译成轻量运行时；Sidecar 也不会携带未使用的 NumPy/OpenBLAS。这样既保留离线本地 API、PDF 渲染和 MCP 能力，也避免把开发依赖、可选模型 SDK 与多余 Chromium 语言包放进安装包。

## Firecrawl（可选）

FetchCV 自带基础网页搜索、正文读取和受控浏览器，不配置 Firecrawl 也能工作。

Firecrawl 云服务：

```text
FETCHCV_FIRECRAWL_URL=https://api.firecrawl.dev
FETCHCV_FIRECRAWL_API_KEY=fc-...
```

自托管 Firecrawl：

```text
FETCHCV_FIRECRAWL_URL=http://127.0.0.1:3002
```

自托管模式不需要 Firecrawl 云 API Key，但仍需要本机 Docker/服务依赖。`vendor/firecrawl/` 是源码参考与自托管材料，不会自动启动，也不会进入桌面安装包。

## 目录

```text
src/                         React 桌面界面
electron/                    Electron、Pi Runtime、安全存储、Sidecar 生命周期
backend/applyos_api/         FastAPI API（旧内部包名暂留以兼容迁移）
backend/applyos_domain/      SQLAlchemy 领域模型
backend/applyos_harness/     权限、审批、状态机、版本、事实与审计
backend/applyos_agent/       业务工具、网页、Skill、MCP 与兼容层
backend/integrations/        PDF、DOCX、简历编辑器和外部适配
public/resume-editor/        嵌入式简历编辑器
tests/                       前端、Electron 和 Pi Runtime 回归测试
backend/tests/               后端与 Agent 业务测试
docs/                        架构、交互与审查记录
test use/                    本机真实材料，不进入 GitHub
```

以下内容不应提交到源码仓库：

```text
node_modules/
backend/.venv/
backend/data/
backend/build/
backend/dist/
dist/
release/
artifacts/
tmp/
.pytest-*/
source-references/
test use/
```

## 已知边界与下一步

- 当前任务重启对账已实现，但完整 SQLite lease、heartbeat、原子 claim 与持久消息唯一消费者仍待完成。
 - 改写审批草稿按 Run 写入 SQLite 审批记录并带递增 revision；旧 revision 写入会返回冲突，不再依赖 localStorage。完整 time-travel 事件历史仍待补齐。
- PDF 预览请求可在客户端停止等待，但真正的服务端协作式取消需要独立导入 Worker。
 - 岗位要求证据矩阵已有稳定 requirement ID、JD 连续原文、简历 section/item 落点和命中片段；从证据卡跳到编辑器精确字符高亮仍待补齐。
 - 提案进入人工审批前会经过确定性 evaluator：校验 JD 连续引文、fact 所有权/授权、数字、日期和角色强度升级；失败会返回同一个 Pi Loop 修正，不启动第二套 Agent。
- `outcome_unknown` 目前依赖人工核对；下一步是为支持的 ToolSpec 增加确定性 `reconcile()`。
- MCP 与 Skill 已有应用层信任控制，但操作系统级沙箱仍待实现。
- 长对话已减少逐 token 重绘，但尚未引入消息虚拟列表；只有在真实性能基准证明必要时才增加该依赖。
- 审计数据已由 Trace 持久化，面向用户的搜索、筛选与脱敏导出检查器仍待完成。

完整三轮研究、用户体验、产品裁决与工程落地见：

- `docs/three-round-agent-audit-2026-07-28.md`
- `docs/agent-review-round-2026-07-31.md`
- `docs/pi_native_architecture.md`
- `docs/interaction_audit.md`
