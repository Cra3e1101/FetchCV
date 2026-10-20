# FetchCV 架构与设计审查（architecture-review-20261021）

本轮是只读的架构审查，承接 `docs/audits/agent-review-20261021/`。原件未作任何修改。没有启动项目、运行测试或调用模型，也没有修改代码。

本报告的结论依据有三类：
- 我亲自阅读的本地源码，包括 node_modules 里锁定版本 0.80.10 的 Pi 编译产物；
- 官方仓库页面（检索日期 2026-10-21）；
- 上一轮子审查给出的线索。这类内容只放在“待复核线索”中，不和已确认的结论混在一起。

代码状态：分支 `codex/m3-runtime-contracts`，HEAD 为 `5d39706acdb97cfd0c53c931c224b0203c206a8e`。工作区是否有未提交改动未知，原因是 shell 不可用，无法运行 git status。

---

## 1. 总体判断

**框架值得继续沿用，不需要换运行时，也不需要重写。** 核心方向是对的：Electron 里只有一个 Pi `AgentHarness` 循环，由模型决定是否调用工具；业务规则、权限、审批和持久化放在后端的 ToolGateway 和领域服务里。这和 Pi 0.80.10 的设计是相容的：harness 只拥有循环、流式解析、工具分发和钩子，持久化与业务状态由应用负责。

问题主要不在“框架选错”，而在下面三个结构性问题：

1. **同一个 Pi 主机后面挂着两套完整的后端，而且没有收敛计划。**
   - 默认走 Python sidecar（FastAPI + SQLite + 全部求职业务工具）。
   - 设置 `FETCHCV_V2_STORAGE_ROOT` 时，切到 V2 的 JS 存储 worker（`packages/*`）。它有独立的数据模型、记忆、检索、引用核验和 MCP 实现，但没有面经、简历流水线和联网这些业务工具。
   - 两者通过一套用 URL 字符串模拟的伪 HTTP 协议接到同一个 `FetchCVAgentHost` 上（`packages/app/workspace-agent-bridge.mjs:210-259` 用正则路由 `/api/pi/...` 路径）。
   - 后果是：每个协议改动都要在两边实现；两套 MCP、两套技能、两套记忆的安全模型都不一样；而且没有任何一份文档声明哪一套是权威。
2. **模型接入层没有把“协议适配”收拢到一处。**
   - 连接测试用的是 `electron/main.mjs` 里自己写的 URL 拼接和非流式纯文本请求；真实请求走的是 pi-ai 的 SDK 适配。两套 Base URL 规则在 Anthropic 场景下会得出不同地址（N02）。
   - Python 侧还另有一套直连模型的实现。
   - pi-ai 自带的 `compat` 兼容契约（例如 max_tokens 字段名、developer 角色、reasoning 格式），项目完全没有向用户或模型目录暴露，只硬编码了 `supportsStore:false`（N03）。
   - 结果是“看起来通用，实际只对 URL 能被 pi-ai 自动识别的厂商可靠”。
3. **上下文和工具结果的容量设计过于保守，而且没有回读通道。**
   - 预算用 UTF-8 字节数当作 token 的上界。这本身是安全的取舍，但相当昂贵。
   - 自动输出上限被压到 2048。
   - 工具结果超过 5 万字符后只保留约 8.3k 字符，而且全仓库没有任何工具能按引用读回完整内容（V2 的 `read_document` 有分页，legacy 没有）。
   - 简历任务依赖的事实 ID、面经逐字引文都在这条路径上。

---

## 2. 实际架构与调用链

```text
React UI (src/) ──IPC runtime:request──▶ Electron main (electron/main.mjs)
                                          │ RuntimeRpc → FetchCVAgentHost.run()  (electron/pi-agent-runtime.mjs)
                                          │   getProviderConfig() → 当前激活的 provider（safeStorage 解密）
                                          │   bootstrap ← backend.request("/api/pi/.../turns|tasks")
                                          │   createFetchCVHarness() → Pi AgentHarness（每次 run 新建，InMemory 会话）
                                          │     on("context")  → assembleContext（预算视图）
                                          │     on("before_provider_payload") → compat 修补 + 请求快照 + steer 消费确认
                                          │   harness.prompt() ← Pi：模型请求 / 流式 / 工具分发 / 多轮
                                          │   tool.execute() → backend.request("/api/pi/runs/{id}/tools/{name}")
                                          │   subscribe() → trace / checkpoint / 回执 → .../complete|fail
                                          ▼
                 ┌────────────── 默认 ──────────────┐    ┌──── FETCHCV_V2_STORAGE_ROOT ────┐
                 │ HTTP → Python sidecar            │    │ 进程内 → V2 storage worker      │
                 │ pi_bridge.py / conversations.py  │    │ workspace-agent-bridge.mjs      │
                 │ ToolGateway（审批/幂等/版本）    │    │ AgentRepository / MemoryStore    │
                 │ 业务工具：web/面经/简历/MCP/Skill │    │ search_knowledge/read_document  │
                 │ SQLite（SQLAlchemy + alembic）    │    │ node:sqlite + blob store        │
                 │ 另有直连模型的 AgentSuite 路径    │    │ JS 版 MCP（手写 JSON-RPC）      │
                 └──────────────────────────────────┘    └──────────────────────────────────┘
```

Python sidecar 的启动、端口分配、健康检查和退出见 `electron/sidecar.mjs:46-127`。V2 的启动见 `electron/workspace-application.mjs:11-104`。两者互斥（`electron/main.mjs:731-742`）。

### 2.1 状态所有权（现状）

| 状态 | 权威位置 | 备注 |
|---|---|---|
| Pi 会话消息 | 每次 run 内存中的 `InMemorySessionRepo`（`fetchcv-harness.mjs:22-26`），run 结束即丢弃 | 合理：Pi 只做运行时，不做存储 |
| 对话与消息 | Python `AgentMessage` / `ConversationMessage`；V2 `Message` | 两套 schema |
| 任务与暂停/取消信号 | Python `AgentTask`，Electron 每 350ms 轮询 `/control`（`pi-agent-runtime.mjs:430-442`） | 轮询是有意的跨进程设计，可以接受 |
| 工具执行记录与幂等 | Python `ToolInvocation`（`permissions.py:185-237`） | 语义化的 operation_id |
| 审批 | Python `approval.py` | — |
| 模型配置与密钥 | Electron `settings/model-provider.json`（用 safeStorage 加密，`main.mjs:288-324`），**另有一份**推入 Python 进程环境变量和 `/api/runtime/configure`（`main.mjs:335-356, 774`） | 密钥有两个持有方 |
| 系统提示词 | 后端在 bootstrap 时一次性生成字符串（`prompt_contract.py:40-69`） | 工具切换后不重建 |

---

## 3. 上游使用正确性（Pi 0.80.10）

版本证据：`package.json:33-34` 精确锁定 0.80.10；`package-lock.json:807-834` 只有一份 pi-ai，不存在嵌套版本错配。上游最新 release 为 **v0.99.2**（github.com/earendil-works/pi/releases，检索日期 2026-10-21），比本项目新约 19 个 minor 版本。

### 3.1 正确用法（已核对上游源码）

| 契约 | 上游位置 | 项目用法 | 结论 |
|---|---|---|---|
| 构造选项 | `harness/types.d.ts:587-617` | `fetchcv-harness.mjs:29-41` 传入的每个选项都存在 | 正确 |
| `context` 钩子返回 `{messages}`，异常转为 `hook` 错误 | `agent-harness.js:339-342, 178-195` | 返回 `{messages}` | 正确 |
| 钩子或运行异常不会让 `prompt()` reject，而是变成一条失败的 assistant 消息 | `agent-harness.js:491-503, 454-461` | 记录 `assemblyError`，在 `prompt()` 返回后由 `assertAssembly()` 重新抛出（`fetchcv-harness.mjs:43-62`、`pi-agent-runtime.mjs:551-553`），并通过 `stopReason` 检查（`provider-failure.mjs:23-27`） | **正确，而且说明作者理解了这一点** |
| `before_provider_payload` 返回 `{payload}` | `agent-harness.js:219-236` | 用于兼容修补和请求快照 | 正确 |
| `setTools` 生效时点 | `agent-harness.js:797-825`；下一轮由 `prepareNextTurn → createTurnState` 读取新工具（`:366-375, 255-288`）；当前这批工具调用仍使用旧的 `currentContext.tools`（`agent-loop.js:394`） | 在工具 `execute()` 内部切换面经工具集 | **正确**：从下一次模型请求起生效，不会破坏当前这批调用 |
| 工具执行模式 | `agent-loop.js:289-290`：这批调用中只要有一个是 sequential，整批串行 | 副作用工具标为 sequential（`pi-agent-runtime.mjs:358`） | 正确 |
| 工具抛异常 | `agent-loop.js:468-475` 转成 `isError` 的工具结果并回给模型 | 后端错误消息作为工具结果返回 | 正确，模型可以据此调整 |
| abort | `agent-harness.js:886-916` 中止控制器并等待空闲；运行以 `stopReason:"aborted"` 正常结束 | `provider-failure.mjs:24` 把 aborted 转为 AbortError | 正确 |
| steer | `agent-harness.js:581-586`，空闲时抛 `invalid_state` | 用 marker 在真实上下文中确认是否被消费（`pi-agent-runtime.mjs:415-423`） | 正确，设计稳健 |
| 重试 | pi-ai 把 `maxRetries` 交给 OpenAI/Anthropic SDK（`openai-completions.js:130-137`、`anthropic-messages.js:368`）；SDK 只在拿到响应之前重试，流读取阶段的错误直接变成 `stopReason:error`（`openai-completions.js:381-399`） | `maxRetries:2` | 正确，**不会**因重试导致部分输出重复或工具重复执行（F31 撤回） |

### 3.2 破坏或误读上游契约之处

- **N01：`tool_result` 不是订阅事件。**
  - 上游的 `tool_result` 只通过 `emitHook` 分发给 `harness.on("tool_result")` 注册的处理器（`agent-harness.js:352-364`）；`subscribe()` 的监听器只能收到 AgentEvent 和 own events（`:158-176`）。
  - 因此 `pi-agent-runtime.mjs:497-521` 整个分支**永远不会执行**。造成两个后果：
    1. 面经切换实际只走 `execute()` 内的那一次 `setTools`，所以上一轮的“双重 setTools”（F18）不成立；
    2. **task 模式下“每个工具结果后刷新工具列表”从未生效**，同一个任务内阶段推进后，模型看到的仍是旧工具列表。
  - 这个问题没被测试发现，是因为宿主层测试使用的是假 harness（`tests/pi-agent-runtime.test.mjs:64, 153`）。
- **N09：系统提示词是静态字符串，工具切换后不会更新。**
  - Pi 支持把 `systemPrompt` 写成函数，入参包含 `activeTools`，并且每一轮都会重新计算（`types.d.ts:602-609`、`agent-harness.js:263-276`）。项目传入的是字符串（`fetchcv-harness.mjs:27, 34`）。
  - 所以切到面经模式后，系统提示词里仍保留着 WEB 和 WORKSPACE 规则，而对应的工具已经被移除。
- **N07：宿主层契约测试用的是假对象，升级风险被低估。**
  - 0.80.10 到 0.99.2 之间的事件和钩子变化，本轮没有逐项核对（见第 7 节）。

### 3.3 上游已有能力，项目重新实现了一遍

| 上游能力 | 项目做法 | 判断 |
|---|---|---|
| `harness.compact()` 以及 `session_before_compact` 钩子 | Python 侧做抽取式摘要（`context.py`），然后塞进 system prompt | 持久化放在后端是合理的；但摘要放在 system 层级可以讨论，见 F08 |
| `resources.skills`、`formatSkillsForSystemPrompt`、`harness.skill()` | Python 生成 Skill 目录，再加一个 `read_skill` 工具 | 合理的业务扩展：项目额外需要信任哈希、启停和路径限制。不建议迁回上游实现 |
| `tool_call` 钩子（可以 block）、`tool_result` 钩子（可以 patch） | 权限判断全在后端 ToolGateway | 合理。权威放在后端是对的；但 `tool_result` 钩子正好是修复 N01 的位置 |
| systemPrompt 函数 | 静态字符串 | 应采用（N09） |
| `compat` 兼容开关 | 只设置了 `supportsStore:false` | 应暴露（N03） |

### 3.4 DeepSeek Harness

- **它不是依赖，也不是代码来源，只是设计参考。** 全仓库（排除 node_modules）只在文档和 `src/styles.css:3148` 的布局注释里提到它。
- `docs/FETCHCV_V2_HARNESS_REVIEW_R3_20260921.md:68-70` 明确写着不安装 dsh、不迁移 Cordis。官方仓库自述是基于 Cordis 的 “everything is a plugin” harness，处于 developer preview，会有破坏兼容的变更。
- 这个取舍正确：项目没有让两个 harness 并存。
- 引入的 UI 代码 `src/vendor/openbitfun` 保留了 LICENSE（`src/vendor/openbitfun/LICENSE`、`design-system/LICENSE`）。

---

## 4. 专项架构判断

### 4.1 运行时边界

- **职责划分基本清晰。** Pi 负责循环、流式、工具分发、取消和 SDK 重试；FetchCV 宿主负责上下文视图、外发脱敏、请求审计、trace 和 checkpoint；后端负责业务状态机、审批、幂等和持久化。
- **没有第二个活着的 Agent 循环。** Python 的 `FETCHCV_DISABLE_TASK_WORKER=1`（`sidecar.mjs:92-95`）明确关掉了旧 worker。不过子审查报告说 `AgentSuite` 的单次生成路径仍在使用（待复核线索 F17）。
- **重试机制没有重叠。** SDK 只在拿到响应前重试，后端不重试工具，Pi 不重试整轮。
- **有两套“状态机”，但它们不重叠。** 后端的 PipelineStage 是业务阶段，Pi 的 phase 是运行阶段，职责不同，属于合理设计。
- **写死过度的地方：** 面经的平台顺序、来源数量门槛、“必须含牛客”和“必须含小红书”分别写在提示词（`prompt_contract.py:23-31`）、工具描述（`pi_bridge.py:66-71`）、检索工具（`interview_tools.py:557-579`）、简报工具（`:1229-1291`）和完成门禁（`pi_bridge.py:838-874`）五个地方，形成多个真相来源（F09）。
- **只交给提示词保证的地方：** “不要先调用 search_web”只写在工具描述里，代码层面不拦截。这是有意为之的软约束，可以接受。

### 4.2 模块分层

- **前端 ↔ Electron：** IPC 只开放 `runtime:request` 等通道，并做来源帧校验（`main.mjs:369-392`），设计良好。
- **Electron ↔ 后端：** 宿主依赖“路径字符串协议”，没有类型化接口（N05）。Python 用 FastAPI 路由实现这套协议，V2 用正则模拟。这是两套后端得以并存的原因，也是协议漂移的风险源。
- **密钥有两个持有方：** Electron 加密保存，同时以明文推给 Python 进程（F17 中已确认的部分）。
- **单点瓶颈：** MCP 每次调用都新起进程，并在 FastAPI 的同步线程里 `asyncio.run`（`mcp_tools.py:76, 129`）。

### 4.3 模型接入

- **抽象不完整。** 只有 `protocol ∈ {openai, anthropic}` 加 `baseUrl` 和 `model`，能力画像只有 `contextWindow`、`maxOutputTokens` 和 `reasoning`（`shared/model-profile.mjs:47-61`）。
- **缺失的维度：**
  - 输入模态：硬编码为 text 和 image（`provider-adapter.mjs:40`）；
  - compat 开关（N03）；
  - 是否支持工具调用；
  - 流式是否返回 usage。
- **连接测试与真实请求不一致（N02）。** 连接测试是非流式、`max_tokens:12`、不带工具（`main.mjs:208-245`），而且 URL 由 `providerEndpoint` 拼接（`:189-202`）。真实请求由 SDK 把 `/chat/completions` 或 `/v1/messages` 追加到 `normalizeBaseUrl` 的结果上（`provider-adapter.mjs:7-10`、`anthropic-messages.js:644-647`）。
  - 当 Anthropic 兼容地址以 `/v1` 结尾时，测试请求的是 `/v1/messages`，运行时请求的却是 `/v1/v1/messages`。
- **身份声明是正确的。** system prompt 里的模型身份取自本次请求的 provider（`pi_bridge.py:367`、`conversations.py:119` 调用 `_runtime_settings(payload.provider)`），不是硬编码。
- **错误分类基本完整。** 按 401/403/404/429/5xx、超时、网络错误、输出截断分别给出提示（`provider-failure.mjs`）。可观测性方面有请求快照（`request-record.mjs`）。

### 4.4 MCP 与 Skill

- **MCP 和 Skill 都进了统一的 ToolGateway**（亲自确认 `mcp_tools.py:201-216` 注册到同一个 gateway），不是旁路接入。
- **MCP 本轮亲自确认的问题：**
  - 名称未清洗，只清洗了 server 段（`:194-195`），见 F03；
  - 每次调用新起进程，且只有 `call_tool` 有超时（`:129, 144`）；
  - `PATH=os.defpath`（`:157`）；
  - HTTP 传输不带任何请求头（`:104`）；
  - `tools/list` 不分页（`:109-110`）；
  - `isError` 时丢弃错误文本，结果整体 JSON 化后在 24000 字符处截断（`:130-131, 145-148`）。
- **MCP 中合理的取舍：**
  - 只读工具必须逐个进入用户白名单（`:119-121, 187-188`）；
  - 写工具必须逐工具批准，而且服务器要声明“非破坏、封闭作用域”（`:122-128`）；
  - 工具清单变化时自动撤销信任（`:77-83`）。
- **Skill：** 子审查的结论（只放目录摘要、路径限制在根目录内、正文变更后停用）本轮未逐行复核，列为待复核线索。
- **扩展成本：** 新增一个内置工具需要同时改后端 ToolSpec、`TOOL_LABELS`（`pi-agent-runtime.mjs:9-33`），可能还要改提示词。成本可以接受，但 TOOL_LABELS 应改为由后端定义携带。

### 4.5 上下文、记忆与知识（按类别分别看）

| 类别 | 权威来源 | 作用域与生命周期 | 判断 |
|---|---|---|---|
| 当前请求上下文 | Pi 会话（内存）经 `assembleContext` 形成的视图 | 单次 run | 按整轮分组、校验工具配对、不改写原始数据，**设计正确** |
| 会话历史 | 后端消息表；hydrate 时只取纯文本（`context-policy.mjs:34-58`） | 岗位聊天取最近 10 条，独立聊天取全部（子审查线索） | 丢弃历史中的工具调用是合理取舍，同时避免了跨请求回放 thinking 签名的问题 |
| 压缩摘要 | Python 抽取式摘要 → system prompt（`context-policy.mjs:60-70`） | 每个岗位一份 | 层级偏高（F08）；不可撤销 |
| 任务检查点 | `AgentTask.result_json.checkpoint` | 跨任务保留，正常完成后也保留（`pi_bridge.py:750-758`） | 生命周期有误（F14） |
| 长期记忆 | legacy：审批记录和引用的追问；V2：`propose_memory` / `read_memory`，并有确认生命周期 | — | V2 设计明显更好，legacy 没有真正的记忆模型 |
| 私人材料与事实 | `facts` 表；V2 有 `read_evidence` 和引用核验 | 候选人级别 | legacy 的事实 ID 依赖一次性塞进上下文，容易被截断（F07） |
| 公开面经 | `InterviewSource` 表，原文副本和 URL 哈希去重 | 候选人级别，可复用 | 存储设计合理 |
| 工具输出全文 | legacy 只在 `ToolInvocation.result_json` 里存副作用工具的结果；**没有回读工具** | — | 结构缺口（F07） |

- **预算单位：** UTF-8 字节，并明确声明为保守上界（`request-record.mjs:22-23`、`context-budget.mjs:29`）。字节数不会小于 token 数，所以这是安全上界，不算计量错误。但它对中文偏保守约 3 倍。超出预算后的降级顺序是：先丢弃旧的整轮，再把大的工具结果换成占位，最后报错。**没有摘要式降级**（F05 改判）。
- **预算覆盖面完整：** system prompt、工具 schema、消息和输出预留都计入，最后还会对实际 payload 再检查一次（`request-record.mjs:24-29`）。这一点做得好。
- **task 模式的特殊风险（N06）：** 历史为空且 `protectedFrom=0`，预算紧张时只能把**本轮**的工具结果替换成“重新读取资料”的占位，可能诱发重复读取的循环。

### 4.6 求职业务

- **简历：** 本轮没有亲自阅读 pipeline 和 validation 的源码。子审查报告事实绑定的设计扎实，但审批不绑定版本（F13），列为待复核线索。
- **面经：** “可生成简报”（`ready_for_brief`：至少 4 篇已分析且至少 1 篇牛客）和“证据充分”（`sufficient`：至少 4 篇且含小红书）服务于两个不同的状态，不是严格矛盾。但前者把“必须有牛客”写死成停止抓取的条件：只有小红书来源时，系统会持续要求去找牛客（F09 部分成立）。
- **完成门禁：** 本轮没有生成简报时，模型的回答会被固定文案替换，原文不保存；来源计数是整个岗位的，不限本轮（`pi_bridge.py:847-874`，F11 确认）。这样做保证了“不伪造简报”，但同时掩盖了运行结果。

### 4.7 桌面与交付

- **开发版数据隔离：** 开发版必须设置 `FETCHCV_DEV_USER_DATA`，否则数据目录无法确定（`main.mjs:51-54`）。E2E 有独立目录（`:55-58`）。这是正确的防误伤设计。
- **启动顺序：** Python sidecar 在 `whenReady` 之前就开始启动；窗口先显示；健康检查是带退避的轮询（`sidecar.mjs:51-63`）；然后 reconcile；Pi 模块在 1200ms 延时后预热（非关键路径）。整体合理。
- **可诊断性弱：**
  - sidecar 的 stdout 和 stderr 默认丢弃（`sidecar.mjs:113-114`）；
  - 健康检查不校验控制令牌；
  - `choosePort` 先探测再启动，中间有竞态窗口。
  - 以上见 N11。
- **退出：** Windows 上用 `taskkill /T /F` 杀掉整个进程树（`sidecar.mjs:122-123`），正确。退出前不通知进行中的 run，由下次启动时的 reconcile 处理，可以接受。
- **打包：** `build-electron-runtime.mjs` 只打包 `main.mjs`（Pi 被 esbuild 内联）和 `preload.cjs`。安装包中的 sidecar 是 PyInstaller 产物，migration 是否随包携带本轮**未验证**。

---

## 5. 应保留的设计

1. 单一 Pi 循环加后端权威 ToolGateway，并通过工具修订号让工具合同保持同步。
2. 按整轮裁剪的上下文视图、工具配对校验，以及覆盖全部输入的预算检查。
3. 钩子失败经 `assertAssembly` 重新抛出；对 `stopReason` 做严格检查，不把 aborted 或 length 当作成功。
4. steer 的 marker 消费确认。
5. 语义化的副作用 operation_id（运行、阶段、工具、参数、目标版本），以及“结果未知即停止”的保守原则。修复方向是把恢复协议补完整，而不是推翻它。
6. 严格的模型画像：未知上下文窗口直接报错，不猜测。
7. 外发脱敏与请求快照（排除 thinking 内容）。
8. MCP 的逐工具白名单、写操作的逐操作审批，以及工具清单变更时撤销信任。
9. 开发版和 E2E 的数据目录必须显式指定。
10. DeepSeek Harness 只作为设计参考，不引入第二个 harness。
11. V2 中的引用核验、分页文档读取和记忆确认生命周期。即使暂不切换到 V2，这些也是 legacy 应当对齐的目标形态。

## 6. 结构性问题清单（摘要）

完整内容见 FINDINGS_REVIEWED.json。

| 编号 | 问题 | 级别 |
|---|---|---|
| N04 | 两套后端，没有收敛决策 | P1（结构） |
| N02 | 连接测试与运行时的 URL 规则不一致，连接测试也没有验证工具协议 | P1 |
| F01/F02 | 副作用失败后的恢复协议不完整（“允许重试”是死路径） | P1 |
| F03 | MCP 工具名未清洗，可能让所有请求失败 | P1 |
| F06 / F07 | 自动输出上限 2048；长结果被截断且无法回读 | P1 |
| N01 | task 模式的工具列表刷新从未生效 | P2 |
| N03 | 没有暴露 compat 兼容契约 | P2 |
| N05 | 宿主与后端之间是无类型的路径协议 | P2 |
| F09 / F11 / F14 | 面经规则分散在多处；完成门禁替换回答；检查点生命周期错误 | P2 |

## 7. 尚无结论的部分

- **Pi 0.80.10 到 0.99.2 之间的变更：** 没有逐项阅读 changelog（release 页面体量过大，只取到了版本号）。升级前必须专门核对一次。
- **安装包产物：** PyInstaller 包里是否包含 alembic 迁移，以及首次启动时如何执行迁移。
- **安装包运行时：** Pi 的 `*.lazy` 动态 import 在打包后能否解析。静态判断 esbuild 会把带字面量的动态 import 打进 bundle，但需要构建后确认。
- **简历流水线与 Skill 实现：** 简历流水线（`pipeline.py`、`validation.py`）、独立聊天工具（`conversations.py:149-192`）、`policy.py`、`skills.py` 都没有亲自阅读。相关结论只作为待复核线索。
- **V2 的覆盖范围：** V2 的功能完整度，以及计划中的切换路径（`packages/app/workspace-cutover.mjs` 已经存在）。需要产品负责人确认 V2 是否是既定方向。
