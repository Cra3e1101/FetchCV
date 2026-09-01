# FetchCV 三轮 Agent 架构与体验审查

> 审查日期：2026-07-21
> 实现基线：FetchCV Windows 0.2.33
> 目标：不是增加一个“会聊天”的页面，而是让“读取材料 → 调研岗位 → 提出修改 → 请求确认 → 修改模板 → 验证 → 生成版本 → 准备面试”成为可恢复、可核验、可接管的 Agent 闭环。

## 1. 外部参考矩阵

| 来源 | 借鉴内容 | FetchCV 的落地方式 | 不照搬的部分 |
|---|---|---|---|
| [Claude Code](https://github.com/anthropics/claude-code) | 工具、Skill、MCP、恢复会话和清晰的运行事件 | Skill 按需加载；MCP 与原生工具统一进入 ToolGateway；桌面端只显示真实事件摘要 | 不复制编码产品的信息架构，不展示隐藏思维链 |
| [Gemini CLI 工具系统](https://github.com/google-gemini/gemini-cli/blob/main/docs/reference/tools.md) | 自动工具选择、修改前确认、受信目录、工具发现 | 只读默认执行；写入/移动/删除按目标审批；工作区边界和工具白名单由代码执行 | 不开放任意 Shell，不把权限交给提示词 |
| [OpenAI Agents SDK](https://github.com/openai/openai-agents-python) | provider-independent tools、guardrails、sessions、HITL、tracing | Provider runtime 与业务工具解耦；所有工具有结构化输入、Trace、审批和结果信封 | 不引入第二套编排框架 |
| [LangGraph interrupt](https://github.com/langchain-ai/langgraph/blob/main/libs/langgraph/langgraph/types.py) | checkpointer、可恢复中断、HITL | SQLite 任务队列、阶段状态机、审批记录、版本快照支持暂停/恢复 | 不为已有确定性管线增加图框架依赖 |
| [Aider](https://github.com/aider-ai/aider) | 变更以 diff 为中心，自动校验，可撤销 | 简历改写保持 before/after、fact_id、JD 证据；应用前审批，应用后质量门禁 | 不把简历转换成源码式自由编辑 |
| [OpenHands](https://github.com/All-Hands-AI/OpenHands) | 事件驱动环境、真实工具轨迹、用户接管 | ToolGateway 事件是 UI 唯一运行来源；网页/文件/简历结果均记录来源 | 不采用开放式计算机控制和任意命令 |
| [Pydantic AI](https://github.com/pydantic/pydantic-ai) | 类型化工具、模型无关、durable execution、eval/OTel | Pydantic 工具 Schema、统一运行预算、证据清单和运行验收 | 不重写现有 runtime 与数据库层 |
| ReAct (ICLR 2023) | 观察和行动交替，结果改变下一步 | 模型每轮根据真实工具结果继续选择，搜索结果不能直接当正文 | UI 不展示模型私有推理文本 |
| Reflexion (NeurIPS 2023) | 失败反馈用于后续尝试 | 失败类型、只读重试、审批决定和引用纠正进入后续上下文 | 不自动把模型自评写成长期事实 |
| AgentBench / SWE-bench / WebArena (ICLR 2024) | 用真实环境任务和最终结果评测，而非只看回答 | 使用真实 PDF/JD 端到端回归；新增运行证据检查 | 不用单一总分掩盖失败原因 |
| WebAgent / ToolLLM (ICLR 2024) | 长网页先提取相关内容；多工具路径必须可执行 | 招聘页读取、网页正文、面试来源分层；工具结果有来源 URL | 不把搜索标题当事实，不把不可访问页面伪装成成功 |
| Microsoft Human-AI Interaction Guidelines (CHI 2019) | 预期、纠错、用户控制、随时间适应 | 关键操作询问；错误可重试；显式引用和审批成为记忆；状态文案描述实际动作 | 不用营销式进度或伪造“深度思考” |

## 2. 三类刁钻用户

1. **隐私敏感的数据分析应届生**：一份成熟 PDF，同时投数据、商业分析和产品；要求原排版不动、数字不被增强、API 上传最小化。
2. **AI 产品/工程复合型求职者**：材料多、岗位表述模糊，经常在长对话中引用旧回答纠正方向，要求 Agent 能继续调研而不是重跑全部流程。
3. **高频投递的 Agent 工具重度用户**：会切模型、断网、暂停、排队消息、接 MCP，窗口尺寸频繁变化；不能接受同一请求因入口不同产生不同能力。

## 3. 第一轮：执行一致性和故障恢复

### 用户发现

- 排队回复缺少即时 SSE 回复的真实处理事件，完成后无法知道调用过什么。
- 每个模型回合的“分析当前请求”是模板文案，不是实际状态。
- 临时网络错误直接回到模型，模型容易重复搜索；副作用工具又不能盲目重试。
- 不同思考档位的预算散落在代码中，不利于解释和测试。

### AI 产品经理复审

- 发送时机不应改变 Agent 能力和证据。
- 运行状态只描述可证明的动作：等待模型决策、选择工具、读取来源、重试、形成回答。
- 重试必须只用于可安全重放的只读操作；写入仍依赖审批和幂等。

### 已实现

- 新增统一 `AgentRunBudget`，任务与对话共享回合/工具/单轮调用上限。
- 只读工具遇到 `retryable` 错误时最多自动重试一次；写工具不自动重放。
- `ConversationToolOutcome` 返回 `stop_reason` 和 `evidence`，记录真实工具、来源和产物。
- 排队消息保存与即时消息同结构的 `processing_trace`。
- 活动文案改为事实性事件：判断下一步、选择具体工具、核对上一工具结果。

## 4. 第二轮：结构化记忆和上下文失效

### 用户发现

- 长对话压缩后，JD 或简历刚被修改，旧快照仍可能继续生效。
- 自动从自然语言“猜偏好”会把一次讨论误当永久设置。
- 用户引用某段旧回答纠正时，这类高价值决定需要比普通闲聊更稳定。

### AI 产品经理复审

- 长期记忆只存用户明确做过的动作，不用关键词推断人格或偏好。
- 上下文必须绑定 JD、基础简历、岗位简历、事实、材料和审批的来源指纹；任一改变就失效。
- 模型需要时可读取 decisions，但通用问题不预载整份简历。

### 已实现

- 上下文快照加入 `source_fingerprint`，JD、简历、事实、材料或审批变化后自动生成新快照。
- `explicit_memory` 只包含审批决定和用户主动引用后的纠正，不执行关键词分类。
- `read_job_workspace_context` 新增 `decisions` 分区，模型按语义调用。
- 保持通用对话只带最近历史；完整岗位和候选人内容仍由工具按需读取，减少隐私暴露和无关偏置。

## 5. 第三轮：真实验收、视觉层级和可解释证据

### 用户发现

- “完成”只表示模型回复结束，不代表岗位证据、简历血缘、质量门禁都存在。
- 右栏有阶段状态，但缺少一个不打扰对话的证据总览。
- 传统百分比分数无法区分“尚未执行”和“已经失败”。

### AI 产品经理复审

- 不增加 AI 总分；改成一组可点击到真实记录的检查。
- 状态分为已核验、进行中、需处理；未进入某阶段不能被算作失败。
- 默认只显示最值得处理的四项，保持 Claude/Codex 式克制信息密度。

### 已实现

- 新增 `AgentRunEvaluator`，检查模型 Trace、ToolGateway Trace、上下文新鲜度、JD 证据、简历版本血缘、质量门禁、消息交付和用户审批。
- 岗位工作区 API 返回 `run_evaluation`；右栏增加紧凑“运行证据”，优先展示 warning/pending。
- 证据项引用 run/context/profile/resume/quality/approval/message 记录，不以模型自述作为通过条件。
- 动效继续遵循 100–240ms 的 transform/opacity 过渡，并尊重 `prefers-reduced-motion`；正在执行的文本流动只表示当前真实事件。

## 6. 仍需后续验证的边界

- 第三方招聘站、小红书和验证码页面的可访问性由站点策略决定；不能保证无人值守抓取。
- 自托管 Firecrawl 是可选网页基础设施，不等同于内嵌一个无需依赖的 Skill。
- 当前可恢复任务管线已有持久状态；通用对话在 Provider 传输中断后会保留用户消息和工具 Trace，但尚未恢复到同一个 Provider token 流位置。
- Windows 公开分发仍需要 Authenticode 签名。

## 7. 验收方法

- 单元/接口：所有后端、前端结构测试通过。
- 真实材料：`test use/高子强的简历.pdf` 与 `test use/JD.txt` 仅在本机运行，不进入仓库和安装包。
- 端到端：聊天滚动、事件自动折叠、引用、键盘发送、窗口缩放、简历预览/编辑、打包后 Sidecar 健康检查。
- 隐私：安装包和源码中不得出现 API Key、数据库、个人测试材料或临时产物。
