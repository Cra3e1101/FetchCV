# M3 runtime 契约实施报告

2026-09-21。本阶段完成运行协议、宿主边界和基础回归；M4 的 APP utility 单写存储、M5 parser 隔离与后续质量评测尚未实施。数据库 schema、旧安装包、原环境及真实素材未迁移。

## 基线与回退

基线：M2 `3737e88101235bb751d788c05ab95030bc0cea7c`。快照 `.m1-work/m3-20260921-01/m2-baseline.zip`，SHA256 `613d7fc16a003ec2b7864c920f053f37020e3226d0d78ac4ea0d8607c7ca0f1f`。未提交的 M1 文件保持原状。回退采用完整 M2 源码版本；先隔离 M3 文件，再从归档按清单恢复，不删除数据或执行 reset/clean。

## 实施

- 新增应用拥有的版本化 RPC，校验方法、workspace、deadline、2 MiB 上限及输入字段。拒绝 renderer 注入 bootstrap、provider、tools 等宿主参数。旧 `pi-agent:*` 写入通道被统一入口替代。
- 全部 19 个 invoke handler、3 个窗口事件先核验本地主 frame；子 frame 无 Node 集成；主窗口不能导航到任意本地文件。没有声称 legacy HTTP token 已撤出 renderer，该工作随 M4 存储/数据接口整体切换。
- streamId/seq/entityId/revision、ACK、补取与缺口标记；256 条/2 MiB 内存上限。展示增量可淘汰，关键记录未确认则背压停止；历史过期明确需快照。该内存日志不是跨进程事件存储，持久消息/trace/checkpoint 继续由现有 DB 保存，M4 再迁权威。
- 工具实际目标从 DB 读取并检查 candidate/job；快照回退同样检查归属。schema/revision 和目标版本绑定操作身份；MCP override schema 在宿主验证，禁止外部 schema 引用；执行记录通过条件更新原子领取，unknown 禁止自动重发。`awaiting_user_action` 保留批准后的受控继续语义。
- 附件限定既有工作区并保存 SHA256；引用须为同岗位助手消息的原文片段。二者进入用户输入，不进入系统政策；不再只保存 metadata 却遗漏 Pi prompt。尚无 Source/Document 不可变版本的附件按 workspace 文件引用处理，后续 M4/M5 升级。
- steering 输入保存 accepted/consumed/cancelled/unconsumed 回执；按输入 ID 在实际 context 中确认消费，UI 展示状态。未开启 followUp/nextTurn/compact/navigateTree 产品入口；不把 SDK 内存队列当持久队列。
- 使用真实 Harness 的最终 payload hook，脱敏后先记录再发送；记录含 payload、hash、模型与工具 schema 指纹。保存失败或超限拒绝新请求。stream、最终消息和请求记录分离，不记录凭据/header 或隐藏推理。供应商要求回送的历史推理字段仅在发送体内保留，持久快照移除并标记 `unavailable_internal_reasoning_excluded`；此类请求不宣称逐字节可重建。无此类字段的 fake/real 对照已验证快照与发送体相等。R3 的跨阶段完整重建要求仍需 M4 的保留策略与适配合同解决，不能用本轮合成通过替代。
- 基础预算超限显式失败；工具裁剪改为合法 JSON 摘要包装并保留回执引用，检查 call/result 配对。预算仍沿用 M2 provider 的窗口配置、采用保守 UTF-8 字节 allowance，并非实际 tokenizer 计数或模型窗口已核实的声明。M8 负责 profile 校准与质量驱动选择。
- 取消后不能以迟到完成覆盖对话终态；宿主释放订阅、计时器和 active 映射。观测回调抛错不会重新执行业务。未把取消解释为撤销已发生的外部副作用。

## 实测

| 检查 | 结果 | 证据 |
|---|---|---|
| Python 全量 | 165 passed / 2 skipped / 0 failures，105.888 s | `.m1-evidence/m3-python-all-02.xml` |
| Node 全量 | 最初 120/120；M4 后续回归最新 151/151（含 28 项 storage 测试）；sidecar 启停成功 | `m3-node-all-02-node.log`、`m4c-node-all-01-node.log` 与相应 `-node-exit.json` |
| 新增同合同对照 | fake Pi / real Pi 各 1 项，共 2/2；同一 RPC + FetchCVAgentHost + 合成 provider | `m3-node-06-node.log` |
| 最终构建 | Vite 2266 modules + Electron main/preload 通过 | `m3-build-03-node.log` 与 `-result.json` |
| 浏览器合成流程 | 岗位/搜索/面试/重试/主题/窄窗/降级/onboarding，通过，无页面错误 | `m3-ui-01-node.log` |
| lint | 修改的 Electron、contracts/app、测试与 AgentMessage 通过 | 显式 ESLint，不改依赖 |

Node 全量 120 项后增加了两个 parity 测试与一个推理字段排除用例；最终定向回归 8/8（m3-node-07）。不把这些用例说成与全量在同一命令中执行。provider 为合成实现，无商业 API 请求。主 frame 拒绝测试执行实际 registerIpc 的注册函数和全部 handler；不是一次实际恶意 Electron iframe 的端到端测试。浏览器测试使用 preload 替身，不能替代 Electron 安装器验收。

失败均保留：m3-python-01 的缺失文件状态码断言误写 422（实际既有合同 404）；m3-python-all-01 暴露 awaiting_user_action 被误当终态的实现回归，已修复且原断言通过；m3-node-05 的 IPC handler 数量误写 20（统一入口后实际 19），已按实际清单修正，全部 handler 逐个拒绝测试通过。另修复一个 preload 未使用变量的 lint 错误。

## 后续边界

没有改 package.json/package-lock.json 或两个原构建脚本。旧 SDK 0.80.10 沿用，没有 node_modules 补丁。新的 NSIS、签名、真实用户库迁移和实际远程供应商验证不在本阶段完成声明中。

本轮仅对批准的合成临时区执行测试工具清理；逐路径删除日志留在 `.m1-evidence/m3-*`。原生浏览器/SQLite 等子进程的完整删除覆盖仍有原审计限定，不能声称 API 收据覆盖一切 native 删除。

M4 必须先证明实际 Electron utility 的 SQLite/FTS/WAL/备份与打包加载；再做 25 表副本映射和崩溃回退。后续 M4a 的实际验证及 M4b 部分实现见 `FETCHCV_M4_EXECUTION_20260921.md`，真实用户库尚未切换。M5–M10 各自的标注质量、隔离、发布门槛同样不能用本报告替代。
