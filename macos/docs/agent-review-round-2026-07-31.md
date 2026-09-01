# FetchCV Agent 一轮闭环审查（2026-07-31）

本轮严格按“研究与工程 → 产品经理 → 三类用户 → 产品复审 → 工程落地”完成一次闭环。结论不是重写 Agent，而是补齐证据可验证性和桌面工作区控制。

## 1. AI 学者兼全栈设计师：外部研究

### 参考项目

- [earendil-works/pi](https://github.com/earendil-works/pi)：保持极简、provider-independent 的单 Agent Loop；FetchCV 继续让 Pi 负责模型循环，让 ToolGateway 负责权限、幂等、审批和持久化。
- [LangGraph](https://github.com/langchain-ai/langgraph)：借鉴 durable execution、checkpoint 和 human-in-the-loop 的状态持久化原则，但不引入第二套图运行时。
- [Cline](https://github.com/cline/cline)：借鉴可审阅操作、checkpoint 和“用户对实际修改保持控制”的产品表达。
- [OpenAI Agents SDK](https://github.com/openai/openai-agents-python)：借鉴 guardrail、session、trace 的职责分离；FetchCV 已有对应能力，本轮不替换底座。
- [Open WebUI](https://github.com/open-webui/open-webui) 与 [assistant-ui](https://github.com/assistant-ui/assistant-ui)：借鉴引用、工具状态与按需加载界面，不复制其通用聊天 Dashboard 结构。

### 参考论文与工业研究

- Gao et al., [Enabling Large Language Models to Generate Text with Citations](https://aclanthology.org/2023.emnlp-main.398/), EMNLP 2023：引用质量必须同时可检查“是否有引用”和“引用是否真正支持主张”。
- Turpin et al., [Language Models Don't Always Say What They Think](https://proceedings.neurips.cc/paper_files/paper/2023/hash/ed3fea9033a80fea1376299fa7863f4a-Abstract.html), NeurIPS 2023：叙述性思考过程不能作为可信证据；产品应展示可验证输入、工具事件和材料落点。
- Yao et al., [ReAct](https://arxiv.org/abs/2210.03629), ICLR 2023：模型决策和外部行动应形成可观察闭环，但隐藏思维链不应直接展示。
- Amershi et al., [Guidelines for Human-AI Interaction](https://www.microsoft.com/en-us/research/publication/guidelines-for-human-ai-interaction/), CHI 2019：系统应说明能力、展示行为后果、支持纠正和失败恢复。
- Anthropic, [Building Effective AI Agents](https://resources.anthropic.com/building-effective-ai-agents)：仅在复杂度带来明确业务收益时增加工作流；有清晰判据时使用 evaluator-optimizer。

### 工程判断

1. 保留“单 Pi Loop + ToolGateway + SQLite checkpoint/outbox”，不叠加 LangGraph 或另一套 SDK。
2. 当前最大可信度缺口不是模型不会推理，而是 ATS 要求只能看到“有证据”，无法检查 JD 原文和简历落点。
3. 当前最大桌面体验缺口是右栏信息密度高但宽度固定，用户不能根据对话、简历或证据任务调整空间。
4. 面试情报是低频重界面，应按需加载，避免增加主工作区冷启动负担。

## 2. AI 产品经理：本轮范围裁决

### 本轮 P0

- 岗位要求证据检查器：点击要求后展示 JD 连续原文、简历模块、条目和命中词。
- 缺少证据时明确说明“可以改善表达，但不能补造经历”。

### 本轮 P1

- 右侧任务上下文可折叠、可拖宽并持久记忆。
- 面试情报按需加载，主聊天与简历流程不为低频功能支付首屏成本。

### 延后

- 完整 append-only 审批事件历史与 time-travel。
- 批量 JD 与全局命令面板。
- 自动跳到简历编辑器的精确字符级高亮。
- 大规模 CSS 模块迁移与 TypeScript 全量迁移。

这些项目价值存在，但不应压过本轮信任闭环，也不应在一次迭代中扩大回归面。

## 3. 三类刁钻用户体验

### 用户 A：隐私敏感的应届生

- 已认可“模型外发前脱敏预览”。
- 新问题：看到“有证据”仍不知道证据来自简历哪一段，容易把关键词命中误解为事实充分。
- 要求：必须能看到 JD 原话和简历原文落点；没有落点要明确承认。

### 用户 B：精通 Agent 的 AI 产品/工程候选人

- 认可 Pi 单循环、真实工具事件和高风险审批。
- 新问题：右栏只有状态结论，缺少可展开的证据对象；固定宽度导致长 JD 要求被截断。
- 要求：证据项可点击、键盘可聚焦；右栏可调整；不展示隐藏 CoT。

### 用户 C：同时管理多个岗位的高频求职者

- 新问题：对话时想收起右栏，审阅证据时又想放大右栏；当前固定布局迫使频繁缩放整个窗口。
- 新问题：低频面试模块不应拖慢日常对话和简历编辑。
- 要求：折叠与宽度设置需跨岗位记忆；面试模块进入时再加载。

## 4. 产品经理复审

三类反馈共同指向“信息不是越多越好，而是要在需要时可检查”。最终裁决：

1. 证据定位优先于新的评分、推荐或装饰性动效。
2. 右栏采用渐进披露：默认保持，用户可折叠；展开时可在 268–420px 调整。
3. 只对状态变化使用 160–200ms 动效；拖拽时关闭布局过渡；支持 `prefers-reduced-motion`。
4. 面试情报拆为异步 chunk，不提高构建阈值掩盖包体问题。

## 5. 全栈设计师落地结果

- ATS requirement 增加：
  - 稳定 `requirement_id`
  - JD 字符位置
  - JD 前后文
  - 简历 section/item 落点
  - 命中词与可读片段
- 右栏要求列表改为可聚焦按钮，展开后显示证据检查器。
- 支持从证据检查器跳到简历工作区核对上下文。
- 右栏支持折叠、拖拽和 localStorage 持久化。
- 面试情报使用 React `lazy`/`Suspense` 按需加载。
- 新增后端与前端契约测试。

## 6. 下一轮候选

下一轮优先考虑“审批事件历史 + checkpoint time-travel”，其次是“从证据卡精确跳到简历编辑器对应条目”。两者都应继续服从：

- 无来源事实不得写入；
- 不展示隐藏思维链；
- 高风险动作必须审批；
- 未知副作用不得自动重放；
- 预览与导出必须使用同一份数据源。
