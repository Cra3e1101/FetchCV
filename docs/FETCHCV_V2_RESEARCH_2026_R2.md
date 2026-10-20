# FetchCV V2：2026 年优先的研究与工程证据台账

核验日期：2026-09-21。对应方案：[执行方案 R2](./FETCHCV_V2_EXECUTION_2026_FIRST_R2.md)。本轮仅检索、阅读及修改方案文档；未安装依赖、下载模型、克隆仓库、复现实验或执行 M2。原设计与上一版研究文档保留。

## 1. 筛选口径与证据边界

前沿算法优先 **2026-01-01 至 2026-09-21 首次公开**的研究。会议年度和首稿年度分别记载：2026 顶会接收不能证明算法在 2026 年才出现。2025 首稿的会议工作放在补充/进阶对照，不挤占当前研究的主位置。基础存储、文档处理与恢复允许参考近两年的现行成熟实现。

工程参考核对官方仓库、变更记录与本地安装版本。项目年龄、GitHub 星数、发布日期都不能单独证明稳定性。尚未锁定 commit 的 main 分支，只用于设计发现；复制实现前还须锁定版本、核对许可证与本地合同。未采用博客或社交平台的接收声明来认证论文发表状态。

本轮保留 6 篇论文，分为 3 篇 2026 首发主参考与 3 篇正式 2026 会议的补充参考。阅读层级逐条列出，不声称全部逐页精读或已经复现。这是面向实施问题的定向检索，不是穷尽性系统综述；没有可报告的全集去重数或 PRISMA 流程。精确搜索词见[搜索日志](./FETCHCV_V2_SEARCH_LOG_2026_R2.json)。

## 2. 工程参考：优先看当前版本到底做了什么

### F1. Pi：先复用本地 SDK 的接点

来源：[官方 Agent README](https://github.com/earendil-works/pi/blob/main/packages/agent/README.md)，以及本地 `node_modules/@earendil-works/pi-agent-core` 的 package.json、声明文件与编译后 JavaScript。本地版本 **0.80.10，MIT**；pi-ai 同版本。上游 README 为本次访问时的 main，不等同于该安装版本。

核验命令：

```powershell
Get-Content node_modules/@earendil-works/pi-agent-core/package.json -Raw
rg -n 'transformContext|beforeToolCall|afterToolCall|shouldStopAfterTurn|toolExecution|convertToLlm|sessionBackend' node_modules/@earendil-works/pi-agent-core/dist/agent.d.ts node_modules/@earendil-works/pi-agent-core/dist/types.d.ts
rg -n 'shouldStopAfterTurn|transformContext|beforeToolCall|createLoopConfig|toolExecution' node_modules/@earendil-works/pi-agent-core/dist/agent.js node_modules/@earendil-works/pi-agent-core/dist/agent-loop.js
```

发现：本地已有上下文转换、工具前后处理、执行模式及下一回合准备接口。`shouldStopAfterTurn` 出现在低层 AgentLoopConfig 与 loop 实现，却没有在本地 AgentOptions / Agent.createLoopConfig 暴露并传入；上游现行 Agent README 已有该用法。**不能直接把最新示例当作已安装能力。** 这是静态 API/接线差异，不是本轮运行复现的故障。

应用：M2a 增加“SDK 能力—应用接线—合同测试”矩阵；先保持锁定版本，用最小 adapter 衔接。只有证明缺少必要能力后才单列升级任务。不另外引入一个 Agent 框架来承载同一模型循环。上游独立 session backend 也不能绕过 APP 直接接管业务库。

### F2. Deep Agents：参考 2026 年的减法和修复

来源：[官方仓库](https://github.com/langchain-ai/deepagents)、[Python SDK CHANGELOG](https://github.com/langchain-ai/deepagents/blob/main/libs/deepagents/CHANGELOG.md)、[维护者发布流程说明](https://github.com/langchain-ai/deepagents/issues/4219)。仓库 MIT；维护者明确讨论 pre-1.0 API 演进，因此不把它称作已冻结的稳定接口。

本次读取的具体记录：

- 0.7.0（2026-07-29）：移除默认 TodoList 中间层，精简基础提示词。
- 0.7.14（2026-09-13）：压缩恢复有界化和输入预算校验等修复。
- 0.7.15（2026-09-16）：补齐无 tool-call ID 时的大结果存储路径唯一性。
- 0.5.4（2026-04-29）：加入与模型/提供方相关的配置机制。

这些是 **Python SDK** 记录；[JavaScript overview](https://docs.langchain.com/oss/javascript/deepagents/overview) 的工具说明不能据此视为同步更新。已查看官方 filesystem / summarization 文件入口，但没有对整个实现作逐行审计。

应用：按任务启用计划工具；大工具结果返回短描述和受权引用；引用唯一性不依赖可空 ID；预算/压缩恢复有上限。它们是 FetchCV 的待验设计，不继承上游的性能数字，也不安装 Deep Agents 替换 Pi。

### F3. LangGraph：checkpoint 与长期 store 分开

来源：[官方 persistence 文档](https://docs.langchain.com/oss/python/langgraph/persistence)。本轮 durable-execution 地址重定向至该页面。其 thread checkpoint 与跨 thread store 的职责划分可用于恢复设计；内存实现不提供跨进程持久性。

应用：恢复状态、可再生摘要、长期事实分别管理。外部请求超时后结果不明，仍须按 FetchCV 的 unknown/幂等协议处理；不能从“有 checkpoint”推导外部副作用恰好执行一次。本轮不引入 LangGraph，也未核验拟采用固定版本的许可证/全部执行语义。

### F4. Letta：核对当前仓库位置

来源：[旧入口 README](https://github.com/letta-ai/letta)、[当前 letta-code](https://github.com/letta-ai/letta-code)。旧入口已指向新代码仓库，并标明旧 V1 API server 的归档方向。当前仓库为 Apache-2.0，强调可持久保存、检查的记忆和技能。

应用：借鉴可检查的经验与状态，而非直接接受自主修改系统提示词、权限或跨用户共享记忆。当前 main 的产品方向不是旧教程中的 API server 合同。本轮未运行 Letta 或宣称其性能优于当前 Pi。

### 基础框架单独保留

Docling / Paperless 的现行版本只用于解析、导入和恢复的工程对照；不作为 Agent 前沿算法。沿用前一轮核验入口：[Docling releases](https://github.com/docling-project/docling/releases)、[chunking 文档](https://docling-project.github.io/docling/concepts/chunking/)、[Paperless releases](https://github.com/paperless-ngx/paperless-ngx/releases)、[管理文档](https://docs.paperless-ngx.com/administration/)。采用具体实现时仍需重新锁定 release/commit，区分代码、模型与数据许可证；不把 Paperless GPL 代码直接纳入项目作为默认选择。

## 3. 2026 年首次公开：主要研究依据

### N1. SimpleMem: Efficient Lifelong Memory for LLM Agents

- 作者：Jiaqi Liu, Yaofeng Su, Peng Xia, Siwei Han, Zeyu Zheng, Cihang Xie, Mingyu Ding, Huaxiu Yao。
- 首发：**2026-01-05**；本轮方法阅读版本为 arXiv v3（2026-01-29），ID **2601.02553**。
- 状态：在 **ICML 2026 官方 Downloads 目录**核到题名；作者仓库亦标示会议。没有取得最终出版社全文，不填写未核实的卷页/DOI。
- 来源：[arXiv 元数据](https://arxiv.org/abs/2601.02553)、[v3 正文](https://arxiv.org/html/2601.02553v3)、[ICML 官方目录](https://icml.cc/Downloads/2026)、[作者代码](https://github.com/aiming-lab/SimpleMem)。作者仓库 MIT，但当前仓库还包含后续 OmniSimpleMem，不将其算作本篇同一实验。
- 阅读层级：元数据、摘要及 §2.1–2.3 方法，非逐页复现实验。

与本项目有关：实体/时间明确的原子事实、多视图检索、依问题安排检索深度。其写入前合成可能改写信息，必须保留来源与 unknown；论文采用集合合并，不应误写成 RRF。名称中的“无损”不是 FetchCV 可跳过原文校验的保证。

执行位置：M6 的 metadata 与语义/词法分流，M7 的候选提取。先做保留来源的最小实现，不把 LoCoMo 等论文成绩搬成求职任务收益。

### N2. LongMemEval-V2: Evaluating Long-Term Agent Memory Toward Experienced Colleagues

- 作者：Di Wu, Zixiang Ji, Asmi Kawatkar, Bryan Kwan, Jia-Chen Gu, Nanyun Peng, Kai-Wei Chang。
- 首发：**2026-05-12**；ID **2605.12493**，本轮按**预印本**引用，不宣称顶会接收。
- 来源：[元数据](https://arxiv.org/abs/2605.12493)、[v1 正文](https://arxiv.org/html/2605.12493v1)、[作者项目页](https://xiaowu0162.github.io/longmemeval-v2/)、[作者仓库](https://github.com/xiaowu0162/LongMemEval-V2/)、[数据卡](https://huggingface.co/datasets/xiaowu0162/longmemeval-v2/blob/main/README.md)。数据卡标示 Apache-2.0；不据此推定所有模型和依赖同一许可证。
- 阅读层级：元数据、项目说明、§4.2 及附录中的检索实现/沙箱说明。

该工作覆盖环境状态、流程经验、陷阱及错误前提；不同检索方式的质量和查询成本需要同时考虑。其问答评测不能独自证明后续行动正确。对 FetchCV 最有用的是 manifest 引导的证据定位、过程经验分层、固定 reader 下的质量/成本比较，而非默认把所有历史交给额外编码 Agent。

执行位置：M7 经验候选；M7/M9 跨会话验证。这里的过程经验是事实性执行结果与适用条件，不是私有思维链，也不携带新的批准权限。

### N3. MemoryArena: Benchmarking Agent Memory in Interdependent Multi-Session Agentic Tasks

- 作者：Zexue He, Yu Wang, Churan Zhi, Yuanzhe Hu, Tzu-Ping Chen, Lang Yin, Ze Chen, Tong Arthur Wu, Siru Ouyang, Zihan Wang, Jiaxin Pei, Julian McAuley, Yejin Choi, Alex Pentland。
- 首发：**2026-02-18**；ID **2602.16313**。
- 状态：**预印本；本轮未独立确认会议接收**。社交平台称 ICML 接收不作为证明，未核实不等于被拒。
- 来源：[元数据](https://arxiv.org/abs/2602.16313)、[v1 正文](https://arxiv.org/html/2602.16313v1)。元数据题名带 MemoryArena 前缀，v1 正文标题不带该前缀，按 ID 确认为同一工作。
- 阅读层级：元数据、摘要与 §3.2 跨会话任务结构，未运行官方环境；本轮未完成代码/数据许可证采用审查。

主要价值是让后续任务依赖前序会话获得的状态与知识，测实际行动结果。迁移到 FetchCV 时要重建求职领域任务，不能把购物/搜索环境成绩视为履历真实性保证。

执行位置：新增 12 条合成任务链 pilot，每条至少三会话；保留原计划正式评测规模。pilot 只找缺陷，不支持生产质量宣称。采用无记忆、事实记忆、事实+过程经验的同预算对照。

## 4. 2026 正式会议：补充评测与进阶对照

以下不能全部称作“2026 年才提出的新算法”。N5/N6 已明确核到 2025 首稿；N4 本轮未独立确定最早公开日期，按正式发表年使用。

### N4. Demystifying Deep Search: A Holistic Evaluation with Hint-free Multi-Hop Questions and Factorised Metrics

- 作者（最终论文 PDF）：Maojia Song, Renhang Liu, Xinyu Wang, Yong Jiang, Pengjun Xie, Fei Huang, Soujanya Poria, Jingren Zhou。
- 状态：**ICLR 2026 正式 proceedings**。最早公开日期未在本轮封闭核验，不归入“2026 首发”组。
- 来源：[官方条目](https://proceedings.iclr.cc/paper_files/paper/2026/hash/9a27f07ee41dd59d527062e045c16353-Abstract-Conference.html)、[正式 PDF](https://proceedings.iclr.cc/paper_files/paper/2026/file/9a27f07ee41dd59d527062e045c16353-Paper-Conference.pdf)。网页把第二作者写作 Liu Renhang，作者姓名采用 PDF 拼写；不混用旧稿作者顺序。
- 阅读层级：正式元数据、摘要及 PDF 的评测/扩展实验相关段落，包括 §4.2.3；未复现 WebDetective。

借鉴其将搜集充分性、知识利用、拒答分开分析的方法。求职资料不是百科沙箱，FetchCV 仍须另测引用定位、原始履历支持及数字/日期一致性。不默认复刻整个 EvidenceLoop。

执行位置：M6/M8 的失败归因。已有足够证据却答错时，优先修正证据利用，而非无条件多检索。

### N5. AgentFold: Long-Horizon Web Agents with Proactive Context Folding

- 作者（arXiv 首稿元数据）：Rui Ye, Zhongwang Zhang, Kuan Li, Huifeng Yin, Zhengwei Tao, Yida Zhao, Liangcai Su, Liwen Zhang, Zile Qiao, Xinyu Wang, Pengjun Xie, Fei Huang, Siheng Chen, Jingren Zhou, Yong Jiang。未将该顺序冒充已逐项核对的最终稿顺序。
- 状态：**ICLR 2026** 官方目录可核；首发 **2025-10-28**，ID **2510.24699**，早期题名末尾是 Proactive Context Management。
- 来源：[ICLR 官方目录](https://iclr.cc/Downloads/2026)、[会议稿入口](https://openreview.net/pdf?id=IuZoTgsUws)、[arXiv 元数据](https://arxiv.org/abs/2510.24699)、[v1 正文](https://arxiv.org/html/2510.24699v1)。会议 PDF 访问遇挑战页，未绕过；方法阅读采用可访问 arXiv 正文 §3.1。

多尺度上下文选择可作进阶比较，但原方法涉及专门训练。不能声称改一段提示词即可复现其收益；原文引用、大结果按需读取、完整工具组的安全精简应先实现。

执行位置：M8 的可选对照，不是 M2 前置。明确排除同名的 [2026 蛋白质折叠模型设计 AgentFold](https://arxiv.org/abs/2608.26747)，后者不回答当前上下文管理问题。

### N6. From Single to Multi-Granularity: Toward Long-Term Memory Association and Selection of Conversational Agents（MemGAS）

- 作者：Derong Xu, Yi Wen, Pengyue Jia, Yingyi Zhang, Wenlin Zhang, Yichao Wang, Huifeng Guo, Ruiming Tang, Xiangyu Zhao, Enhong Chen, Tong Xu。
- 首发：**2025-05-26**；ID **2505.19549**，v2 更新于 2025-09-29；正式发表为 **ICLR 2026**。
- 来源：[arXiv 元数据](https://arxiv.org/abs/2505.19549)、[正式 proceedings](https://proceedings.iclr.cc/paper_files/paper/2026/hash/93e444b4a1a64815631c3c74977ee200-Abstract-Conference.html)。本轮正式 PDF 获取失败；不声称已精读最终全文。
- 阅读层级：正式/预印本元数据及摘要；多粒度关联和选择的描述据摘要，未审计代码实现或复现实验。

执行位置：M7/M8 的第二梯队消融。先证明简单原文/摘要/过程分层有效，再考虑聚类和路由；不据摘要直接新增 GMM、图数据库或大型模型依赖。

## 5. 排除、降级与纠错

| 材料/问题 | 本次处理 |
|---|---|
| BEIR、MIRACL、ALCE、Lost in the Middle 等较早研究 | 移出 Agent 算法的主要选型依据；现有产品要求和可靠检索基线不因此撤销 |
| LongMemEval 2025、HippoRAG 2、Sufficient Context 2025 | 不作本轮前沿推荐，优先使用上述 2026 研究；历史记录保留 |
| AgentFold 同名蛋白质工作 | 题名/任务不符，排除 |
| ContextBench 的同名/相邻主题工作 | 研究对象与 FetchCV 适配较弱，本轮不纳入主要证据，不拼接不同论文结论 |
| InfoMosaic、MemoryWalker、LongSeeker 等搜索线索 | 未完成与上述同等深度的元数据/适配核验，不据此新增执行要求 |
| SimpleMem 仓库的后续 OmniSimpleMem | 版本/论文范围不同，不冒充本篇实验或 ICML 接收范围 |
| Python Deep Agents 更新与 JavaScript 文档 | 分开标注，不假定跨语言同步 |
| 最新 Pi README 与本地 0.80.10 | 以本地声明与接线决定能否调用，升级另行评估 |
| Letta 旧 API server 教程 | 使用当前仓库迁移说明，不把退休入口当现行产品 |
| 社交平台会议接收消息 | 只当检索线索，未经官方/作者元数据核实不写成正式接收 |

## 6. 可复核性、访问限制和下一步

来源为官方仓库/文档、作者 arXiv/项目页、ICLR/ICML 官方记录。ICML 虚拟海报页面受访问限制时使用官方 Downloads 题名记录；OpenReview 挑战页和部分 PDF 获取失败如上明示。未绕过访问限制。本轮没有运行 OpenAlex、Semantic Scholar 或 CNKI 的系统检索，不能声称跨数据库穷尽覆盖。

R2 中的应用建议是**基于来源的工程推断**，不是已验证效果。12 条 pilot、分阶段引用/压缩、有界检索及经验 schema 都是拟议设计。论文年份满足新鲜度要求，仍需通过 FetchCV 的相同预算、授权边界、实际产物和恢复测试才能采用。

下一阶段先做本地能力矩阵与最小合同设计。实施前为实际采用的仓库固定 commit、记录依赖与许可证，确认所读方法版本；不因“2026”或“顶会”直接扩大安装包、默认工具集或副作用权限。
