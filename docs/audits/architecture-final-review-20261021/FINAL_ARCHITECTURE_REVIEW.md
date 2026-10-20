# FetchCV 最终架构复核（architecture-final-review-20261021）

## 0. 证据边界

- **执行方式：** 本轮只读。宿主 shell 仍因 VM 磁盘不足无法启动（`VM_DISK_SPACE_INSUFFICIENT`），所以：
  - **没有执行任何 git 命令。** 实际工作树状态未知；只确认 `.git/HEAD` 指向 `codex/m3-runtime-contracts`。开发 Agent 自述“开始复核时已有 87 条 Git 状态记录”，本轮未核实。
  - **没有用解析器校验 JSON。** `FINDING_DISPOSITION.json` 和 `SOURCE_MANIFEST.json` 我逐行通读，结构闭合、无明显语法错误，但这不等于解析通过。
  - **没有运行任何测试。** 开发 Agent 的日志只作为线索：`python-release.txt` 末行为“190 passed, 2 skipped, 3 deselected”，`python-final-closure.txt` 中 3 项失败均为真实 PDF 缺失，与报告一致。
- **依赖版本：** `package.json:33-34` 与 `node_modules/@earendil-works/pi-agent-core`、`pi-ai` 的 `package.json:3` 均为 0.80.10。
- **亲自阅读的修改后源码：**
  - Electron：`electron/pi-agent-runtime.mjs`（100–624）、`pi/fetchcv-harness.mjs`、`pi/provider-adapter.mjs`、`pi/provider-probe.mjs`、`pi/provider-failure.mjs`、`pi/context-budget.mjs`、`pi/context-policy.mjs`（1–80）、`pi/conversation-tools.mjs`、`electron/main.mjs`（相关段）、`electron/sidecar.mjs`（1–80）、`electron/provider-utils.mjs`
  - shared：`shared/provider-endpoint.mjs`、`shared/model-profile.mjs`
  - 后端 harness：`backend/applyos_harness/permissions.py`（1–340）、`approval.py`、`gates.py`、`pipeline.py`（320–430）、`trace.py`、`versioning.py`（restore_snapshot）
  - 后端 agent：`backend/applyos_agent/result_archive.py`、`host_approval.py`、`mcp_tools.py`、`skills.py`、`prompt_contract.py`、`interview_evidence.py`、`interview_tools.py`（554–580）、`pi_domain_tools.py`（194–490）
  - 后端 API：`backend/applyos_api/conversations.py`、`pi_bridge.py`（45–180、187–226、360–700、820–920）、`main.py`（相关段）、`deps.py`、`backend/applyos_domain/database.py`
  - 迁移与 UI：alembic 0008、`src/components/ModelParameters.jsx`
  - 测试：`tests/pi-contract-regression.test.mjs`、`backend/tests/test_tool_gateway.py`（150–229）
- **未阅读（结论只能当线索）：** `capabilities.py`、`context.py`、`runtime.py`、`turn_input.py`、OCR 相关的 UI 与接口、`ModelSettingsDialog.jsx`、V2 的 `packages/*` 本轮改动、PyInstaller 配置。
- **子审查：** 本轮没有使用。下文所有 P1/P2 结论都由主审亲自读码得出。

## 1. 框架是否值得沿用：值得

**单一 Electron Pi 循环 + Python 负责业务、权限、持久化**，这个分工正确，应当保留：
- Pi 0.80.10 只拥有循环、流式、工具分发和钩子；
- 业务状态、审批、执行记录的权威留在 Python。

本轮修复反而更贴合上游契约：
- 去掉了收不到的 `subscribe(tool_result)`；
- 在 `execute()` 内调用 `setTools`，从下一轮起生效；
- `systemPrompt` 改为按 `activeTools` 的函数；
- 记忆改为 user 层资料消息。

问题已不在“框架选错”，而在三类收尾质量：
1. **事务与未知状态守卫的身份边界。** 见 X02。
2. **独立聊天新加固带来的锁竞争与密钥边界回归。** 见 X03、X04。
3. **“业务完成”与真实产物之间的语义缺口。** 见 X05。

### 1.1 默认 Python、冻结 V2：可接受，不建议反向迁移

**理由：**
- 简历流水线、事实审批、面经调研、MCP 写审批、完成门禁都只在 Python 侧实现。V2 的工具集只有知识检索、记忆、文档、作品和 MCP（`packages/app/workspace-agent-bridge.mjs:18-33`）。
- 真实用户数据在 Python 的 SQLite 中。

**反向迁移的代价：**
- 需要重写全部业务流水线和门禁；
- 需要迁移真实数据库，包括审批和版本快照。

这类数据风险远大于维持双栈的成本。

**必须补的一条（X14）：** `FETCHCV_V2_STORAGE_ROOT` 目前在安装版中同样生效（`electron/main.mjs:734` 一带的互斥分支）。安装版用户一旦设置该变量，就会进入一个缺少业务能力、MCP 安全模型也不同的后端。应当只在开发构建或显式实验开关下启用。

**V2 中值得回收的部分：** 分页文档读取、引用核验、记忆确认生命周期。应按 `BACKEND_TRANSITION` 的原则逐项回移到 Python，而不是整体切换。

### 1.2 是否必须立即换成类型化 AgentBackend：不必，但应在下一迭代做最小一层

现在不会出错，原因是两个后端由同一个宿主驱动，而 V2 用正则模拟路径（`workspace-agent-bridge.mjs:210-259`）。真正的风险是新增字段时出现单边漂移，例如 `tools`、`result_reference`、`system_prompt_sections` 只有 Python 返回。

**最小接口（只在 JS 层）：**

```text
AgentBackend {
  startTurn(scope, input) / startTask(runId, kind, provider)
  executeTool(scope, name, payload, signal)  -> {result, result_reference?, tools?, task_kind?}
  listTools(runId) / recordRequest(scope, seq, record)
  checkpoint(taskId, cp) / control(taskId)
  complete(scope, body) / fail(scope, body) / reconcile(hostId)
  steer(runId, input) / settleInput(id, state)
}
```

**分阶段：**
1. 第一阶段：HttpBackend 包住现有 URL；V2 直接实现接口方法，删除正则路由；用一套共享契约测试同时跑两个适配器。
2. 第二阶段（可选）：再考虑跨进程的 schema 校验。

不改动 Python 路由，不重写宿主。

### 1.3 Python 的单次抽取与模型密钥：不是发布阻断，下一迭代处理

**现状：**
- 密钥仍通过环境变量传给 sidecar（`electron/main.mjs:297-305, 736`），也通过 `/api/runtime/configure` 下发。
- 由于 MCP 的 `env_keys` 已拒绝 `FETCHCV_*`（`mcp_tools.py:27, 51-52`），之前最直接的外泄路径已关闭。
- 剩下的风险是两套协议栈和两套错误处理，以及外发内容不受 Electron 的 outbound_privacy 约束。

**迁移方式：**
- 抽取由用户主动发起，属于预览类操作，依赖“应用进程存活”是合理的，但不应依赖“窗口存活”。
- 推荐流程：Electron **主进程**通过 IPC 接收导入请求，再按三步执行：
  1. 调 sidecar，只做本地解析和脱敏，拿回待外发文本；
  2. 主进程用同一个 pi-ai 适配器调用 `completeSimple` 或 `streamSimple`，并带上结构化 schema；
  3. 把结构化结果 POST 回 sidecar，由 sidecar 做校验和入库。
- 不要做 Python 回调 Electron 的反向 RPC。
- 迁移完成并验证后，删除 `providerEnvironment` 中的密钥字段和 `runtime/configure` 里的 `api_key`。

## 2. 发布前必须修 / 下一迭代应修 / 可接受取舍

| 分类 | 项 |
|---|---|
| **发布前必须修** | X03：独立聊天在网络 IO 期间持有 SQLite 写锁 · X02：结果未知守卫可被修订号、阶段或别名变化绕过 · X05：“完成”不代表 PDF 已验证，需在 UI 和报告中明确语义，或接上真实产物门禁 · X14：安装版中禁用 V2 环境开关 |
| **下一迭代** | X04：审批专用签名密钥 · X08：`inspect_application_workspace` 输出体积 · X09：Anthropic 预算型 thinking 挤占可见输出 · X11：面经“就绪”与“充分”再次被合并 · N05：AgentBackend 最小接口 · F17：抽取迁入主进程 · 归档配额与保留期限（X13） · F19 / F21 中 MCP 的持久会话与 HTTP 认证 |
| **可接受取舍** | F05 保守字节估算 · F12 语义去重 · N08 持久化在后端 · 独立聊天暂不进 ToolGateway（限只读子集，条件见 §3.6） · Skill 相对资源暂不支持（需在产品范围中声明） · stdio MCP 不是沙箱（已声明） |

## 3. 六组问题逐项回答

### 3.1 主体架构

见 §1。

### 3.2 Pi 的用法是否修对

**在 `execute()` 返回前调用 `setTools` 的时序：正确。** 依据 Pi 0.80.10 源码：
- 当前这批工具调用使用的是开批时的 `currentContext.tools`（`agent-loop.js:394`）；
- 下一轮由 `prepareNextTurn → createTurnState` 读取新的工具和系统提示词（`agent-harness.js:366-375, 255-288`）。

所以切换从下一次模型请求开始生效，不影响同批调用。几种边界情况：
- **同批多个只读并行工具都刷新：** 最后一次写入生效。只读工具不改变阶段，读到的清单一致，竞争无害。只要批里有一个 sequential 工具，Pi 就会让整批串行（`agent-loop.js:289-290`），副作用工具不会和其他工具并行刷新。
- **刷新失败：** `execute` 抛出异常，Pi 把它转成 isError 的工具结果（`agent-loop.js:468-475`）。下一轮 `createTurnState` 调用 `systemPrompt` 函数，`assertCapabilities()` 再抛出，被 `executeTurn` 捕获并生成失败消息（`agent-harness.js:491-503`）。宿主随后在 `prompt()` 返回后重新抛出 `capabilityRefreshError`（`pi-agent-runtime.mjs:543-545`）。模型不会拿着旧清单继续推理，测试也覆盖了这一点（`pi-contract-regression.test.mjs:89-94`）。
- **abort：** 刷新请求带了 `signal`，取消时 `cancelledRequests` 已经置位，最终按 cancelled 处理。正确。
- **遗漏（X07）：** 后端已经成功执行了副作用，但刷新失败导致 Pi 把这次调用记为 isError，宿主回执也写成 `failed`（`pi-agent-runtime.mjs:340-351, 506-513`）。回执与后端事实相反。

**动态 systemPrompt：** 分段规则能准确反映 `activeTools`（`fetchcv-harness.mjs:38-46`；`prompt_contract.py:73-80`），WEB、WORKSPACE、INTERVIEW、Skill 都按工具存在与否组装。有两处遗漏：
- **X06：** 岗位聊天的 `job_id` 作用域行只追加到静态 `system_prompt` 上（`pi_bridge.py:407`），而只要有分段就不再使用静态版本，所以这一行丢了。影响小：工具从 run 推导岗位，不依赖模型传入 job_id。
- **任务模式：** 分段使用默认的 `thinking_level`，并且会在有联网工具时加入 WEB 段。旧版对任务模式是排除 WEB 的。属于行为变化，不算缺陷。

**记忆位置：** 摘要以 `timestamp:0` 的 user 消息形式放在最前，并计入预算（`fetchcv-harness.mjs:29-30`；`context-budget.mjs:43, 59`）。确认已进入资料层，不在 system 中。

**真实 Harness 测试：** `pi-contract-regression.test.mjs` 使用了真实的 `AgentHarness`、真实宿主和真实循环，只替换了 streamSimple。它确实覆盖了 N01 的原始缺陷（第二轮工具清单和 toolsHash）。地址测试使用真实 Anthropic SDK，只拦截 fetch，覆盖了 N02 的原始缺陷。关键遗漏有两个：
1. 动态提示词只在两次 `prompt()` 之间、空闲状态下调用 `setTools` 时验证过（:130），没有验证在 `execute()` 内切换后的下一轮 system 内容；
2. 没有覆盖“刷新失败但后端已成功”时回执的正确性。

不需要再补别的测试。

### 3.3 工具事务、恢复与审批

**白名单是否都满足“只有数据库副作用”：** 静态看成立。
- `local_transactional` 只用在 4 个领域工具（`pi_domain_tools.py:443-456`，经 `add()` 注册）和 `rollback_version_snapshot`（`mcp_tools.py:291`）。
- 这些 handler 的调用链里没有文件写入、`commit()` 或外部调用：`grep` 后端，`.commit()` 只出现在 gateway、deps、conversations、pi_bridge 和测试中。
- `_write_report` 只写 trace（`pipeline.py:402-411`）；文件写入只在 `renderer.py`、`policy.py`，以及 `assets.py` 中用到 `shutil`，均不在这些工具链上。

**savepoint 加 rollback 能否证明“未执行”：** 证明力来自两点：
1. handler 运行期间外层事务没有提交。认领状态在执行前单独提交（`permissions.py:220-227`），之后的所有改动都在这个未提交的外层事务里。
2. `guard.is_active` 能识别 handler 内部的 commit：commit 后 guard 失效，结果判为 outcome_unknown（`permissions.py:300-307`）。

失败时 `session.rollback()` 回滚整个外层事务，因此对“只写数据库”的工具，这个证明在逻辑上成立。

两个注意点：
- pysqlite 的旧式事务模式下没有配置 BEGIN 事件（`database.py:36-49`）。SAVEPOINT 会充当最外层事务，成功路径上的 RELEASE 等于提交，不影响结果正确性，但建议用真实文件库做一次断言（V-A）。
- 现有测试中 external 分支同样回滚了数据库（`test_tool_gateway.py:196`），所以测试无法区分两种 scope 的“证明力”，只能证明状态标签不同。

**状态转移：**
- 认领使用 CAS（`permissions.py:220-224`），能防止并发重复执行。
- `failed` 只对本地事务型工具可以重新认领。
- `retry_authorized` 只能由人工处理接口从 `outcome_unknown` 写入（`main.py:1206, 1221-1222`），恢复接口拒绝处于 `running` 的记录。
- 批准和处理结果都持久化在数据库中，跨重启不会丢失。

**新问题 X02：** `operation_id` 包含工具修订号、阶段和注册名（`permissions.py:139-144` 以及其后的 `_operation_identity`）。下列任一项变化都会得到一个新身份，旧的未知操作就挡不住它：
- 工具修订号变化：本轮修复本身改了 `effect_scope`，进入 `_spec_revision`（:341），所有修订号都变了；
- MCP 同名冲突导致别名改变（`mcp_tools.py:204-211, 217-241`）；
- 阶段变化；
- 在 BLOCKED 的 run 上直接 `start_task`：会把 run 置为 RUNNING（`pi_bridge.py:566`），不检查是否有未知操作。

于是同一个外部写操作可能被重新派发。

**简历哈希批准：**
- 哈希在**发起审批时**记录（`approval.py:32-38`），apply 时与当前内容比对（`pipeline.py:334-337`），审阅期间被编辑会让批准失效。
- 多轮修订时取的是最新一条已批准记录，旧哈希与新内容不符会安全失败。

没有发现绕过路径。仍存在的缺口：
- `approvals.require` 不带 target，任何旧批准都能通过入口检查，最终依赖哈希兜底；
- 提案按 run 汇总，新一轮审批需要对历史提案再次表态。这是早已存在的用法问题。

**回滚范围：** `restore_snapshot` 校验了候选人和岗位作用域（`versioning.py:90-92`），没有限定“本 run 产生的快照”，属于可接受范围。另一个问题：审批决定接口用当前阶段重新执行操作（`main.py:1186-1197`）。如果阶段在审批期间变了，`operation_id` 不同，批准匹配不上，整个决定请求回滚（X15 中记录，P3）。

**草稿门禁与产物门禁（X05）：** 草稿门禁已经不再伪造 PDF 状态（`gates.py:73-78`），X01 确认修复。但：
- `artifact_required=True` 的产物门禁**在生产代码中没有任何调用方**，grep 只命中测试；
- PDF 上传接口直接信任客户端传来的页数头，也不运行门禁（`main.py:1302-1341`）；
- 任务到达 READY_TO_PUBLISH 时 run 被标为 COMPLETED（`pi_bridge.py:775, 791`）；
- 之后在编辑器修改内容，只会清空 `pdf_path`，不会让已有的质量报告失效（`main.py:1254-1268`）。

所以现在没有“假装 PDF 已生成”，但存在“业务完成 = 草稿通过校验”的语义；旧质量报告在内容修改后可能被复用。是否已在 UI 上误导用户，本轮未读 UI，无法判断。

### 3.4 模型协议与测试连接

**地址解析：**
- `resolveProviderEndpoint` 是唯一实现（`shared/provider-endpoint.mjs`），SDK、探测和模型目录都用它。
- Anthropic：先剥离 `/messages`，再剥离 `/v1`，由 SDK 追加 `/v1/messages`。`/anthropic`、`/anthropic/v1`、`/v1/messages` 都得到正确结果；真实 SDK 测试覆盖了 5 种形式。
- OpenAI 兼容：只剥离 `/chat/completions`，不补 `/v1`。用户若只填域名，会请求 `/chat/completions`；由于探测与运行时一致，会在测试连接时如实失败。
- 带查询参数的地址（例如 Azure 的 `api-version`）被明确拒绝。应在支持矩阵中声明。

**compat 与能力映射：**
- 白名单的键和枚举与 pi-ai 0.80.10 的 `types.d.ts:413, 423, 433` 一致；
- UI 不对 Anthropic 显示 compat（`ModelParameters.jsx:17`），适配器也只对 openai 应用（`provider-adapter.mjs:40`）；
- 输入模态默认为仅文本。

**可设置但无效或冲突的值：**
- 推理模式为“不支持”时，`thinkingFormat` 和 `supportsReasoningEffort` 不起作用（pi-ai 先检查 `model.reasoning`），UI 没有提示；
- 白名单允许 `chat-template`，但 UI 没有列出；
- 内置模型目录里的 `input` 和 `compat` 被忽略，只认手动设置（`model-profile.mjs:68`）。

**输出容量（X09）：**
- 自动输出上限为 `min(16384, ceiling??8192, window/4)`（`model-profile.mjs:65`）。
- 对使用预算型 thinking 的 Anthropic 兼容模型，pi-ai 的 `adjustMaxTokensForThinking`（`simple-options.js:33-51`）在 high 级别下给出 thinkingBudget=16384，大于等于 max，于是降为 max−1024。
- 任务模式固定使用 `deep`，即 high（`pi-agent-runtime.mjs:190`；`provider-adapter.mjs:3`），可见输出加工具参数最低只剩约 1024 tokens，足以让 `prepare_resume_review` 被截断。
- 只在 reasoning=true 且模型不是 adaptive thinking 时触发。

**合成工具探测：**
- 能合理区分“可对话”和“工具未验证”：只有一次带枚举参数的调用，加上一次结果回传后正常结束，才判定 verified（`provider-probe.mjs:16-26`）。
- 它不能证明以下能力：复杂嵌套 schema、严格模式、大工具目录、并行调用、长参数流式。UI 应写成“基础工具往返已验证”。
- 探测与运行时有两处差异（X10）：
  - 探测使用 `reasoning:'minimal'` 和 `maxTokens≤1024`（:13），运行时用 low/medium/high，可能出现探测通过、运行失败，或反过来；
  - 推理模型可能在 1024 内被思考耗尽，导致误判失败。

**错误文本：** `providerFailure` 只使用状态码和固定字段白名单（`provider-failure.mjs:5-21`），`redactProviderError` 会隐藏密钥原文。不会泄露密钥，也有足够的定位提示（401/403/404/429/5xx、超时、网络）。

### 3.5 上下文、归档与隐私

**预算覆盖：** system、当前 `activeTools`（每轮取自 Pi）、固定的记忆消息、全部消息和输出预留都计入了（`context-budget.mjs:24-43`），`request-record` 还会对最终 payload 再查一次。整轮分组与工具配对保持不变。一致。

**回读链：**
- 后端对每次成功的工具结果都做归档（`pi_bridge.py:521-523, 666-668`；`conversations.py:242-243`）；
- 宿主把 `_result_reference` 放进结果，超长时生成信封，保留 reference 和 `fact_ids`（`context-policy.mjs:10-21`）；
- 预算二次压缩时，从原内容中取回 `_result_reference` 或 `reference`，引用仍可达（`context-budget.mjs:51-53`）；
- `read_tool_result` 按 scope 校验并验证哈希（`result_archive.py:30-40`）。

结论：链路真实可用。两处不足：
- 二次压缩时 `fact_ids` 不再保留（只剩 512 字符预览）；
- 本轮刚产生的结果仍可能被替换为占位，回读后可能再次被裁剪（N06 部分）。

**120 个事实 ID 的测试是否有代表性：** 只能证明 ID 不会丢，不能证明模型能用上事实内容。真实失败机制是 `inspect_application_workspace` 返回了两份完整的简历 `content_json`（`pi_domain_tools.py:223-224`），其中可能含有 base64 头像（`gates.py:17-23` 的注释说明了这种存储方式）。事实正文被挤进需要分页读取的区域，分页读到的大量内容是 base64 噪声（X08）。

**scope、哈希与原子性：**
- scope 为 `run:<id>`（岗位聊天和任务共享，同一岗位内合理）或 `chat:<id>`；
- 归档 id 由 scope 和内容哈希共同决定，写入采用 `on_conflict_do_nothing`，原子；
- 删除岗位时联动清理（`main.py:689-690`）；
- 归档内容经过 `sanitize_trace` 脱敏，和模型看到的 Electron 脱敏版本规则不同，但都去掉了邮箱和电话。可以接受。

**优先级：**

| 问题 | 优先级 | 依据 |
|---|---|---|
| 归档无限增长 | P2，下一迭代 | 网页结果最多 5 万字符，每次调用都存 |
| 独立聊天没有删除路径，`chat:` 归档无法清理 | P2（隐私），下一迭代 | X13 |
| 独立聊天取最近 200 条 | P3，可接受 | 有整轮裁剪兜底 |
| 没有摘要 | P3，可接受 | 同上 |

**估算方式：** 应继续保留保守字节估算，作为**安全上界**。若要提高效率，可以加一个“校准系数”：用 provider 返回的 `usage.input` 和本次估算字节数做比值，按模型持久化，且只允许把上界向下调到不低于实测值的程度。暂不建议接入 tokenizer：需要逐厂商维护，收益无法事先量化。

### 3.6 MCP、Skill 与独立聊天

**MCP：**
- 已完整：别名合法且稳定，冲突时带哈希（`mcp_tools.py:204-211`）；只读工具白名单、写工具逐工具批准，并要求服务器声明非破坏、封闭作用域；全局 deny 在注册和调用两处都生效（:223, 246-250）；整会话 45 秒超时（:84, 150）；分页带游标去重和上限（:117-130）；文本、块和结构化结果都保留；错误文本截断到 4000 字符回传（:154）。
- 缺口：
  - 发生冲突后别名会改变，牵连 X02；
  - 联网 deny 时 stdio 服务器也被整体禁用（:223），偏保守，但没有向用户解释；
  - 取消时不发送 `notifications/cancelled`。
- **stdio 不是沙箱：** 注释（:222）和描述“只读（依据服务器声明）”都写明了，没有被混淆；UI 文案本轮未读。
- **HTTP 认证头与 `.cmd`：** 不应阻断当前发布。前提是 UI 和文档明确写出“不支持，配置会被拒绝”：`env_keys` 在 HTTP 下直接报错（:63-64），`.cmd` 需要绝对路径。

**Skill：**
- 正确：
  - 全文件哈希覆盖 frontmatter（`skills.py:68, 110`）；
  - BOM 已处理（:61, 109）；
  - 同名且都启用时 `read_skill` 拒绝（:171-173）；
  - 目录截断有提示（:160）；
  - `list_skills` 只读，只列启用项。
- 旧授权的兼容逻辑先把旧的正文哈希写成 `trusted_hash`，下一次同步时因为与全文件哈希不符而停用（:86-89, 78-85）。结果正确，但用户会遇到“启用后很快又被停用”，应在升级说明中提示。
- **相对资源：** 建议先**明确产品范围**（只支持单文件 Skill）。将来要扩展时，复用 `roots()` 的路径限制，只读，并单独计入预算。

**独立聊天：**
- **X03（P1，修复引入的回归，静态推断）：** `execute_chat_tool` 先执行一次 `UPDATE ConversationMessage` 来串行化回执（`conversations.py:153-154`），然后在**同一个事务**里做网络 IO（:213-226），直到请求结束才提交。
  - pysqlite 在 UPDATE 前会发出 BEGIN 并拿到写锁，默认 busy timeout 是 5 秒（`database.py:39` 只设置了 `check_same_thread`）。
  - 同一批并行的两个 `search_web`（只读工具默认并行）中，第二个会在 5 秒后报 `database is locked`。
  - 同期其他写操作也会被阻塞，例如另一个岗位任务的 checkpoint 或用户保存编辑器。
- **X04（P2）：** HMAC 密钥就是控制令牌，而控制令牌已经通过 `additionalArguments` 交给了渲染进程（`main.mjs:621`），PDF 渲染窗口的 query 里也带着它。签名能绑定轮次、工具、参数、调用 ID 和 5 分钟有效期，可以防止模型或后端自行伪造批准，也能防止跨调用重放；但它与“能调用全部 API 的权限”是同一个凭据，不构成独立的批准权限。应改为只由主进程和 sidecar 持有的专用密钥。
- **重放与并发：**
  - 同一 call_id 的完成结果会从归档回放；
  - 参数变化会报 `idempotency_conflict`（:163-165）；
  - 一个失败（failed）的调用可以在令牌有效期内用同一令牌再执行一次。都是只读工具，可以接受。
  - 并发覆盖靠 X03 中的写锁防止，修复 X03 时必须用其他方式保留这一点（见 NEXT_ACTIONS 第 1 项）。
- **是否必须并入 ToolGateway：** 不必，可以暂留，条件有三：
  1. 只限只读子集；
  2. 在代码中加一个断言，独立聊天工具的 `side_effect` 一律为 False，并加测试；
  3. 共用模块：`WebClient`、权限判断、归档和回执逻辑。

  若将来需要写工具，再给 ToolGateway 引入 `ExecutionScope`（run 或 conversation）的抽象，让 `ToolContext.run` 变为可选，并把 invocation 表的外键改为多态 scope。不要为了得到 run_id 而创建假岗位或假候选人。

## 4. 尚无证据的部分

- 实际 Git 工作树和 JSON 解析结果（工具受限）。
- SQLite savepoint 在 pysqlite 旧式事务模式下的实际行为（V-A）。
- X03 锁竞争的实际表现（需要两个并发请求，加一个 8 秒的模拟网络）。
- UI 是否把 READY_TO_PUBLISH 显示为“已完成并导出”（X05 的用户影响）。
- OCR 状态流转（F10）、`capabilities.py` 的阶段守卫（F24）、F28/F29/F32 的改动：本轮未阅读。
- 安装包是否带上新表和新逻辑。代码使用 `create_all` 创建新表（`main.py:190`；`database.py:51-53`），新增的是表而不是列，静态看可行，但需要用安装版跑一次升级来确认。
- Pi 0.80.10 → 0.99.x 的变更：没有阅读 changelog。不建议在本次发布中升级；要升级，应先在现有契约测试的基础上做单独评估。
