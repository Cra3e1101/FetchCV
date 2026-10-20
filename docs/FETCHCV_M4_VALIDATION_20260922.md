# M4 验收增量：2026-09-22

> 后续状态见 [M4 收尾报告](./FETCHCV_M4_CLOSEOUT_20260922.md)：APP 内 Pi 和审批写入已接通；用户说明不需要迁移旧记录后，本次按空工作区范围完成验收。下文保留为当时的执行记录，不重写原失败与未验证项。

设计依据仍是 `D:\hesan\Desktop\VSCODES\linshi\FETCHCV_V2_FINAL.md` §5、§10、§22，以及已采用的 `FETCHCV_V2_EXECUTION_2026_FIRST_R2.md` M4a–M4d。原设计未修改。本报告接续 `FETCHCV_M4_EXECUTION_20260921.md`；后者末尾“未接入启动链、未运行实际旧库转换”的描述是历史状态，以本报告为准。

**状态：工程检查已取得下列实测证据，但 M4 尚不宣告完整验收。** 用户指定的项目旧库实际为空，原方案“真实简历/审批/投递历史抽样逐项相等”没有非空输入，不能用合成样本冒充通过。APPDATA 旧用户目录未迁移；默认产品入口仍保留旧分支。新 V2 分支是存储、历史 reader 和本地备注入口，不是完整 V2 Agent 求职流程的完成声明。

## 1. 保护与版本范围

- 初始 Git 基线 `1959bb8d3832fd405d77db9fb53d3b40e6c35644`；本轮之前最近提交 `90da910`。Git 仅保护纳入版本控制的文件，不能代替被忽略的数据/依赖/安装包备份。
- 原 `backend/data/fetchcv.db` 保留，SHA256 始终为 `11e73ec84150780d7a92fa5fd39e287e639a6164b15ed0bcdeec9c997511a565`。旧 `.venv`、`release/*.exe`、真实素材保留。未变更 `package-lock.json`、两个原构建脚本、`src/`、Python 业务代码。
- 固定工作根仍为 `D:\hesan\Desktop\VSCODES\FetchCV_M1_work\20260910-235136`，每次运行使用新子目录。失败目录没有清空、复用或删除。
- 本轮实测项目根所有者仍为 `LAPTOP-6C3TR05Q\CodexSandboxOffline`。没有更改所有权/ACL；该环境问题仍保留。
- 原有未提交 `.gitignore`、`backend/requirements/`、`scripts/m1/` 和研究文档不混入本次代码提交。
- 本轮代码分为 `0ae8b25`（reader 与恢复）、`b8cbeb9`（停写/最终副本编排）、`0ad926f`（显式 V2 启动与候选包）。`git fsck --full` 实测退出 0、无输出；Git 对象完整性通过不等于用户数据备份。

## 2. 变更与实测

| 变更 | 路径 | 依据 | 结果 |
|---|---|---|---|
| APP 独占 storage、崩溃恢复、事务化备注与请求回执 | `packages/storage/application-store.mjs`、`packages/app/storage-worker.mjs`、`electron/storage-client.mjs` | §5/§10；M4c | 实际 Electron utility 重启、第二写者拒绝、同请求不重复写均通过 |
| 停写租约→最终一致副本→绑定本副本审核→原子指针 | `packages/app/workspace-cutover.mjs`、`scripts/m4/run-project-cutover.ps1` 等 | §10；M4c | 先停写后快照、拒绝审核/失租约不激活、发布后错误不自动回滚通过；实际项目副本通过 |
| 文档分页与只读历史 | `document-reader.mjs`、`workspace-reader.mjs`、storage 合同 | §10；M4d | Unicode 跨页无丢失；审批/投递全部历史字段等价；错误 scope 拒绝 |
| 恢复可写 V2 工作区 | `restore-workspace.mjs` | §10/§22 | 新写入经 export/verify/restore 后存在；重复请求仍返回原回执；不覆盖原包/旧库 |
| 显式选择 V2 启动分支、窄 preload、最小 reader | `electron/main.mjs`、`workspace-application.mjs`、`storage-preload.cjs`、`public/workspace/` | M4c/M4d | 实际窗口和 NSIS 解包程序通过；错误 manifest 不回旧库 |
| 将新增 worker/preload 纳入运行时产物 | `scripts/build-storage-runtime.mjs`、`package.json` 的 `electron:runtime` | M4a/M4c packaged gate | 先取得候选 NSIS 成功证据后才改 package；最终候选再次构建通过 |

APP 从自己验证后的 manifest 返回 workspace 身份，main 不再预读未验证 JSON 决定身份。Renderer 只有封闭 storage 请求，没有原始 SQL、路径或凭据接口；实际不可信窗口对两个 storage IPC 均被拒绝。选择 `FETCHCV_V2_STORAGE_ROOT` 后不启动旧 Python sidecar/Pi 持久化分支，启动失败不会隐式回旧库。协作式写者锁不是阻止任意外部软件写 SQLite 的 OS 沙箱；不作此扩展声明。

当前 V2 页面能读简历/作品、已有文本、对话、历史审批/投递，并保存本地备注；备注明确不发给模型。它没有宣称已迁完旧 Pi 工具写命令、简历编辑/导出或 M9 全部导航。旧默认分支保留用于兼容；两条启动分支互斥。

恢复完成后，把复制来的 `bundle.json` 改名为 `restore-source-bundle.json`：它说明恢复来源，不冒充可写工作区未来状态的校验清单。原不可变导出包保留。V2 恢复包不能让 V1 直接打开或自动导入，账户绑定凭据 vault 单独保留。

## 3. 验收证据

机器可读汇总：`.m1-evidence/m4-validation-20260922.json`，32 次运行的退出记录及 hash、删除路径、失败和最终产物信息。证据原件不能以汇总替代。

| 检查 | 实测 | 证据 |
|---|---|---|
| Node 全量 | **156 passed / 0 failed / 0 skipped，14.865 s**；含旧 sidecar 启停 | `m4c-node-all-03-node.log` / `-node-exit.json` |
| APP 新写入导出与回灌 | 1/1；完整回执恢复，同一请求未产生第二条备注 | `m4c-app-recovery-01-*` |
| cutover 故障路径 | 2/2；覆盖停止后的末次旧写、审核拒绝、租约丢失、发布后回执错误 | `m4c-cutover-03-*` |
| 实际 utility | Electron 43.1.1；重启、独占写者、回执恢复通过 | `m4c-utility-03-*` |
| 开发态实际窗口 | 文档分页/历史/备注通过；320/768/1024/1440 宽度无横向溢出，0 renderer errors | `m4d-workspace-ui-03/ui-report.json`（稳定根） |
| 最终候选 NSIS | 退出 0；ASAR 86 个清单条目；422 个 sidecar 文件逐项 hash 一致 | `m4c-package-09/package-report.json`（稳定根） |
| NSIS 解包程序 | 写入、完整退出后重启、坏 manifest 三场景通过；实际主进程+preload+utility；不可信窗口拒绝通过 | `m4c-packaged-ui-02/packaged-report.json`（稳定根） |
| 包中启用 V2 时 | 未观察到旧 sidecar spawn，合成 profile 未创建旧 sidecar data 目录；原合成旧库 hash 不变 | 同上；这是观测与分支检查，不是完整 OS 进程行为证明 |
| lint / diff | 明确列出的变更文件 ESLint 与 `git diff --check` 通过 | 运行命令与最终 Git 检查 |
| Python | 沿用 M3 的 165 passed / 2 skipped；本轮未改 Python，未重跑 | `.m1-evidence/m3-python-all-02.xml` |

最终安装包：`D:\hesan\Desktop\VSCODES\FetchCV_M1_work\20260910-235136\m4c-package-09\output\FetchCV-Setup-0.4.19-win-x64.exe`。

- 大小 **129,247,038 B**，SHA256 `0c1dd273cebbfd50eec89877233e9d5c8d01fcef461a48e8ea433143f7b1833f`。
- ASAR SHA256 `d86e034bfcebdd3e3ffa4092b7886221b2514dba07e15d81e83ff071ca67ca42`，NSIS 解出后相同。
- Authenticode 实测 **NotSigned**；构建器输出 signing 字样不代表实际签名成功。没有运行安装向导或覆盖旧 installer。
- 这是带测试删除守卫 banner 的候选包，引用本机守卫路径，**不能作为对外发布安装器**。现有 sidecar 二进制原样复用并核 hash，未把它说成当前 Python 源码的新构建。完整发布/升级流程属于 M10。
- ASAR 路径扫描无 DB/secret/env/真实素材路径；24 个文本文件的三类凭据模式扫描 0 命中。这是有限启发式检查，不是不存在任何秘密的证明；私有恢复 DB/vault 也不是可公开产物。

## 4. 实际授权库与最终副本

用户明确授权项目 `backend/data/fetchcv.db` 的只读副本，并保持不访问旧 APPDATA。实际库为 **24 张业务表、全部 0 行**，恰好缺少 `tool_invocations`；当前 SQLAlchemy 模型仍是 25 表。默认严格检查拒绝该库后，增加显式 `pre-tool-invocations` 变体，只允许这一个已核实差异。没有修改旧库、补造旧行或静默接受其他未知 schema。

最终副本位于：

`D:\hesan\Desktop\VSCODES\FetchCV_M1_work\20260910-235136\m4c-project-01\copies\approved-project\`

Workspace ID：`7ed9d66a-2ef5-4632-9618-b0ba8664c77a`。本次原始快照在同运行根 `protected-recovery/`，账户绑定 vault 在 `vault/`。vault 条目 0，因此这不是实际非空秘密恢复证明；此前已有非空合成 DPAPI 跨 Electron 进程验证。

`run-project-cutover.ps1` 用 `FileAccess.Read / FileShare.Read` 持有来源 DB 句柄，覆盖最终快照、审核、manifest 发布、APP utility 验证全过程；不修改文件 ACL。仅适用于此次已核实无 WAL/journal 的来源；出现这类伴随文件会拒绝这条快捷入口，而不是忽略 WAL。一般 snapshot 模块仍使用 SQLite backup API，合成 WAL 测试保留。

来源 hash 前后相同，详见 `.m1-evidence/m4c-project-01-source-lease.json`。这是新副本 generation=1 的激活与实际 APP 打开验收，**不是默认 APPDATA 用户工作区已切换**。只读句柄在结束时释放，也不声称永久修改了原库的 OS 只读属性。

缺少非空真实历史样本的验收项仍记为未验证；实际空库和非空合成样本分开报告。

## 5. 失败、空间与环境记录

- `m4c-utility-01`：沙箱账户 GPU 启动失败；实际用户上下文的 `-02`、`-03` 通过。
- `m4b-approved-copy-01`：严格 25 表检查拒绝旧 24 表变体；明确变体后 `-02` 通过，最终 `m4c-project-01` 通过。
- `m4d-workspace-ui-01`：选中空作品集时用例错误期待有正文；UI 增加明确空正文提示，选择已知非空简历验证。
- `m4c-package-01`：默认 npm cache 清理试图删除范围外旧日志，被守卫拦截 3 次。用户批准限定缓存根后继续；新 npm cache/log 均在独占运行根，关闭更新提示及旧日志轮转。
- package `-02` 临时 app 无依赖；`-03` 两目录布局不允许 app 包内含 build 配置；`-04`/`-06` 重复 extraResources 复制导致 EBUSY；`-05` afterPack 再次复制导致 EEXIST。最终直接调用本地 getConfig 验证：重复传整份 build 会产生两条相同规则；仅传覆盖项后为一条。原 sidecar 可完整读取，无对应进程；早期“外部占用”猜测未被证实。最终未采用自制流式复制，沿用原复制规则并独立核 hash。
- package `-07`：观察到旧 `-05` 目录的两个 Changed 通知，守卫退出 86；相关已记录构建子进程均已退出，通知来源无法归因。没有忽略、白名单化或把该次算成功；后续 `-08`/`-09` 分别完整通过。
- `m4d-reader-02`：实现误把 run 的归属当成直接列，实际经 Conversation 关联；修正后 `-03` 通过。
- cutover `-01`/`-02`：测试误读 Candidate 的列/JSON 层级；按实际 `profile_json.legacy.title` 修正，`-03` 通过。
- Node all `-02`：155/156，旧启动顺序测试误读新增 V2 app-ready 分支；限定旧分支的原顺序断言后 `-03` 156/156。
- 汇总脚本首跑因 Windows ASAR extractFile 路径分隔符错误失败；归一化为平台路径后才生成汇总。首跑没有生成成功清单。

32 次汇总运行共 **580 条成功删除 API 收据、300 个不同路径**，均在对应批准的生成目录；3 条范围外尝试被阻止，成功范围外删除收据为 0。递归封装可能对同一路径记录 unlink/rm 两次，不能说成 580 个文件。原生 SQLite/Chromium/构建器操作不在完整 API 拦截覆盖内，不能把零范围外 API 收据扩大为所有 native 行为保证。

没有执行空间清理，回收空间 **0**。失败和成功产物都保留；本轮后 D 盘可用约 **9.85 GB**。这不是 M1 的原始 before/after 全树测量，不据此推算整个迁移节省的空间。

## 6. 回退与待补验收

1. 关闭明确选择 V2 根的 FetchCV 进程，等待 APP utility 退出；不要让 V1 打开 `archive.db` / `workspace.db`。
2. 如该 V2 根已产生新写入，先用 `exportWorkspace` 输出到全新恢复目录，再以 `verifyWorkspaceExport` 验证；保留 vault 和原包。`restoreWorkspace` 只能恢复到新的 V2 根，不能覆盖既有目录。
3. 本轮新增数据恢复演练的有效包在 `m4c-app-recovery-01/workspace-export/recovery/after-app-writes/`；恢复工作区在同目录 `after-app-restore/`。实际 APP 备注及其幂等回执已验证恢复。不要删除这些证据来重跑。
4. 此次没有改默认用户数据选择。回到旧产品使用原安装器/旧环境；如果之前手工设置了 `FETCHCV_V2_STORAGE_ROOT`，应在该启动环境取消它。保留 V2 副本/导出包，不能只改 manifest 丢弃新增数据。
5. 源码回退按本轮 Git 提交逐项检查，先保存当前工作区更改；不使用 `git clean`、递归删除或覆盖用户未提交文件。被 Git 忽略的数据、安装器、环境原位保留。

未完成：非空真实历史抽样；默认用户工作区切换；完整 V2 Pi 业务写命令与求职闭环（当前新增分支只开放 reader/本地备注）。M4 的存储底座与当前分支验证不能冒充这些任务已完成。未进入 M5–M10，也未用未签名候选包替换正式旧安装器。
