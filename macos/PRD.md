# FetchCV 产品需求文档

> 产品名称：FetchCV  
> 产品形态：本地优先的桌面求职 Agent  
> 当前版本：0.2.24 Alpha  
> PRD 版本：V3.5  
> 更新日期：2026-07-20  
> 适用范围：产品、设计、前端、Electron、后端、Agent、测试与发布  
> 文档基线：以 `/Users/jiujiu/Desktop/vibe coding/FetchCV` 当前代码和自动化测试为准

---

## 0. 文档说明

本 PRD 取代早期 ApplyOS PRD。产品、界面和用户可见文案统一使用 **FetchCV**。

当前 Python 内部包名仍保留 `applyos_api`、`applyos_domain`、`applyos_harness`、`applyos_agent`，这是为了兼容既有迁移、导入路径和已打包 sidecar，不代表产品仍名为 ApplyOS。内部包重命名必须通过独立迁移完成，不允许机械替换后破坏数据库、测试或打包流程。

本文使用以下状态：

- **已实现**：当前代码中存在，并有测试或实际运行验证。
- **部分实现**：主链路可运行，但质量、交互或真实外部集成尚未达到发布标准。
- **规划**：尚未形成可交付能力，不得在界面或宣传中声称已经支持。

产品需求与当前实现发生冲突时：

1. 用户安全、事实真实性和不可逆操作约束优先；
2. 本 PRD 的产品流程优先于旧 Stage 文档；
3. 当前代码只代表实现基线，不自动代表正确产品设计；
4. 修复既有问题时必须保留已验证的数据、版本和渲染链路。

---

# 1. 产品定义

## 1.1 一句话定位

FetchCV 将用户已有的简历、经历和作品材料组织为个人资料库，理解目标岗位 JD，在真实事实边界内制定岗位策略、改写并排版简历、生成作品集草稿，并记录每次投递实际使用的材料版本。

## 1.2 产品不是

FetchCV 不是：

- 只有输入框和聊天记录的通用 AI 助手；
- 把几条经历简单拼进 PDF 的筛选器；
- 自动编造经历、数字或技能的简历生成器；
- 用不透明分数冒充真实 ATS 的评测工具；
- 未经用户确认就自动投递、发邮件或联系 HR 的机器人；
- 把内部状态机、Fact Lock 和发布门禁暴露为首次使用门槛的后台系统；
- Claude、Claude Code 或其他产品的换皮客户端。

## 1.3 核心价值

FetchCV 解决四个连续问题：

1. **材料整理**：用户只需先建立一次完整个人资料库。
2. **岗位理解**：Agent 不只提取关键词，还解释岗位目标、核心职责、能力证据和风险点。
3. **定向表达**：同一段真实经历可针对数据分析、产品、Agent 等不同岗位调整重点，但不得改变事实强度。
4. **版本可信**：预览、编辑、PDF 和投递快照保持一致，用户始终知道本次投递使用了什么。

## 1.4 目标用户

MVP 面向需要同时投递多个方向、拥有较多项目或实习材料、愿意自行复核最终内容的个人求职者，优先覆盖：

- 应届生与实习生；
- 数据分析、产品经理、AI 产品、Agent 应用等复合岗位求职者；
- 需要为不同岗位维护不同简历侧重点的人；
- 担心 AI 夸大、错写或破坏原排版的人。

---

# 2. 产品原则

## 2.1 先有个人资料，再有岗位任务

正确顺序是：

```text
导入基础简历与补充材料
→ 建立个人资料库
→ 创建岗位项目并输入 JD
→ Agent 理解岗位
→ 推荐和组织相关经历
→ 用户确认策略
→ 生成、讨论和修改投递材料
→ 预览与导出
→ 用户实际投递后记录快照
```

不得要求用户在导入材料前创建岗位，也不得要求用户先逐条完成“事实锁”才能使用 Agent。

## 2.2 完整经历优先，不把人拆成零散句子

教育、实习、项目、校园活动和作品应以完整经历实体组织。每个实体可以包含多个事实，但用户选择的是“这段经历如何用于当前岗位”，不是在几十条碎片中拼简历。

教育时间、学校、专业、学位、GPA 及其对应奖项应保持上下文关系。个人信息、教育背景等不随岗位变化的基础内容默认保留，无需每个岗位重复选择。

## 2.3 Agent 负责语义判断，代码负责确定性

模型可以：

- 理解 JD；
- 判断经历与岗位的语义相关性；
- 生成简历策略和改写建议；
- 发现表达风险和信息缺口；
- 生成作品集内容结构。

确定性代码必须负责：

- 状态流转；
- 数据库事务；
- 用户审批；
- 事实归属与来源；
- 数字、日期、公司、学校和项目名称一致性；
- 版本快照；
- 文件路径边界；
- PDF 渲染和产物保存；
- 发布门禁与投递冻结；
- 错误恢复、幂等和审计。

## 2.4 对话连续，任务组件就地出现

同一个岗位使用一个持续会话。JD 理解、经历确认、策略讨论、改写审批、简历预览和错误恢复不应被拆成互不相干的新页面。

中栏保留对话上下文，需要结构化操作时在对话附近呈现专用组件；复杂选择可进入右栏上下文检查器。用户完成一个阶段后仍能查看此前结论和对话。

## 2.5 可回退、可重跑、可产生新版本

用户在记录真实投递前可以：

- 修改 JD；
- 返回调整经历选择；
- 修改简历策略；
- 拒绝或编辑改写建议；
- 进入排版编辑器继续修改；
- 重新运行受影响阶段。

回退不得静默覆盖已生成版本。重跑应创建新 Run、提案或草稿版本，并保留父版本和操作记录。

已记录投递的快照不可变，但源简历和后续新版本仍可继续编辑。

## 2.6 透明但不展示隐藏思维

运行中必须让用户知道系统进行到哪一步，但不得展示或保存模型隐藏思维链。

允许展示：

- 当前阶段和已完成阶段；
- 正在处理的对象；
- 简短运行摘要；
- 工具事件和产物；
- 输入来源；
- 错误、风险和下一步；
- 可脱敏的 Trace 摘要。

不得展示：

- 伪造的“思考过程”；
- 长篇内部推理；
- API Key 或完整敏感信息；
- 无法验证的“AI 已深度分析”等营销式状态。

---

# 3. 端到端用户流程

## 3.1 首次使用

```text
启动 FetchCV
→ 选择 PDF 简历
→ 本地提取；已连接模型时可选择脱敏后的 AI 增强识别
→ 预览个人信息、教育、实习、项目、技能和奖项
→ 用户核对并确认入库
→ 进入个人资料库
→ 可继续添加作品集、网站、代码仓库、证书或其他材料
```

要求：

- PDF 是主入口，旧 JSON 仅作为“旧版工作区迁移”。
- AI 增强识别仅发送本地提取并脱敏后的文本，不上传 PDF、头像、文件路径、姓名、联系方式、证件号或详细地址。
- 模型只负责判断章节和字段归属，所有返回条目必须携带可在原文中核对的引用；不支持的字段和幻觉条目必须拒绝。
- 模型未连接、请求失败、结构错误或证据不足时自动回退本地解析，不能阻塞导入。
- 导入前必须预览解析结果，不能直接污染资料库。
- 解析失败时保留原文件并给出可理解错误，不显示内部 JSON。
- 重复导入同一文件应识别并提示，不重复创建全部经历。
- 用户可在资料库中补充、编辑、合并和删除误识别内容。

## 3.2 新建岗位

```text
新增岗位
→ 输入公司、岗位名称和 JD
→ 保存岗位项目
→ 让 Agent 理解岗位
```

岗位项目必须支持编辑和删除。删除使用明确的二次确认，并同时清理该岗位的 Run、草稿、提案和应用记录，但不删除个人资料库中的基础简历和经历。

## 3.3 岗位理解与经历策略

```text
读取 JD
→ 提取职责、硬要求、加分项、能力维度和原文证据
→ Agent 用自然语言向用户总结岗位理解
→ 用户补充或纠正理解
→ 将完整经历分为核心、辅助、背景与省略
→ 右栏显示建议及证据
→ 用户确认或调整
```

Agent 必须先说明其岗位理解，再进入经历选择。不能分析完成后无解释地自动跳到下一步。

推荐必须说明来源：

- 连接模型时：显示真实提供商、模型和协议，并说明内容会发送至所配置 API。
- 未连接模型时：阻止岗位分析和 Agent 对话，引导用户连接模型；不得运行本地规则并把结果呈现为 Agent 推荐。

## 3.4 简历策略与改写

FetchCV 的核心不是选择几条经历，而是制定岗位表达策略：

- 确定简历主线；
- 决定每段经历承担的能力证据；
- 调整章节和信息优先级；
- 对相关经历进行定向改写；
- 保留迁移能力，避免把候选人写成单一标签；
- 对岗位不相关内容压缩而不是机械删除；
- 明确能力缺口，不得补写不存在的经历。

示例：

- 数据分析岗位以 SQL、数据清洗、实验分析、指标和业务洞察为主线，产品能力只作为辅助迁移能力。
- 产品岗位以需求分析、方案设计、协作、迭代和落地为主线，数据分析作为决策能力保留。
- Agent 岗位以工作流、模型评测、Prompt、工具调用和工程落地为主线，同时保留产品与数据能力。

## 3.5 改写审核

每条改写提案必须展示：

- 原文；
- 建议文本；
- 修改理由；
- 对应 JD 证据；
- 来源经历与 `fact_id`；
- 风险等级；
- 当前决定。

用户可以接受、保留原文或编辑后接受。所有建议默认待决定；高风险建议禁止批量接受。

## 3.6 简历预览、排版与 PDF

```text
应用已批准提案
→ 生成岗位简历草稿
→ 在客户端内预览
→ 打开完整排版编辑器
→ 保存编辑器快照
→ 使用同一 DOM/CSS 生成正式 PDF
→ 回到岗位会话继续讨论或记录投递
```

预览、编辑和 PDF 必须来自同一个 `resume-editor-prototype` 渲染源。禁止再维护独立的 React 假预览或另一套 ReportLab 正式模板。

桌面端正式 PDF 使用 Electron 隔离窗口加载同一编辑器 DOM，并通过 `webContents.printToPDF` 输出 A4 PDF；生成后上传到本地 FastAPI，成为该 ResumeVersion 的正式产物。

## 3.7 记录投递

“材料已生成”不等于“已经投递”，也不等于“材料被锁死”。

只有用户明确点击“记录为已投递版本”并完成二次确认后，系统才：

- 创建 Application；
- 绑定岗位、简历版本和可选作品集版本；
- 保存 JD 与材料快照；
- 冻结本次投递快照；
- 记录投递时间和后续动作。

---

# 4. 桌面客户端信息架构

FetchCV 使用三栏桌面结构，三栏按信息作用域划分。

## 4.1 左栏：全局工作区

左栏负责稳定导航：

- FetchCV 标识和新增岗位；
- 个人资料库；
- 岗位项目列表；
- 搜索岗位；
- 当前模型连接；
- 模型设置入口。

岗位条目显示公司、岗位和简短状态，不堆叠 Run 详情。岗位管理通过上下文菜单或管理弹窗完成，支持编辑和二次确认删除。

## 4.2 中栏：当前岗位会话与任务画布

中栏是主要工作区，始终保留当前岗位的会话上下文：

- 用户消息；
- Agent 回答；
- 岗位理解摘要；
- 运行状态与工具事件；
- 需要用户处理的专用组件；
- 简历预览与编辑入口；
- 底部输入框和附件入口。

中栏不使用网页 Dashboard 式 KPI 卡片，也不在每个阶段替换成没有历史的新页面。

## 4.3 右栏：阶段感知的上下文检查器

右栏根据中栏当前对象切换：

- 岗位理解：JD 证据、能力维度、疑问和纠正入口；
- 经历确认：完整经历分组、推荐层级、来源和调整入口；
- 改写审核：当前提案的事实、JD 依据和风险；
- 简历生成：当前版本、父版本、渲染状态和校验结果；
- 投递记录：绑定资产、快照和冻结状态。

右栏不是固定黑色，也不是把所有状态永久堆在一起的运行抽屉。宽度不足时可折叠或覆盖显示，中栏保持主操作区。

## 4.4 视觉与动效

视觉目标是安静、克制、精确的桌面生产力工具：

- 使用 FetchCV 自有品牌，不放 ApplyOS 名称；
- 使用温暖纸张色、低对比边界和少量陶土橙强调色；
- 不使用纯黑右栏、霓虹渐变、玻璃卡片墙或通用 AI Dashboard 风格；
- 正文字号不小于 14px，辅助信息原则上不低于 12px；
- 中文正文必须清晰，不使用过细字重；
- 标题可使用 Source Serif 4，界面正文使用 Plus Jakarta Sans 或可靠中文系统字体回退；
- 动画只用于阶段变化、消息进入、展开收起和成功/错误反馈；
- 支持 `prefers-reduced-motion`；
- 加载状态必须有文字状态变化，不能只显示无限旋转图标。

---

# 5. 功能需求

## 5.1 个人资料库

资料库包含：

- Candidate 基础资料；
- 基础简历及其编辑器快照；
- Experience 完整经历实体；
- Fact 可追溯事实；
- MaterialAsset 作品集、网站、仓库、证书、文档和图片；
- 历史 ResumeVersion。

经历至少支持：教育、实习/工作、项目、校园、技能、奖项和总结。教育中的学校、专业、时间和相关奖项应建立关联，不以无上下文的单句平铺。

验收要求：

- 可反复进入资料库；
- 可继续添加材料；
- 可查看来源；
- 可编辑解析错误；
- 可合并重复经历；
- 删除资料需二次确认；
- 岗位删除不影响资料库。

## 5.2 岗位项目

岗位项目字段：公司、岗位、地点、JD 原文、来源、状态和更新时间。

必须支持：创建、搜索、选择、编辑、删除、补充 JD、重新分析和查看历史 Run。

JD 修改后，旧岗位分析结果不得继续伪装为最新结果。系统应标记依赖内容过期，并允许从岗位理解阶段创建新 Run。

## 5.3 模型连接

支持保存和切换多个连接配置：

- 连接名称；
- OpenAI-compatible / Anthropic-compatible 协议；
- Base URL；
- 模型名；
- API Key；
- 当前启用状态。

要求：

- API Key 由 Electron 主进程使用 `safeStorage` 加密；
- 明文密钥不得写入源码、业务 SQLite、renderer 持久化、日志或 Trace；
- 密钥保存后不得返回 renderer；
- 配置弹窗可随时关闭，未填写不得阻断主界面；
- 保存前支持连接测试；
- 切换连接后新 Run 使用新模型，历史 Run 保留原提供商信息；
- 远程 Base URL 默认只允许 HTTPS；localhost 可使用 HTTP。

运行模式：

- `mock`：仅供自动化测试显式开启，正式客户端不可作为用户模式；
- `compatible`：用户配置的 OpenAI/Anthropic 兼容 API；
- `claude`：官方 Claude Agent SDK，可选开发/高级运行时。

删除当前连接后必须立即切换到仍可解密的下一个连接；没有可用连接时，Sidecar 必须清空模型运行态并回到未配置状态。跨设备复制的 `safeStorage` 密文不得导致客户端崩溃，应要求用户重新输入密钥。

## 5.4 岗位会话

每个岗位拥有持久 AgentMessage 记录。Agent 应能回答：

- 对岗位的理解；
- 当前使用的真实提供商、协议和模型；
- 为什么推荐某段经历；
- 当前简历策略；
- 某条改写依据；
- 下一步是什么；
- 哪些内容仍需要用户确认。

模型身份回答必须来自运行时配置，不得用“先进语言模型”或“预置策略”回避。

## 5.5 运行状态

状态变化至少包括：

```text
准备输入
→ 理解岗位
→ 匹配经历
→ 等待经历确认
→ 生成简历策略
→ 生成改写建议
→ 等待逐条审核
→ 应用已批准修改
→ 校验事实
→ 组织作品集
→ 检查一致性
→ 等待生成/发布确认
→ 可预览与导出
→ 已记录投递
```

运行中必须显示当前动作和已完成动作，支持取消。失败时显示结构化错误、修复建议和重试入口。

岗位会话使用 SSE 增量输出。停止生成必须取消进行中的 Provider 请求；已提交的用户消息保留，未完成的助手消息不得写入持久会话。

## 5.6 经历匹配

推荐单位为完整 Experience。系统自动保留个人信息和必要教育背景，仅让用户决定会改变岗位表达的经历与内容。

每段经历显示：

- 名称、组织、角色和时间；
- 关键内容摘要；
- 推荐层级；
- 命中的 JD 能力；
- 推荐理由；
- 推荐来源（真实 Provider、协议和模型）；
- 用户是否纳入本岗位。

用户确认后仍可返回修改。修改会使后续策略和草稿标记为待重建，而不是禁止回退。

## 5.7 简历策略

策略输出至少包含：

```json
{
  "positioning": "岗位表达主线",
  "ability_priorities": [],
  "experience_roles": [],
  "section_order": [],
  "compression_plan": [],
  "transferable_skills": [],
  "gap_analysis": [],
  "risks": []
}
```

策略生成后 Agent 必须在会话中解释主线和取舍，并允许用户用自然语言调整，例如“产品经历只保留一条”“加强 SQL，但不要删掉 Agent 项目”。

## 5.8 改写与审批

改写不能仅把被选经历原文复制进模板。Agent 应根据岗位策略调整信息顺序、动作表达、证据密度和篇幅，但不得改动不可证实的事实。

角色强度至少识别：

```text
参与 → 负责
参与 → 主导
协助 → 独立完成
了解 → 熟练
熟悉 → 精通
原型 → 已上线
内部使用 → 大规模应用
```

高风险变化默认阻断，必须由用户逐条编辑或确认。

## 5.9 简历工作室

FetchCV 复用 `resume-editor-prototype` 的编辑器数据结构、视觉模板和排版能力。

要求：

- 基础简历是新岗位版本的父版本；
- 用户确认的策略和改写写入新的 ResumeVersion；
- 编辑器支持正文、章节、顺序和样式调整；
- 保存时写回 `editor_snapshot`；
- 预览 iframe 使用只读模式；
- 正式 PDF 使用同一渲染页面；
- PDF 路径、页数、renderer 和版本关系写入本地数据库；
- 导出失败不能把版本标记为完成；
- 预览和 PDF 不得出现选中边框、编辑控件或裁切。

## 5.10 作品集

当前状态：**部分实现**。

已实现：

- PortfolioVersion 数据模型；
- Page Schema；
- Mock/File Protocol builder；
- 构建、发布、冻结和一致性检查接口。

尚未实现：

- 与真实 Vibe Coding/网页制作器源码的正式适配；
- 完整作品集编辑和浏览器预览；
- 真实网站导出、托管与链接管理。

在真实 adapter 完成前，界面必须标记为“作品集草稿/模拟构建”，不得声称已经发布真实网站。

## 5.11 投递记录

Application 至少记录：岗位、ResumeVersion、PortfolioVersion、状态、提交时间、下一动作和备注。

投递跟进应支持：准备中、已投递、笔试、面试、Offer、拒绝和结束，并保留事件时间线。当前版本只完成基础记录与冻结，完整跟进工作台属于后续版本。

---

# 6. Agent 与 Harness

## 6.1 Agent Loop（已实现基础运行时）

FetchCV 使用 provider-independent Agent Loop，而不是由前端按固定顺序直接调用文本生成接口：

```text
模型读取当前 Run 上下文与可用工具 Schema
→ 返回结构化 tool call
→ ToolGateway 校验阶段、权限、审批、范围和幂等
→ 执行业务工具并持久化真实结果
→ 工具结果回灌模型
→ 模型根据最新阶段继续决策
→ 完成、等待用户、失败或取消
```

当前已支持 OpenAI-compatible 原生 `tool_calls`、Anthropic-compatible 原生 `tool_use`，以及提供商不支持原生工具时的 JSON Schema 决策回退。模型 API Key 只进入授权 Header，不进入请求正文、业务数据库或 Trace。

当前限制：一次模型回合最多执行一个有副作用工具；只读检查可与其共同出现。模型不能获得 Shell、任意文件写入、任意网络或数据库直写能力；联网只能经过受控 `NETWORK_READ` 工具。

## 6.2 业务工具（已注册）

现有简历业务管线通过 ToolGateway 暴露以下受控能力：

- 运行输入校验、岗位分析、经历匹配；
- 简历策略、逐条改写提案、应用已批准改写；
- 事实校验、作品集协议预览、一致性检查和发布就绪；
- 只读岗位/材料/简历上下文检查。
- 公开网页搜索、静态网页正文读取和招聘页面导入。

岗位简历必须从最新基础简历建立父子版本，保留原模板、模块、顺序和设置，只把用户批准的 Diff 写入对应经历正文。不得重新拼装一份无关模板。

## 6.3 逻辑能力

MVP 使用一个受控 Pipeline，内部包含四类逻辑能力，不要求四个自由自治 Agent：

1. JD Analyst：结构化岗位要求并保留原文证据；
2. Experience Matcher / Resume Strategist：匹配完整经历并制定表达策略；
3. Asset Generator：生成简历提案与作品集结构；
4. Quality Auditor：发现夸大、冲突、遗漏和发布风险。

模型不能自行决定跳过用户审批、发布或冻结。

## 6.4 当前确定性状态机

```text
created
→ input_validating
→ jd_analyzing
→ facts_matching
→ awaiting_fact_review
→ strategy_generating
→ draft_generating
→ awaiting_user_review
→ approved_changes_applying
→ fact_validating
→ portfolio_building
→ consistency_checking
→ awaiting_publish_approval
→ ready_to_publish
→ published
→ frozen
```

异常状态：`failed`、`blocked`、`cancelled`。

要求：

- 非法跳转由代码拒绝；
- 等待经历确认和改写审批时必须暂停；
- 失败或阻断保存 `resume_stage`，允许恢复；
- 冻结和取消为终态；
- 每次跳转写入 Trace；
- 重试使用幂等键，避免重复创建资源。

## 6.5 工具权限

权限等级：

```text
READ
NETWORK_READ
DRAFT_WRITE
CONFIRMED_WRITE
EXPORT
PUBLISH
DELETE
```

权限必须同时由 Agent runtime 配置和工具函数内部校验。模型参数永远不被直接信任。

## 6.6 事实与来源

Fact 是内部可信和追溯机制，不是用户的首屏操作对象。

每条关键生成内容至少关联：

- `fact_ids`；
- `generation_run_id`；
- `transformation_type`；
- `risk_level`；
- `approval_status`。

数字、日期、公司、学校、项目名称和角色强度冲突由确定性校验阻断。

## 6.7 结构化输出

模型阶段必须以 JSON Schema/Pydantic 为契约。若提供商返回带说明文字或不完整 JSON，runtime 可执行一次受控修复；仍不通过则停止该阶段并显示可重试错误，不能使用半成品继续。

## 6.8 Agent 平台基础设施（已实现首版）

- `AgentTask` 使用 SQLite 持久化排队、运行、暂停、失败、取消与完成状态；sidecar 重启后会恢复孤儿任务。
- 暂停和取消既在模型回合/工具边界检查，也会关闭进行中的 compatible-provider HTTP 传输或调用 `ClaudeSDKClient.interrupt()`；中断不会记为模型失败。
- Agent 工作期间用户仍可输入，`QueuedAgentMessage` 按岗位和 sequence 持久化并在任务停下后依次处理。
- `AgentContextSnapshot` 压缩旧对话，但把完整 JD/来源、基础与岗位简历结构、已验证事实和材料来源固定保留。
- Skill Loader 扫描受控目录内完整 `SKILL.md`，阻止路径/符号链接越界和超大文件；Skill 不可授予权限或执行代码。
- MCP 管理支持显式 stdio 配置、批准、探测、启停和只读白名单。写工具还必须声明非破坏性封闭作用域、FetchCV 简历/作品集目标参数、逐工具批准和逐运行批准；ToolGateway 保存调用前后快照与本地回滚引用。
- MCP 子进程默认只接收最小环境，模型密钥、浏览器令牌和桌面控制令牌不会隐式继承。
- 隔离工作区提供文件枚举、有限文本读取、字面量搜索和 `sha256`/`validate_json`/`count_text` 三种固定命令；不接受 Shell 字符串或外部可执行程序。
- `/events?follow=true&after_sequence=N` 按真实 `AgentRunStep` 增量推送模型、工具和任务事件；客户端只展示这些持久记录，不伪造隐藏思维链。

## 6.9 受控网页能力（已实现）

- `search_web`：按 Bing、DuckDuckGo 顺序回退，也可通过 `FETCHCV_WEB_SEARCH_ENDPOINT` 配置 HTTPS 搜索端点；
- `read_web_page`：提取静态 HTML 的标题、描述、正文、标题层级、来源 URL 和内容哈希；
- `import_job_posting`：优先解析 Schema.org `JobPosting` JSON-LD，回退到页面正文，并保存 `job_posting_page` MaterialAsset；
- 空 JD 且存在 `source_url` 时，Agent 可在输入校验失败后自动恢复并先导入招聘页；
- 已有 JD 时不自动覆盖，创建 `replace_job_description` Approval，批准后恢复任务才允许替换。

网络安全边界：默认仅 HTTPS；拒绝 URL 凭据、localhost、私网、链路本地、保留地址和非 80/443 端口；每次重定向重新校验；禁用环境代理；限制超时、响应类型和 2MB 响应大小；常见 token/signature 等敏感查询参数在写入数据库或 Trace 前移除。页面内容始终作为不可信外部数据，不能改变系统指令。

Electron 桌面端另提供随机令牌保护的本机浏览器桥，只暴露打开、读取、状态和关闭命令，并使用独立持久 partition 保存登录态。纯浏览器渲染页面可由该工具读取；发现登录或验证码时必须显示窗口、暂停任务并由用户操作，不自动绕过挑战，也不向 Agent 返回 Cookie 或凭据。

---

# 7. 数据模型

当前领域模型：

| 模型 | 作用 |
|---|---|
| Candidate | 用户基础身份与联系方式 |
| MaterialAsset | 作品集、网站、仓库、证书等材料 |
| Experience | 完整教育、工作、项目、技能或奖项经历 |
| Fact | 可追溯的原子事实与验证状态 |
| Job | 目标岗位和 JD |
| JobProfile | 结构化岗位理解 |
| ResumeVersion | 基础/岗位简历版本与编辑器快照 |
| PortfolioVersion | 岗位作品集版本与 Page Schema |
| Application | 实际投递记录和绑定资产 |
| AgentRun | 一次岗位任务运行 |
| AgentMessage | 岗位会话消息 |
| AgentRunStep | 阶段、工具和运行摘要 |
| AgentTask | 可恢复的后台任务与控制状态 |
| QueuedAgentMessage | Agent 忙碌期间的顺序消息 |
| AgentContextSnapshot | 压缩历史与固定业务上下文 |
| AgentSkill | Skill 索引、哈希和启用状态 |
| McpServerConfig | MCP 启动配置、批准、发现与只读白名单 |
| RewriteProposal | 逐条改写提案 |
| Approval | 经历、提案、发布等用户决定 |
| VersionSnapshot | 写操作前后的不可变快照 |
| QualityReport | 事实与发布门禁结果 |

数据关系原则：

- Candidate 拥有资料库；
- Job 属于 Candidate；
- Experience 与 Fact 属于 Candidate，可被多个 Job 复用；
- ResumeVersion 与 PortfolioVersion 可绑定 Job，并保留父版本；
- AgentRun 绑定 Candidate、Job、runtime 与 session；
- Application 绑定投递时的具体资产版本；
- 冻结的是投递快照，不是用户全部资料。

---

# 8. 当前技术架构

```text
Electron 主进程
├── 原生窗口与受控文件选择
├── safeStorage 模型密钥管理
├── Python sidecar 生命周期
├── 隔离简历渲染窗口
└── Chromium printToPDF
        │
        ▼
React 18 + Vite Renderer
├── 三栏桌面工作区
├── 岗位会话与任务组件
├── 资料库与导入弹窗
├── 模型连接管理
└── 嵌入式 resume-editor-prototype
        │ localhost HTTP
        ▼
FastAPI Sidecar
├── Candidate / Library / Job API
├── Provider-independent Agent Runtime
├── SQLite AgentTask Worker 与增量事件流
├── ContextManager / SkillLoader / MCP Manager
├── AgentEngine → ToolGateway → Deterministic Harness
├── Resume / Portfolio / Application API
└── PDF 导入、产物与快照
        │
        ▼
SQLite + Electron userData/artifacts
```

技术基线：

- Electron 43；
- React 18、Vite 6；
- Radix UI、Lucide、Framer Motion；
- Python 3.11+；
- FastAPI、Pydantic、SQLAlchemy、Alembic；
- SQLite；
- `claude-agent-sdk==0.2.120`；
- `httpx` 兼容模型 runtime；
- `pypdf` PDF 文本解析；
- Playwright/Electron E2E 与 pytest。

---

# 9. API 基线

以下为当前已实现的主要接口；新增接口应延续资源语义和结构化错误规范。

## 9.1 工作区与资料库

```text
GET    /health
GET    /api/runtime/status
POST   /api/runtime/configure
POST   /api/runtime/disconnect
GET    /api/workspace
GET    /api/candidates/{candidate_id}/library
POST   /api/candidates
GET    /api/candidates
POST   /api/candidates/{candidate_id}/materials
POST   /api/candidates/{candidate_id}/experiences
POST   /api/candidates/{candidate_id}/facts
PATCH  /api/facts/{fact_id}/verification
POST   /api/imports/resume-pdf/preview
POST   /api/imports/resume-pdf
POST   /api/imports/legacy-resume
```

## 9.2 岗位与会话

```text
POST   /api/jobs
GET    /api/jobs
PATCH  /api/jobs/{job_id}
DELETE /api/jobs/{job_id}
GET    /api/jobs/{job_id}/workspace
POST   /api/jobs/{job_id}/messages
POST   /api/jobs/{job_id}/messages/stream
POST   /api/jobs/{job_id}/analyze
POST   /api/jobs/{job_id}/resume-strategy
POST   /api/jobs/{job_id}/import-web
POST   /api/web/search
POST   /api/web/read
```

## 9.3 Agent Run 与审批

```text
POST   /api/agent-runs
GET    /api/agent-runs/{run_id}
GET    /api/agent-runs/{run_id}/steps
GET    /api/agent-runs/{run_id}/events
POST   /api/agent-runs/{run_id}/resume
POST   /api/agent-runs/{run_id}/retry
POST   /api/agent-runs/{run_id}/cancel
POST   /api/agent-runs/{run_id}/facts/review
GET    /api/agent-runs/{run_id}/proposals
POST   /api/agent-runs/{run_id}/proposals/review
POST   /api/agent-runs/{run_id}/publish-approval
POST   /api/agent-runs/{run_id}/job-import-approval
GET    /api/agent-runs/{run_id}/report
```

## 9.4 简历、作品集与投递

```text
GET    /api/resumes/{resume_id}
PATCH  /api/resumes/{resume_id}/editor
POST   /api/resumes/{resume_id}/render
GET    /api/resumes/{resume_id}/pdf
PUT    /api/resumes/{resume_id}/pdf
POST   /api/resumes/{resume_id}/freeze
POST   /api/jobs/{job_id}/portfolios
POST   /api/portfolios/{portfolio_id}/build
POST   /api/portfolios/{portfolio_id}/publish
POST   /api/applications
GET    /api/jobs/{job_id}/applications
```

---

# 10. 安全、隐私与本地边界

1. Sidecar 仅绑定 loopback。
2. 每个桌面进程生成独立随机会话令牌；除 `/health` 外，Sidecar API 与产物必须校验令牌，不复用其他桌面进程的 Sidecar。
3. Electron renderer 禁用 Node integration，启用 context isolation、sandbox 和 CSP。
4. 外链默认只允许 HTTPS。
5. API Key 仅在 Electron 主进程解密，并通过子进程环境传入 sidecar。
6. 日志和 Trace 不记录 API Key、完整手机号、完整邮箱或原始认证头。
7. 用户文件与产物限制在受控目录。
8. Agent 默认不获得 Bash、任意删除或任意网络权限；公网读取只能经受控 NETWORK_READ 工具。
9. 冻结版本不可覆盖。
10. 岗位删除、投递记录和发布必须显式确认。
11. 测试默认使用虚构数据；真实简历只用于用户授权的本地验证。
12. 不抓取或复用个人 Claude 登录态。
13. 不依赖泄露、反编译或非官方 Claude Code 源码。
14. PDF AI 增强识别在调用模型前完成直接身份信息脱敏；原始 PDF、头像和本地路径不得进入模型请求。
15. 模型解析结果必须通过本地 Schema 与原文证据校验，身份字段只允许由本地占位符恢复。

---

# 11. 当前实现基线

| 能力 | 状态 | 说明 |
|---|---|---|
| Windows Electron 客户端 | 已实现 | 可生成 portable EXE，内置 FastAPI sidecar |
| PDF 简历导入与预览 | 已实现 | `pypdf` 本地解析；可选脱敏 AI 结构识别、严格 Schema、原文证据校验、失败回退和同次预览复用 |
| 个人资料库 | 已实现 | 支持简历、完整经历和其他 MaterialAsset |
| 岗位创建、编辑、删除 | 已实现 | 删除包含依赖清理与二次确认 UI |
| 岗位会话 | 已实现 | AgentMessage 按 Job 持久化 |
| Mock 测试模式 | 已实现，仅测试 | 需要 `FETCHCV_ALLOW_MOCK_RUNTIME=1`，正式客户端不可启用 |
| 多模型连接与切换 | 已实现 | OpenAI/Anthropic compatible，safeStorage 加密 |
| Claude Agent SDK runtime | 已实现但可选 | 通过兼容层接入确定性 Harness |
| Provider-independent Agent Loop | 已实现 | 原生/回退工具调用、结果回灌、错误恢复与真实 Trace |
| 网页搜索与读取 | 已实现，受控 | 静态 HTTPS、公网 SSRF 边界、搜索回退和来源哈希 |
| 招聘页面导入 | 已实现，静态页面 | JSON-LD/正文解析、MaterialAsset、已有 JD 覆盖审批 |
| 受控桌面浏览器 | 已实现，用户协作 | 隔离登录态、公开 HTTPS、固定桥命令、登录/CAPTCHA 暂停恢复 |
| 状态机、审批、Trace、快照 | 已实现 | 支持暂停、失败、恢复和冻结 |
| 完整经历选择 | 已实现 | 仍需继续提升分组与回退体验 |
| 简历策略与改写 | 已实现基础闭环 | 模型策略快照已进入岗位简历；本地事实计划、原模板连续性和逐条审批继续兜底，跨岗位语义质量仍需基准评测 |
| 嵌入式简历编辑器 | 已实现 | 复用 resume-editor-prototype 快照与样式；支持纸面正文直接编辑、富文本格式、颜色/标记、链接、列表、对齐、缩进和安全粘贴 |
| 统一预览/编辑/PDF | 已实现 | 同一 DOM/CSS，Electron printToPDF 后上传正式产物 |
| 作品集 | 部分实现 | 数据模型和 Mock/File Protocol 可用，真实 builder 未接入 |
| 投递记录和冻结 | 部分实现 | 基础记录可用，完整跟进工作台未完成 |
| macOS 客户端 | 已实现，未签名 | Apple Silicon DMG/ZIP、sidecar、图标与 safeStorage 已验证；签名和 notarization 待完成 |
| 流式岗位会话 | 已实现 | SSE 增量输出、真实状态、停止生成与持久化一致性 |
| Sidecar 会话隔离 | 已实现 | loopback、随机令牌、禁止跨桌面进程复用 |
| 持久任务与消息队列 | 已实现 | 单 Worker、暂停/恢复/重试/取消、孤儿恢复、顺序消息 |
| 上下文压缩与固定记忆 | 已实现 | JD、简历结构、事实和材料来源独立固定 |
| Skill Loader | 已实现，受控 | 项目/用户/环境根目录、完整读取、边界与大小检查 |
| MCP Server 管理 | 已实现，受控读写 | 只读白名单；写工具封闭作用域、逐工具/逐运行审批、版本快照与本地回滚 |
| 隔离工作区工具 | 已实现，受限 | 列表、文本读取/搜索和三种固定检查，无任意 Shell |
| 真实任务事件 UI | 已实现 | 增量 SSE、当前动作、折叠工具记录、任务控制 |

当前自动化基线：后端 77 项测试与前端 35 项 Node 测试通过；静态检查、PDF 直接身份信息脱敏、AI 结构识别、原文证据校验与回退、Provider 强制中断、任务/普通对话 Agent Loop、重复工具收束、持久队列、上下文压缩、Skill 边界、受控 stdio MCP 读写、工作区边界、网页/浏览器桥、流式聊天、岗位删除、Sidecar、统一简历渲染、多岗位 JD 导入和开发版/成品启动 E2E 均纳入回归。真实材料测试使用 `test use/高子强的简历.pdf` 与 `test use/JD.txt`，并校验脱敏请求不含姓名、电话、邮箱、文件路径或 PDF 字节，以及日期、学校/专业/GPA、公司/岗位、项目/奖项、模块顺序和旧版本迁移，不得降低该基线。

---

# 12. 已知问题与优先级

## P0：核心求职闭环

1. 岗位理解必须先向用户解释并允许纠正，不能直接跳到选择经历。
2. 经历选择必须始终可回退，调整后正确使后续策略和草稿失效并可重建。
3. 教育、奖项和项目上下文需要进一步合并，避免碎片化。
4. 持续建立覆盖数据分析、产品和 Agent 岗位的语义质量基准，防止定向改写退化为关键词替换或事实复制。
5. 逐条提案需要完整呈现原文、建议、JD 依据、来源和风险。
6. 聊天与结构化任务组件需要保持一个连续岗位会话。
7. 所有失败状态必须有可理解原因、修复入口和可靠重试。

## P1：资产与版本

1. 完整迁移 resume-editor-prototype 的可用编辑能力和模板行为。
2. 增加 ResumeVersion 父子关系、回退与版本对比 UI。
3. 完善投递记录、时间线和下一步提醒。
4. 接入真实作品集 builder；未接入前保持 Mock 标识。
5. 增加 PDF 页数、溢出、字体和文本可搜索性质量检查。

## P1：跨平台与发布

1. 增加 Intel Mac 与 Windows 的持续集成构建验证。
2. 正式分发增加 Apple Developer ID、notarization 和 Windows 签名。
3. 增加自动更新、崩溃报告与可回滚升级策略。

## P2：体验与可访问性

1. 放大过小字号并修复中文字体发虚。
2. 补齐键盘导航、焦点管理和屏幕阅读器语义。
3. 优化小窗口下右栏折叠和简历预览缩放。
4. 降低重复信息和无意义卡片边框。

---

# 13. 版本路线图

## 0.2.x：稳定当前桌面闭环

- 修复岗位删除、模型身份、空状态和错误恢复；
- 统一预览、编辑和 PDF；
- 保证 Windows portable 可启动；
- 清理测试残留和品牌名称。

## 0.3：岗位策略与简历质量

- 完成岗位理解对话与纠正；
- 完整经历分组和可回退选择；
- 深化岗位化简历策略；
- 完成逐条 Diff 审批；
- 增加 ResumeVersion 分支、重跑和对比；
- 用真实模型与多岗位样本评测改写质量。

## 0.4：作品集与投递管理

- 接入真实网页制作器 adapter；
- 作品集预览、编辑和导出；
- 跨资产一致性检查；
- 完整投递时间线与跟进动作。

## 0.5：生产质量

- 完整 Agent Eval；
- 崩溃恢复、数据备份和迁移；
- 性能、可访问性和隐私审计；
- Windows 签名与自动更新方案。

## 0.6：分发与更新

- Apple Silicon 与 Intel 持续构建；
- Developer ID 签名与 notarization；
- Windows 代码签名；
- 自动更新与回滚。

---

# 14. 测试与评测

## 14.1 自动化测试

必须覆盖：

- 领域模型和迁移；
- 状态机合法/非法跳转；
- 工具权限和路径边界；
- Fact 归属、数字、日期和角色强度；
- PDF 导入预览和重复导入；
- 岗位删除级联但不误删资料库；
- 模型配置、切换、错误与身份回答；
- 经历选择、改写审批和发布审批；
- ResumeVersion 快照和冻结；
- 统一简历预览、编辑和 PDF；
- sidecar 启动、端口冲突、健康检查与退出；
- packaged 客户端启动。

## 14.2 Agent Eval

建立覆盖数据分析、产品、AI 产品和 Agent 岗位的固定测试集。核心指标：

- JD 职责/要求提取准确率；
- 完整经历推荐 Precision/Recall；
- 岗位主线人工认可率；
- 改写提案人工接受率；
- 无来源陈述率；
- 数字与日期一致率；
- 角色强度风险召回率；
- 结构化输出一次通过率和修复后通过率；
- 同一候选人跨岗位差异化程度；
- 简历预览与最终 PDF 视觉一致率。
- 非法/重复工具调用拦截率；
- 工具调用、结果和审批 Trace 完整率；
- 暂停后恢复到正确阶段的成功率。

硬性指标：

```text
冻结快照被覆盖次数 = 0
无来源关键数字进入正式版本次数 = 0
高风险改写绕过审批次数 = 0
非法状态跳转未拦截次数 = 0
API Key 写入源码/业务库/Trace 次数 = 0
```

---

# 15. 下一版本验收标准（0.3）

使用一份包含教育、实习、数据分析项目、产品项目、Agent 项目和技能的真实结构简历，分别创建数据分析岗与产品岗。

验收必须满足：

1. 首次导入后资料按完整经历展示，教育与相关奖项不被无意义拆散。
2. 两个岗位共用个人资料库，但各自拥有独立会话、Run、策略和简历版本。
3. Agent 先解释岗位理解，用户可以纠正。
4. 数据分析岗突出数据能力，产品内容作为辅助；产品岗突出产品工作，保留数据迁移能力。
5. 用户可以返回调整经历，不需要删除岗位重来。
6. Agent 生成逐条改写，不是复制原文。
7. 每条改写显示 JD 依据、事实来源和风险。
8. 用户可接受、拒绝或编辑后接受。
9. 高风险角色升级被拦截。
10. 简历预览、完整编辑器和导出 PDF 内容与样式一致。
11. PDF 生成前后会话不丢失。
12. “材料生成完成”不会自动记录投递或锁死源简历。
13. 用户明确记录投递后，本次快照不可变，后续仍可创建新版本。
14. 连接模型时能准确回答提供商、模型和协议；无模型时阻止 Agent 运行并引导连接。
15. 失败可恢复，重复操作不会产生重复资产。
16. Agent 必须通过真实结构化工具调用独立完成“读取原简历 → 分析岗位 → 提出修改 → 请求确认 → 修改岗位版本 → 校验 → 生成新版本”，而不是由前端硬编码顺序或只返回文字。
17. 每个模型回合、工具请求、工具结果、审批暂停、失败和恢复都有可核对的脱敏记录。
18. Agent 运行期间可以继续发送消息；消息按顺序排队，暂停、恢复和进程重启后不会丢失。
19. 长对话压缩后，早期消息摘要、完整 JD、基础/岗位简历结构、已验证事实和材料来源仍可核对。
20. Skill 不能越过配置根目录或改变权限；MCP 未批准、未白名单或非只读工具不能被 Agent 调用。

---

# 16. Definition of Done

FetchCV MVP 只有同时满足以下条件才视为完成：

1. 用户能从 PDF 简历和补充材料建立可编辑资料库。
2. 岗位理解、经历策略、改写、排版和投递记录形成连续会话闭环。
3. 模型连接透明、安全且可切换；无模型时不冒充 AI。
4. 简历内容严格受事实、审批和风险规则约束。
5. 预览、编辑和正式 PDF 使用同一渲染源。
6. 用户可回退和重跑，历史版本可追溯。
7. 投递快照不可变，但源资料和后续版本可继续修改。
8. 真实作品集 builder 完成接入，或将作品集明确移出 MVP 而不以 Mock 冒充。
9. Agent Run、关键阶段、工具和错误均有脱敏记录。
10. 核心业务、Electron、sidecar 和成品启动有自动化回归测试。
11. Windows 客户端无需命令行即可启动。
12. README、PRD 和客户端品牌统一使用 FetchCV。

---

# 17. 工程实施规则

1. 修改前读取相关代码和项目记忆，不按概念图猜测实现。
2. 不重写已验证的 resume-editor-prototype 渲染器。
3. 不在 Prompt 中实现本应由状态机、权限或数据库保证的规则。
4. Agent 输出必须结构化，并支持 Mock 测试。
5. 写操作需要快照或明确的版本边界。
6. 删除和冻结必须有明确确认。
7. 不显示隐藏思维过程。
8. 不复制第三方项目的品牌和受版权保护实现；可学习其公开架构和交互模式。
9. 每次改动运行与风险相称的测试。
10. 新功能必须说明已实现、部分实现或规划状态。
11. 新接口不得把 API Key 或敏感 PII 返回 renderer。
12. macOS 适配不得破坏现有 Windows 构建和本地数据迁移。

---

# 18. 相关文档

- `docs/interaction_audit.md`：交互审计与用户认知顺序；
- `docs/current_system_analysis.md`：早期系统分析，部分内容已过时；
- `docs/reuse_inventory.md`：resume-editor-prototype 与桌面壳复用边界；
- `docs/integration_risks.md`：历史集成风险；
- `docs/sdk_compatibility.md`：Claude Agent SDK 兼容层；
- `README.md`：当前启动、模型与目录说明。

后续应逐步将仍使用 ApplyOS 名称或旧状态的文档更新为 FetchCV，但不得因此直接重命名运行中的 Python 包和数据库对象。
