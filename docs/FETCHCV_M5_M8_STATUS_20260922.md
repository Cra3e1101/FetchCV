# M5–M8 实施与验收状态（2026-09-22）

> 2026-09-23 的统一状态与后续缺项见 [最新状态](FETCHCV_M5_M8_STATUS_20260923.md)。本文保留历史实测，不能用下方旧测试数或旧失败判断当前状态。

> 本文以下内容是早期 r2 历史快照，失败现场保留。最新解析与打包进展见 [M5 受限解析交付 r3](FETCHCV_M5_PARSER_DELIVERY_20260922.md)：OS 隔离和桌面/包内导入链已通过，回归增至 181 项；人工密封质量门槛仍未完成。下文“隔离失败/入口未接通”不再代表当前代码状态。

**结论：交付了可运行的检索、人工审阅记忆和上下文保护增量，但 M5–M8 尚未全部满足原设计退出准则。** 不能把下列合成测试与打包通过称为整个迁移完成。M5 的 Windows 隔离实验失败，生产解析入口未接通；原 §21 的人工密封质量评测尚未完成。

设计来源：`D:\hesan\Desktop\VSCODES\linshi\FETCHCV_V2_FINAL.md` §7–9、§18、§21–22。近期 GitHub/论文的取舍、实施边界及阶段缺项见 [实施记录](FETCHCV_M5_M8_EXECUTION_20260922.md)。原设计文件未修改。

## 1. 基线与保护证明

- 基线：`7fcb309`（M4）；源码归档 `.m1-work/m5-m8-20260922-01/m4-source-baseline.zip`。
- 归档 SHA256：`43583fc0c17f0a2834c0d4579bc00aa332ef839502324a036a0f2793d5e387e0`。它只保护 Git 跟踪源码，不保护被忽略的真实材料、依赖环境和旧安装包。
- 本轮增量提交：`5938463`、`b9d479f`、`897e8f2`、`d581a93`、`c61f6f8`、`07c988a`、`8bfa4fc`；审计工具修正 `b5b27c0`。
- 最终打包源代码：`8bfa4fc`；机器审计记录源码位置为 `b5b27c0e54bb5386c7a451b46f809dc9abafec54`，后者只增加审计验证。最终状态文档后续独立提交，不改变安装包。
- 实际运行 `git -c safe.directory=D:/hesan/Desktop/VSCODES/FetchCV_Windows fsck --full`，退出 0，无输出。既有 `.gitignore` 修改与历史未跟踪文件未混入本阶段提交，不声称工作树完全干净。

以下 SHA256 复测与此前记录一致：

|保护项|SHA256|
|---|---|
|`backend/data/fetchcv.db`|`11e73ec84150780d7a92fa5fd39e287e639a6164b15ed0bcdeec9c997511a565`|
|`release/FetchCV-Setup-0.4.19-win-x64.exe`|`28bc773d6e6126027954bf8d71e9d9336b225a4e4885ccf56718929c14d89209`|
|`package.json`|`26d4257a9b87004502f38ec68a6e9c3ffb4e0f1f5676b7106ad6f17ddf701c9b`|
|`package-lock.json`|`e640fd2b15d9f575ebcddd6817ce5b327cd7efe34d04a148940f62afa8240fbc`|

旧环境、原始素材、旧 installer 未被切换或清理；未访问用户旧 APPDATA。测试和构建使用固定稳定根 `D:\hesan\Desktop\VSCODES\FetchCV_M1_work\20260910-235136` 中的新子目录，没有系统 Temp 回退。

## 2. 逐项变更

|动作与路径|作用与依据|验证结果/限制|
|---|---|---|
|新增 `workers/parser/formats.py`|M5：PDF、DOCX、HTML、Markdown、text、chat 转原文保真的 IR；标题/表格/页码、Unicode 偏移、输入及解压上限|纯解析合成样例通过。扫描件返回 needs_review；未声称有 OCR 或 OS 隔离|
|新增 `packages/storage/ingestion.mjs`、扩充 APP/contracts|M5：先保留 blob，再建立持久任务；幂等捕获、版本、取消/撤回与 lease 栅栏，拒绝过期结果|竞态/重试/取消/撤回测试通过；生产 parser 尚未接入|
|新增 `packages/knowledge/retrieval.mjs`|M6：结构块、中文 FTS、scope 先过滤、版本/时间/撤回约束、generation 与原文引用重核|跨权限资料不能挤占 top-k；引用、导出恢复测试通过。8 个合成来源、3 个查询仅是 pilot|
|新增 `packages/knowledge/memory.mjs`|M7：精确引用用户消息；偏好/约束/决策需用户确认；冲突替换、有效期、来源和撤回|通过原文/秘密格式/冲突/分页/撤回测试；普通事实与过程经验尚非完整 M7 实现|
|新增 `packages/storage/feature-schema.mjs`|M6/M7：派生结构独立版本管理，不靠静默建表猜版本|导出/恢复保留搜索、记忆；未知 feature revision 拒绝|
|更新 `public/workspace/*`|最小搜索/核对引用，记忆候选、来源审阅、确认/拒绝/替换/撤回/分页|真实 Electron 与打包程序通过；不是新导入 UI|
|更新 `electron/pi/*`、runtime、APP bridge|M8：模型预算包含系统/工具/输出余量；完整轮次选择；工具凭据占位；实际选入证据发送前重核|8k/32k、中文、长工具结果、撤回、真实 Pi、取消/补充输入通过。UTF-8 字节是保守估计，不是精确 tokenizer|
|保留 `windows_container.py`、`stage_runtime.py`、`entry.py` 与独立 probe|M5 OS 隔离试验；只改全新测试目录 ACL|失败且明确未验收；未接产品/打包，未创建 AppContainer profile|
|新增/更新 tests 与 `scripts/m5-m8/summarize-validation.mjs`|可重复证据、成功/失败日志、路径审计及安装包核对|机器审计不会把失败记录抹掉；正式门槛继续为 false|

截至机器审计：相对 M4 的 43 个源码/测试/文档文件发生变化，1664 行新增、99 行移除（随后状态文档不计入此统计）。逐文件当前字节数和 SHA256 在 `.m1-evidence/m58-validation-20260922-r2.json` 的 `sourceFiles`；没有把文件大小等同于回收空间。

独立审阅发现并修复：过期附件/引用/目录与工具缓存、无关旧结果阻塞新请求、工具预算满足后过度裁剪、可伪造文本标记、待确认记忆缓存漏检。输入 ID 现在来自 host 记录并精确匹配已选入消息，不从用户文本推断。最后一轮限定范围独立审阅未发现阻塞；这不是全项目安全认证。

## 3. 实测验证

最终完整基础回归命令（`$testFiles` 是 `tests/*.test.mjs`，单独排除仍未验收的 `parser-container.test.mjs`）：

```powershell
$env:FETCHCV_PYTHON='D:\hesan\Desktop\VSCODES\FetchCV_Windows\backend\.venv-m1\Scripts\python.exe'
$env:PYTHONDONTWRITEBYTECODE='1'
# 每次需新 label/root；不得覆盖下列已完成现场。
& 'D:\Nodev\node.exe' scripts/m1/run-guarded-node.mjs --label m58-regression-03 --temp-root 'D:\hesan\Desktop\VSCODES\FetchCV_M1_work\20260910-235136\m58-regression-03' -- 'D:\Nodev\node.exe' --test --test-concurrency=2 @testFiles
```

|实测|结果|证据|
|---|---|---|
|54 个回归文件|175 passed / 0 failed / 0 cancelled / 0 skipped；约 87.47 秒，退出 0|`.m1-evidence/m58-regression-03-node.log`、`-node-exit.json`|
|真实 Pi + APP + 本地合成 provider|模型→工具→模型、草稿、请求回执、超预算发送前拒绝、取消/任务/补充输入通过|`m58-final-pi-04`（6/6），亦包含于最终175项|
|真实 Electron UI|记忆确认/持久化/撤回、引用核对；320/768/1024/1440 宽度无横向溢出、renderer error 0|`m7-ui-02` 的 `ui-report.json`、`workspace-ui.png`；后续候选重验产品流程|
|NSIS 候选构建|退出 0，ASAR 86 条路径，复用 sidecar 422 文件逐一 hash 验证|`m58-package-02/package-report.json`|
|候选提取启动|write/restart/invalid-manifest 均通过；Agent、记忆、引用、草稿、拒绝外国窗口、renderer error 0；V2 未启动 Python sidecar|`m58-packaged-ui-02/packaged-report.json`；退出 0|
|检查源码|修改文件 ESLint、`git diff --check`、`git fsck --full` 均退出 0|本次实际命令输出|
|产物 secret 检查|24 个 ASAR 文本文件的3类凭据模式零命中；禁止路径零命中|机器审计 `artifactScan`。不等于任意秘密或全部原生二进制已被穷尽扫描|
|Windows 解析沙箱|**失败**：第一次低完整性标签失败；第二次标签成功，CreateProcessW 返回 Winerror 2；三个 canary 尚未完成|`m5-container-01/02` 日志保留；不包含在175项通过统计中|

新候选绝对路径：
`D:\hesan\Desktop\VSCODES\FetchCV_M1_work\20260910-235136\m58-package-02\output\FetchCV-Setup-0.4.19-win-x64.exe`

- 大小：129,767,462 B。
- installer SHA256：`39445a2ebfcd8d17934c63361efd6bd9d68df95f03e2278366d0ed5fb368a105`。
- app.asar SHA256：`e542c146c0160294549ec3c3e2a01ceae47404fb5a11366e8a45c94175f83b4f`。
- `Get-AuthenticodeSignature` 实测 `NotSigned`。构建日志出现 signing 字样不能当签名证据。
- 未运行安装向导、未发布、未替换旧 installer。主进程/utility 带测试删除守卫，依赖本机测试路径，不是可分发的正式版本。

本轮失败也保留：初始红测、格式测试 fixture 修正、M8 钩子异常传播修正、受限环境 Electron/sidecar 超时，以及 `m58-regression-02` 的 171/173。后者一项是清单版本断言过期，另一项是短命 HTTP 监听未收到失败回执（传输原因未严格隔离证明）；初始化失败的单元测试改用可注入 APP 传输，真实 APP/Pi 端到端验证仍保留。最终 `m58-regression-03` 完整重跑通过，未降低业务断言。

## 4. 空间与删除审计

- 审计覆盖34次运行，21次运行成功；失败现场全部保留。
- 34个运行目录测量全部 `complete=true`；当前合计 **2,279,180,047 B**（约2.12 GiB），用于依赖运行副本、测试数据、失败现场及两份候选。**回收空间为0**。
- JS 删除 API 成功回执242条，全部在各自批准的临时根内，范围外回执0、blocked回执0；每条路径/操作在机器报告的 `runs[].deletedPaths`，原始 JSONL 哈希也已登记。
- 242是 API 回执数，可能包含重复路径，不是独立文件数。原生 SQLite/Chromium/builder 删除未被 JS 守卫穷尽拦截，不能声称所有原生文件删除都被计数。
- 本阶段没有对整个项目再次做完整前后体积测量，不能给出全项目精确增减；上述数字仅是实测保留运行目录。打包后 D 盘可用空间读取为约4.8GB，属当时读数。

## 5. 未完成项与原因

1. **M5 OS 隔离与实际导入链**：实验进程尚未启动；普通 subprocess 不替代 OS 约束。微软文档的 profile 步骤会写专用 APPDATA 目录及系统管理配置，原 APPDATA 禁令仍生效，窄范围授权问题尚未得到答复。不能断言创建 profile 一定解决 Winerror 2。实际 canary、资源耗尽/取消、运行时授权/许可证及生产接入仍待完成。
2. **M5 文件入口/OCR/队列调度**：纯解析与 APP 持久队列已实现，但自动解析、原生文件导入、重启调度及新 worker 的 OCR 未接入；现有 migrated ready 文档可搜索。RPC 捕获当前受2MiB报文限制，不能把纯 parser 的50MiB上限宣称为产品上传上限。
3. **M6/M7 正式质量集**：原 §21 的60来源、400查询分组/密封、100对话、至少20%双人标注未完成；不得用8来源3查询的合成 pilot 代替 recall/nDCG/忠实性/拒答/记忆 precision 门槛。dense/RRF 等尚无本项目收益证据，未默认引入。
4. **M7/M8 后续能力**：过程经验候选、personal_fact 统一引用、高级语义摘要及任务级缓存/成本收益仍未完成。当前交付是安全的审阅记忆与选择性上下文，不宣称达到高级压缩或完整经验学习。
5. **环境遗留**：根目录所有者复测仍为 `LAPTOP-6C3TR05Q\CodexSandboxOffline`；此次未改全树所有权。原始旧历史库为空的限制保持此前记录，不为获取历史而进入用户 APPDATA。

机器报告的 `m5ToM8FullyAccepted=false`、`m5OSIsolationPassed=false`、`parserWiredInProduction=false`、`humanSealedBenchmarkPassed=false` 是本次明确结论。

## 6. 回退与继续操作

- **当前没有切换真实用户环境**：停止验收候选即可继续使用原 installer/旧环境；保留新候选及测试目录，不执行删除或覆盖。
- 源码查看/回退参考 `7fcb309` 和已保留的 M4源码zip。不要运行 `git reset --hard`、`git clean` 或整体覆盖当前工作树，因为存在其他阶段未提交内容。需要试跑旧代码时将既有源码zip解压到新的项目内回退目录；不要覆盖原件。
- 若未来实际启用新APP并产生数据，必须先导出完整新工作区（DB/WAL和blobs）；源码回退不等于数据回退。Memory/Search FeatureSchema 与新增事件/资料仍需保留，不直接用旧库覆盖。
- 下一执行顺序：取得新 AppContainer profile 的窄范围授权 → 单独证明 OS canary/限额/取消 → 补齐解析调度、原生导入/OCR及打包 → 冻结来源分组的质量集并完成人工标注 → 按实测决定 dense/RRF、过程经验和摘要增强。原有权限/撤回/来源门槛不降级。

完整机器证据：`D:\hesan\Desktop\VSCODES\FetchCV_Windows\.m1-evidence\m58-validation-20260922-r2.json`。此报告不会将部分交付写成 M5–M8 全部完成。
