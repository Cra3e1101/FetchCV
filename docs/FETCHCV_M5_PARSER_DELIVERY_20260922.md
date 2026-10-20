# M5 受限解析与桌面导入交付（2026-09-22，r3）

本记录接续早期 r2 的失败现场。Windows LPAC、APP 自动解析、桌面原生文件导入及安装包链路已实测通过；这不等于原方案 §21 的人工质量集已通过，也不表示真实用户环境已切换。M5–M8 总体验收仍未完成。

## 基线与边界

M4 基线 `7fcb309`；源码备份 `.m1-work/m5-m8-20260922-01/m4-source-baseline.zip`，SHA256 `43583fc0c17f0a2834c0d4579bc00aa332ef839502324a036a0f2793d5e387e0`。忽略的数据不受 Git/源码 zip 保护。旧 Python 环境、项目原数据库、原始资料及旧 installer 保留，未访问旧 FetchCV APPDATA。

用户单独授权了 `FetchCV.Parser.M5.20260922` 专用 AppContainer，包括它自己的 `C:\Users\hesan\AppData\Local\Packages\fetchcv.parser.m5.20260922` 目录及对应注册表存储。这个例外不扩展到其他用户目录。工作根仍为 `D:\hesan\Desktop\VSCODES\FetchCV_M1_work\20260910-235136`。

## 交付行为

- 原生文件选择器把所选路径通过主进程私有端口交给 APP；renderer 不能指定文件路径。单一文件句柄限 50 MiB，并用 bigint dev/ino、修改时间、大小和重复 lstat 校验身份。原件只读，副本先存 blob，再登记任务。
- APP 仍是业务库唯一写入者。精确协议、来源 revision、Document/input hash 在队列选择与原子 claim 中双重检查；取消、撤权和过期 lease 阻止迟到结果提交。正常关闭恢复 pending，重启可续作；普通解析失败不自动重试。
- 运行时预检在 claim 前完成。环境或磁盘故障保留 pending 并暂停队列，不批量标记文档失败；用户明确重试后才恢复。
- 文件导入、范围选择、解析状态、取消、重试、正文、引用和停止使用来源已接入桌面。撤回停止搜索和助手读取，原件/历史版本保留。
- 工作用目录逐段检查 workspace 边界与 junction；缓存在随机 staging 完整校验后 rename 发布，损坏缓存只隔离。全部缓存、staging、隔离目录和解析现场共享 512 MiB 保留上限，每次任务预留输入及两份最大输出，另留 256 MiB 磁盘余量。没有后台删除原件或失败现场。

## 隔离与运行时

独立分发的 [CPython 3.14.7 Windows embeddable](https://www.python.org/ftp/python/3.14.7/) 和 pypdf 6.4.1 经固定 SHA256 离线展开，带官方 CPython SPDX、许可证与逐文件 hash；不分发 Anaconda 环境。Python ZIP SHA256 `d297e5ff019966817ad8502465176139f2d3d840fa4ed84b13bed399a6ab1f15`；pypdf wheel SHA256 `1782ee0766f0b77defc305f1eb2bafe738a2ef6313f3f3d2ee85b4542ba7e535`。

采用 [Windows AppContainer](https://learn.microsoft.com/en-us/windows/win32/secauthz/implementing-an-appcontainer) 的 LPAC opt-out，仅授予 `registryRead`，无网络 capability。该 capability 用于 Windows 运行库初始化，不应被表述为禁止一切注册表读取。专用 profile 的文件/注册表 DACL 只给 host 用户、SYSTEM、Administrators；worker 只读当前 runtime/job，结果经限长管道交给 host，无可写目录。

JobObject 在 CreateProcess 时原子附加：1 个进程、512 MiB、45 秒、kill-on-close；stdout 64 MiB、stderr 64 KiB。父进程退出/取消会结束 worker，回收授权；持久授权日志及命名互斥量支持下一次恢复。Win10 19045 不支持 TokenIsLessPrivilegedAppContainer 查询（87），采用明确 WinError 5 的 AAP-only ACL 探针补证，并用普通 AppContainer 可打开相同探针的负对照验证。不能把未知错误当隔离通过。

早期失败全部保留，尤其 `m5-container-13` 暴露专用 profile 的原 ACL 可写；后续改为保护 DACL。旧合成残留未删除。`m5-parser-old-grant-revocation-20260922.json` 记录旧实验 runtime/job 的 package-SID 授权撤回。

## 实测

| 验证 | 结果与证据 |
|---|---|
| OS 隔离及资源控制 | `m5-container-15` 通过：外部/前任务读、job/runtime/profile 写、profile 注册表写、loopback 网络、额外进程均被阻止；普通 AC 对照被拒；超时、取消、输出超限、内存超限后仍可启动新任务 |
| APP 队列 | `m5-scheduler-green-03` 6/6：幂等、撤回、关闭恢复、协议拒绝、超过 RPC 大小的原生导入、基础设施暂停/恢复 |
| 缓存/路径边界 | `m58-regression-04` 的真实解析用例验证半成品缓存隔离、原子发布及中间 junction 被拒，合成外部目录仍为空 |
| 回归 | `m58-regression-04`：56 文件，181 passed，0 failed/cancelled/skipped，约 249.30 秒，退出 0 |
| 桌面 | `m5-ui-import-01`：真实 preload/utility/LPAC；导入/取消选择/搜索引用/撤回；320/768/1024/1440 宽度无溢出，renderer error 0。只有选择器返回值用合成文件替代 |
| NSIS | `m58-package-03`：退出 0；ASAR 87 条路径；105 个 parser 资源、422 个原 sidecar 文件逐一 hash 一致 |
| 提取包启动 | `m58-packaged-ui-03`：write/restart/invalid-manifest 通过；包内 parser 实际运行，导入、引用、重启后读取、撤回通过；4 个接口拒绝外国窗口；未启动旧 sidecar |
| 静态复核 | 改动文件 ESLint 和 diff whitespace 检查通过；独立 review 的队列、缓存、文件身份及工作区边界问题已修复，最终复核无新 blocker |

新验收 installer：`D:\hesan\Desktop\VSCODES\FetchCV_M1_work\20260910-235136\m58-package-03\output\FetchCV-Setup-0.4.19-win-x64.exe`。大小 **140,375,312 B**；SHA256 `da654871eaed27429dd6e737d65f2a731477d43cfe0c7e766e8b71e80f68e826`；ASAR SHA256 `5627cf4ad34b584da78ae9b3a2b9b6156aecd99a68c339517082ec8ab9e37ecb`；实测 **NotSigned**。未运行安装向导、未发布。候选含本机测试守卫，不能作为正式分发版。

## 未完与回退

原 §22 明确 OCR 和本地 dense 是可选；高级语义摘要、自动过程经验不应自行升级为 M8/M7 退出条件。扫描件目前 needs_review，不进入搜索，不冒充 OCR 成功。文本格式的复杂布局准确率、§21 的 60 来源/400 查询/100 对话、人工标签与至少 20% 双标注仍需正式测量；现有合成测试不能替代它们。

复核中重新参考 [IBM MTRAG-UN / SemEval 2026](https://github.com/IBM/mt-rag-benchmark) 的不可回答、条件不全和依赖前文问题分类，以及 [HaluMem](https://github.com/MemTensor/HaluMem) 的记忆操作级评测。仅用于改进本项目评测设计，不引用其成绩作为本项目成绩、不下载真实履历或向外部服务上传文件。前者是 2026 工作；HaluMem 核心论文为既有工作，不能因仓库更新就改称 2026 新算法。

项目根所有者仍为 `LAPTOP-6C3TR05Q\CodexSandboxOffline`，未修改整树所有权。同权限本地进程瞬时替换路径的通用竞态不等于已取得 OS 全文件系统事务保障。

关闭验收候选即可继续使用旧 installer；未切换真实 workspace。源码回退需在新目录使用 M4 备份/指定 Git 提交，不能覆盖未提交内容或新数据。若用户已在 V2 写入，应先完整导出 DB/WAL/blobs，不能用源码回退代替数据备份。专用 profile 和全部现场保留，不执行清理删除。JS 删除审计只覆盖拦截到的 API，不能宣称穷尽原生 SQLite/Chromium/构建工具删除。
