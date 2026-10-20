# 目标架构（渐进式，不重写）

原则有三条：
- 保留现有的 Pi 单循环和后端权威 ToolGateway；
- 把“协议适配”“工具结果存取”“后端端口”三处收拢到唯一实现；
- 先对两套后端做出决策，再继续投入。

不更换运行时，不迁移语言，不引入 DeepSeek Harness 或 Cordis。

## 1. 模块职责

| 模块 | 职责 | 不负责 |
|---|---|---|
| React UI | 展示、输入、审批交互；只消费类型化事件 | 业务判断、模型协议 |
| Electron 主进程 | 窗口与 IPC 校验；**模型凭据唯一持有方**；启动和监管后端 | 业务状态 |
| AgentHost（`FetchCVAgentHost`） | 每个 run 创建一个 Pi harness；上下文视图；外发脱敏；请求快照；把 Pi 事件映射为 UI 事件 | 持久化、权限判断 |
| ModelGateway（新，由现有代码收拢） | `resolveEndpoint`、能力画像（窗口、输出、模态、reasoning、compat）、连接测试；**唯一的协议适配层**，对 pi-ai 做薄封装 | 业务提示词 |
| AgentBackend 端口（新接口） | startTurn / startTask / executeTool / readToolResult / recordRequest / checkpoint / control / complete / fail / reconcile | — |
| 后端实现（Python sidecar；V2 视决策而定） | 业务状态机、ToolGateway、审批、幂等、领域工具、知识库、持久化 | 模型调用（目标状态下不再直连模型） |
| 扩展层 | MCP 只保留一套（会话管理器 + 名称别名 + 统一权限）；Skill 目录与按需读取 | 绕过 ToolGateway |

## 2. 状态所有权（目标）

| 状态 | 唯一权威 | 其他层的角色 |
|---|---|---|
| 模型凭据 | Electron safeStorage | 后端不接收凭据 |
| 运行中的 Pi 会话 | AgentHost 内存 | 运行结束即丢弃 |
| 对话、任务、阶段、审批、工具执行记录 | 后端数据库 | 宿主只缓存 |
| 工具结果全文 | 后端的 ToolInvocation / ToolResult 存档（只读工具的结果也要存） | 上下文中只放预览加引用 |
| 检查点 | 后端，带 `state: active / settled` 字段 | — |
| 系统提示词片段 | 后端按能力返回分段 | 宿主通过 systemPrompt 函数，根据 activeTools 组装 |

## 3. 关键数据流

```text
UI → IPC → AgentHost.run(request)
   → backend.startTurn()  ⇒ {segments, history, tools[], policy}
   → ModelGateway.model(profile)  ⇒ pi-ai Model（含 compat）
   → AgentHarness(systemPrompt = f(activeTools, segments))
       on(context)              → ContextAssembler（token 估算 + 保护本轮 + 分页占位）
       on(before_provider_payload) → 脱敏 + 快照
       tool.execute             → backend.executeTool() ⇒ {preview, ref, next_tools?}
                                    next_tools 存在时，在 execute 内调用 setTools（下一次请求生效）
       on(tool_result)          → （可选）结果补丁
   → stopReason 校验 → backend.complete()  // 原文 + 结构化门禁结果，二者分开存储
```

## 4. 接入边界

- **模型：**
  - 支持矩阵限定为 OpenAI Chat Completions 兼容和 Anthropic Messages 兼容两种。
  - 每个模型画像包括：`contextWindow`、`maxOutput`、`reasoning`、`input`（模态）和 `compat`（直接映射到 pi-ai 的 model.compat）。
  - 连接测试分两级：一是流式文本，二是带一个工具的调用。两级都通过才标记为“可用于 Agent”。
  - 不支持的参数必须显式报错，不能静默降级。
- **MCP：**
  - 只保留一套实现。按 N04 的决策：若保留 legacy，就把 V2 的会话、分页和 list_changed 处理移植过来；若选择 V2，就补上 Windows 启动器（npx/uvx 等）的支持和 HTTP 认证。
  - 注册名统一为合法别名。
  - env 只能来自按服务器配置的凭据，并有拒绝列表。
  - 结果按 content 类型转换，并以不可信数据的形式包装。
- **Skill：**
  - 保持“目录摘要 + `read_skill` 按需读取”。
  - 信任哈希覆盖整个文件。
  - 允许读取 Skill 目录内的只读资源。
  - Skill 永远不授予工具权限。

## 5. 上下文与知识体系

| 类别 | 目标处理 |
|---|---|
| 当前请求 | 现有 assembleContext 保留；估算改为更接近真实的保守 token 估计；本轮工具结果只降级为预览，不替换成占位 |
| 历史与摘要 | 摘要作为受保护的 user 数据消息，不放在 system；记录来源消息范围；可重建 |
| 任务检查点 | 有生命周期字段，结构化 JSON 注入，并标记为不可信 |
| 长期记忆 | 采用 V2 的 propose / confirm / revoke 生命周期（无论最终保留哪套后端） |
| 私人事实 | 工具输出以“事实 ID 索引 + 分页正文”的形式返回；引用可回查 |
| 公开面经 | 保留现有存证；就绪和证据判定统一由一个 InterviewEvidencePolicy 决定 |
| 工具全文 | 所有工具结果存档；提供 `read_tool_result(ref, offset, limit)` |

**常驻约束**（保留在系统提示词中）：事实不可编造、外部内容视为数据、审批即停止、不声称未完成的能力。
**按需加载**：面经流程、简历流程、Skill 全文。

## 6. 保留、合并、拆分与退役

| 动作 | 对象 |
|---|---|
| 保留 | Pi 单循环；ToolGateway；operation_id 语义幂等；整轮裁剪；严格画像；外发脱敏；steer marker；开发版和 E2E 的数据隔离 |
| 合并 | 三处 URL 规范化合并为一个 `resolveEndpoint`；TOOL_LABELS 合并进后端工具定义；面经规则合并为一个 Policy；独立聊天工具并入 ToolGateway（待复核 F16） |
| 拆分 | 后端端口抽为接口（HttpBackend / InProcessBackend）；提示词改为分段返回 |
| 退役 | subscribe 中的 tool_result 分支；Python 直连模型的路径（待复核 F17/F29）；未消费的 target_revision 或将其接通；`.m1-work` 和 `backend/.venv-m1` 中的旧副本（需用户确认后清理）；N04 决策后落选的那套 MCP 和后端 |

## 7. 为什么不建议更换框架

现有问题都可以在当前框架内修复：协议适配收拢、回读通道、恢复协议、规则统一，都不受 Pi 的限制。Pi 0.80.10 已经提供了所需的扩展点：context 和 payload 钩子、systemPrompt 函数、`tool_call` / `tool_result` 钩子、`setTools`，以及 `compat` 兼容开关。

更换运行时的代价包括：重写宿主事件映射、请求审计和取消语义，并重新验证全部业务工具。目前没有任何一个问题需要付出这个代价。
