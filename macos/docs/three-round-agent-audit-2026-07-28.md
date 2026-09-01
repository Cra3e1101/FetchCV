# FetchCV 三轮 Agent 架构与产品审查

日期：2026-07-28
版本：0.4.15
范围：Windows 桌面端、Pi Agent Runtime、FastAPI Sidecar、ToolGateway、简历与面试业务工具、交互与权限边界。

## 研究基线

本轮没有把高 Star 项目整套搬入 FetchCV，而是只吸收可验证的架构原则：

- [Pi](https://github.com/earendil-works/pi)：保持模型循环极简；FetchCV 不在 Python 后端重建第二套模型循环。
- [LangGraph](https://github.com/langchain-ai/langgraph)：借鉴持久检查点、人机确认、恢复与可观测性，不引入其完整运行时。
- [OpenHands](https://github.com/OpenHands/OpenHands)：借鉴事件、工具回执和产物边界。
- [LibreChat](https://github.com/danny-avila/LibreChat) 与 [LobeChat](https://github.com/lobehub/lobe-chat)：借鉴模型/工具选择、MCP/Skill 管理和折叠式执行信息。
- [Agent Chat UI](https://github.com/langchain-ai/agent-chat-ui)：借鉴流式对话、工具状态和中断恢复的界面分层。

论文与人机交互依据：

- [ReAct](https://arxiv.org/abs/2210.03629)：推理与行动交替，但界面只展示可核验的行动摘要，不泄露隐藏思维链。
- [Reflexion](https://arxiv.org/abs/2303.11366)：失败信息应成为后续决策上下文，而不是机械重试。
- [Lost in the Middle](https://arxiv.org/abs/2307.03172)：长上下文不能只依赖截断；重要事实、审批和工具结果应持久化。
- [AgentBench](https://arxiv.org/abs/2308.03688)：验收应覆盖完整任务，而非只测单次模型回答。
- [ToolEmu](https://arxiv.org/abs/2309.15817) 与 [AgentDojo](https://arxiv.org/abs/2406.13352)：工具结果、网页和扩展内容均视为不可信数据，写入和外发必须经过策略层。
- [Microsoft Guidelines for Human-AI Interaction](https://www.microsoft.com/en-us/research/publication/guidelines-for-human-ai-interaction/)：明确能力边界、允许纠错、支持撤销和失败恢复。

## 目标架构

```text
React/Electron 桌面交互
  → 单一 Pi Agent Loop
  → ToolGateway
      → 权限 / 审批 / operation_id / 副作用记录
      → 简历、岗位、网页、面试、工作区、MCP、Skill 工具
  → FastAPI + SQLite 持久状态
```

Pi 只负责观察上下文、选择工具、读取结果和继续决策。队列、审批、版本、证据、隐私和恢复全部位于循环外围。

实时天气、新闻等通用问题不注册专用业务关键词工具。模型根据语义选择 `search_web` 与 `read_web_page`；本轮同时移除了残留的 `get_weather` 展示分支。

## 第一轮：去除伪流程，确定单一循环

### 三类用户发现

- 新用户被“作品集构建”和“发布审批”阻断，尚未和 Agent 协作就被告知材料锁定。
- 重度用户发现 Electron Pi 与 Python Worker 都可能推进任务，状态含义不一致。
- 安全用户发现扩展默认启用、审批语义混杂，业务审批和工具权限出现在同一位置。

### 产品裁决

1. 简历流程到达事实与一致性检查后直接生成可编辑岗位版本。
2. Electron 桌面端只保留 Pi 模型循环。
3. 业务确认留在对应业务页面；工具权限确认进入输入框附近。

### 落地

- 简历状态机跳过模拟作品集和本地“发布资产”审批。
- Electron Sidecar 禁用 Python 模型 Worker；Python 只保留确定性工具、策略和持久化。
- Skill 新发现时默认关闭。
- AI 简历增强识别改为用户主动开启，并说明真实外发范围。

## 第二轮：副作用安全与工作区连续性

### 三类用户发现

- 写工具在进程退出后可能重复执行。
- 切换岗位时详情、Activity、审阅选择和预览标签可能互相覆盖。
- ATS 百分比会制造第三方系统“通过率”的错觉。
- 远程模型出口缺少统一 PII 处理。

### 产品裁决

1. 所有副作用使用稳定 `operation_id`。
2. 未收到写入回执时进入 `outcome_unknown`，禁止自动重放。
3. 岗位标签、滚动位置和审阅状态按岗位隔离。
4. ATS 改为可解释的岗位要求覆盖，不承诺通过率。

### 落地

- `ToolInvocation` 作为副作用 outbox：prepared → running → completed；未知结果必须人工处理。
- 同一规范化操作即使 Provider call ID 改变，也复用稳定 operation ID。
- 岗位详情请求加入序列校验；过期响应不能覆盖当前岗位。
- 审阅浮层加入对话框语义、Escape 和进度保持。
- 基础简历与岗位简历的预览、Word、PDF 文案明确区分。
- Pi 上下文出口统一处理姓名、邮箱、电话、证件号和本地路径。

## 第三轮：生命周期、信任链和纠错能力

### 三类用户发现

新用户：

- cancelled 状态仍显示无效的“从中断处重试”。
- PDF 识别错误能看见但不能在入库前修正。
- 要求矩阵只展示前四项，也看不到支持证据。
- `outcome_unknown` 卡片要求用户判断，却缺少核对信息。

重度用户：

- conversation busy、Activity 和 AbortController 仍是全局单例。
- 强退后旧 Pi task 会长期显示 running。
- 审阅草稿在请求失败前被提前清除。
- 任务运行中切换默认模型，界面可能显示错误模型。

安全用户：

- 出站脱敏缺少 Bearer、Cookie、API Key、私钥和 URL Query Token。
- MCP Server 自报 `readOnlyHint` 后被自动加入白名单。
- Skill 文件批准后发生变化，旧信任没有自动撤销。

### 产品裁决

本轮不新增求职功能，只修：

1. 任务终态、重启恢复和孤儿任务对账。
2. 岗位运行态隔离和未提交工作恢复。
3. 远程出口、MCP、Skill 的信任闭环。
4. 导入纠错、要求证据和未知操作核查。

### 落地

- cancelled 明确为终态；界面只允许基于同一岗位创建新一轮任务。
- Electron 启动并连接 Sidecar 后执行 host reconciliation：旧 host 的 running Pi task 转为 paused；若存在未知副作用则转为 blocked。
- 聊天 busy、Activity、错误和 AbortController 按 job 隔离；停止当前岗位不会中止另一岗位对话。
- AgentTask 持久化不含密钥的 Provider/model 快照；运行期间界面展示任务实际绑定模型。
- 审阅决定写入按 run 隔离的本地持久草稿；只有后端提交成功后才清除。
- 岗位要求矩阵支持展开全部要求，并展示命中证据或“当前简历没有可定位证据”。
- 改写审阅同时展示 JD 证据、绑定事实和风险级别。
- 出站脱敏递归覆盖消息、Thinking、工具参数和工具 Schema 文本，处理 Bearer、Basic、Cookie、API Key、Token、私钥、URL 凭据、Windows/UNC/macOS 路径；当前 Provider API Key 作为仅内存敏感字面量加入出口过滤。
- MCP 连接不再自动启用 Server 自报只读工具；用户逐项授权。工具 Schema 或注解变化后清空旧白名单和写策略。
- Skill 授权绑定内容哈希；内容变化后自动停用，读取前再次校验。
- MCP URL 拒绝把密钥放入 Query。
- PDF 导入预览可逐项修改模块、名称、组织、角色、日期和正文，可删除、排序、标记无法确认；最终入库使用同一份已核对快照。
- 本地/AI 预览支持停止和超时；API 层 AI 增强默认关闭。
- `outcome_unknown` 卡片展示操作、来源、目标、时间、最后状态、核对说明和三种决定的后果。

## 本轮验证

定向验证覆盖：

- Pi Harness 与递归脱敏。
- ToolGateway operation ID 与 unknown outcome。
- Pi 任务重启对账和模型快照。
- Skill 哈希撤销。
- MCP Schema 变化撤销授权。
- PDF reviewed preview 入库。
- ATS 要求支持状态和前端证据矩阵。
- 简历主流程直达可编辑岗位版本。

完整测试与安装包结果记录在本次交付消息中。

## 明确延期

以下属于下一架构版本，不在 0.4.15 中伪装完成：

- SQLite 任务租约、心跳、原子 claim，以及 Pi 对持久消息队列的唯一消费。
- 审阅草稿的服务端 revision/冲突控制；当前是按 run 的本机持久缓存。
- 导入会话 ID 和服务端协作式取消；当前取消能停止客户端等待，解析任务仍需独立 Worker 才能强制终止。
- 要求矩阵稳定 requirement ID、source offset、fact ID 和 resume location 的完整证据图。
- ToolSpec 确定性 `reconcile()`：基于文件哈希、版本快照或可信查询自动核对 unknown outcome。
- MCP/Skill 的操作系统级沙箱。
- 批量 JD、候选人偏好学习、投递 CRM、更多模板和全量 TypeScript 迁移。

这些延期项应先通过并发、强退和安全测试，再进入功能扩展。
