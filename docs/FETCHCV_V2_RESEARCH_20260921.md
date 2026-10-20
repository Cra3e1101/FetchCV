# FetchCV V2：GitHub 与论文研究台账

检索/核验日期：2026-09-21。用途：[执行方案修订建议](./FETCHCV_V2_EXECUTION_REVISED_20260921.md)。本轮研究与文档编写，没有复现论文实验、安装这些项目、复制其代码或将其模型加入 FetchCV。

## 1. 检索范围与证据等级

问题：如何在保持本地优先、单 Pi loop、SQLite 单写者、可选 Python worker 的条件下，提高迁移可恢复性、文档定位质量、检索与记忆可信度，并减少实施成本。

纳入：有官方仓库/文档的相关项目；能核实标题、作者、年份与 venue 的检索、引用、上下文或记忆论文。主要年份 2023–2026，保留 2021 BEIR 作为基线方法参考。按本项目相关性筛选，而非按星数、榜单或“最新”排序。

本次使用网页检索后直接访问 GitHub 官方仓库与发布页、项目官方文档、ACL Anthology、NeurIPS Datasets and Benchmarks proceedings、ICLR proceedings、PMLR、OpenReview 与作者 arXiv 页面。没有执行 CNKI、OpenAlex、Semantic Scholar 的独立库检索，也没有做穷尽式系统综述。[检索词 JSON](./FETCHCV_V2_SEARCH_LOG_20260921.json) 保存实际搜索查询；下文保存选中来源及直接访问入口。未完整保存/计数所有检索候选，不生成伪 PRISMA 数字。

核验层级：**A** 官方发表元数据/摘要；**S** 阅读指定全文段落；**C** 官方源码/文档；**R** 项目发布记录。除明确写 S 的段落外，不声称论文全文精读。外部收益与 FetchCV 内部收益分别处理。

OpenReview 的后续直接打开出现浏览器校验页，未绕过；LongMemEval 使用作者 arXiv 与仓库交叉核对，MemGAS 使用此前返回的官方检索元数据和作者仓库 BibTeX/说明交叉核对。MemGAS 的全文算法/超参/效果表未在本轮完成核验，故仅提出有限实验方向。

## 2. GitHub 实现参考

以下五个有产品/框架实践的项目用于成熟实现参照；sqlite-vec 单列为 pre-v1 组件。维护快照是本次页面观察，不能替代固定 commit 的依赖审查，也不是推荐升级 FetchCV 到其最新版本。本文没有进行许可证兼容性的法律结论；直接复用代码前须核对具体文件与依赖许可证。

### R1. Joplin：本地数据库与服务分层

- [官方仓库](https://github.com/laurent22/joplin)、[架构说明](https://joplinapp.org/help/dev/spec/architecture/)、[LICENSE](https://github.com/laurent22/joplin/blob/dev/LICENSE)、[Releases](https://github.com/laurent22/joplin/releases)。证据 C/R。
- 维护快照：发布页可见 v3.7.18 及 2026-09 的资产；有持续发布记录。
- 文件/机制：官方 architecture 说明 UI 下的 services、models 和本地 SQLite；不是每个 UI 组件各自承担数据库职责。
- 许可：默认 AGPL-3.0-or-later，子目录若有独立 LICENSE 则另行适用，商标/图标也有单独条款。
- 用于 FetchCV：强化 APP 业务/存储边界和 UI 只调合同的结构。适配性高，但 Joplin 的同步和插件体系不属于本轮要移植的部分。

### R2. Zotero：版本迁移与附件阅读

- [仓库](https://github.com/zotero/zotero)、[schema.js](https://github.com/zotero/zotero/blob/main/chrome/content/zotero/xpcom/schema.js)、[userdata.sql](https://github.com/zotero/zotero/blob/main/resource/schema/userdata.sql)、[COPYING](https://github.com/zotero/zotero/blob/main/COPYING)、[tags](https://github.com/zotero/zotero/tags)。证据 C。
- 具体可核验机制：schema.js 在 schema 更新相关流程调用 `Zotero.DB.backUpDatabase({ force: true })`，记录 schema 更新备份状态；SQL 文件与迁移代码共同维护版本。
- 许可：AGPL 系列，userdata.sql 头部为 AGPL-3.0-or-later。这里只借鉴流程与用户体验，不搬代码。
- 维护限制：本次 GitHub Releases 页面不足以确定正式产品最新版本；没有把“页面没有 release”解释为项目停更，也不提供未经核实的版本号。
- 用于 FetchCV：迁移前备份与升级后检查、稳定引用和 reader。Zotero 的平台与存储细节不能直接视作 Electron/Node SQLite 的兼容性证明。

### R3. Paperless-ngx：原件、导出与恢复合同

- [仓库](https://github.com/paperless-ngx/paperless-ngx)、[administration](https://docs.paperless-ngx.com/administration/)、[Releases](https://github.com/paperless-ngx/paperless-ngx/releases)。证据 C/R；仓库标识 GPL-3.0。
- 维护快照：发布页可见 v3.2.0，2026-09 发布资产。
- 文档说明 exporter 包含文档、元数据和 manifest，可做校验；importer 要考虑版本兼容及空目标环境；API token 不随普通导出恢复。派生 archive 与原件区分。
- 用于 FetchCV：恢复包同时描述文件、数据 schema、应用版本和凭据恢复方式；拿到导出目录不等于演练成功。具体增量/反向恢复策略是 FetchCV 的设计提案，非声称 Paperless 已替我们解决。
- 不引入服务端 Django/Celery 栈，不执行文档中的删除选项。

### R4. Docling：文档 IR 与结构切块

- [仓库](https://github.com/docling-project/docling)、[chunking 文档](https://docling-project.github.io/docling/concepts/chunking/)、[Releases](https://github.com/docling-project/docling/releases)。证据 C/R。
- 维护快照：发布页可见 v2.129.0，2026-09 发布资产。代码 MIT；模型须另查其各自许可证。
- 机制：结构感知切块、tokenizer 预算、过大块拆分/小块合并，`contextualize` 可将元数据带入检索文本。
- 用于 FetchCV：区分原文定位与索引增强；现有 PDF/OCR 能力先建立基线，再对困难版式比较可选解析器。它不是证明整个 Docling 栈符合当前包体/资源预算。

### R5. Haystack：组件边界与重复策略

- [仓库](https://github.com/deepset-ai/haystack)、[DocumentWriter 文档](https://docs.haystack.deepset.ai/docs/documentwriter)、[源码](https://github.com/deepset-ai/haystack/blob/main/haystack/components/writers/document_writer.py)、[Releases](https://github.com/deepset-ai/haystack/releases)。证据 C/R；仓库标识 Apache-2.0。
- 本次文档显示 Version 3.1，发布页同时存在候选版本，故不拿未经固定版本的示例直接当依赖接口。
- 机制：DuplicatePolicy 明确区分默认/覆盖/跳过/失败。
- 用于 FetchCV：每类导入明确“同 identity+同内容跳过、同 identity+新内容建新版本、不同 scope 不合并”，而不是隐式覆盖。借鉴合同即可，不引入另一套 Agent runtime。

### R6. sqlite-vec：可选，不能标为稳定成熟基础

- [仓库](https://github.com/asg017/sqlite-vec)、[MIT 许可文件](https://github.com/asg017/sqlite-vec/blob/main/LICENSE-MIT)、[Releases](https://github.com/asg017/sqlite-vec/releases)。证据 C/R；仓库同时列出 Apache 许可文件，集成时核对所选分发件。
- README 明确警示 pre-v1 breaking changes；发布页 v0.1.9 包含 DELETE/长文本 metadata 错误修复，这正是本地撤权/删除传播必须实际回归的原因。
- 用于 FetchCV：锁定版本与实际二进制哈希，测试 Electron utility 的加载、向量维度、scope 过滤、删除传播和打包；失败可只用 FTS，不为向量检索阻塞基础产品。
- 不以 C/no-dependencies 的描述推断 Electron ABI、分发和权限问题已解决。

## 3. 论文卡片：八篇，分清发表与适用边界

### P1. BEIR

- 标题：**BEIR: A Heterogeneous Benchmark for Zero-shot Evaluation of Information Retrieval Models**。
- 作者：Nandan Thakur, Nils Reimers, Andreas Rücklé, Abhishek Srivastava, Iryna Gurevych。
- 发表：NeurIPS 2021 **Datasets and Benchmarks**；不误标为同年主 track。
- [官方论文页](https://datasets-benchmarks-proceedings.neurips.cc/paper/2021/hash/65b9eea6e1cc6bb9f0cd2a47751a186f-Abstract-round2.html)；[PDF](https://datasets-benchmarks-proceedings.neurips.cc/paper_files/paper/2021/file/65b9eea6e1cc6bb9f0cd2a47751a186f-Paper-round2.pdf)。稳定标识：proceedings hash `65b9eea6e1cc6bb9f0cd2a47751a186f`。访问 A，PDF 首页/摘要。
- 可支持：跨数据集比较揭示方法取舍，lexical 检索应保留为有竞争力的基线。不能支持“dense 在 FetchCV 一定更好”。
- 执行映射：E2 同数据、同预算对照，除平均值外报告任务切片和成本。相关性高；领域直接适配性中，需要中文履历集验证。

### P2. MIRACL

- 标题：**MIRACL: A Multilingual Retrieval Dataset Covering 18 Diverse Languages**。
- 作者：Xinyu Zhang, Nandan Thakur, Odunayo Ogundepo, Ehsan Kamalloo, David Alfonso-Hermelo, Xiaoguang Li, Qun Liu, Mehdi Rezagholizadeh, Jimmy Lin。
- 发表：**TACL 2023**。DOI：`10.1162/tacl_a_00595`。
- [官方页](https://aclanthology.org/2023.tacl-1.63/)。访问 A。
- 可支持：多语言检索不能只看一个英语总分；该数据集有 18 语言，但主要是各语言内的 Wikipedia 检索，不能直接证明跨语言或履历私有资料效果。
- 执行映射：中文、英文、中英混合、姓名/公司/编号分项标注；公开数据只补充方法检查，原方案的领域 golden 仍为主要验收依据。

### P3. ALCE

- 标题：**Enabling Large Language Models to Generate Text with Citations**。
- 作者：Tianyu Gao, Howard Yen, Jiatong Yu, Danqi Chen。
- 发表：EMNLP 2023，6465–6488。DOI：`10.18653/v1/2023.emnlp-main.398`。
- [官方页](https://aclanthology.org/2023.emnlp-main.398/)；[PDF](https://aclanthology.org/2023.emnlp-main.398.pdf)；[作者代码](https://github.com/princeton-nlp/ALCE)。访问 A/S：§3.3 Citation Quality、人工评估相关段落。
- 可支持：引用质量需同时考虑输出是否被引文支持、是否有无关引文；自动 NLI/judge 并非完美人工替代。
- 执行映射：先做引用解析/权限硬检查，再做事实断言支持与覆盖评估；保留人工仲裁。不承诺复用论文模型即可达到 FetchCV .98。

### P4. Lost in the Middle

- 标题：**Lost in the Middle: How Language Models Use Long Contexts**。
- 作者：Nelson F. Liu, Kevin Lin, John Hewitt, Ashwin Paranjape, Michele Bevilacqua, Fabio Petroni, Percy Liang。
- 发表：TACL 2024，12:157–173。DOI：`10.1162/tacl_a_00638`。
- [官方页](https://aclanthology.org/2024.tacl-1.9/)；[PDF](https://aclanthology.org/2024.tacl-1.9.pdf)。访问 A，PDF 首页/摘要。
- 可支持：受测模型的长上下文利用率受证据位置影响；上下文窗口长度不等于有效利用全部证据。
- 执行映射：E5 对当前锁定模型做前/中/后位置扰动，验证预算选择，不简单复制“永远放头尾”的策略。对新模型结论仍需复测。

### P5. Sufficient Context

- 标题：**Sufficient Context: A New Lens on Retrieval Augmented Generation Systems**。
- 作者：Hailey Joren, Jianyi Zhang, Chun-Sung Ferng, Da-Cheng Juan, Ankur Taly, Cyrus Rashtchian。
- 发表：ICLR 2025。
- [官方页](https://proceedings.iclr.cc/paper_files/paper/2025/hash/33dffa2e3d2ab74a783d1a8c292f66d9-Abstract-Conference.html)；[PDF](https://proceedings.iclr.cc/paper_files/paper/2025/file/33dffa2e3d2ab74a783d1a8c292f66d9-Paper-Conference.pdf)；[作者代码](https://github.com/hljoren/sufficientcontext)。稳定标识：proceedings hash `33dffa2e3d2ab74a783d1a8c292f66d9`。访问 A/S：定义、autorater 与选择性生成相关段落，非完整复现。
- 可支持：分析检索上下文是否足够，有助于解释 RAG 失败与选择性回答。充分性不是外部事实真实性认证，自动判断也会错。
- 执行映射：E3 有限补检/拒答与覆盖率共同评估。首版使用必要字段检查及可校准辅助判断，不默认叠加重型 autorater。

### P6. LongMemEval

- 标题：**LongMemEval: Benchmarking Chat Assistants on Long-Term Interactive Memory**。
- 作者：Di Wu, Hongwei Wang, Wenhao Yu, Yuwei Zhang, Kai-Wei Chang, Dong Yu。
- 发表：ICLR 2025。作者预印本标识 `arXiv:2410.10813v2`，2025-03-04 修订；预印本年份不替代会议年份。
- [OpenReview](https://openreview.net/forum?id=pZiyCaVuti)；[作者 arXiv](https://arxiv.org/abs/2410.10813)；[作者仓库](https://github.com/xiaowu0162/LongMemEval)。访问 A/C；OpenReview 后续直接打开受校验页限制。
- 五类能力：信息提取、跨会话推理、时间推理、知识更新、拒答。当前仓库注明历史数据清理和后续 V2 工作；本方案引用的是这篇 ICLR 2025 论文，使用数据时另锁 revision，不混用版本成绩。
- 执行映射：E4 五类分别测试，另加 FetchCV 的用户确认、scope 与撤权合同。论文 QA 能力不能替代这些产品权限要求。

### P7. HippoRAG 2

- 标题：**From RAG to Memory: Non-Parametric Continual Learning for Large Language Models**。
- 作者：Bernal Jiménez Gutiérrez, Yiheng Shu, Weijian Qi, Sizhe Zhou, Yu Su。
- 发表：ICML 2025，PMLR 267:21497–21515。稳定标识：`v267/gutierrez25a`。
- [官方页](https://proceedings.mlr.press/v267/gutierrez25a.html)；[作者仓库](https://github.com/OSU-NLP-Group/HippoRAG)。访问 A。
- 可支持：图关联与检索整合是多跳/关联记忆的研究方向；不是必须采用图数据库的证据。
- 执行映射：仅 E6 后置候选；先测简单检索实际失败类型、成本上限，再决定是否读透/复现算法。本文没有核验其完整超参或将其论文增益外推到 FetchCV。

### P8. MemGAS：前沿研究候选

- 标题：**From Single to Multi-Granularity: Toward Long-Term Memory Association and Selection of Conversational Agents**。
- 作者：Derong Xu, Yi Wen, Pengyue Jia, Yingyi Zhang, Wenlin Zhang, Yichao Wang, Huifeng Guo, Ruiming Tang, Xiangyu Zhao, Enhong Chen, Tong Xu。
- 发表：ICLR 2026；官方检索元数据为 Poster。稳定标识：OpenReview `i2yIvZARnG`。
- [官方记录](https://openreview.net/forum?id=i2yIvZARnG)；[作者实现](https://github.com/Applied-Machine-Learning-Lab/ICLR2026_MemGAS)。访问：官方检索摘要/元数据 + C；后续直接打开 OpenReview 被校验页拦截，论文全文未完成核验。
- 仓库 README/BibTeX 确认题名、作者、会议；可见 turn/session/summary 等粒度入口，以及额外模型/生成过程。根页面未见 LICENSE，不能因此假设允许直接复制实现。
- 执行映射：只提议多粒度、同预算的本地消融。GMM/复杂选择机制尚不进入主线；源码示例的默认全局检索、自动保存不符合 FetchCV 原确认/scope 合同，不能照搬。

## 4. 补充工程依据

- [Electron utilityProcess](https://www.electronjs.org/docs/latest/api/utility-process)：用于明确进程边界及启动/环境行为，不等同恶意代码安全沙箱。
- [Windows Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)：资源与进程集合管理；文件与网络隔离要另行设计验证。
- [Windows 应用隔离](https://learn.microsoft.com/en-us/windows/security/book/application-security-application-isolation)：选择 OS 强制边界的官方背景；尚未完成 FetchCV parser 兼容性 spike。
- [SQLite Online Backup API](https://www.sqlite.org/backup.html)：一致性备份机制依据；复制正在写入的 `.db` 文件不能无条件等同完整备份。

本地材料：原 `FETCHCV_V2_FINAL.md` §1、5–10、14–15、18、20–22；M1 最终报告；当前 package.json/Git 状态。上述工程页用于支持界限，实施前仍须锁定实际 Electron/SQLite/Windows 版本。

## 5. 不采纳或暂缓的建议

1. 不增加新的 Agent 框架替代/并行 Pi。Haystack 在这里只提供组件合同参考。
2. 不将 Docling、重型 reranker、图构建、MemGAS 全套依赖一次装入默认 runtime。
3. 不因为 sqlite-vec 有发布就视其 API 与 Electron 适配已经稳定。
4. 不把 RRF k=4 的原小样本 pilot 升格为定论；不把公开英文 benchmark 成绩外推到中文私有履历。
5. 不用一个生成模型的自评代替人工证据标注，不将“更多引用/更长上下文/更多记忆”本身视为提升。
6. 不复用来自普通 GitHub issue、第三方榜单或营销页的成绩做关键论据；搜索遇到的这些结果未进入八篇论文清单。

## 6. 证据仍不足的地方

没有在 FetchCV 上进行上述算法消融；没有验证新 SQLite 驱动的 Electron 打包兼容性；没有验证 OS parser 沙箱实施方式。多数仓库是活动分支链接而非内容固定的 commit permalink；正式复用实现时须解析 commit、保存许可证与所选文件哈希。Zotero 最新产品版本、MemGAS 完整论文细节与代码许可未在本轮补齐，因此不作为直接安装或复用依据。

本次足以支持执行顺序、失败边界与评测方法的改进；不足以承诺某模型/算法的具体质量增幅、延迟或内存占用。最终以项目内冻结数据、实际 Windows 构建和恢复实验为准。
