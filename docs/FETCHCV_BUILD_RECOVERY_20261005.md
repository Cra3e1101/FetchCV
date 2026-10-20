# 候选构建恢复记录（2026-10-05）

已恢复完整候选构建与包内验收：m58-package-16、m58-packaged-ui-14 均守卫退出 0。M5–M8 的人工质量门槛不因此标为完成。

## 修改

- 构建每次建立全新工具缓存，不复制旧解包目录。7zip 归档及执行文件分别使用固定 SHA256；执行文件必须为 `223b873c50380fe9a39f1a22b6abf8d46db506e1c08d08312902f6f3cd1f7ac3`。
- NSIS 保持原版本 3.0.4.1、资源 3.4.1，使用 builder 原有固定归档校验值。直接解包到新最终目录，以支持的 `ELECTRON_BUILDER_NSIS_DIR` / `ELECTRON_BUILDER_NSIS_RESOURCES_DIR` 使用，避免解包后的目录改名；不修改 node_modules、ACL 或防护。
- 在线准备使用 @electron/get v5：isGeneric=true、fetch signal 超时、条件初始化代理。独立审查发现并纠正了原先遗漏 isGeneric、误用 Got 参数及缺少必需路径检查的问题。
- 明确的 `--offline-verified-tools` 模式仅从记录路径读取压缩包，先验证固定 hash，再在新根解包。不是错误后静默回退，也不使用旧解包程序。
- 包内验收从本次工具记录读取 7zip，校验真实路径位于候选缓存且内容 hash 正确；旧候选缺少记录时会拒绝。

## 实测与失败

| 运行 | 结果 |
|---|---|
| m58-package-11 / 12 | NSIS 解包后 rename EPERM；未完成 |
| m58-nsis-rename-01 / 02 | 普通目录、解包目录、builder 内层解包流程均成功 |
| m58-nsis-rename-03 | 解包后立即 rename 也出现 EPERM；外层缓存锁测试尚未执行到 |
| m58-package-13 | 原生 fetch 下载失败 |
| m58-package-14 | 首个工具下载 connect ETIMEDOUT，尚未进入新增 NSIS helper |
| m58-nsis-stage-01 | 在线 NSIS 下载 ECONNRESET |
| m58-nsis-stage-02 | 离线准备通过，343 个 NSIS 文件 + 22 个资源文件；守卫退出 0；未执行编译器 |
| m58-package-15 | 新方案进入 NSIS 打包，但 .git/index.lock Created 导致守卫 86，中止子进程；未通过完整打包 |

package-15 的事件时间为 2026-10-04T16:46:30.0879575Z（本地 10 月 5 日 00:46:30）。文件系统通知不提供创建者身份，不能凭该记录断言来自构建、用户或后台工具。未放宽监视规则。

随后审查代理确认曾在该次构建期间执行未禁用可选锁的 git diff/status。不能精确归因，但这是本方调度失误；后续停止并行审查，构建期间不做 Git 操作。单独重跑 package-16 后通过。

## 最终恢复结果

- package-16：90 个 ASAR 路径、422 sidecar 文件、105 parser 文件；构建守卫退出 0。
- packaged-ui-14：从新 installer 解包，实际运行 write/restart/invalid-manifest，核对导入、引用、记忆/个人事实确认与撤回，守卫退出 0。未安装或切换日常用户工作区。
- installer：稳定根 `m58-package-16/output/FetchCV-Setup-0.4.19-win-x64.exe`，140384553 B，SHA256 `a3eec434f6a42933c5757d32f8ec728d032a19db915b6ce5faf149c62ab7c4b9`，NotSigned。
- ASAR SHA256 `6ba63a973ba9c1a0201088deab7553d10dbb3f7b9abdb897991c377101f8c3a9` 与之前通过验收的应用包一致。NSIS installer 是新产物，不要求与旧 installer 字节一致。
- 两次运行共 128 条 JavaScript 删除 API 成功回执，范围外 0、blocked 0；不是全部原生文件操作的穷尽审计。
- 核对最近 200 条 Defender Operational 事件（最早本地 2026-09-30 00:06:21），没有匹配 package-16 / packaged-ui-14 的 1116/1117。仅报告限定记录，不证明整机无威胁。
- 原 DB hash 与既有基线相同。证据：`.m1-evidence/m58-recovery-validation-20261005.json`。旧失败与隔离记录保留，无空间回收。

原 EPERM 根因仍未查明；直接解包是避免该操作的实现选择，不声称已证明或修复 Windows 文件占用根因。Defender 告警与原文件增大证据另存 `.m1-evidence/m58-7zip-integrity-20261003-findings.md`。不恢复隔离文件、不关闭防护；源码/工具检查不能证明整台主机无威胁。

## 下一步

继续 M5–M8 的人工/复杂版面与质量评测缺口；不要重做已通过的构建恢复验证，除非代码、依赖或环境变化要求重新验证。产品业务代码没有因本次构建恢复修改。
