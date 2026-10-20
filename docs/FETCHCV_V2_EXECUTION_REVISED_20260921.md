# FetchCV V2 执行方案修订建议：M1–M10

日期：2026-09-21。状态：**研究后形成的执行提案；本轮只新增文档，未实施 M2+。**

原设计：`D:\hesan\Desktop\VSCODES\linshi\FETCHCV_V2_FINAL.md`，110,397 B，SHA256 `9e38a6d445fbc6aeab5ffc0c1baaa1da2ffa7eb79cb0cf1ca38584b70ba94569`。原文件保留不改。下文明确标为“修订”的内容须在进入对应实现阶段前纳入认可的阶段计划；其余继承原设计。用户后续授权与保护要求优先。

配套证据：[项目与论文研究台账](./FETCHCV_V2_RESEARCH_20260921.md)、[实际检索词](./FETCHCV_V2_SEARCH_LOG_20260921.json)。本文中的 R1–R6、P1–P8 对应该台账。项目路径均以 `D:\hesan\Desktop\VSCODES\FetchCV_Windows` 为根。文中的未来模块/测试文件是拟建目标，不表示文件已经存在或验证已执行。

## 1. 决策摘要

维持原方案的核心：Electron 窄桥接、APP utility 作为业务与 SQLite 唯一写入者、单 Pi model/tool loop、Python 仅按需承担解析/embedding、原件与不可变版本分离、FTS 可独立工作、长期记忆须有来源和明确状态。

本次优化集中在七处：

1. **将迁移可靠性具体化**：M4 分四步，在副本上做转换、恢复和故障注入后才切换；升级后新写入数据必须可读、可导入恢复，不能仅称“已导出”。参考 Zotero 的版本迁移代码和 Paperless-ngx 的导出/恢复合同，具体实现仍按 FetchCV 的单写者架构设计。
2. **在 M2 前置只读盘点，在 M2 切换前具备最小安全合同**：避免先删旧 loop，再发现必要工具、权限或取消语义缺失。M3 完成完整合同，M8 再优化上下文选择；基本硬预算和原子工具消息不能等到 M8 才补。
3. **修补逻辑 schema 尚未闭合的部分**：秘密字段归档、Source 身份与 scope、调用幂等与重复意图、任务租约过期后的迟到提交、Message 修订序号，均先用明确反例验收。
4. **解析与检索内容分层**：原始可定位文本、检索增强文本、发送模型的文本分别标识和哈希。采用 Docling 的结构与 tokenizer 感知切块思路；首版继续用现有解析能力，重解析器只做可选能力包实验。
5. **把“相关”与“足以作答”分开**：增加必要证据覆盖、缺失信息、冲突和拒答评测。引用同时检查可解析性、语义支持与覆盖率，不以链接存在替代真实性。
6. **让前沿算法通过本地消融晋级**：多粒度记忆、重排和图检索不直接进入默认依赖。先比较 FTS、dense、RRF；再判断是否值得增加复杂度。
7. **每阶段交付一个可用切片和可执行验收**：最小 source reader 提前到 M4/M5，检索界面在 M6 即可用；不等待 M9 才看见产品收益。

## 2. 当前起点：把历史事实与下一阶段目标分开

状态依据：[M1 实施报告](../.m1-evidence/m1-build-20260920-gpt01/M1-REPORT.md)。本轮读取报告和 Git 状态；未重新运行其全部测试。

| 项目 | 当前证据/约束 | 对后续计划的影响 |
|---|---|---|
| 源码基线 | `1959bb8d3832fd405d77db9fb53d3b40e6c35644`；M1 requirements、scripts/m1 尚未提交 | M2 前先完成受控版本快照；只暂存已审查文件，不用 `git add .`；Git 不代替环境、原件、DB 备份 |
| Python | 新环境 65 distributions；旧基线 155 通过/2 跳过、import 1559 ms；新环境同测试数、import 中位 1555.2637 ms | 保留旧数字与各自运行上下文，不重跑覆盖；runtime/build/dev 三锁与 wheelhouse 作为重建依据 |
| 功能验证 | M1 报告记录 PDF、DOCX、100 个 Node 测试、NSIS、原有 packaged 测试通过 | 是后续回归起点，不等于 V2 性能/安全目标已达到 |
| 包体 | NSIS 128,380,409 B；unpacked 403,722,304 B，约 385.02 MiB | 原方案 ≤130 MiB / ≤380 MiB 是 V2 目标；unpacked 仍约超 5.02 MiB，不降低目标冒充达标 |
| 回退与审计 | 旧 env/installer 保留；隔离不回收物理空间；原生子进程删除未全覆盖 | M1 应记“功能通过，完整删除审计有保留意见”；不得事后编造缺失收据 |
| 原件与权限 | artifacts、test use、原 DB、旧 installer 继续保护；项目所有者问题未解决 | 不做隐式清理、ACL 变更或真实数据写入；保护范围跨阶段继承 |
| 依赖边界 | Python playwright 被排除；Node playwright 用于 Electron 测试；electron-winstaller 为锁内传递依赖 | 不按同名包或“不用 Squirrel”盲删依赖；下一次改锁仍须证明 NSIS 可用 |

M1 的历史审计缺口只能明确接受限定结论，或对未来运行补充覆盖；不能靠反复重跑消除历史事实。本文不把该缺口擅自视为已获豁免。

## 3. 研究结果如何进入主线

| 来源 | 采纳到计划的做法 | 暂不采用的部分 | 阶段 |
|---|---|---|---|
| R1 Joplin | UI 与数据库/业务服务分层，离线能力独立 | 整套同步、插件或应用框架移植 | M3/M4 |
| R2 Zotero | schema 版本管理、迁移前备份、升级后完整性检查；附件与定位阅读体验作为参照 | 复制其数据库或直接搬 AGPL 代码 | M4/M5 |
| R3 Paperless-ngx | 原件/派生产物区分；manifest、版本兼容和恢复演练 | Django/Celery/server 部署栈 | M4/M10 |
| R4 Docling | 结构切块、长度边界、标题与表格上下文；原文定位独立 | 默认安装其全部模型与框架 | M5 |
| R5 Haystack | 组件输入输出合同、显式重复策略 | 增加第二套 Agent loop | M5/M6 |
| R6 sqlite-vec | 可选 SQLite 向量后端，先测实际 Electron ABI/扩展加载 | 假设 pre-v1 API 长期稳定 | M4a/M6 |
| P1 BEIR、P2 MIRACL | lexical 基线与领域/语言分层；公开集只作方法参考 | 用英文或 Wikipedia 分数承诺中文履历效果 | M6 |
| P3 ALCE、P5 Sufficient Context | 引用支持/覆盖与可回答性分别评测 | 默认部署大模型 judge，或把有引用当作真实 | M6/M8 |
| P4 Lost in the Middle | 上下文位置扰动测试、预算内证据选择 | 固定断言所有新模型都有相同位置偏差 | M8 |
| P6 LongMemEval | 提取、跨会话、时间、更新、拒答五类记忆用例 | 用长历史 QA 分数替代用户确认和撤权测试 | M7 |
| P7 HippoRAG 2、P8 MemGAS | 离线研究候选：多跳证据、多粒度索引 | 默认上图数据库、GMM 路由、额外在线生成步骤 | M7 可选实验；不阻塞首版 |

这些是针对 FetchCV 的工程判断。论文结果没有在本项目复现，不能写成预计提升百分比。开源项目用于设计参照，不在本轮复制代码、安装依赖或下载模型。

## 4. 实现前须闭合的设计细节

### 4.1 秘密字段与“全量无损归档”的冲突（修订原 §10）

原文要求所有旧表完整 `row_json` 归档，又要求 Setting/MCP 中秘密转 credential reference。若原样归档，秘密仍可能进入新库。

提案：迁移前按旧表/字段建立分类，区分普通数据、个人资料与凭据。新 LegacyArchive 的凭据值替换为不可逆推出秘密的引用，保留 redaction schema/version 和字段列表；原始 DB 另作受访问控制的恢复快照。原始快照绝不进入构建、检索、普通 evidence 日志或 CI。需要携出时使用明确的加密导出机制，并在不同账户恢复时测试凭据是否需重新输入。

验收分两层：原始快照完整性与逐行清点；脱敏映射的语义完整性。不要要求脱敏后 JSON 与原始秘密行的明文哈希相等，也不要为短秘密保存可公开离线猜测的单独哈希。原始文件完整性摘要与普通可分享报告分开存放。所有旧行仍必须有映射结果或明确的归档/脱敏记录。

### 4.2 Source 身份不应隐式扩大 scope（修订原 §7/§10）

原 `UNIQUE(workspace, identity_key)` 与可空 candidate/job 需明确关系。建议首版采用 **scope 内 Source 身份**：canonical URI/导入身份加规范化 candidate/job scope 构造 identity；相同 URL 在两个 candidate 下分别保留 Source。blob 可按内容去重，但共享 blob 不授予读取权限。URI 规范化去凭据、保留有业务意义的 query，不把不同页面误合并。

若以后需要一个 Source 显式共享给多个 scope，再增加独立授权关联；本轮不先建一套通用 ACL 图。验收同 URL/不同候选人、同原件/不同岗位、撤权后缓存返回、同 scope 新版本与重复导入。

### 4.3 分开三个身份（修订原 §6/§10）

`invocation_id` 表示一次用户/宿主意图及其重试；`operation_hash` 绑定规范化参数、目标版本、scope、策略和批准；外部 `provider_idempotency_key` 仅在提供方实际支持时使用。

相同 invocation 重试必须复用结果/状态；用户明确再次执行则是新 invocation，须重新评估批准条件。不要让 `UNIQUE(workspace,operation_hash)` 意外禁止同一 run 内合法重复操作，也不要通过换 run_id 绕过重复外部提交保护。M3 先明确合同，M4 才形成最终约束迁移。外部请求发出后回执丢失保持 `unknown`，禁止自动重发；无法靠本地事务证明远端 exactly-once。

### 4.4 租约、取消、事件的提交边界（细化原 §6/§10）

每次领取 IngestJob 使用新的 fencing token/单调递增 attempt。完成提交要求 `job_id + attempt + lease_owner + expected_source_revision` 匹配，且 Source 未 tombstone。租约过期的旧 worker 即使返回成功也不得覆盖新结果。

本地业务变更、ToolCall receipt 和相关 Event 尽量在同一 SQLite 事务提交；已有 Event 表可承担待发送事件日志，不为名字另造消息中间件。UI 按持久 sequence 恢复，窗口有界；发现缺口则重新读取状态。实时 token 增量可以走独立流，不强行每 token 落库。

取消分“发出请求/观察到取消/本地提交是否已发生/远端结果是否已知”，而非单一布尔。runtime 和数据库枚举统一表达 interrupted/unknown；它们不占运行锁，也不能当作成功。新增用例：提交前崩溃、提交后通知前崩溃、取消与提交竞态、过期 worker 迟到、重放与队列溢出。

### 4.5 Message 修订与序列（补原 §10）

保留会话内递增 sequence：编辑创建新 Message 行、新 sequence，通过 supersedes_id 指向旧行；旧引用仍指向旧不可变内容。若 UI 需要同一逻辑消息身份，使用单独 logical_message_id，不能复用违反 UNIQUE(conversation,sequence) 的序号。迁移先保留旧顺序，不在迁移时重写文本。

### 4.6 worker 的真实隔离（落实原 §5/§20）

utilityProcess/普通 Python 子进程是故障边界，不天然阻止读文件或联网。M5 必须选择并验证 Windows 约束：Job Object 管资源/子进程生命周期；文件和网络限制需另外可强制实施的机制，例如受限令牌/AppContainer 的可行实现。选型先验证解析依赖兼容性，不先承诺某个机制必可用。

负面测试读取作业根外 canary、junction 逃逸、出网、子进程、超内存/超时、DOCX 解压炸弹。普通文件路径检查和 API hook 不能冒充 OS 安全沙箱。未能实施隔离时，阶段报告必须给出能力限制，不能放行“处理任意不可信文件”的承诺。

## 5. 算法与数据结构的最小演进路线

### 5.1 文档三种文本，分别承担职责

`source_text` 是可定位的不可变解析文本及 Block/locator；`index_text` 可附加标题路径、表头和必要上下文；`prompt_text` 是当前问题选择出的证据片段。三者各自有版本/哈希和映射，索引增强文本不能伪装成原文 quote。

沿用原 200–400 token、最大 512 的切块起点，按标题/段落/表格行分块，超过预算再切，过小同级片段在预算内合并；标题和表头计入 embedding token 预算。扫描、表格、代码和混合中英单独报告。凡合成的标题/摘要只作索引辅助，不能直接成为用户经历事实。参考 R4；这是方案选择，尚非实测最优值。

### 5.2 检索以可解释基线起步

先完成中文分词/字符补充、字段权重与 exact ID 查询，再比较 FTS、dense、RRF；无 embedding 模型时 FTS 完整可用。ACL/scope/当前版本/asOf 在候选截断前约束，返回与引用生成时再检查一次。缓存 key 包含 scope 和授权/内容/索引版本，撤权立即失效。

RRF 用排名而非不同模型的原始分数混加。原 k=4 是小 pilot 候选，不改写为最优；仅在 tune 集做小网格（如 k=4/20/60，候选深度20/60），validation 固定配置，sealed 只作锁定配置验收。默认保持原 top60 起点；这个网格是新增实验提案，未运行。先验证纯检索，再固定生成器验证回答；否则无法判断收益来自哪一层。

reranker 只有在基础召回已达标、错误分析显示排序是主要瓶颈时进入；沿用原 250ms 超时降级约束。图检索只有多跳错误确有足够样本、简单 parent expansion 无法解决时做离线试验，不给每个用户强加图构建成本。参考 P1/P2/P7，保留 R6 的版本/ABI 风险。

### 5.3 可回答性先于自信输出

检索相关性、证据是否足够、证据是否支持输出、事实是否真实分别记录。参考 P5，把日期、对象、数值口径和必要来源缺失显式化；结构化任务优先确定性校验，自由问题可用经过校准的模型辅助分类 `sufficient / insufficient / conflicting / unknown`。

缺证据只允许有上限的定向补检（首版建议最多一次，仍受原 multi-query 上限约束），不能无界 agentic RAG。仍不足时说明缺什么或请求澄清；冲突并列展示来源与时间，不静默选一条。分类器也可能错，须测回答覆盖率、正确拒答与错误拒答，防止靠全部拒答获得漂亮安全指标。无需默认增加一个大型在线 judge。

### 5.4 引用覆盖与支持分开

先验证 locator/权限/版本/quote hash，再验证关键断言的语义支持；有链接只通过第一层。参考 P3，将需要证据的断言拆为可审核单元，分别报告引用支持 precision 与有充分证据覆盖的断言比例；数值、时间、否定与个人经历必须专项检查。

原 citation precision≥.98 等硬门槛保留。覆盖率作为新增正式报告项，阈值需在标注指南和验证集冻结时确定，不能看到 sealed 结果再选。抽象建议和明确标示的推断与事实陈述分别计分；不能为提高覆盖率编造引文。

### 5.5 记忆先解决更新与撤回，再探索多粒度

权威仍是原事实链与用户确认的 Memory。先用 P6 的五类任务建立领域测试，增加否定、转述、第三方指令、偏好变化、相同内容不同有效期、删除/撤权传播。

可选实验仅增加索引视图：原始 turn、session、可回溯摘要三种粒度。摘要保存 source IDs、生成器/prompt revision、失效条件，不升格为 active Memory；确认后的事实也不能靠新摘要静默覆盖。用“单粒度”与“多粒度但同 token 预算”比较准确率、证据覆盖、延迟、内存及生成成本。

P8 的复杂关联/选择算法和 P7 的图检索属于研究候选。首轮多粒度若无可复现收益就停，不追加复杂 router 来挽救假设。MemGAS 作者实现的可选全局检索和自动保存默认值不能直接沿用到 FetchCV scope/确认合同。

### 5.6 上下文优化分两次交付

M2/M3 先交硬预算、完整 tool-call/result 组、当前用户输入保留和明确 overflow。M8 才做相关性、时效、去重和来源多样性的选择优化；首先实现可审计的预算内贪心选择基线，不先引入复杂优化器。

必须项先预留：system/策略/schema/输出/safety、当前输入、尚未完成的工具组。可选证据再按任务价值与成本选择，保存采用/拒绝原因和 ContextManifest。摘要失败可降级为更少历史，但不能截断 JSON、拆散工具组或将摘要转长期记忆。参考 P4，做同一证据在前/中/后的位置扰动；结果决定排序策略，不把旧论文结论当新模型定律。

## 6. 修订后的阶段执行卡

每阶段开始前冻结：输入版本、精确文件 allowlist、数据访问范围、测试清单、基线与回退材料。下表路径是工作落点，真正实施时按原 §16 与现有调用关系收窄到文件；不为“目录整洁”先整体改名。新的 Node SQLite 驱动会影响打包，必须补原生模块/资源打包证明，不能只在系统 Node 下测试。

| 阶段 | 改动与交付 | 验收与停止条件 | 回退 | 原设计/研究依据 |
|---|---|---|---|---|
| M1 收口 | 冻结现有 requirements、M1 工具和报告；整理待提交文件，记录审计限定 | 核验已有证据哈希/受保护清单；不重跑覆盖旧基线；未知文件不得自动暂存 | 旧 env/installer/隔离副本；禁止 git clean/reset-hard | §15/22；M1 实施报告 |
| M2a 只读盘点 | `docs/`：loop 入口、工具能力、消费者、历史数据/队列依赖、文件/行号；标注何时移除旧入口 | 每项必需能力有现有证据和迁移归属；确认无业务写入 | 文档可独立撤回，不触产品 | §3/6/17/22 |
| M2b 单 loop | 按能力矩阵迁移 Pi adapters/tools；最低批准/目标/取消/预算语义；完成后一次切换旧 loop 入口 | 单一 loop；conversation/task/cancel/approval；旧历史可读；旧队列不自动发送；任一必要能力缺失则不切 | 回完整上一版；不在同版启动隐藏旧 loop | §6/17/22 |
| M3 runtime | `packages/contracts`、`packages/app` 与必要 Electron/preload 接点；统一 RPC、附件/quote、事件、错误状态、invocation 合同 | fake/real Pi 同合同；scope/target/revision 反例；取消竞态/事件缺口；越权即停 | 整体协议版本回退；保存通用记录与新的失败状态 | §5/6/18/20；R1 |
| M4a 存储可行性 | `packages/storage` 与仅用合成数据的 spike：实际 Electron utility 中选 SQLite driver，测 FTS/WAL/备份/可选扩展 | unpacked/NSIS 内可加载、无第二写者；记录 Electron/Node ABI/SQLite compile options；无法打包就先不迁 DB | 隔离实验库，保持旧产品 | §5/10/15；R6 |
| M4b 副本迁移 | schema、25 表字段映射、秘密脱敏、归档与 identity 决策；只转换一致性副本 | FK/integrity/hash/count 与业务关系检查；每旧行可找；新库 secret 扫描；任一映射不明则停 | 丢弃只表示不采纳此实验结果；实际文件仍按用户规则保留/隔离 | §10/20；R2/R3 |
| M4c 权威切换 | 停写→一致性备份→最终增量/重建→校验→原子切 manifest→APP 唯一写者；旧库只读 | 在每个边界注入崩溃；旧版不能误开新库；新写入后恢复演练；不通过不切用户库 | 前版+一致性旧快照；V2 增量包在兼容恢复工具中可读/恢复，禁止静默丢失 | §10/22；R2/R3 |
| M4d 来源可用 | Source/Document/Block 的最小 reader、旧历史 adapter 和 missing/tombstone 展示；必要 UI 可提前 | 能打开旧简历与来源、定位到不可变版本；跨 scope 和已撤权不可读 | 回既有 reader；继续 APP 唯一写入 | §7/10/13；R2 |
| M5 ingestion | `workers/parser`、APP job 调度、IR、三种文本映射、fencing、可选 OCR；现有解析器先行 | golden 解析/表格/定位；重复/取消/迟到/崩溃；OS 隔离负面测试；未达条件标 needs_review | 禁新任务、保留 captured 原件和旧版本；回旧 parser revision | §5/7/20；R4/R5 |
| M6 retrieval | `packages/app` 检索、storage 索引与 generation；最小搜索 UI；FTS→dense/RRF→可选重排 | 原 §21 检索 gate + 权限/时效；成对对照与置信区间；质量提升未证实则不默认 hybrid | generation 指针回退/只用 FTS；来源与事实不回滚 | §9/21；P1/P2/P5 |
| M7 memory | APP memory 命令、确认/冲突/时效、可查看来源的最小 UI；多粒度为独立实验 | 原 precision/secret/撤权 gate + 五类记忆任务；摘要不得自动确认；实验失败不阻塞基础记忆 | 关闭记忆读取；保留候选、确认与撤回记录可导出 | §8/21；P6；P7/P8 可选 |
| M8 context | assembly、ContextManifest、引用验证、原子工具组、预算选择；替换旧字符裁剪 | 8k/32k/长工具/附件/位置扰动/冲突/无答案；引用支持与覆盖分别报告 | 回 M3 基础 assembly，继续保留硬预算和合法消息结构 | §18/21；P3/P4/P5 |
| M9 UI/extension | 完整对象导航/diff/activity/memory；声明式扩展、MCP 信任/撤权 | 端到端求职闭环、键盘/窄窗、旧 Artifact 可开；schema 变化使旧批准失效 | 回旧导航/reader；数据库唯一写入者不变 | §11/12/13/20 |
| M10 发布 | 可选能力包、签名/更新、SBOM、包体与启动、升级/回退 | 原全 gate；installer≤130MiB、unpacked≤380MiB；固定机器≥30次；实际签名和失败更新演练 | 前版 installer +兼容 DB 快照 +可恢复 V2 新数据 | §14/15/21/22；R3 |

M2a 与 M4a 的只读设计/合成 spike 可以在获得相应实现授权后交错开展；**生产写入权威切换依然只在 M4c**。不允许以并行工作为由同时运行两个生产 loop 或两个 DB 写者。

## 7. 验收命令与证据合同

### 7.1 现有可用检查（本次没有执行下列测试）

下面采用已存在入口，进入实施阶段时通过已验收的边界工具在全新目录运行。不要直接 `npm run verify` 或 `npm run backend:test`：现有脚本使用固定项目内 basetemp，pytest 会在开始时递归清空它。

```powershell
# 先核验恢复根；不存在立即停止，不回退 %TEMP%
$project = 'D:\hesan\Desktop\VSCODES\FetchCV_Windows'
$stable = 'D:\hesan\Desktop\VSCODES\FetchCV_M1_work\20260910-235136'
if (-not (Test-Path -LiteralPath $stable -PathType Container)) { throw '稳定工作根不存在' }
git -c safe.directory=D:/hesan/Desktop/VSCODES/FetchCV_Windows -C $project diff --check
git -c safe.directory=D:/hesan/Desktop/VSCODES/FetchCV_Windows -C $project diff --stat
```

现有回归入口为 `scripts/m1/run-python-baseline.py`、`scripts/m1/run-guarded-node.mjs`、`tests/packaged.e2e.mjs`，具体启动参数沿用已通过的 M1 运行清单，包括 FETCHCV_PYTHON、TEMP/TMP、测试 DB、PWTEST_SERVER_REGISTRY、PLAYWRIGHT_BROWSERS_PATH 等。每次生成新 label/root，拒绝复用已存在的 pytest basetemp。保留正常 stdout、stderr 和真实 exit code；非零绝不靠汇总脚本改成成功。

### 7.2 拟新增阶段验收文件与命令合同

下列路径/命令是**拟实现的测试合同，目前未创建、未运行**。它们应调用真实模块并包含失败注入，不能只验证 mock 自述。通过当前已验收 runner 执行，不另造一整套通用编排框架。

| 阶段 | 拟执行测试命令（经 guard 包装） | 必须写出的材料 |
|---|---|---|
| M2/M3 | `node --test tests/v2/runtime-contract.test.mjs tests/v2/loop-parity.test.mjs` | 工具能力矩阵、入口扫描、fake/real 对照、取消/批准/附件结果 |
| M4a | `node tests/v2/packaged-storage.e2e.mjs --run-root <fresh-root>` | Electron 内真实 driver/ABI/FTS/backup/扩展结果、installer 文件清单 |
| M4b–d | `node --test tests/v2/migration.test.mjs tests/v2/restore.test.mjs` | 25 表映射、秘密脱敏、SQL 检查、逐行去向、新写入恢复、崩溃矩阵 |
| M5 | `node --test tests/v2/ingestion.test.mjs tests/v2/parser-boundary.test.mjs` | IR/定位 golden、资源限额、fencing 及越界访问结果 |
| M6 | `node scripts/v2/evaluate-retrieval.mjs --manifest <frozen-eval.json> --output <new-jsonl>` | 每 query 排名、必要证据覆盖、scope/asOf、延迟、配置、配对差值和区间 |
| M7/M8 | `node scripts/v2/evaluate-grounding.mjs --manifest <frozen-eval.json> --output <new-jsonl>` | 记忆五类分项、引用支持/覆盖、拒答/覆盖率、token 与位置扰动 |
| M9/M10 | `node tests/v2/journey.e2e.mjs`；`node tests/v2/upgrade-rollback.e2e.mjs` | 新装/升级/回退/离线/坏 DB/worker 不可用、签名/包体/≥30次启动 |

每条 receipt 至少记录 argv/cwd、源代码 commit/dirty diff hash、输入 manifest hash、受保护范围、运行环境、开始结束时间、真实退出码、断言数、通过/失败/跳过、日志路径、修改/删除审计覆盖范围。敏感 env 仅记录“存在/引用标识”，不记录值。受保护数据不进入公开 CI。

PowerShell 输出对象统一使用 `[pscustomobject]`；字典集合先显式枚举后计算，禁止依赖 OrderedDictionary 的隐式属性绑定。JSON schema 校验必须拒绝意外 null、空分类键、缺失计数。成功删除 API 次数、去重路径、文件数、目录数分别记录；遇见审计覆盖缺口如实写 unknown。

### 7.3 不再让验收工具无限扩大任务

沿用已经通过的 descriptor 捕获与 watcher 版本并锁定哈希。FS notification 是变更线索；atime 不等同写入，事件 ID 不等于唯一事件。修改工具只针对已复现缺陷，加最小合成回归；工具验收与产品验收计数分开。不能通过删断言/扩大白名单让业务过关，也不要求在每次产品运行前重建全套工具框架。

若需要证明 native 删除完整性，先确定覆盖能力与成本，再启用相应 OS 级观测；没有足够证据就保留审计限定。受控合成目录与已授权临时删除范围仍是执行边界。

## 8. 质量实验的冻结方式

保留原 §21 的 60 份六类来源、400 query（200 tune/100 validation/100 sealed）、100 对话序列、20% 双标与仲裁。按 Source 家族划分，避免同原件的改写/新版本跨集合泄漏。新增来源类型、算法和模型需记录 revision，不用线上真实履历填公共样本。

| 实验 | 对照 | 主要读数 | 通过后才允许的变化 |
|---|---|---|---|
| E1 切块 | 固定长度 vs 结构+标题/表头上下文 | 原文定位合法率、关键事实/单元格、检索与 token 成本 | 更换 chunker revision 并重建新 generation |
| E2 检索 | FTS vs dense vs RRF；只在必要时加 rerank | 原 recall@20/nDCG@10、中文/英文/混合/数字/否定/多跳分项、p95/RSS | 达到原 gate 且关键分层无伤害才推荐 hybrid |
| E3 可回答性 | 直接生成 vs 有上限补检+拒答 | 有答案正确率、无答案正确拒答≥.95、错误拒答、回答覆盖率、无据数字=0 | 确认收益后启用策略，不能靠全拒答过关 |
| E4 记忆 | 原始 turn/session 单粒度 vs 多粒度索引 | 五类能力、active precision≥.99、撤权100%、secret=0、延迟/成本 | 只改变候选检索，不改变确认权限 |
| E5 上下文 | 基础合法 assembly vs 预算选择；前/中/后位置扰动 | 完整工具组、overflow、事实≥.98、citation precision≥.98、覆盖率 | 换 assembly revision；保留可回退基础实现 |
| E6 图关联（后置） | 最佳简单检索 vs 图/关联实验 | 预定义多跳子集收益、全局退化、构建/查询成本 | 独立能力开关；无收益直接结束实验 |

置信区间应按 Source 家族/对话簇做配对重采样，避免把同源改写当独立样本。对照固定生成模型、prompt、token 预算、模型与索引版本；额外调用、下载、构建时间都计成本。报告点估计、分母、区间和失败案例，不把小样本的 0 次错误解释成“生产零风险”。100 个 sealed query 不足以给所有语言/格式细分都提供强统计保证，样本不足应显示不足。

sealed 不参与持续调参。首次验收失败后若根据错误调整算法，原集合转为已知回归集；下一次最终泛化声明需新增独立 sealed 集。模型变更做原集合回归仍有价值，但不再假称它始终未见。

## 9. 磁盘、备份、回退和停止规则

在稳定根下每阶段新建命名目录，启动时记录绝对路径与存在性；恢复发现根丢失立即停，不回退系统 TEMP。项目外操作仅限已经授权的 `D:\hesan\Desktop\VSCODES\FetchCV_M1_work\<运行ID>\` 范围；新的运行根须列入具体阶段清单。

构建预估峰值至少分别列出：旧环境/旧包保留、源暂存副本、物理 node_modules、sidecar 中间目录、unpacked、压缩 installer、DB/blob 副本、缓存和证据。测当前空闲空间，再根据上一轮实测峰值加明确安全余量；没有峰值实测就先小规模测量，不宣称某个固定 GB 一定够。禁止用 junction 指向受保护 node_modules 来节省空间后仍允许构建写入。

原件默认只隔离；任何真实删除按用户批准范围执行并记录路径与数量。非批准范围删除、不可读/ACL 阻塞、包依赖修改而不能证明 NSIS 可用时立即停。需要用 package 脚本更新固定 basetemp 时，作为独立文件变更出 diff 并保留同等构建行为，不混入算法改造。

M4 切换前旧库保留一致性快照和 blob manifest；切换后新写数据保留带 schema/应用版本的恢复包、源版本及引用关系。恢复测试包含升级后新增/编辑/撤回操作，验证在兼容恢复工具内可见；无法反向映射的 V2 实体应明确说明如何查看和再次迁入，不承诺旧版本原生支持它。运行旧版本前必须确认它只指向兼容旧库。备份保留期与擦除权另按原 §20 执行，本提案不授权删除真实备份。

## 10. 下一项工作建议

下一项优先是 **M2a 只读能力矩阵 + M3 最小合同草案 + M4a 驱动可行性测试设计**，先暴露迁移缺口，不立即删旧 loop 或搬数据库。

这项交付应包含：每个 loop/工具的入口和调用者文件行号、必需能力/用户可见行为、历史队列处置、取消/批准/目标版本语义、需要迁移的最小文件集、测试夹具清单和预估包体影响。M4a 初次实现只用合成库与打包副本。

在进入实际 M2+ 代码变更前，基于这些材料给出精确执行清单并沿用用户批准流程。本轮研究文件是供该决策审阅的具体方案；没有新安装、迁移、模型下载、真实数据改写或 M2+ 验收通过声明。
