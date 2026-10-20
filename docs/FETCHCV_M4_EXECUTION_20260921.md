# M4 执行与门槛

2026-09-21。依据原设计 §10/§22 及 R2 的 M4a–M4d；用户已授权继续 M3 等后续流程。采用 migration / incremental implementation 技能的逐增量验证方法，不切换未通过门槛的存储。

## 回退基线

M3 源码提交 `9f69417`，归档 `.m1-work/m4a-20260921-01/m3-baseline.zip`，SHA256 `fc7ff580d9a5704774de26604f63a8b0e80dbda5b4421d3e7d968ed08561d32a`。原数据库、旧环境、安装包、真实素材继续保留。Git 不保护被忽略的真实数据。本阶段每次测试使用稳定根 `D:\hesan\Desktop\VSCODES\FetchCV_M1_work\20260910-235136` 下新建目录；根缺失不回退 TEMP。

## M4a：实际运行时可行性，已实测

合成程序与原始失败副本：`.m1-work/m4a-20260921-01/`；汇总 `.m1-evidence/m4a-results.json`，各次 stdout、exit、文件监视和删除收据以同名 label 保存。

| 运行 | 结果 |
|---|---|
| m4a-sqlite-01 | 失败：Electron 在创建 Node 环境时 native assert，退出 134，尚未产生测试库；保留现场 |
| m4a-sqlite-02 | 开发态 Electron utility 通过 WAL、外键、FTS5、事务回滚、在线 backup、只读备份与完整性检查 |
| m4a-packaged-01 | electron-builder NSIS 构建通过；win-unpacked 应用内 utility 同样通过，app.isPackaged=true |
| m4a-nsis-01 | 解出实际 NSIS 内 77 个文件，app.asar 哈希与 win-unpacked 一致；解包所得应用内 utility 同样通过 |

实际 Electron 43.1.1、utility Node 24.18.0、SQLite 3.53.1。使用 `node:sqlite`，未增加原生 addon 或修改 package.json / lockfile。扩展加载保持默认关闭，可选向量扩展尚未测试。

首次 native assert 后，Electron 子进程不继承 NODE_OPTIONS / ELECTRON_RUN_AS_NODE；app 与 utility 脚本第一行仍显式加载既有删除守卫，外层文件监视及批准根不变。两个环境变量同时改变，不能断言其中某一个已被独立证明为唯一原因。

NSIS 合成安装包 99,579,306 B，实测 Authenticode=NotSigned（builder 的 signing 日志不是已签名证明）。7-Zip 检出附加尾数据警告，但退出 0、解出文件及内容核验通过。这里验证的是安装包内载荷加载，不是执行安装向导、注册表/快捷方式或升级回退；正式发布验收留在 M10。没有安装这个合成程序。

原生 SQLite、Electron 与构建器的删除覆盖并非完整；记录的是 JS API 收据与文件监视观察，不声称所有 native 删除都被 API guard 截获。所有测试数据均在本次合成根。

## M4b：副本转换，进行中

1. `packages/storage/snapshot.mjs`：只读打开来源，通过 SQLite backup API 包含已提交 WAL；新建独占目的目录，拒绝覆盖、缺失稳定根、未知/缺失旧表；验证完整性与 FK，再记录 25 表计数。目标原始快照仍含个人数据/秘密，必须放受保护恢复区，不能当普通归档或打包资源。
2. `legacy-archive.mjs` / `legacy-redaction.mjs`：25 表逐行脱敏归档、完整归档去向、JSON 与大整数保真、逐表计数/脱敏行 hash。先全库发现已知凭据，再输出任何行；凭据替换成随机引用，不写秘密的独立 hash。MCP 自由启动字符串只保留于受保护快照，普通归档里要求重审。归档阶段拒绝带未合入 WAL 的 live DB、未知表、重复目录、坏 JSON；失败副本保留。
3. `schema.mjs` / `core-migration.mjs`：首批 Workspace/Candidate/Job/Conversation/AgentRun/Message/Event 表及候选人、岗位、运行、历史/队列消息转换。复合 FK 绑定 workspace 和 candidate/job；每会话最多一个运行中 run；消息内容只追加修订。历史中间态转 interrupted，队列保留原序号与 `automaticDelivery=false`；全部输入先验 hash。跨 scope 错误时 schema 与领域写入整体回滚，归档不丢。
4. `source-migration.mjs` / `source-schema.mjs` / `blob-store.mjs`：素材、JD、面试来源转 Source/Document；相同 URI 在不同 candidate/job 下仍为不同 Source。正文捕获为不可变 blob，偏移采用 Unicode code point；原件只在宿主明确授予的目录内读取，路径不作为知识。捕获二进制不等于已解析全文，缺失/未授权原件不会伪造 hash 或 Block。blob SHA256 在写入、复用和读取时校验；限制 50 MiB，实际超限会失败，不截断。
5. `content-migration.mjs`：事实、经历、岗位要求转 KnowledgeItem，保留旧 verified 的确认依据；所有 confidence 的语义支持仍为 unknown。按 candidate/job 分组保留每个简历/作品集/面试版本。父版本先分配 ID，再解析关联，支持父版本排序较晚；拒绝循环和跨候选人/不兼容岗位关联。同 Artifact 使用 based_on FK，跨 Artifact 的 base resume / portfolio 来源放不可变 lineage 引用并复核。建议保存为未应用 draft patch，不替换 current version、不执行旧批准。
6. `operation-migration.mjs` / `operation-schema.mjs`：ToolCall 的 running/unknown 保持 unknown，其余非终态 interrupted；旧批准只有在同 run、精确 operation 匹配时才挂接 ToolCall，已批准也转 expired。无法绑定的批准保留 LegacyArchive + Event + MigrationIssue，不捏造调用。任务、投递、步骤、队列、上下文和评估记录生成带归档引用的 Event，摘要不升级为 Memory。
7. `ingest-lease.mjs`：条件更新领取 lease，绑定 owner/attempt/source revision，晚到 worker、过期 lease、已变更来源、重复完成不能提交。此处只实现状态原语；M5 仍须在 APP 同一事务中配对解析结果写入，不能据此声称已有隔离 parser。
8. `config-migration.mjs`：非秘密设置保留，credential refs 待重新输入/审核；MCP 不转移旧权限，默认 requires_review / executable=false；技能只有实际捕获内容才重算 body/manifest hash，全部 enabled=0。可选凭据封存见下节；没有构造 ExtensionInstall 信任记录或激活旧凭据。
9. `prepare-workspace.mjs` / `migration-validation.mjs`：快照→脱敏归档→领域投影→校验串为一个离线流程。投影阶段在外层事务内，计数对照一致性快照；逐行去向、目标存在、FK/integrity、内容 hash、blob、Block 范围、版本 lineage、技能 manifest 校验通过后才提交。失败保留副本与失败报告；回滚/报告写入本身失败也保留原错误，不冒充成功。永不创建 active manifest，返回 activationAllowed=false。

首个合成快照测试 `m4b-snapshot-01` 通过：25 表齐备、两条提交中的 WAL 记录包含在一致性快照、源 .db 字节不改写、重复目的目录/未知表/缺根拒绝。不是实际用户库迁移验收。

此前完整 Node 回归 `m4b-node-all-01` 为 132/132、`-02` 为 142/142、`-03` 为 145/145；凭据封存接入后的最终 `.m1-evidence/m4b-node-all-04-node.log` 为 **148 passed / 0 failed / 0 skipped，94.708 s**，guard run_verdict.success=true，sidecar 启停成功。现有 storage 用例 25 项；ESLint 与 git diff --check 通过。Python 业务代码本轮未改，沿用 `m3-python-all-02.xml` 的 165 passed / 2 skipped，未重跑也未将其说成本轮实测。

`tests/fixtures/create-v1-storage.py` 使用项目实际 SQLAlchemy 模型产生合成库，全部 25 表有记录，共 27 行；不是只有同名空表。正常样本迁入 2 个 Candidate、1 个 Job、1 个 Conversation、1 个 interrupted AgentRun、3 条 Message；原 metadata、同时间戳 id 顺序和旧队列序号保留。故意破坏候选人归属的另一个样本被新库 FK 拒绝，领域 schema 回滚后仍有完整 27 行 LegacyArchive。fixture 的 Python 删除/移动审计为零；SQLite native 覆盖仍保留上文限制。

本轮完整流水线使用同一实际模型 fixture：25 表、27 行；输出 2 Candidate、1 Job、1 Conversation、1 interrupted AgentRun、3 Message、3 Source、3 Document、2 Block、3 KnowledgeItem、3 Artifact、4 ArtifactVersion。一个原件缺失、一个技能未获文件访问，一个批准无法精确绑定；均明确记录，没有补造。完整有效合成副本位于稳定根的 `m4b-node-all-02/workspace-copy/new-workspaces/run1/`，报告 `projection-report.json`。`archive-report.json` 的 domainConverted=false 表示归档阶段状态，不是后续投影报告；激活门槛始终未放行。

额外故障验证：`m4b-copy-02` 4/4，最终全量也包含同样用例。配置阶段以目录冒充技能文件，整个领域 schema 和写入回滚，27 行归档与源库字节保留、无成功报告；失败现场在稳定根 `m4b-node-all-02/workspace-copy-failure/new-workspaces/failed/`。篡改 MigrationMap 的测试拒绝无效目标。早期 `m4b-copy-01` 在成功后故意篡改了同一个副本，不能作为完整有效副本交付；后两轮改为另复制 `tampered-copy.db` 做破坏测试，成功原副本保持有效。

**M4b 尚未整体验收**：结构转换已有完整逐行去向，引用恢复见下节；缺少引句/答案区间的旧引用保持明确的未解析或仅关联状态。真实库中的未知历史结构、凭据分类/安全存储、真实素材范围和秘密扫描尚未验收。报告明确列出 evidence_reference_resolution、credential_resolution、single_writer_cutover、crash_and_new_data_rollback 四个未过门槛，不声称 M4 完成。引用门槛此时代表实际旧库未解析清单的审核，不再代表尚无引用迁移实现。

原设计约束落实时两项显式细化：缺失/未授权/失败 Document 允许 blob_hash=NULL；ready/captured 仍必须有真实 hash，解决原设计“blob_hash 必填”与 missing_file 状态的冲突。缺失技能仅 enabled=0 时允许 body/manifest hash=NULL，不采用旧 claimed hash 代替。R2 已批准的 ToolCall invocation_id 去重替代 operation_hash 全局唯一。配置 install_id 暂不接尚未实现的 ExtensionInstall，不能用于授权。

代码增量提交：`3bc8ba0` 来源/blob/reader，`3729f3d` 知识和版本，`2848ba6` 操作/配置/lease，`29a1ce3` 完整副本流水线、lineage 与历史适配器。结果汇总 `.m1-evidence/m4b-domain-results-20260921.json` 含 9 次运行的 exit SHA256、临时根和删除记录；这 9 次 Node 删除 API 收据均为 0。文件监视无越界通知，不等于原生 SQLite/子进程所有删除均被 API 守卫覆盖。

脱敏用例证明的是已知字段/模式/显式凭据字面量，不证明任意自由文本不存在未知秘密。凭据分类审核、用户账户下的正式存储部署和真实库秘密扫描仍是激活门槛；默认未传 vault 时随机引用仍需重新输入/审核，可选封存仅表示密文已保存待审。原始文件 hash 只属于受保护快照元数据，普通归档使用脱敏语义 hash。当前没有处理真实用户数据。

## 引用迁移增量（6cba28e）

依据原设计 §10 的可解析 Evidence/Citation、不可解析记录保留要求。源码核对：`resume_pdf/importer.py:689` 保存 path#sha256，`legacy_resume/importer.py:238,266` 保存旧 version/section/item；`application_tools.py:31,96` 的 JD evidence 为原文引句；`interview_tools.py:1294–1313` 保存 source IDs，不提供答案字符区间。迁移不能自行补造这些区间。

新增 `reference-migration.mjs`、`reference-schema.mjs`、`reference-validation.mjs`、`quote-locator.mjs`：

- 岗位要求在同 candidate/job 的不可变 JD 正文中精确且唯一出现时，建立 EvidenceLink，记录 Document/text hash、Block、Unicode code point 范围与 quote hash；relation 固定 context，semanticSupport 仍 unknown。重复、大小写不同、缺失文本不会模糊猜测。
- facts 的 path#sha256 只用于匹配已有 material 映射并核对实际捕获 hash，不按引用路径重新读取任意文件。二进制 captured 尚无 parser text 时保留 document_text_unavailable；旧 version/section/item 当前为 unsupported_source_reference，原串仍在归档。
- 经历原件关系、简历/建议 fact IDs、建议 JD 引句、面试简报及问题 source IDs，每项生成 MigrationReference，记录旧表/行/字段位置、目标及具体结果。候选人个人事实可关联其岗位 Artifact；不同候选人或不同岗位来源不跨 scope。缺失引用不丢，也不自动授权共享。
- 仅有来源关系或源引句、没有答案区间时保持 reference_only，**没有生成 Citation**。旧版本 JSON 中的 legacy_unresolved 是迁移前信息状态；独立 MigrationReference 记录本轮解析结果，不改写不可变版本内容。
- DB 复合 FK/触发器约束证据位置和归属；复核器重新读 blob、核 quote hash/文本范围、旧行到 owner 的 MigrationMap、引用目标 scope 及证据回执绑定。M4 的 EvidenceLink 仅允许 block/text 引用，chunk_id/message_id 必须 NULL；M5/后续显式迁移后才能扩展，不能绕过尚未实现的 Chunk 约束。

实测：`m4b-references-01` 1/1；`-02` 1 通过/1 失败，原因为新增合成 fixture 误写不存在的 facts.confidence 列，尚未执行引用转换；按实际模型列修正后 `-03` 2/2；流水线接入后 `-04` 5/5；最终全量 `m4b-node-all-03` 145/145。失败现场原样保留。新增末阶段失败注入：旧 fact_ids 含数字，references 阶段拒绝并回滚所有领域表，27 行原归档与原库字节保留。

默认 27 行 fixture 的结果是 reference_only=3 / unresolved=2 / EvidenceLink=0，原因逐条为缺 source_reference、JD 无引句、事实关系缺答案区间、素材关系缺引句、面试来源缺引句及答案区间；没有把这个样本宣传成全部引用已解决。另一专门合成样本验证 1 条含 emoji 的有效 EvidenceLink、跨 scope 拒绝、重复引句、源 hash 不符、quote hash 篡改和实际原件内容保留。

本轮完整有效合成副本：稳定根 `m4b-node-all-03/workspace-copy/new-workspaces/run1/`。汇总 `.m1-evidence/m4b-reference-results-20260921.json` 保存各运行退出记录 hash、路径、失败原因及引用阶段结果。5 次运行的 Node 删除 API 收据均为 0；守卫没有越界通知；native 覆盖限制不变。未改依赖、安装包、旧环境、实际用户库或真实素材。

## 凭据封存增量（a1192a2）

修复 `legacy-redaction.mjs` 的引用损坏边界：原实现可能在字面量替换时再次替换刚生成的 `credential-ref`（尤其短秘密或与引用前缀相同的字面量）。现在保护本轮已生成的引用及 URL 编码形式，已知秘密以一次匹配替换，替换结果不递归再处理。回归覆盖普通文本、Bearer 模式与 URL token。

新增 `credential-vault.mjs`，宿主在 Electron app ready 后传入现有 safeStorage；没有引入依赖、没有自制生产密码算法。root 必须是宿主选择的已有绝对目录，拒绝符号链接根/对象和路径穿越。加密 envelope 绑定 schemaVersion、workspaceId、随机 vaultId、随机 reference；每次新建密文文件，独占写入、fsync、读回验证，不覆盖或删除原文件。结果只返回 ID/计数/状态，不返回秘密或秘密 hash。加密不可用、Linux basic_text 后端、解密失败、错误归属、未知 reference、篡改密文均拒绝；加解密错误不转发可能包含秘密的底层 message/cause。明文 envelope 限 16 MiB；JS 字符串生命周期结束依赖 GC，不声称能够可靠内存归零。文件路径检查也不是 OS capability 隔离证明。

`prepareLegacyArchive` / `prepareWorkspaceCopy` 接受可选宿主 CredentialVault。原值只在脱敏器内存中短暂保留，封存后清空容器；凭据候选及被隐藏的 MCP 自由启动字段均保留在密文，状态 sealed_pending_review。封存失败则归档不报告成功，原恢复快照与失败现场保留；后续领域投影失败时已有密文保留为未激活恢复材料。不传 vault 的默认行为保持 requires_reentry_or_review。配置阶段 credentialsInstalled=false 仍是正确表述：没有安装为可执行 provider/MCP 授权，没有 renderer 查询入口，也没有切换实际用户设置。真实旧库的凭据分类审核仍必需。

实测与证据：

- `m4b-credentials-01`：3/3 脱敏回归；`-02`：1/1 vault 合同；`-03`：8/8 归档/凭据联动。Node 测试采用 AES-GCM 替身，明确不将其说成 DPAPI 证明；已测试所有归档 redaction reference 可从同一密文恢复、普通设置不含合成秘密、加密不可用无成功 projection 报告。
- `tests/credential-vault.e2e.mjs` 显式运行实际 Electron 43.1.1：create 进程结束，再启动 recover 进程读取同一合成密文，均检查跨 workspace 拒绝和磁盘中不含合成明文。`m4b-credentials-electron-01` 在 CodexSandboxOffline 上通过；日志出现 GPU 子进程退出 -1073741515，但两项凭据验证、进程和 guard 均退出 0，异常原样保留。
- `m4b-credentials-electron-02` 经审批在实际用户 **hesan** 上运行，两个进程各自报告 account=hesan / success=true / encryptionAvailable=true / recovered=true，退出 0；没有前述 GPU 日志。实际项目 APPDATA、真实凭据均未读取。此项为开发态 Electron 验证，不是新的 packaged/安装器凭据验收；不证明跨 Windows 用户或跨机器恢复，正式加密必须由实际运行 FetchCV 的账户完成。
- 最终 `m4b-node-all-04` 148/148。第一次发起该命令时自动审批服务连接中断，审核未完成、命令未执行；同一授权命令再次提交审批后成功执行，没有绕过检查。

汇总 `.m1-evidence/m4b-credential-results-20260921.json` 含 6 次运行、exit hash、hesan 的两个实际 Electron 报告、异常说明。6 次 Node 删除 API 收据均为 0，文件监视无越界通知；native 覆盖限制不变。本阶段所有密文/快照均为合成数据。原项目所有权仍属 CodexSandboxOffline 的环境问题未处理。

## M4c 切换与恢复原语、M4d reader 修复

代码提交 `27f0d67`、`49cf8ee`、`09bc93a`、`fb7dd26`。对应 R2 的 M4c 原子 manifest、崩溃和新增数据恢复要求，以及 M4d 的 tombstone 读取要求。下列模块仍未接入产品启动链，不能据此宣称 APP utility 已成为唯一业务写者。

- `workspace-manifest.mjs`：宿主选择已有真实根目录；相对 DB/blob 路径拒绝穿越和符号链接越界，核对 Workspace ID 和实际 schema 版本。独立 SQLite 锁以 BEGIN IMMEDIATE 持有协作式写者所有权；进程退出后可重新取得。发布以期望 generation 比较、新文件独占写入及 fsync、同目录 rename 替换 active pointer 完成；保留每次历史候选及失败 stage。候选不是已发布证明，活动指针才是权威。损坏/不支持的指针拒绝；活动指针缺失却存在历史/stage 时要求显式恢复，禁止默默回旧库。并发软件直接打开业务 DB 不受此协作锁限制；尚无 OS 强制单写证明，也未阻止真实旧 Python 写者。
- 进程退出矩阵：首次发布、已有 generation=1 两种起点，各在 staged / published 位置由独立 Node 进程直接 exit(23)，不执行 finally/close。首次 staged 中止要求恢复；已有 staged 中止仍读 generation=1；published 中止分别读 generation=1/2；锁均可重新取得。另测失败回执、重复 generation、越界、错误 Workspace、未知 schema、损坏及丢失指针。只证明这些进程退出场景；未模拟任意指令点强杀、断电或文件系统损坏，未证明目录元数据的断电持久性。
- `workspace-export.mjs`：只写新建独占恢复目录；SQLite backup 包含已提交 WAL，将所有实际表写成规范 JSONL，保留大整数/BLOB 表示，复制并核 hash 所有不可变 blob（含尚未被事务引用的对象）。被引用 blob 缺失、损坏或异常路径会失败。最后才写 bundle.json，失败目录保留且无完成回执。包包含私有内容，并非脱敏公共导出；凭据密文单独、依赖 Windows 账户恢复，不自动拷贝真实 vault；明确 v1ImportSupported=false，不能让旧程序打开 V2 DB。
- `verify-workspace-export.mjs`：独立核文件 hash、完整性/FK、Workspace/schema、逐表数量与 SQLite 对应 JSONL 的实际行内容，核被引用 blob 和文件清单；拒绝路径穿越、链接、非空 WAL/journal、错误归属和缺文件。篡改 JSONL 并一起重算其清单 hash 仍会因与 SQLite 内容不符而拒绝。它验证内部一致性，不提供签名或来源真实性证明。文件路径检查不是 OS capability 隔离。
- `document-reader.mjs`：补查所属 Workspace/Candidate/Job 的墓碑和存在性；原来只查 Source/Document 的墓碑会遗漏上层删除状态。定向回归依次软删除/恢复五层实体，已删除时拒绝，恢复后可读，均为合成数据。原有 Source 撤权、hash、范围与跨 scope 拒绝保持通过。

实际失败与修正：`m4c-export-01` 退出 1，原因是新增实现把产品代号 V2 误当数据库 schema_version=2；实际 core 投影为 schema_version=1。已抽取 WORKSPACE_SCHEMA_VERSION=1 供 core/manifest/export/verify 共用，没有更改已有持久 schema。早期最小 manifest fixture 未发现该错误；完整 25 表迁移 fixture 的联动暴露问题并验证修正。`m4c-export-03` 的破坏用例直接修改了合成恢复包，不能把该目录交付为有效包；`m4c-recovery-01` 和最终全量改为复制单独 tampered-copy，成功原包保留。

实测：manifest-01 1/1、manifest-02 2/2、export-01 0/1（失败保留）、export-02 3/3、export-03 1/1、recovery-01 3/3、m4d-reader-01 4/4。最终 **m4c-node-all-01：151 passed / 0 failed / 0 skipped，130.701 s，guard run_verdict.success=true**，含 28 项 storage 测试、sidecar 启停。ESLint 和 git diff --check 通过；本轮未改构建入口或前端，没有将前轮 build/NSIS 验证说成新增模块的 packaged 验收。Python 未改也未重跑，仍引用 165 passed / 2 skipped 的原证据。

有效合成恢复包：`D:\hesan\Desktop\VSCODES\FetchCV_M1_work\20260910-235136\m4c-node-all-01\workspace-export\recovery\exported\`，包含当前 V2 副本的 25 张实际表、29 个清单文件。它保留迁移后修改的 Workspace 和新建合成附件；不是用户原件或完整跨版本自动回灌验证。汇总 `.m1-evidence/m4c-recovery-results-20260921.json` 记录 8 次运行、退出 hash、失败原因及有效 bundle hash。这 8 次 Node 删除 API 收据均为 0；manifest rename 会替换批准的合成目录内生成指针，SQLite 原生临时文件操作仍不属于完整 API 删除覆盖，不能将零收据说成所有层面零删除。

## 2026-09-22 增量状态

见 [M4 验收增量](FETCHCV_M4_VALIDATION_20260922.md)：APP utility 与显式 V2 启动分支已接入，实际项目只读副本、156/156 Node、最终候选 NSIS 解包运行、文档/审批/投递 reader、新写入恢复已验证。下面旧“后续仍需完成”段落保留为上一轮状态，不是当前完成声明。授权项目库为空，非空真实历史抽样仍未验证；默认用户数据和完整 V2 Pi 业务闭环没有宣称已迁完。

## 验证后的回退（2026-09-21 历史记录）

生产读取/写入仍沿用旧库，新增 storage 模块尚未被 Electron 启动链导入。撤销 M4 增量时先隔离新增源码与合成产物，再按上方 M3 归档恢复；不需要倒迁用户库。失败测试目录保留，禁止为重跑清空原目录。若后续完成 M4c 并产生新用户写入，必须先停写、输出并独立核验新增数据恢复包、保留账户绑定 vault，才可恢复兼容旧快照；新包不能直接导入旧程序，恢复入口及实际回灌验收仍未完成，不能只改回 manifest。

## 后续仍需完成

M4d 的 `document-reader.mjs` 和 `history-reader.mjs` 最小实现已在合成数据库验证：文档版本/hash/Unicode 范围、跨 scope 拒绝、缺失/撤权/墓碑；历史按稳定 sequence 分页，保留旧队列 metadata、禁止自动发送/重放、候选人墓碑拒绝访问。它们尚未接入产品 APP utility / renderer，不能宣称 M4d 已验收。blob 路径检查不是 OS 文件能力隔离证明，读路径存在竞态的系统级防护仍属 M5。

后续顺序：将已验证的凭据封存接入正式宿主迁移入口，完成真实副本分类及引用未解析清单审核；将本轮 manifest/export 原语接入 M4c APP utility 唯一写入和停写后的最终快照，补完整崩溃矩阵、正式恢复入口与新写入回灌；最后接入 M4d reader/history adapter 并跑产品回归。尚未运行真实用户库转换，未切换权威。M5–M10 不跨过这些门槛；全文质量人工标注、OS 隔离和真实签名不得以合成成功代替。

API 参考：[Node SQLite backup 与只读打开](https://nodejs.org/api/sqlite.html)。该页面是当前文档；实际可用性由上面 Electron 版本的执行结果确认。
