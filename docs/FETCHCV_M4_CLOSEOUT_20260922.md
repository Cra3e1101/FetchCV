# M4 收尾与本次验收范围（2026-09-22）

**结论：M4 已在“项目空库、可回滚的 V2 内部切换、不迁移既往用户记录”范围内完成验收。**

用户本轮说明“之前的记录我也不需要了”。因此不再寻找 APPDATA 的真实旧记录，也不以这项数据缺失无限阻塞本次空工作区验收。原方案 §22 的**非空真实简历/审批/投递历史抽样未验证**，不记为通过；非空合成迁移、完整性和恢复测试照常执行。这不是证明所有真实旧库都可以安全升级的结论。

设计依据为原 `FETCHCV_V2_FINAL.md` §5、§10、§22，以及 `FETCHCV_V2_EXECUTION_2026_FIRST_R2.md` 的 M4a–M4d。前一份 `FETCHCV_M4_VALIDATION_20260922.md` 和其机器汇总保留为历史记录；其中“V2 仅 reader/本地备注、Pi 尚未接入”的状态已由本次增量推进。

## 1. 保护与版本

- 原始 Git 基线：`1959bb8d3832fd405d77db9fb53d3b40e6c35644`。本轮开始于 `5a65ccf`；业务实现提交 `44eac6c9fa1a021f7e99d18f90b997facfaf9ffc`，审批页内容显示修正 `d225ee4`。Git 不能替代被忽略的数据、环境或安装器备份。
- `backend/data/fetchcv.db` SHA256 仍为 `11e73ec84150780d7a92fa5fd39e287e639a6164b15ed0bcdeec9c997511a565`；实际 24 表、全部 0 行、缺 `tool_invocations` 的明确旧变体。未补造旧记录。
- 原 `.venv`、`release/FetchCV-Setup-0.4.19-win-x64.exe` 实测仍存在；没有更换旧安装器、改动原库、读取真实 APPDATA、访问模型真实账户或删除真实素材。
- 本轮没有更改依赖、`package.json`、lockfile、两个原构建脚本、`src/` 或 Python 业务代码。既有未提交 `.gitignore`、requirements、M1 工具及研究文档未混入本次提交。
- 所有测试使用固定根 `D:\hesan\Desktop\VSCODES\FetchCV_M1_work\20260910-235136` 下的新目录。没有清空旧现场或回退系统 Temp。

## 2. 本轮变更

| 动作 | 主要路径 | 依据与效果 | 验证 |
|---|---|---|---|
| 新增运行/消息/请求/工具的事务存储 | `packages/storage/agent-repository.mjs` | M4c：沿用 APP 唯一 SQLite 连接；记录模型请求、queued/consumed 输入、完成回执与未知工具结果 | 并发、重复请求、取消、重启迟到提交测试通过 |
| 复用现有 Pi host 的本地存储传输 | `packages/app/workspace-agent-bridge.mjs`、`workspace-agent-service.mjs`、`electron/pi-agent-runtime.mjs` | §5：Pi 在 APP utility 中运行，V2 路径不调用 Python 持久化接口；M2/M3 原有 harness 继续复用 | 真实 Pi SDK + 本机合成模型通过；旧分支回归通过 |
| 新增草稿和用户审批命令 | `packages/storage/artifact-commands.mjs`、`application-store.mjs` | 保存不可变 draft；用户确认时检查相同 operation hash、scope、原版本、内容和有效期；事务发布，旧版本保留 | 跨 scope、错误 hash、旧目标、重复决定、重启过期均覆盖 |
| 接入父进程受限 IPC | `packages/app/storage-worker.mjs`、`electron/storage-client.mjs`、`workspace-application.mjs`、`storage-preload.cjs` | cancel 不排在长请求之后；SDK 数据不是 renderer 协议；凭据仅经父进程端口传给 APP，完成后丢弃引用 | 实际不可信窗口对 status/request/agent 三个接口均被拒绝 |
| 增加最小可用入口 | `public/workspace/`、storage/runtime 合同 | 普通对话无需岗位；资料读取、模型提问、停止、草稿原文审阅/确认；本地备注排除在模型历史之外 | 真实打包界面通过；文本用 textContent 展示 |
| 补运行时打包与验收证据 | `scripts/build-storage-runtime.mjs`、`tests/storage-agent*.mjs`、`tests/storage-packaged.e2e.mjs` | bundle 为 APP 中的 Pi 补 createRequire；不改原构建器；新增数据通过导出/验证/恢复 | NSIS 与恢复测试通过 |

代码增量为 22 个文件，首个实现提交 +830/-57 行，随后一行显示修正。逐文件字节数和 SHA256 见机器汇总 `sourceFiles`。本轮不声称所有旧业务工具已经迁完：V2 当前提供范围内资料枚举、作品读取、文档读取、会话读取和待审草稿；联网、解析/导出、MCP 重授权及完整求职界面仍随后续对应阶段推进。默认旧产品启动分支未被强行替换。

## 3. 实测验收

| 检查 | 结果 | 证据 |
|---|---|---|
| 最终 Node 全量 | **160 passed / 0 failed / 0 skipped，37.323 秒** | `.m1-evidence/m4e-node-all-02-node.log`、`-node-exit.json` |
| 真实 Pi SDK | 本机合成 OpenAI 协议服务；读取作品→持久化草稿→保存回答；任务续接、steer、cancel 均通过 | `m4e-agent-store-03-*`；也纳入全量 |
| 模型凭据 | 合成 key 未进入模型消息体或 Event；调用结束后 provider 引用释放 | `tests/storage-agent-runtime.test.mjs` 实测 |
| 新 V2 写入可恢复 | 运行/回答/审批后的新作品版本经 export→verify→restore 保留；重复完成请求返回原回执；原版本 hash 不变 | `m4e-agent-store-03/agent-persistence/copies/v2/agent-recovery-bundles/` |
| 真实 Electron utility | 43.1.1；独占写者、进程终止后重启、同请求不重复保存均通过 | `m4e-utility-01/utility-report.json` |
| 最终 NSIS 构建 | 退出 0；ASAR 86 项；422 个原 sidecar 文件逐个 hash 核验 | `m4e-package-03/package-report.json` |
| 最终 NSIS 解包程序 | 实际 main/preload/APP utility/Pi；模型回答与用户批准的新版本在退出重启后保留；坏 manifest 拒绝且不回旧库；0 页面异常 | `m4e-packaged-ui-02/packaged-report.json` |
| 来源与写者隔离 | 合成旧库 hash 不变；V2 分支没有观察到旧 sidecar spawn；未生成旧 sidecar 数据目录 | 同上 |
| 25 表迁移/FK/integrity/hash/count、scope、不可变 Source、reader、原子 manifest | 全量测试通过；原授权空库的一致性副本和 APP 激活证据沿用原报告 | 本轮全量 + `m4c-project-01/project-cutover-result.json` |
| Python | 本轮未改 Python，沿用 M3 的 165 passed / 2 skipped，不伪称重跑 | `.m1-evidence/m3-python-all-02.xml` |
| 非空真实旧记录抽样 | **未验证；用户不需要迁移既往记录，本次范围不要求导入它们** | 用户本轮说明；APPDATA 未访问 |

最终候选（验收用，未对外发布）：

`D:\hesan\Desktop\VSCODES\FetchCV_M1_work\20260910-235136\m4e-package-03\output\FetchCV-Setup-0.4.19-win-x64.exe`

- 大小 **129,756,255 B**；SHA256 **`91eda9427a02d3e29ad5afe52689d259990b80e1c89f1210615c7bddd376f5a2`**。
- ASAR SHA256 `ff372142ce85caff1fb6369bac0392dfc5ea9acf233e17aaceb8ffcaccba545f`。
- 实测签名 **NotSigned**。未运行安装向导、未覆盖 `release/`。该包有本机测试守卫 banner，不能当作对外发布安装器；正式签名/发布仍是 M10。
- ASAR 24 个文本文件、3 类凭据模式扫描 0 命中；禁止的数据/secret 路径 0 命中。这是有限检查，不是不存在任何秘密的证明。

## 4. 空间与删除审计

完整机器汇总：`.m1-evidence/m4-agent-validation-20260922.json`，共 **12 次运行，全部最终退出 0**；包含源代码冻结、命令、每次退出与删除日志 SHA256、每个成功删除路径、包清单与实际窗口报告。

这些新运行目录完整测量共 **2,627,938,123 B**，均保留；回收空间 **0**。最终 D 盘可用 **7,164,452,864 B**，未做清理。数值是本轮新生成物，不是整个项目的 M1 before/after 差值。

共 **354 条成功 JavaScript 删除 API 收据、186 个不同路径**；均在各自批准的运行根中；范围外成功收据 0、blocked 0。递归 wrapper 会重复计数同一路径，不能称作 354 个文件。SQLite/Chromium/构建器的 native 删除并未被完整 API 拦截，仍保留这一审计覆盖限制。

## 5. 修正、限制与环境问题

- 测试代码初次 lint 报两个未使用变量，汇总脚本初次 lint 又报一个未使用 helper；均已移除，随后 lint 通过。原始验证输出保留。
- 代码复核发现审批与 ToolCall 应使用同一 operation hash。修正后以 `m4-artifact-2` 标明新合同，并追加原版本变化、重启过期和导出恢复测试。第一版候选仅作中间证据，最终候选已包含修正。
- 审批页最初展示了内部迁移字段；最后只显示原内容、草稿和修改理由，重新构建并完成最终界面验收。
- 自动审批曾因混合 PowerShell 表格被理解为“D 盘仅 1 字节”而拒绝启动最终构建。目标目录当时不存在；Get-PSDrive 和 DriveInfo 独立返回 **8,205,848,576 B**。加上不足 2 GiB 立即停止的检查后，同一构建获得审批并成功。没有换工具绕过拒绝，也没有自行删除文件腾空间。
- 根目录所有者仍为 **LAPTOP-6C3TR05Q\CodexSandboxOffline**；未修复或声称已解决所有权问题。
- 默认 APPDATA 工作区未切换；真实旧记录保持原位。模型测试使用合成本机服务，不代表某个真实远程模型的简历质量已验证。M5–M10 的功能和发布门槛未混记为 M4 成果。

## 6. 回退与后续边界

1. 关闭显式选择 V2 根的窗口，等待 APP utility 退出。若保存了新的 V2 数据，先用 `exportWorkspace` 导出到全新恢复目录并运行 `verifyWorkspaceExport`；不能只把 manifest 指回旧库而丢掉新增记录。
2. 恢复包只能通过 `restoreWorkspace` 恢复到新 V2 目录；原包、原旧库、不可变版本和独立凭据 vault 保留。V1 不得直接打开 V2 数据库。
3. 本轮没有改变默认旧用户数据选择或旧 installer，因此回到旧产品不需要覆盖数据库；手动设置过 `FETCHCV_V2_STORAGE_ROOT` 时，只在下一次启动环境取消它。
4. 源码需要撤销时先保存现有未提交内容，按 `d225ee4`、`44eac6c` 逐项审阅撤销；不得 `git clean` 或删除被忽略的数据/依赖目录。初始基线不是这些文件的备份。
5. 如果以后改变决定、需要导入真实旧历史，应另行授权具体来源，并补做非空真实样本、秘密与文件引用审核；本次通过不能替代那项验收。

本次关闭的是 M4 的上述实现与验收范围，不表示整套 M1–M10 迁移或正式发布已经完成。
