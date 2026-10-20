# M2 完成报告

2026-09-21。结论：原设计 §22 M2 的源码迁移及验收完成。唯一生产 model→tool→model loop 为 Electron Pi AgentHarness；Python 保留确定性工具、权限/审批、存储及既有单次模型能力。没有实施 M3 的全面 RPC 重构、M4 数据库迁移或后续算法改造。

## 1. 基线与保护

- 原基线：`1959bb8d3832fd405d77db9fb53d3b40e6c35644`，迁移前 `git fsck --full` 通过。
- 完整已跟踪源码快照：`.m1-work/m2-20260921-01/baseline-tracked.zip`，1,265,709 B，SHA256 `58759a9ba399afe220314272f84cbdd8128068a3dc4cdc44675a67a0d605efa0`。
- 尚未提交的 M1 文件另存 `pre-m2/`，46 个文件的最终哈希均与 `backup-manifest.json` 一致。
- Git/源码快照不覆盖旧环境、DB、installer、真实素材；本轮没有迁移或清理这些内容，也没有操作用户 APPDATA。
- 稳定工作根：`D:\hesan\Desktop\VSCODES\FetchCV_M1_work\20260910-235136`。所有测试使用独立新子目录，没有回退系统 TEMP。

## 2. 逐项变更与能力接线

| 动作/能力 | 路径与接点 | 验证 |
|---|---|---|
| 退役 Python loop | engine.py、conversation_tools.py、agent/pipeline.py；service.converse；TaskQueue 的 worker/claim/enqueue | 三个原模块与六个相关旧 pyc 只移动到 `.m1-quarantine/m2-20260921-01/`，逐文件 SHA256 一致；生产目录符号搜索无旧 loop 引用 |
| 关闭 HTTP 启动和对话 SSE fallback | applyos_api/main.py 的 create_job_message、stream_job_message、任务 enqueue/resume/retry、旧消息 queue | 返回 409 `desktop_agent_required`，不创建消息或任务；GET 历史/trace SSE 保留 |
| 确定性创建 run | AgentRunCreate 默认 auto_start=false；PiDomainPipeline.create_run | 无 Python 模型配置也可创建；幂等键和 candidate/job 归属仍校验；显式 auto_start=true 拒绝 |
| 唯一前端执行路径 | src/lib/api.js、src/App.jsx | 无 preload 的 Agent 调用明确拒绝，零 HTTP 回退；运行中输入只调用 Pi steering |
| 旧队列兼容 | list_queued_messages / cancel_queued_message、AgentWorkspace.jsx | 重启两次仍可读、顺序不变、不自动处理；界面明确“不自动发送” |
| 工具与审批 | capabilities.py + pi_domain_tools.py + pi_bridge.py | web/browser/workspace/context/interview/application/skills/MCP 沿用 ToolGateway；高层领域工具提供岗位审核、简历补丁、批准后应用与验证；审批、幂等、越阶段拒绝仍通过 |
| 取消和宿主切换 | FetchCVAgentHost.run；Pi task control/tool/complete/fail | 正常 resolve 的 abort 不能提交完成；停止后拒绝新工具；task_id 必须属于当前任务；旧宿主迟到失败不能覆盖新任务；取消后不能重试启动同一 run |
| SDK 初始化失败 | FetchCVAgentHost.run 的 try/catch/finally | 初始化失败记入 turn/task fail，活动映射释放，不滞留 running |
| 模板/素材保真 | test_agent_real_materials、stage7/Pi API 测试 | 真实 PDF 只读；确定性领域流程保持原模板、未修改块；PDF/Word 导出相关测试通过 |

源码搜索命令：`rg -n 'build_conversation_gateway|ConversationToolAgent|AgentTaskWorker|AgentEngine|build_agent_engine|\.converse\(' backend/applyos_agent backend/applyos_api src electron`，结果无匹配。隔离区与备份故意保留旧实现；它们不进入本轮构建。

SDK 接线证据：`electron/pi/fetchcv-harness.mjs` 创建已安装的 Pi 0.80.10 AgentHarness；`tests/pi-single-loop.test.mjs` 使用真实 SDK 和合成 provider，验证 model→tool→model、save_point/settled 与 session 写入顺序。InMemorySessionRepo 不被当作跨进程持久化证明。

三种 SDK 队列的边界：真实 SDK 测试确认 abort 清空 steer/followUp，而 nextTurn 保留。FetchCV 当前只向产品暴露 steering，每轮新建 Harness，停止后丢弃实例；未启用 followUp、nextTurn、compact 或树导航的新产品入口。用户输入由现有消息记录保留，不自动重放。消费确认、压缩竞态和全面 revision 合同仍按 R3 列入 M3，不宣称本轮已实现。

## 3. 实测结果

| 项目 | 最终结果 | 证据 |
|---|---|---|
| 后端完整回归 | 152 passed / 2 skipped / 0 failed，106.389 s | `.m1-evidence/m2-python-04.xml` |
| Node 全套单元/sidecar | 108 passed / 0 failed；runner success=true | `m2-node-all-02-node.log`、`m2-node-all-02-node-exit.json` |
| 前端生产构建 | 2266 modules；通过 | `m2-build-02-node.log`、`m2-build-02-result.json` |
| Electron runtime 打包 | main.mjs 约 2.9 MiB；通过 | 同上；原构建参数仅输出目录隔离，原构建脚本未修改 |
| 浏览器合成流程 | 明暗主题、窄窗、岗位切换、Pi preload 测试替身、重试、服务降级、onboarding；零页面错误 | `m2-ui-01-node.log`、`m2-ui-01-node-exit.json`；截图在稳定根 `m2-ui-01/screenshots/` |
| 静态检查 | 修改的 JS/JSX/测试 ESLint 通过；差异检查通过 | 使用 `git -c core.whitespace=cr-at-eol diff --check` 尊重基线 CRLF；修复了一处真正的尾随空格 |
| 构建清单 | 70 文件 / 6,082,843 B；敏感文件名及三类常见密钥模式零命中 | `.m1-evidence/m2-closeout-evidence.json` |

Python 数量变化：原 155 passed / 2 skipped。隔离两个旧 loop 专用测试文件中的 11 项，撤下两个专门断言 Python SSE loop 的测试，新增 10 项 M2 合约用例，因此最终 152 passed / 2 skipped。未把退役测试算作通过。原有事实/审批/权限/真实材料断言迁入 Pi 工具/API 或确定性领域测试；旧 loop 的专有规划/合成策略不再作为 Pi 行为要求。原两项跳过原因仍保留于 JUnit，未改成伪通过。

失败现场全部保留：

1. `m2-python-01`：stage7 夹具依赖自动 Python 流水线。改为显式 Pi 工具推进后通过。
2. `m2-node-all-01`：测试 sidecar 已启动，但沙箱内 taskkill 返回 Access denied，35 s 超时。按规则停止；用户要求继续后，在沙箱外仅处理已核实的测试进程。后续完整回归仍保留删除守卫，并证明 sidecar 正常启停，未修改项目 ACL。
3. `m2-python-03`：新测试的 host_id 使用过短合成值，未满足既有 schema。修正测试输入并增加 HTTP 状态断言，没有放宽业务校验；最终全量通过。

## 4. 文件隔离与删除审计

- 三个原模块合计 46,366 B、六个相关旧 pyc、两个旧 loop 测试文件均隔离保留。M2 不以空间回收为目标；原件物理删除数为 0（操作记录层面）。路径/哈希见 `.m1-work/m2-20260921-01/retired-*.json`。
- 四次 Python 测试共 10 条成功删除 API 收据；浏览器测试 244 条、242 个不同路径；其余 Node/构建运行 0 条。均落在各自批准的临时子目录，blocked=0。
- `rm` 与其内部 `rmdir` 可为同一路径分别留收据，不把 254 条 API 收据说成 254 个不同文件。
- 原生浏览器/构建子进程的完整删除计数仍有 M1 已披露的审计局限；不能把文件监视器零违规提升为完整 native 删除证明。
- package.json、package-lock.json、两个原构建脚本与 Git 基线逐字节一致。M1 的 46 个既有文件未修改。

## 5. 未纳入本次完成声明的内容

- 本次未生成新 NSIS、未安装新版本、未替换 release 内旧 installer；构建验收仅为前端及 Electron runtime。实际商业模型调用、真实账户网页流程未运行；loop 验证使用真实 SDK + 合成 provider。
- Python 单次模型调用和 PDF/OCR 能力保留；没有声称 API Key 已不交给 Python。全面跨语言模型边界属于 M3。
- 既有项目所有权问题未修复；本轮也没有改 ACL。
- 产物扫描只覆盖文件名及已列明的凭据模式，不保证发现任意编码秘密。
- 原有 M1 文件仍未提交，独立于 M2 提交；它们有前述快照，不被混入本次变更。

## 6. 回退方法

回退整个版本，不在 M2 内重新打开旧 loop：

1. 停止 FetchCV 和本任务测试进程，确认实际 PID/可执行路径，不沿用旧 PID 猜测。
2. 根据 `.m1-evidence/m2-change-paths.json` 的明确文件清单，将当前 M2 文件先移入项目内新的回退隔离目录；不物理删除。先保存用户之后的修改。
3. 将 `baseline-tracked.zip` 解压到新的 `.m1-work/m2-rollback-<运行ID>/`，只复制清单内基线存在的文件回原路径；M2 新文件留在隔离区。旧 engine/conversation/worker 必须与旧前端整体恢复。
4. 保留原 .gitignore、M1 requirements/tools、DB、真实素材和 installer；不执行 git reset --hard、git clean 或全树覆盖。
5. 需要恢复旧运行环境时显式选择原 `backend/.venv/Scripts/python.exe` 或原 installer。不要让旧版与新版同时写同一用户目录。
6. 恢复后的验证继续使用新的稳定临时子目录，不复用历史 pytest basetemp。

最终提交信息及暂存清单另存 `.m1-evidence/m2-git-closeout.json`；原方案和此前失败报告均未覆盖。
