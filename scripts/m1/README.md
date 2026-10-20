# M1 工具入口与审计边界

本目录仅用于 M1 环境迁移，不修改业务逻辑。2026-09-21 接入了已验收的 scheme C 监视器；旧 runner 原件和完整 diff 位于 `.m1-evidence/m1-build-20260920-gpt01/`。

## 使用约束

- 稳定根固定为 `D:\hesan\Desktop\VSCODES\FetchCV_M1_work\20260910-235136`。恢复时必须存在，禁止回退系统 Temp。
- 每次使用新的 `--label` 和该根下尚不存在的 `--temp-root`；不得复用、清理既有测试现场。
- 需要新 Python 环境时显式设置 `FETCHCV_PYTHON` 为 `backend\.venv-m1\Scripts\python.exe` 的绝对路径。没有设置就不能声称测试使用了新环境。
- `run-guarded-node.mjs` 将 TEMP/TMP、Playwright 注册表及浏览器缓存限定在本轮临时根。测试数据库为临时根下的新 SQLite 文件，不使用真实 DB，也不使用跨连接会丢失表的内存 SQLite。
- packaged 验证的 `FETCHCV_PACKAGED_EXECUTABLE` 必须是稳定根内部的新构建 `.exe`。不要运行原有 release 路径或安装新 installer。
- 禁止为了让测试通过改动 `tests/`、`src/`、`electron/` 或 Python 业务模块。

## 判定

只有 child exit=0、`run_verdict.success=true` 且监视器完整退出才是通过。`stopped_cleanly` 仅描述监视器，不代表测试通过。

scheme C 使用 FileName、DirectoryName、Size、LastWrite、Attributes、CreationTime、Security，不订阅 LastAccess。队列按对象引用消费，`record_seq` 是记录标识；EventIdentifier 允许碰撞，不可用来去重。

Node/Python 删除守卫只覆盖相应进程内的文件 API。原生子进程操作不保证被拦截；目录通知可能合并，不可把通知数量当作删除数量。递归 API 收据、路径清单和实际文件数应分别报告。任何实际范围外删除尝试仍须停止并保留现场。

PowerShell 中送入 Measure-Object/Group-Object 属性管道的行记录应使用 `[pscustomobject]`，不可把 ordered dictionary 当成有属性的记录。

## 本次验证证据

`.m1-evidence/m1-build-20260920-gpt01/M1-REPORT.md` 汇总原始日志、失败修复、构建、尺寸、隔离和回退方法。历史候选包与失败现场全部保留。不要把旧候选包的哈希门禁当成当前正式工具的哈希。
