# M2：唯一 Pi loop 迁移

执行授权：用户 2026-09-21「开始执行 m2 吧」。依据原方案 §17、§22 M2，以及执行方案 R2 / Harness 补充 R3。不实施 M3–M10，不变更依赖锁、数据库结构或真实用户数据。

## 回退点

Git 基线 `1959bb8d3832fd405d77db9fb53d3b40e6c35644`；`git fsck --full` 返回 0。
`.m1-work/m2-20260921-01/baseline-tracked.zip` 保存基线源码；`pre-m2/` 保存尚未提交的 .gitignore、requirements、scripts/m1 和 docs；SHA256 见同目录 backup-manifest.json。该备份不包含环境、数据库、安装器或真实素材，它们原位保留。
退役源码/旧 loop 专用测试只移入 `.m1-quarantine/m2-20260921-01/`，不物理删除。回退需停止应用后恢复整套旧源码，不能在新版内通过开关重新启用旧 loop。恢复不得覆盖用户数据库。

## M2a 调用链与范围

| 能力 | 现状/证据 | M2 动作 |
|---|---|---|
| 对话 | src/lib/api.js streamPiMessage 有 Python POST SSE fallback | 仅调用 preload；无 preload 明确 desktop_agent_required |
| 任务 | API create/resume/retry 调用 _agent_engine；lifespan 启动 AgentTaskWorker | 创建仅持久化；启动/恢复由 Electron Pi；移除 Python worker |
| 追问 | App.jsx 在无 steerPiTask 时入 Python 队列 | 仅 Pi steering；旧队列可读/取消，不自动发送 |
| 领域工具 | pi_domain_tools.py PiDomainPipeline + build_pi_task_gateway | 沿用确定性分析结果写入、事实校验、版本、审批能力 |
| 通用工具 | capabilities.py 注册 web/browser/workspace/context/interview/application/skills/MCP | 保留 ToolGateway 权限、审批、幂等；不增加绕过路径 |
| 历史 | API GET run/steps/events/workspace/queue | 保留；GET 事件流不是模型 loop |
| 单次模型调用 | PDF 解析、AgentService 分析/策略 | 保留现有能力；M3 再处理跨语言模型调用边界 |
| 取消 | AgentHarness.abort 可能正常 resolve；host 当前随后提交 complete | 增加取消检查及停止状态回归，防止取消后成功提交 |

实际 SDK 为已安装 Pi 0.80.10 AgentHarness（不是低层 Agent）；不升级依赖。InMemorySessionRepo 不是持久数据库。SDK hooks / abort / queue 行为只依据本地源码与测试，不宣称支持未经验证的 API。

## 实施与验证

1. 快照与受控基线：已完成；Node 选定 4 文件 11/11，通过守卫，证据 m2-baseline-node-20260921-01-node-exit.json。
2. 关闭旧 HTTP 执行、SSE fallback、worker 调度；保留历史和控制记录。退役 engine/conversation/model pipeline 源码，不保留隐藏可执行 loop。
3. 将旧 loop 专用测试的领域保证迁入 Pi/API 合约测试。记录退役用例与新用例数量，不把旧测试未运行算通过。
4. 验证新 Pi 对话、任务、取消、审批、幂等、历史/旧队列不自动执行；Node 假 provider 验证模型调用与工具结果串联，真实 SDK 验证接口。
5. Python 通过 scripts/m1/guarded-pytest.py（唯一新 basetemp）；Node 通过 run-guarded-node.mjs；检查退出记录和删除审计。新临时目录仅置于已批准稳定根。
6. 检查差异、前端构建、代码审查；记录未验证的真实供应商/安装器行为。仅提交本阶段明确文件，保留 M1 既有未提交文件。

失败时停止该运行，保留现场；修复自身实现再用新的独立临时目录验证。权限/范围外删除/无法证明 NSIS 的依赖改动按用户规则停止报告。

稳定根：D:\hesan\Desktop\VSCODES\FetchCV_M1_work\20260910-235136。恢复时先检查存在，不回退系统 TEMP。
