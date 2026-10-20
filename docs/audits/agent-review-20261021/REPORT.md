# FetchCV Agent 架构审查报告（agent-review-20261021）

审查日期：2026-10-21（Shell 不可用，无法取得精确时分，目录以日期命名）
审查方式：**纯静态审查**。本轮 Linux 工作区因宿主磁盘不足（VM_DISK_SPACE_INSUFFICIENT）无法启动，没有执行任何命令、测试、构建或动态复现；另有两个子审查（Pi 上游契约核对、Electron/模型配置/打包一致性）因 API 额度不足中途终止。下文所有结论均来自源码阅读，凡未亲自或由子审查逐行核对的内容，均列入“未验证”。

## 0. 代码状态

| 项 | 值 | 来源 |
|---|---|---|
| 分支 | `codex/m3-runtime-contracts` | `.git/HEAD` |
| HEAD | `5d39706acdb97cfd0c53c931c224b0203c206a8e` | `.git/refs/heads/codex/m3-runtime-contracts` |
| 工作区是否有未提交改动 | **未知**（无法运行 git status） | — |
| 产品版本 | 0.4.19 | `package.json:6` |
| Pi 依赖 | `@earendil-works/pi-agent-core` 0.80.10、`@earendil-works/pi-ai` 0.80.10（精确锁定） | `package.json:33-34` |
| 仓库约束文件 | 根目录无 AGENTS.md / CLAUDE.md | Read 结果 |

## 1. 总体结论

1. **Pi 是真实运行时，不只是借名。** 桌面端模型循环由 `AgentHarness`（pi-agent-core）驱动，模型请求由 pi-ai 的 `openai-completions` / `anthropic-messages` 实现发出（`electron/pi/fetchcv-harness.mjs:19-41`，`electron/pi/provider-adapter.mjs:47-63`）。项目没有在 Electron 侧重写模型循环。Python 侧的旧循环（`CompatibleAgentRuntime`、`ClaudeAgentRuntime`、`loop_utils`）只被测试调用，已不在主对话链路上。
2. **但 Python 侧仍有 3 条直连模型的活路径**（岗位网页预览抽取、PDF 简历 AI 解析、未被 UI 调用的 `/api/jobs/{id}/analyze`），它们绕过了 Pi 链路的外发脱敏、请求快照和协议适配，且 API Key 通过环境变量进入 sidecar，与代码注释“密钥不进入 Python”矛盾（F17）。这就是“两套并行但行为不同的模型接入”。
3. **最严重的问题集中在工具账本和上下文预算，而不是提示词文本：**
   - 有副作用的工具执行抛异常后，invocation 永久停在 `running`，同参数重试只得到 `tool_outcome_unknown`，重启后整个 run 被标为 BLOCKED；用户的“未执行，允许重试”决定也是死路径（F01、F02）。
   - 上下文预算把 **UTF-8 字节数**当作 **token 数**比较（F05），默认最大输出只有 `min(2048, …)`（F06），工具结果超 50000 字符后只保留约 8.3k 字符且无回读工具（F07）。三者叠加，简历任务所需的事实 ID、面经原文引文最先被截掉。
   - MCP 工具名不做供应商约束清洗，一个超长或含非法字符的名称会让**每一次**模型请求被拒（F03）；`env_keys` 可以把 sidecar 自身的控制令牌和模型密钥转发给第三方 MCP 进程（F04）。
4. **面经工作流存在规则互相矛盾**：知识检索判定“可生成简报”要求含牛客来源，提示词和简报工具要求含小红书来源（F09），加上 OCR 状态死锁（F10）和完成门禁覆盖模型回答（F11），容易造成空转或“有资料却生成不了简报”。
5. **审批与简历版本没有绑定**：批准只匹配 run + action，批准后用户在编辑器里的修改会被 apply 覆盖（F13）。
6. 值得保留的设计不少（见第 6 节）：统一 ToolGateway、TypeBox/JSON Schema 参数校验、工具修订号、上下文按整轮分组且校验 tool 配对、未知模型窗口直接报错而不是猜测、事实与 JD 引文的确定性校验、无隐藏子 Agent。

## 2. 实际架构图（静态追踪）

```text
React UI (src/App.jsx, src/components/*)
  │  window.fetchcv.* (electron/preload.cjs)          [IPC 通道清单：未验证，见 §7]
  ▼
Electron main (electron/main.mjs)
  │  getProviderConfig(requestId) → 解密后的 provider {protocol, baseUrl, model, apiKey}
  │  同时把 provider 设置作为环境变量推给 Python sidecar（main.mjs:335-352, 769-775, 804）
  ▼
FetchCVAgentHost.run()  (electron/pi-agent-runtime.mjs:225)
  │ 1. POST /api/pi/{conversations|jobs}/{id}/turns  或  /api/pi/runs/{id}/tasks
  │    ← bootstrap: system_prompt, history, tools[], outbound_privacy, prompt
  │ 2. makeTools(): 每个工具 execute() = HTTP POST 回 sidecar（:351-396）
  │ 3. createFetchCVHarness() (electron/pi/fetchcv-harness.mjs)
  │      AgentHarness(session=InMemorySessionRepo, systemPrompt+memory块, tools)
  │      on("context")  → assembleContext() 预算裁剪（context-budget.mjs）
  │      on("before_provider_payload") → compatiblePayload + 请求快照落库
  │ 4. harness.prompt(bootstrap.prompt)  ← Pi 管理：模型请求、流式解析、工具分发、循环
  │ 5. subscribe(): turn_start / message_update / tool_execution_* / tool_result / turn_end
  │      → 过程区 trace、checkpoint（task 模式 280ms 去抖）、tool_receipts
  │ 6. POST .../complete 或 .../fail
  ▼
Python sidecar (FastAPI, backend/applyos_api/main.py)
  ├─ 全局中间件 require_desktop_session（main.py:226-233，x-fetchcv-control-token）
  ├─ pi_bridge.py：job 对话、任务、工具执行（ToolGateway）、checkpoint、reconcile
  ├─ conversations.py：独立对话（4 个手写工具，不经 ToolGateway）
  ├─ applyos_harness/permissions.py ToolGateway：注册、校验、审批、幂等、trace
  ├─ applyos_agent/*：业务工具（web、interview、workspace、pi_domain_tools、mcp_tools、skills）
  └─ SQLite (SQLAlchemy + alembic)
```

### 各场景实际路径

| 场景 | 入口 | 工具来源 | 历史 | 完成门禁 |
|---|---|---|---|---|
| 独立聊天 | `conversations.py:90 start_conversation_turn` | 4 个手写工具（知识检索、web 搜索/读取、工作区读取），**不经 ToolGateway**（`conversations.py:149-192`） | 全部已完成消息，无上限、无压缩（`:130`） | 无（`:208-217`） |
| 岗位聊天 | `pi_bridge.py:360 start_turn` | ToolGateway CONVERSATION 模式全量工具 + Skill + MCP + `activate_interview_research` | 最近 10 条纯文本 + 压缩摘要（摘要放在 system prompt） | 仅面经模式有门禁（`:838-874`） |
| 面经调研 | 岗位聊天中调用 `activate_interview_research` 后切换为 7 个工具（`pi_bridge.py:55-63`），由 `pi-agent-runtime.mjs:380-384` 与 `:504-510` 两处 `setTools` | 面经工具 | 同岗位聊天；system prompt 不重建 | 本轮必须产生 brief，否则替换模型回答 |
| 简历任务 | `pi_bridge.py:505 start_task` | 岗位聊天工具 + 领域工具（`pi_domain_tools.py:526-528`） | **空历史**（`fetchcv-harness.mjs:25`），仅 prompt 内联上次 checkpoint | 失败回执不阻止完成（`:757`） |
| 中断/取消/重启 | `cancel()` → `harness.abort()`；task 模式 350ms 轮询 `/control`；启动时 `/hosts/reconcile` | — | 暂停后恢复=新任务从头开始 | reconcile 只恢复独立对话与 task，不恢复岗位聊天 turn |

### 旧版与未调用代码

- `backend/applyos_agent/runtime.py` 中 `CompatibleAgentRuntime.complete_turn`（:386）、`ClaudeAgentRuntime.complete_turn`（:247）、`loop_utils.py`、`CapabilityMode.TASK`（`capabilities.py:46`）：仅测试调用。
- 但 `runtime.py` 的单次 `generate` 仍被 `AgentSuite.extract_job_posting`（`main.py:622-630`）和 `ai_parser.py:229` 使用——是活代码。
- `finalize_resume_version`（`pi_domain_tools.py:442`）定义了但从未注册，却在 `TOOL_LABELS` 中出现（`pi-agent-runtime.mjs:28`）。
- **两套 MCP 实现**：默认走 Python `mcp_tools.py`（官方 `mcp==1.28.1` SDK）；设置 `FETCHCV_V2_STORAGE_ROOT` 时切到 JS 手写 JSON-RPC 客户端 `packages/mcp/*`（`electron/main.mjs:734-742`）。两者安全模型、协议版本、Windows 启动规则都不同。
- `.m1-work/`、`.m1-quarantine/` 下有十余份旧构建产物；`backend/.venv-m1` 内有一份缺 `prompt_contract.py` 的旧 `applyos_agent`。只要 `FETCHCV_PYTHON` 指向它，就会运行旧代码。

## 3. 上游能力映射

> 说明：负责逐行核对 pi-agent-core / pi-ai 0.80.10 dist 源码与当前上游的子审查因额度不足中断，下表“是否正确”一列中凡标“未验证”的，均没有对照上游源码确认。DeepSeek Harness 的性质与本项目的关系同样未核实。

| 上游能力 | 项目接入位置 | 实际用法 | 是否正确 | 证据 |
|---|---|---|---|---|
| `AgentHarness`（模型循环、工具分发） | `fetchcv-harness.mjs:29-41` | 每轮新建 harness，传 session/models/model/systemPrompt/tools/activeToolNames/thinkingLevel/steeringMode/followUpMode/streamOptions | 使用方式合理；选项名是否全部被 0.80.10 识别：**未验证** | 本地源码 |
| `InMemorySessionRepo` | `fetchcv-harness.mjs:22-26` | 每轮从 bootstrap 重建内存会话；持久化由 FetchCV 后端负责 | 合理的业务选择（Pi 的会话持久化未被使用） | 同上 |
| `NodeExecutionEnv` | `fetchcv-harness.mjs:30` | `cwd: process.cwd()`；FetchCV 未注册 Pi 内置文件/shell 工具 | 未发现误用；安装版的 cwd 语义未验证 | 同上 |
| `harness.on("context")` | `fetchcv-harness.mjs:44-52` | 返回 `{messages}` 做预算裁剪；异常存入 `assemblyError` 后再抛出 | 契约（返回形状、异常传播）**未验证** | 同上 |
| `harness.on("before_provider_payload")` | `fetchcv-harness.mjs:54-61` | 修改 payload、落库请求快照、确认 steer 输入已进入上下文 | 同上 | 同上 |
| `harness.setTools()` | `pi-agent-runtime.mjs:383, 509, 515` | 面经切换时在工具 execute 内部和 `tool_result` 事件中**各调一次**；task 模式每个工具结果后刷新一次 | 重复调用，且在工具执行中调用的语义**未验证**（F18） | 本地源码 |
| 事件 `tool_result` | `pi-agent-runtime.mjs:497` | 与 `tool_execution_end` 同时处理 | 0.80.10 是否发出此事件**未验证**；若不存在，面经切换只靠 execute 内那一次 | 同上 |
| `steer()` / 队列 | `pi-agent-runtime.mjs:194-223, 415-423` | 用唯一 marker 在真实上下文中确认是否被消费 | 设计合理 | 同上 |
| pi-ai `createModels` / `createProvider` | `provider-adapter.mjs:48-63` | 自定义 provider + 内存凭据存储 | 合理 | 同上 |
| pi-ai 重试（`maxRetries:2`） | `provider-adapter.mjs:68-73` | 依赖上游 | 部分流式输出后是否重试、会不会重复文本或工具调用：**未验证**（F31） | 同上 |
| OpenAI Chat Completions | `provider-adapter.mjs:29, 45` | `compat: {supportsStore:false}` | 未验证 reasoning_content、并行 tool_calls、usage 的处理 | — |
| Anthropic Messages | `compatible-payload.mjs` | 非官方域名时删除 `thinking.display` | 是合理的兼容补丁；thinking signature 回放**未验证** | 本地源码 |
| DeepSeek Harness | 未见依赖 | — | 是代码来源还是设计参考：**未验证** | — |

## 4. 专项发现摘要

完整字段见 `FINDINGS.json`。严重级别：P0 数据安全或必然错误，P1 主流程会坏，P2 特定条件下出错或有风险，P3 维护性问题。本轮没有 P0。

### A. 模型 API

- **F17 P2**：Python sidecar 仍直接调用模型。它通过 httpx 单次请求 `/chat/completions` 或 `/v1/messages`（`runtime.py:305-311, 393-419`），API Key 由 Electron 写入 sidecar 的环境变量。这些调用没有 Pi 链路的外发脱敏和请求快照。
- **F06 P1**：自动最大输出取 `min(2048, ceiling, window/4)`（`shared/model-profile.mjs:56`），对大参数工具调用和推理模型明显偏小；`stopReason==='length'` 会直接让整轮失败（`provider-failure.mjs:26`）。
- **F30 P3**：所有模型都被声明支持图片（`provider-adapter.mjs:40`）。
- **F31 P2（待验证）**：provider 层 `maxRetries:2` 与部分流式输出的关系不明。
- 已确认的好设计：未知上下文窗口在严格模式下报 `model_profile_required`，不猜测（`model-profile.mjs:53-58`）；错误按 HTTP 状态归类、不透出原始响应体（`provider-failure.mjs:5-21`）。
- **未验证**：连接测试（`main.mjs:567 testProviderConnection`）是否走同一套 URL 规范化、是否测了工具调用协议；模型身份回答的来源。

### B. MCP

- **F03 P1**：工具名 `mcp__{server}__{tool}` 只清洗了 server 部分（`mcp_tools.py:194-195`），server 名最长可到 120 字符（`schemas.py:369`）。MCP 工具每轮都下发，所以一个非法名称就能让全部请求被供应商拒绝。
- **F04 P1**：`env_keys` 没有拒绝列表（`mcp_tools.py:154-160`），可以把 `FETCHCV_CONTROL_TOKEN`、模型密钥等转发给第三方进程。
- **F19 P2**：每次调用新起一个进程；`initialize` 和 `list_tools` 没有超时；取消信号不会传到 MCP 调用。
- **F20 P2**：服务器自报 `readOnlyHint` 即可免审批；全局“禁止联网/禁止读工作区”不覆盖 MCP。
- **F21 P2**：Windows 下 `PATH=os.defpath`，npx/uvx 找不到 node；HTTP 传输无法配置认证；`tools/list` 不分页。
- **F22 P2**：两套 MCP 实现由环境变量切换，行为不一致。
- **F34 P3**：`isError` 的错误文本被丢弃；结果整体 JSON 化后在 24000 字符处截断。
- resources、prompts、sampling 两套实现都不支持，但界面和文档没有声明。
- 已确认的好设计：配置只存环境变量名，不存秘密；写操作审批绑定到具体操作；调用时用 Draft 2020-12 校验 schema 并拒绝外部 `$ref`。

### C. Skill

- 已确认的好设计：system prompt 只放目录摘要（名称加 240 字符），全文通过 `read_skill` 按需读取；路径解析后限制在允许的根目录内，可防符号链接逃逸；正文变更后自动停用；Skill 不授予任何执行权限。
- **F23 P2**：信任哈希只覆盖正文（`skills.py:61, 68, 110`）。frontmatter 的 description 进入 system prompt，批准后可以被改写来注入指令。
- **F33 P3**：带 BOM 的文件解析失败；同名 Skill 读取结果不确定；`list_skills` 会写数据库并列出已停用的 Skill；只能读取 `SKILL.md` 本身，目录内引用的资源读不到；目录上限 20 个且超出时无提示。

### D. 提示词与上下文

- **F05 P1**：预算用 UTF-8 字节数比较 token 上限（`context-budget.mjs:5, 27, 43`）。中文内容被高估约 1.5–3 倍，32k 模型只剩约 29KB 可用，而岗位聊天的工具 schema 就占约 19KB。
- **F07 P1**：工具结果超过 50000 字符后，只保留约 `(50000-256)/6≈8290` 字符预览（`context-policy.mjs:10-14`），全仓库没有按引用回读完整结果的工具。`inspect_application_workspace` 把事实列表放在 JD 之后，事实 ID 最先被截掉（`pi_domain_tools.py:201-223`）。
- **F08 P2**：压缩摘要（原始的用户和助手文本）被放进 system prompt（`context-policy.mjs:60-70`、`fetchcv-harness.mjs:27`）。虽然包了“不可信”标记，层级仍是 system。
- **F18 P2**：上下文组装和请求记录使用创建 harness 时的初始工具列表（`fetchcv-harness.mjs:48, 56`），`setTools` 之后预算和工具哈希都基于过期快照。
- **F14 P2**：任务模式历史为空，也没有 memory 块。用户在岗位聊天中给出的自然语言约束，任务里看不到。
- **F32 P2**：近期的提示词精简删掉了“只有 1 个来源也要生成标注‘证据有限’的简报”和“先调用 `activate_interview_research`”两条规则（证据目录 `before/pi_bridge.py:388-389, 405-407`）。与 F09、F11 叠加后，空转风险上升。按需加载本身是生效的：显式按钮和激活工具的结果都会带出指引。
- **F35 P2**：面经模式下附件提示仍写着“用工作区工具读取”，但这些工具已不可用（`turn_input.py:30`）。
- 跨岗位隔离：岗位历史、摘要、审批都按 `job_id` 过滤。独立对话的知识检索没有候选人过滤（P3，单用户桌面场景影响有限）。

### E. 工具循环与业务

- **F01 P1 / F02 P1**：副作用工具账本问题，见总体结论第 3 点。
- **F12 P2**：客户端幂等键对副作用工具不起作用，去重依据是参数哈希；`target_revision` 从未发送，过期目标检查是死代码。
- **F13 P2**：审批不绑定简历版本；批准后用户的编辑会被覆盖；同一事实被多个补丁引用时，最后一个静默生效；用户批准空选择时回退为“全部已验证事实”（`pipeline.py:424-427`）。
- **F09 / F10 / F11 P2**：面经就绪规则矛盾、OCR 死锁、完成门禁替换回答，且来源计数跨整个岗位、不限本轮。
- **F15 P2**：岗位聊天没有单一活动 turn 的保护，重启后也不会被 reconcile，消息会永远停在 `streaming`。
- **F16 P2**：独立聊天的工具不经 ToolGateway，联网批准依赖客户端自报的 `approval_confirmed`。
- **F24 P2**：聊天模式允许所有阶段，包括 FROZEN 和 CANCELLED（`capabilities.py:75-76`）。
- **F25 P2**：失败的工具回执不阻止 complete。
- 已确认的好设计：`prepare_resume_review` 要求事实经过确认、JD 引文逐字存在、数字/日期/名称可回查，并检查职级拔高；面经抓取保存规范化 URL、哈希和原文副本，按 URL 去重；没有隐藏的 LLM 子 Agent。

### F. 桌面、开发版与安装版

本节主要内容**未验证**（子审查中断）。仅确认：
- 安装包的 `files` 排除了 `node_modules`（`package.json:85-92`），Pi 依赖必须由 `scripts/build-electron-runtime.mjs` 打进 `build/electron`。动态 import `@earendil-works/pi-ai/api/*.lazy`（`pi-agent-runtime.mjs:149-155`）在安装版能否解析，需要构建后验证。
- sidecar 日志默认丢弃，只有 `FETCHCV_SIDECAR_LOG=1` 时保留（`sidecar.mjs:114`），白屏或后端未就绪时难以诊断。
- **F28 P3**：未设置控制令牌时不鉴权；令牌也可以通过 `?fetchcv_token=` 查询参数传入（`main.py:226-233`）。

## 5. 复杂度判断

| 类别 | 内容 |
|---|---|
| 业务必需 | ToolGateway（审批、幂等、作用域）；简历事实绑定与校验；面经原文存证；checkpoint 与 reconcile |
| 合理扩展 | 基于 Pi 的 `context` / `before_provider_payload` 钩子做预算和请求审计；steer marker 消费确认 |
| 重复封装或历史遗留 | Python 端旧 Agent 循环与 `AgentSuite`；两套 MCP；独立聊天的手写工具与 ToolGateway 并存；`setTools` 双调用；`.m1-work` 和 `.venv-m1` 中的旧副本 |
| 过度设计疑点 | task 模式每个工具结果后都重新拉取工具列表并 `setTools`；过程区 trace 每次更新都触发 checkpoint 去抖。是否必要需在动态验证后再判断，这里不定为缺陷 |

## 6. 建议保留的设计

1. 单一 Pi 循环加统一 ToolGateway 的总体方向。
2. 工具修订号（参数 schema、权限、审批、副作用的哈希），以及调用时的修订号校验。
3. 上下文按整轮分组裁剪，并两次校验工具调用与结果配对；不改写已存储的会话。
4. 严格的模型画像：未知窗口直接失败，不靠猜测。
5. JD、附件、引用放在 user 角色，并以 JSON 标注为数据。
6. 确定性的事实、数字、引文校验，不依赖模型自评。
7. 面经的原文副本、URL 哈希去重，以及遇到登录或验证码时如实停止。
8. Skill 只放目录摘要、按需读取、路径限制在根目录内、正文变更后自动停用。
9. steer 输入以唯一 marker 在真实上下文中确认消费，而不是看队列计数。

## 7. 未验证项与证据边界

- 没有运行任何测试、构建、lint、git status 或动态复现。README 中的测试通过声明（`README.md:26-32`）**未被采信，也未被证伪**。
- 以下内容未逐行对照上游源码：Pi 0.80.10 的事件名、`setTools` 语义、钩子返回契约、重试与取消的传递、OpenAI 和 Anthropic 的流式与 thinking 处理。也未核对当前上游最新版本。
- DeepSeek Harness 与本项目的关系；`src/vendor/openbitfun` 的许可证和署名。
- Electron IPC 通道、连接测试与运行时 URL 规范化的一致性、密钥存储（是否用 safeStorage）、单实例锁、子进程清理、开发版与安装版数据目录是否隔离、打包产物是否包含迁移。
- 现有测试的副作用与数据路径（是否会碰真实用户数据）。
- 子审查结论（F01–F36 中大部分）由子代理逐行阅读得出；主审查员亲自核对过的只有 `pi-agent-runtime.mjs`、`fetchcv-harness.mjs`、`provider-adapter.mjs`、`compatible-payload.mjs`、`provider-failure.mjs` 和 `package.json`。各条的确认程度已在 FINDINGS.json 的 `confidence` 字段注明。
