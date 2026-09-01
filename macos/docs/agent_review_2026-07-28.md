# FetchCV Agent 架构、产品与体验三轮审查

> 日期：2026-07-28
> 基线：FetchCV Windows 0.4.11
> 目标：让 FetchCV 成为可调用真实工具、可暂停恢复、可审批、可核验、可交付求职产物的业务 Agent，而不是 API 聊天套壳。

## 1. 研究参考与取舍

| 参考 | 采用的精华 | FetchCV 的落地 | 明确不照搬 |
|---|---|---|---|
| [LangGraph](https://github.com/langchain-ai/langgraph) | 长任务状态、检查点、恢复 | SQLite 任务记录、Pi 检查点、恢复前能力指纹校验 | 不引入第二套图编排运行时 |
| [OpenAI Agents SDK](https://github.com/openai/openai-agents-python) | 入口只负责编排，工具、会话、运行状态分层 | Pi 负责模型循环；ToolGateway 负责工具与策略；业务服务负责版本和质量门禁 | 不让 Provider SDK 承担业务规则 |
| [Codex app-server](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md) | thread/turn/item 身份、内联审批、恢复 | Agent 事件统一 thread/run/turn/sequence/revision；审批绑定真实工具调用 | 不展示隐藏思维链，不开放任意 Shell |
| [Claude Code](https://github.com/anthropics/claude-code) | Skill、MCP、权限、后台任务、生命周期 | Skill 按需读取；MCP 与原生工具统一进入 ToolGateway；暂停、排队和继续保持同一任务 | 不复制编码产品的信息架构 |
| [OpenHands](https://github.com/OpenHands/OpenHands) | Agent SDK 与 GUI 解耦、真实环境事件 | Electron 只消费公共事件；Python 业务后端不伪造模型思考 | 不采用开放式计算机控制 |
| [Pydantic AI](https://github.com/pydantic/pydantic-ai) | Provider 无关、类型化工具、图与 eval | Pydantic/JSON Schema 工具输入；运行证据检查；Provider 配置可替换 | 不重写已稳定的 Pi 核心 |
| [assistant-ui](https://github.com/assistant-ui/assistant-ui) | Thread/Message/Composer/ActionBar 分层、流式滚动与工具 UI | 对话、思考摘要、输入器、审批和证据各自独立；输入器固定在底部 | 不引入另一套 React Runtime |
| [Vercel AI Chatbot](https://github.com/vercel/ai-chatbot) | 结构化工具、消息持久化、Radix 交互 | 工具结果结构化存储；弹层、菜单和焦点行为遵循可访问组件规范 | 不做通用聊天 Dashboard |
| [Open WebUI](https://github.com/open-webui/open-webui) | Agent 前端与模型后端解耦、工具结果原位更新 | 同一事件 ID 用 revision 更新，不把每次 delta 堆成新消息 | 不追求模型市场式复杂度 |
| ReAct（ICLR 2023） | 决策与真实行动交替 | 模型基于工具结果决定下一步；搜索结果不等于网页事实 | 公共 UI 只显示可验证行动摘要 |
| SWE-agent（NeurIPS 2024） | Agent-Computer Interface 决定任务效果 | 给模型高层领域工具，而非大量细碎 UI 操作 | 不把简历工作流变成自由 Shell |
| AgentBench / WebArena（ICLR 2024） | 长期决策、真实环境、指令遵循需要端到端评测 | 用真实 PDF、JD、网页、恢复、审批与导出做验收 | 不以“回复成功”代替业务完成 |
| WebAgent（ICLR 2024） | 先规划、再提取长网页的相关部分 | 招聘页和面试来源先读取正文，再由模型结构化和交叉验证 | 不把搜索摘要直接写进知识库 |

## 2. 三类高要求用户

1. **隐私敏感的数据分析应届生**：已有成熟 PDF，只允许基于事实调整表达，不能破坏版式或上传无关个人信息。
2. **AI 产品与工程复合求职者**：会切换模型、纠正 Agent、引用旧回答、接 Skill/MCP，要求上下文和工具行为可追溯。
3. **高频投递的 Agent 重度用户**：频繁暂停、恢复、排队消息、断网、缩放窗口，要求入口不同但能力、权限和结果一致。

## 3. 第一轮：AI 学者/全栈设计师审查

### 用户暴露的问题

- Pi、Python fallback、任务队列使用了相似但不完全一致的事件结构。
- Provider 的 reasoning delta 容易被误当成可展示思考，既拥挤又有隐私风险。
- 检查点只保存文本和步骤，不能判断恢复时工具、Skill、MCP 或权限是否已改变。

### 产品经理裁决

- UI 展示“做了什么、用了什么依据、现在需要什么”，不展示模型隐藏思维链。
- 即时对话、后台任务、Python fallback 必须使用同一公共事件协议。
- 恢复是重新核验后继续，不是盲目重放旧状态。

### 已实现

- 新增 Agent Event Protocol v1：`thread_id/run_id/turn_id/sequence/revision/kind/status/evidence_refs`。
- 同一事件按 revision 原位更新；事件文字被限长，避免流式碎片和工具原始输出污染聊天。
- Provider reasoning 仅转成公共决策摘要，不保存或展示隐藏思维文本。
- Pi 任务 checkpoint 的真实 `processing_trace` 进入前端，完成后仍可审计。

## 4. 第二轮：三个用户体验与 PM 复审

### 用户反馈

- 右栏此前只是阶段展示，没有回答“Agent 本轮依据了哪些材料”。
- 证据列表过长时像 Dashboard；过短时又无法解释为什么通过。
- 任务暂停/恢复按钮缺少明确语义，屏幕阅读器也无法理解。

### 产品经理裁决

- 中央只承载对话和当前行动；右栏承担上下文库存、运行依据和下一步。
- 默认展示最重要的四项，完整信息按需展开。
- 状态必须来自真实 checkpoint、ToolGateway trace、材料和版本记录。

### 已实现

- 右栏增加上下文库存：JD、基础简历、补充材料、已验证事实。
- “本轮依据”默认四项，可展开全部；不再把证据卡片堆入对话正文。
- checkpoint 新鲜度、运行证据和控制按钮增加明确状态和可访问标签。
- Python fallback 事件与 Pi 协议对齐，同时保留旧消费者的 `type` 兼容字段。

## 5. 第三轮：恢复安全、交互动效和压力复审

### 用户反馈

- 长任务中出现新步骤时需要自然上推，结束后自动折叠，但用户手动展开后不能被抢走控制权。
- 恢复前如果用户刚关闭网页权限或更换 MCP，旧任务不能继续按旧能力行动。
- “模型回复完成”不能等价于“求职任务完成”。

### 产品经理裁决

- 当前行动保持一条流动高亮；历史事件折叠且仍可查看。
- checkpoint 必须绑定创建它的工具、Skill 和权限表面。
- 完成状态由业务产物、版本血缘、事实与质量门禁共同决定。

### 已实现

- 新事件使用位置动画平滑进入；当前动作文字使用克制的横向流动高亮。
- 完成后延迟折叠；用户主动展开后保持展开；`prefers-reduced-motion` 下禁用循环动效。
- checkpoint 增加 SHA-256 capability fingerprint，覆盖工具定义、Skill 清单和权限配置。
- 恢复时若指纹变化，旧检查点只作为提示，Agent 必须重新读取工作区和当前工具后再行动。
- 运行证据继续区分 verified / pending / warning，不使用虚构 AI 总分。

## 6. 当前架构结论

```text
React / Electron
  ├─ Thread / Composer / Activity / Approval / Evidence UI
  └─ Pi Agent Core（Provider 无关模型循环、流式、steer）
       └─ FastAPI Pi Bridge
            └─ ToolGateway
                 ├─ JSON Schema 与阶段范围
                 ├─ 权限 / 审批 / 工作区边界
                 ├─ 幂等 / Trace / 证据
                 └─ 简历、网页、面试知识库、Skill、MCP 领域工具
                      └─ SQLite 任务 / Checkpoint / 版本 / 质量门禁
```

Pi 是极简决策核心，FetchCV 业务能力通过高层领域工具扩展；不是在旧框架里简单替换 SDK。所有真实副作用仍必须经过 ToolGateway。旧 Python Agent Engine 仅保留兼容和测试路径，不再是桌面主循环。

## 7. 验收标准

- 任何入口产生的工具调用都经过 ToolGateway。
- Agent 能完成“读取原简历 → 调研岗位 → 提出修改 → 请求确认 → 修改模板 → 验证 → 生成版本”。
- 暂停、宿主重启和恢复保留检查点；能力表面变化会触发重新核验。
- 思考区只展示公共行动摘要，完成后折叠，可由用户重新展开。
- 右栏能说明当前上下文、真实依据、缺失条件和下一步。
- 长对话、窗口缩放、键盘输入、引用、审批和简历编辑均通过桌面端到端测试。

## 8. 仍然存在的真实边界

- 登录、验证码和平台反爬策略不能被承诺为无人值守可绕过；应优先使用用户提供的公开链接、浏览器桥接和低频读取。
- Provider HTTP 流无法恢复到同一 token 字节位置；FetchCV 恢复的是任务、工具记录和业务上下文。
- Windows 公开发行仍需 Authenticode 签名；未签名安装包只适合本机测试。
