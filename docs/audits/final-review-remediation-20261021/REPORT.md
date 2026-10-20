# 最终复核后的整改与验证

日期：2026-10-21。输入为 `../architecture-final-review-20261021/` 四份报告；原报告未修改。

本机 PowerShell、Git、Python、Node 均可运行。已用 JSON 解析器读取 FINDINGS_FINAL.json，包含 16 项发现。Claude 宿主的 VM 磁盘限制不等同于本机工具不可用，本轮没有为此删除文件。

## 结论

继续沿用 Electron 单一 Pi 循环与 Python 业务后端。四项发布前问题 X02 / X03 / X05 / X14 已在源码中处理；其中 X03 经复现后修复，X02/X05 有业务回归，X14 是安装态分支的源码限制及构建检查，尚未重新安装验证。

本轮没有迁移真实用户库、改动 Pi 依赖版本、发布 GitHub、替换用户安装版或关闭系统保护。不存在“所有架构债务清零”的结论。

## 发现处置

| ID | 处理 | 依据与边界 |
| --- | --- | --- |
| X02 | 修复，采用更保守的恢复范围 | 写入认领前和 outbox 提交后重新检查同一候选人的 running/outcome_unknown；新任务也检查。工具别名、修订号、阶段、替换 run，甚至新岗位不能跳过旧未知结果。候选人的未解决操作会阻止其他写入，读取仍可用。没有给历史记录猜测 MCP 原名或自动解除未知状态。 |
| X03 | 复现并修复 | 修改前，网络读取未结束时无关数据库写入超时。现在短事务登记 running，释放锁后联网，短事务合并回执。相同 call_id 同时执行被拒，不同 call_id 可并行，回执不会覆盖。 |
| X05 | 修复解析/报告有效性；明确草稿语义 | PDF 上传由 pypdf 解析真实页数，拒绝伪 PDF、加密或零页文件，调用 artifact_required=True 门禁；客户端页数头不作依据。编辑后清空 PDF 引用和旧页数，并将旧质量报告标 pending/stale。界面写“草稿已验证，可编辑和导出”。不把草稿完成等同于 PDF 通过，也不把解析/页数检查当作 PDF 正文逐字事实比对。 |
| X14 | 源码修复 | `FETCHCV_V2_STORAGE_ROOT` 仅在 `!app.isPackaged` 时选择实验后端。安装版继续走 Python；未提供新的公开 V2 开关。 |
| X04 | 修复 | 启动时独立生成 approvalKey，仅给宿主签名器和 sidecar 环境。renderer 的 API 控制令牌不能签出有效批准；没有把 approvalKey 加到窗口参数、查询字符串或 IPC 返回值。日志脱敏会覆盖该 KEY。 |
| X08 | 修复主要体积问题 | 工作区结果前置 120 条等规模事实的 ID/160 字摘要；简历仅返回可见文本，不再输出整份带头像的 content_json；完整事实正文仍在可分页的归档结果内。长结果信封在预算允许时保留全部摘要。极大事实目录仍需要分页，不承诺无限长度首屏。 |
| X09 | 修复，尊重配置上限 | 非 adaptive 的 Anthropic 思考预算为可见输出留空间。16K 配置下深度推理保留至少 8K；小输出上限模型不伪造更大容量。真实 Harness 测试发现它会过滤 thinkingBudgets，因此策略落实到注册的 provider API 边界，实际 SDK 请求已验。 |
| X10 | 改善，有限诊断仍有限 | 探测默认用 balanced 对应 medium，允许显式 thinkingLevel；总输出上限 4096，使用相同预算策略。文案为“基础工具往返已验证”。这不是所有思考档位、复杂 schema、并行调用均已验证。 |
| X11 | 修复 | ready 与 sufficient 分开：至少四篇已核验材料可以综合，即使没有小红书仍生成 limited 简报；删除 needs_nowcoder_discovery。少于四篇且平台耗尽的自动停止信号尚未另建持久化状态，不声称该边界完全自动化。 |
| X13 | 部分修复 | 增加删除独立对话 API 和侧栏入口，事务内清理消息与 chat: 归档；有活动轮次拒绝删除，联网结束后重新检查作用域，防止取消/删除后回写归档。原始上传资料作为共享材料保留。未引入自动过期、LRU 或容量配额，避免静默删除仍被引用的证据。 |
| X06 | 修复 | job_id 作用域也加入动态提示词分段。 |
| X07 | 修复 | 后端已成功、刷新失败时，宿主回执写 completed_refresh_failed，工具操作显示已完成，整体循环仍失败停止；回执保存进任务检查点。真实宿主失败分支有断言。 |
| X12 | 修复 | 字符串、数组、null、数字使用 `{value, _result_reference}`，不会被展开成下标对象。 |
| X15 | 部分修复，拒绝不安全的自动推断 | 已认领工具执行失败后，失败 trace 单独提交。审批执行前重新检查当前 operation_id，阶段/定义/目标变化给出 approval_revision_conflict，不强行以旧阶段执行。崩溃恢复仍不自动把所有历史 local 操作判 failed：历史记录不保证记录了当时 handler 的范围，不能用当前源码反推旧进程未产生副作用。前置拒绝的 trace 仍可能随请求回滚，保留为审计覆盖债务。 |
| N05 | 按最终复核留到下一迭代 | 类型化 AgentBackend 不阻断当前修复；不在这轮再替换宿主/两套后端协议。 |
| F17 | 按最终复核留到下一迭代 | JD/PDF 单次抽取仍在 Python，保留当前功能与密钥注入。未来迁入 Electron 主进程后再撤掉，不让导入依赖窗口存活。 |

## 实测与证据

证据根：`.m1-evidence/final-review-fixes-20261021/`。

| 验证 | 结果 |
| --- | --- |
| X03 修复前复现 | `x03-before.txt`：无关写入在网络未结束时超过 3 秒，测试失败；没有宣称复现了某个固定 5 秒错误文本 |
| 定向业务回归 | `core-3.txt`：52 passed，覆盖并发工具、签名、PDF、简历业务、面经、回滚和任务状态 |
| 后端全套（除三项缺失 PDF） | `python-final.txt`：197 passed、2 skipped、3 deselected |
| 最后候选人范围及旧库补表等边界回归 | `boundary-final.txt`：14 passed；包含全套之后增加的跨岗位守卫和补表测试，与全套有重叠，不相加 |
| Node / 真实 Pi / 真实 SDK | `node-final.txt`：54 passed |
| 前端生产构建 | `frontend-build-final.txt`：成功；保留已有大 chunk 警告 |
| Electron 依赖打包 | `electron-build.txt`：成功，使用上一轮保留的生产等价 esbuild 脚本，隔离输出 |
| 修改相关 ESLint | `lint-final.txt`：退出 0 |

`node-1.txt` 保留了第一次预算修复失败的证据：只把 thinkingBudgets 放入 streamOptions 时，真实 Harness 请求仍不足 8K。查阅锁定源码后改在 provider API 边界生效，最终同一断言通过。

`core-1.txt` 两项旧测试期待旧拒绝文案/直接改写 running 状态，改为检查新语义：活动记录不能由另一次调用擅自宣布为孤立；由 host reconciliation 判定。`core-2.txt` 的两项新夹具错误（缺 run_type、响应 schema 不暴露 pdf_path）已修复，PDF 失效改查数据库实体。未降低业务断言。

前端检查同时发现 App.jsx 已有 callback 提前引用状态和依赖声明问题，本轮把处理函数移到状态声明之后并补全稳定依赖，未关闭 lint 规则。

### 复现命令

在项目根运行，使用新的临时目录名：

```powershell
$env:FETCHCV_WORKSPACE_ROOT="$PWD/.m1-work/final-review-suite-workspace"
$env:PYTHONDONTWRITEBYTECODE='1'
$env:PYTHONUTF8='1'
Remove-Item Env:FETCHCV_SETTINGS_FILE -ErrorAction SilentlyContinue
& .\backend\.venv-m1\Scripts\python.exe -B -m pytest backend/tests -q -p no:cacheprovider --basetemp .m1-work/final-review-suite -o addopts='' -k 'not test_real_pdf_and_jd_domain_flow_preserves_original_resume and not test_real_resume_redaction_and_ai_preview_do_not_send_pdf_or_identity and not test_legacy_job_snapshot_rebases_on_source_layout_without_losing_body_edit'
```

```powershell
& 'D:\Nodev\node.exe' --test tests/final-review-regressions.test.mjs tests/pi-contract-regression.test.mjs tests/pi-agent-runtime.test.mjs tests/pi-harness.test.mjs tests/conversation-tools.test.mjs tests/model-profile.test.mjs tests/tool-result-preview.test.mjs tests/provider-endpoint.test.mjs tests/provider-failure.test.mjs
& 'D:\Nodev\node.exe' node_modules/vite/bin/vite.js build
& 'D:\Nodev\node.exe' .m1-evidence/architecture-remediation-20261021/build-runtime.mjs
```

Python 均在隔离数据库与工作区执行，网络由合成服务替代，没有调用真实付费模型。

## 未完成与发布边界

- 缺失 `test use/高子强的简历.pdf` 的三项真实材料用例仍不能通过，未生成冒充原件的替代材料。
- 桌面 create_schema 的旧库补表行为已用文件 SQLite 测试，但没有运行新的 NSIS 安装/升级流程，不能称为安装版升级验收。
- 本轮前端完成构建与静态检查；未使用 computer use，也没有假称手工点过界面。
- 自动归档配额/保留期、HTTP MCP 认证、Skill 相对资源、完整 AgentBackend 收敛、Python 抽取迁移均未在这一轮扩展。
- X15 的历史崩溃恢复继续保守；不能为了减少人工确认，把未知外部副作用自动重试。
- 原有未提交工作继续保留。当前源码清单与修改前备份补丁只用于追踪这轮变化，不是完整发布包，也不代表已经提交 Git。
