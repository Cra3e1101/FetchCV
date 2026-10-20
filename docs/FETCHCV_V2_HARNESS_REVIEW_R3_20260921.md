# FetchCV V2 R3：Pi / DeepSeek Harness 补充审查与执行调整

日期：2026-09-21。状态：**方案与只读源码审查，未执行 M2+**。

阅读顺序：先读本文的更正与新增任务，再读 [R2 完整阶段计划](./FETCHCV_V2_EXECUTION_2026_FIRST_R2.md)。本文替代 R2 §3 中以低层 Agent 为主的能力盘点及 §11 下一步任务描述；其余阶段、2026 研究优先级、原件保护和批准边界继续有效。原始 `linshi/FETCHCV_V2_FINAL.md` 与 R2 均原样保留。

本次用户指定来源：[Pi 官网](https://pi.dev/)、[Pi 官方仓库](https://github.com/earendil-works/pi)、[DeepSeek Harness 官方仓库](https://github.com/deepseek-ai/deepseek-harness)。逐项核验记录见 [R3 证据清单](./FETCHCV_V2_HARNESS_REVIEW_R3_EVIDENCE.json)。

## 1. 审查结论：确有遗漏，最重要的是核对了错误的主要 API 层

R2 正确指出本地版本与最新文档存在差异，但主要核对 `Agent`，没有追到 **FetchCV 实际创建的是 `AgentHarness`**。低层 Agent 的选项不能直接作为 Harness 的可配置能力。

本地证据：

- `package.json:33–34`：pi-agent-core / pi-ai 均锁定 **0.80.10**。
- `electron/pi/fetchcv-harness.mjs:13–17`：取出 AgentHarness、创建 InMemorySessionRepo 和 session。
- 同文件 `:23–35`：构造 AgentHarness，传入 models、tools、systemPrompt 与队列模式。
- 同文件 `:37–39`：已通过 `harness.on('context', …)` 调用现有工具结果精简和出站脱敏。
- `electron/pi-agent-runtime.mjs:144–148`：动态载入 core、Node 环境和 provider 模块。
- 本地 `node_modules/@earendil-works/` 直接子目录只有 pi-agent-core / pi-ai；没有 pi-coding-agent、pi-durable、Chord、pi-telemetry。

因此下一步应先复用 **Harness 的已有接点**。不是先新建一个 Agent 再重新实现 session、队列和压缩，也不能把官网 CLI 全部功能视为 FetchCV 自动拥有。

## 2. Pi 遗漏能力及精确适配边界

### 2.1 本地已存在的 Harness 能力

下表文件基址为 `node_modules/@earendil-works/pi-agent-core/dist/`，行号对应本次本地文件。这里只证明静态声明/接线存在，未运行新合同测试。

| 能力 | 本地证据 | R3 调整 |
|---|---|---|
| 上下文与工具前后接点 | `harness/agent-harness.js:333–377`；`harness/types.d.ts:480–513` | 通过 context / tool_call / tool_result 接到 APP 策略；不往 Harness 构造器塞低层 Agent 专属选项 |
| provider 请求和载荷接点 | `harness/types.d.ts:386–401,474–478` | M3 核验脱敏和最终请求预算的真实顺序；分别覆盖普通回复、摘要、分支摘要，不能假设一个 hook 覆盖所有路径 |
| steer / followUp / nextTurn | `harness/agent-harness.d.ts:50–58`；`types.d.ts:356–374` | 三种输入分别定义“已接受、待消费、已取消”的状态，保留输入 ID；不将它们混作一个无状态文本队列 |
| save_point / settled | `harness/agent-harness.js:424–449` | 可作为事件落盘/状态更新的接点；当前内存 session 的 save_point 不证明已持久化到 APP 的 DB |
| compact / navigateTree | `harness/agent-harness.d.ts:60–71`；`agent-harness.js:610–637` | 先比较 SDK 压缩/分支机制与现有字符精简；压缩要求 idle，不假设可在任意流式回调里执行 |
| setActiveTools / setResources | `harness/agent-harness.d.ts:76–85` | 为按任务启用工具/skills 提供现有接点；资源加载、来源信任、审批仍由 APP 管理 |
| SessionStorage / SessionRepo | `harness/types.d.ts:313–342` | M4 优先评估 APP 适配器，而非换一套独立权威会话库；树节点 ID、leaf 与 fork 语义需完整保留 |

两处要纠正的细节：

1. R2 所列 `toolExecution` 是低层 Agent 接口。当前 HarnessOptions 没有该项，Harness.createLoopConfig 也未传它。应核验 AgentTool 的执行分类、实际工具批次及 APP 调度入口，不能声称在当前构造器加一行就能改变并发规则。
2. 本地 Harness.createLoopConfig 同样没有暴露 `shouldStopAfterTurn`。存在低层类型不等于 FetchCV 能直接配置；确需该能力再比较版本升级或最小适配，不修改 node_modules。

### 2.2 当前取消与压缩需补的测试

本地 `agent-harness.js:886–906` 的 abort 会清空 steer / followUp，通知队列变化并等待运行收束；该段没有清空 nextTurn。`compact()` 的实现使用独立 hook signal，摘要调用没有直接传入 runAbortController 的 signal（`:625–637`）。这些是**需要验证的语义差异**，不等于已证明用户数据丢失或取消失效。

因此 M2/M3 合同必须包含：

- 取消时三类未消费输入的明确处理与 UI 回执；不得无记录地丢弃，也不在恢复后意外自动执行。
- “已发出取消请求”与“工具/摘要已停止并完成收束”分开；取消不是已撤销副作用的证据。
- 摘要期间的新输入、scope 变化或关闭窗口使结果过期时，不提交旧摘要；不靠一个无关的 signal 推定已取消模型调用。
- 当前 `electron/pi/context-policy.mjs` 的字符精简是已有路径。新机制必须比较预算、合法工具配对、引用可回读和事实保持，不能将已有代码描述为“尚无上下文处理”。

### 2.3 官网和新包补足的设计视角

| 来源 | 已核实内容 | 是否直接引入 |
|---|---|---|
| [官网 SDK](https://pi.dev/docs/latest/sdk) | coding-agent 的 AgentSessionRuntime 管理 session/cwd 更换；替换后需重新订阅事件并绑定扩展 | 当前没装此包。借鉴工作区切换生命周期，先在既有 Harness adapter 实现最小合同 |
| [官网 compaction](https://pi.dev/docs/latest/compaction) | 压缩和分支摘要携带累计文件操作信息，并保留树形历史 | 借鉴“摘要携带结构化来源”。求职资料需用 Source/version/block 引用，不能照搬编码工具文件列表 |
| [Chord README](https://github.com/earendil-works/pi/blob/main/packages/chord/README.md) | 按依赖启动、反向释放；服务和状态复制分离；断连后的副本需重新就绪 | 参考生命周期与 UI 状态合同，不为 M2 引入通用分布式插件运行时 |
| [pi-durable README](https://github.com/earendil-works/pi/blob/main/packages/durable/README.md) / [公开导出](https://github.com/earendil-works/pi/blob/main/packages/durable/src/index.ts) | 当前公开入口是记录类型和 MemoryStorage，README 另指向后续设计/序列 | **不能作为已完备持久化替代品**，不替换 M4 SQLite 计划；设计稿也不冒充已实现能力 |
| [pi-telemetry 合同](https://github.com/earendil-works/pi/blob/main/packages/telemetry/README.md) | 遥测不改变业务回调的执行次数/返回值；提供 adapter conformance | M3 采用同类合同；依赖是否引入另评，不默认增加远端 exporter |

Pi 官网的 extensions、skills、RPC、会话分享是不同层级功能。对 FetchCV，先保留现有 SDK 嵌入路径；不额外启动 CLI/RPC 子进程、不默认扫描用户全局资源、不默认分享简历会话。Pi 官方仓库也明确没有内建文件/进程/网络权限隔离；宿主边界不能靠一个扩展提示词替代。[官方权限说明](https://github.com/earendil-works/pi#permissions--containerization)

## 3. DeepSeek Harness：借鉴机制，保持单一权威与单 loop

官方将其标为 **developer preview，存在破坏兼容的变更**，并说明尚未接受安全审计。根仓库 MIT，不代表所有第三方组件同许可证。本轮不安装 dsh、不迁移 Cordis、不让两个 harness 并行拥有写入权。[README](https://github.com/deepseek-ai/deepseek-harness)、[安全状态](https://github.com/deepseek-ai/deepseek-harness/blob/master/SAFETY.md)

### 3.1 持久事实、实时过程、能力接口分开

[架构文档](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md) 区分 session 持久事件、agent 运行中事件和 capability 接点；模型历史从已记录内容投影出来，流式增量不等同于最终落盘消息。

对 FetchCV 的增量要求：

- 业务事实/receipt 与已结算的 Agent 事件持久化；UI token 增量是临时展示。
- 失败、取消、重试保留 attempt 状态，不能把半条成功文本当完成结果。硬退出时允许有未结算缺口，但要显示 interrupted/unknown。
- M3 定义请求组装记录，M4 接入统一存储。记录模型/profile、工具 schema hash、来源版本、摘要 revision、脱敏策略 revision，以及有序片段或受权内容引用。
- 仅存 hash 不足以重建内容；应在保留期内能重建**脱敏后的模型可见请求**。凭据/header 不入日志；材料撤权或删除后，可明确标记不可重建，不为审计强留已撤回敏感内容。

这是对 FetchCV 的改造提案；不照搬 dsh 所有事件类型或 session 物理格式，也不把 append-only 日志误解成永不执行用户删除策略。

### 3.2 可扩展钩子与最终拒绝检查分开

[工具流程图](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/tool-execution-pipeline.md) 与 [工具包合同](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/core/tools/README.md) 将普通扩展处理、单调拒绝检查、执行、结果整理和最终观察分层。[源码 index.ts](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/core/tools/src/index.ts) 的 guardReason / guard 注册也能对应上该设计。

FetchCV 在 APP 侧保留不可由插件取消的授权、目标归属、revision/CAS、操作 hash 检查。扩展可缩窄权限，不能通过排序或替换结果把拒绝改成允许。工具身份与参数一经批准必须冻结；如果实际 dispatch 改变参数，重新验证批准范围。

```mermaid
flowchart LR
  A[模型提出工具调用] --> B[参数规范化与身份固定]
  B --> C[任务策略与已有批准核验]
  C --> D[APP 最终拒绝检查]
  D --> E[受控执行与业务 receipt]
  E --> F[模型可见结果与引用]
  F --> G[只读观测与 UI]
```

图中 receipt 和最终拒绝检查是 FetchCV 权威；结果文案改写不能改变真实成功/失败状态。dsh 的 scope-local 注册有自己的继承/遮蔽语义，不能简单复制 restrict() 然后声称新注册工具也自动受全部父级限制；最终 APP 检查对任何入口都必须成立。

### 3.3 取消要求资源收束，重试必须区分副作用

dsh 工具源码的调用合同要求实现观察 signal 并在自有工作收束后完成；同进程代码不能被该接口硬杀。工具名/参数不可由 around wrapper 任意改写，caller cancellation 不能因 signal 替换丢失。[工具源码](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/core/tools/src/index.ts)

FetchCV 因此需要：取消前 dispatch 检查；已启动工具的完成/超时/unknown 状态；独立 worker 的迟到结果 fencing。外部写结果不明仍禁止自动重发。工具返回超时，不代表远端操作未发生，也不代表原件已恢复。

### 3.4 插件生命周期要回收注册资源

[Cordis primer](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cordis-primer.md) 将服务依赖和注册资源的释放作为基础。结合 Pi Chord，建议 M3 的第一方模块就声明依赖并返回 disposer；M9 再开放经审核的扩展能力。首版不必采用完整热更新框架。

必须释放事件订阅、watcher、定时器、工具注册和子进程句柄；激活失败要释放本次已建立的资源。会话/workspace 切换时撤销旧订阅，并使用 generation 拦截旧回调写入新会话。卸载能释放注册资源，**不能自动撤销已发送请求、已导出文件或已提交业务事务**。

### 3.5 prompt、工具 schema 和动态上下文分开组装

dsh 的 [system-prompt 合同](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/system-prompt.md) 有确定排序和 scope，对稳定提示词与动态上下文作区分。其 [session 投影合同](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/session.md) 明确版本化投影和恢复时的解释规则。

M3 最小组装清单建议为：稳定系统策略、实际可调用工具 schema、任务输入、受权证据、可再生摘要。保留有序 component ID/revision，拒绝重名与无效排序。外部材料始终作为资料，不升格为系统政策；不为缓存保留已撤权数据。先复用现有 context hook，再定义确定性组装合同，避免给每一段文本都造一个独立服务。

### 3.6 PTC 作为后置候选

dsh 支持 native / ptc / both，PTC 的嵌套调用仍走工具管线，而且整个程序不自动重放。[工具包合同](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/core/tools/README.md)

对 FetchCV，批量检索/结构化比较可先用现有只读批处理工具。只有 M6/M8 评测证明模型往返开销显著，再比较受限程序化组合；须保留每个子调用的授权/来源/预算，禁止把“允许执行程序”视为对子调用的总授权。M2 不因此新增通用任意代码执行器。

## 4. 新增 2026 年论文，但不夸大发表与证明范围

**A Programming Paradigm for Spatiotemporal Composability**，Yifan Shi、Wei Zhang、Tianyi Cui；首次公开 **2026-08-26**，arXiv **2608.25512**，本轮按预印本使用，未核实正式会议接收。[元数据](https://arxiv.org/abs/2608.25512)、[PDF](https://arxiv.org/pdf/2608.25512)

本轮核对作者、日期、摘要及 PDF 首页；未逐页精读 92 页或审查全部形式化证明。其主题是组件依赖和可释放效果的组合机制，适合为插件生命周期提供研究线索。FetchCV 的落地依据仍是官方工程合同及本地测试，不能据摘要宣称任意插件都能安全热更新或任意外部副作用都可逆。

注意 **Pi 的 Chord 与 dsh 的 Cordis 是不同项目**；名称相近、都处理组件组合，不代表 API 兼容或能直接替换。

## 5. 执行计划的最小修订与验收

| 优先级 / 阶段 | 改为交付什么 | 验证方式（后续实施时运行） | 失败处理 |
|---|---|---|---|
| P0 / M2a | AgentHarness → APP 的能力接线表，三队列/取消状态合同，本地与候选 SDK 差异 | 合成 session + fake provider，分别观察 steer/followUp/nextTurn、abort、save_point/settled；记录实际调用和持久化边界 | 保持现有 SDK；明确缺口，独立决定 adapter 或升级 |
| P0 / M2b–M3 | 宿主工具管线：身份冻结、最终拒绝检查、原始 receipt、模型结果视图 | 拒绝后钩子尝试允许；同名/嵌套入口；撤权与迟到结果；批准后改参；副作用 unknown | 不启用新入口，不以结果文本伪造通过 |
| P0 / M3–M4 | 可重建的脱敏请求记录，与 stream/attempt/settled 状态分离 | fake provider 捕获的请求与记录重建逐字段比较；失败/重试/取消；撤权后明确不可重建 | 不自动重放；保留受权故障证据 |
| P1 / M3 | 会话与模块生命周期 + generation | 两次切换/重新激活无重复订阅；失败激活无资源残留；旧回调不能写新会话 | 停用该能力，保留旧 runtime；不强行热切换 |
| P1 / M3–M8 | 优先复用 Harness compact/tree hooks；按 Source 引用总结历史 | idle/busy、摘要中取消/撤权/新输入；合法工具组；token 与任务正确性对照 | 回 R2 基础合法上下文，不提交旧摘要 |
| P1 / M3 | 有界、默认本地的遥测适配 | exporter 抛错/关闭时业务回调仍恰好调用一次，结果不变；秘密字段检查 | no-op 遥测；业务审批/receipt 失败策略不因此降级 |
| P1 / M10 | SDK/资源精确版本、离线 provider 目录与安装脚本审查 | 锁与产物比对、NSIS 实测、空网络/目录更新失败退路 | 旧 installer / 已验证锁，不现场追 latest |
| P2 / M9 | 声明式能力清单、卸载测试，必要时评估 PTC | 依赖缺失/停用/取消；嵌套调用逐项权限和记录；同预算对照 | 保持第一方固定组合和原生工具 |

Pi 上游的供应链措施包括精确依赖、安装脚本审查和离线模型数据构建入口，可用于 M10 的升级检查设计。[官方供应链说明](https://github.com/earendil-works/pi#supply-chain-hardening) **不能照搬成 FetchCV 全局禁止 install scripts**：Electron/esbuild 的安装和 NSIS 必须按既有 M1 证据分别处理，本轮不改 package.json / lockfile。

上述用例是待实现的验收设计，不是本轮已通过的测试。先完成 M2a 最小接线与合同，再决定新增依赖；不把 Chord、Cordis、pi-durable、pi-coding-agent 或通用 PTC 变成 M2 必选前置。

## 6. 本轮范围、版本与限制

已做：浏览用户指定官网/仓库及其官方文档，抽查工具 guard 源码和 durable 公开导出；读取本地 Harness 的声明、关键实现与 FetchCV 调用者；核实一篇关联 2026 预印本；新增本补充方案与 JSON 证据清单。

未做：安装/升级/克隆、模型调用、基准复现、业务代码变更、M1 重跑或 M2 实施。本轮不会把静态存在判为行为已通过。

版本限制：引用的是 2026-09-21 访问到的 main/master 与 latest 文档；GitHub commit API 在网页工具中不可访问，PowerShell HTTPS 尝试亦出现 TLS 错误，未获得精确远端 commit。未关闭 TLS 校验或绕过权限。实施前须取得固定 commit/tag 并复核；本地 0.80.10 与关键文件 hash 已记入清单。

原始设计、R2、业务源码和包文件保留；没有因上游范例而获得真实用户数据、凭据、共享会话或原件删除的新授权。
