# 整改计划（agent-review-20261021）

原则：先做最小有效修复，不推倒重写。每一项都必须先写出能失败的测试，确认它失败后再改代码。测试只能使用 `.m1-work/<本轮唯一目录>` 下的合成数据和 mock provider。

## 第一组：阻断正确性或数据安全

| 顺序 | 项 | 修改范围 | 依赖 | 验证 | 回滚 |
|---|---|---|---|---|---|
| 1 | F01 副作用工具异常后状态卡在 running | `backend/applyos_harness/permissions.py` 的异常分支，用独立事务写入 failed 或 outcome_unknown | 无 | 新增 pytest：确定性异常后可以重试；超时后为 unknown | 单文件回退；数据库无 schema 变化 |
| 2 | F02 “允许重试”无效 | `permissions.py:214-218` 认领条件 | F01 | resolve 之后重试成功 | 同上 |
| 3 | F04 MCP env_keys 秘密转发 | `mcp_tools.py` 增加拒绝列表；创建和批准接口在 `main.py` 中校验 | 无 | 合成 MCP 服务只断言内部变量不存在 | 拒绝列表可配置；已有配置命中拒绝列表时标为需重新配置，不删除 |
| 4 | F03 MCP 工具名清洗 | `mcp_tools.py:194-195`，增加别名映射 | 无 | 单测覆盖超长、非法字符、冲突 | 已保存的审批若绑定旧名称，需要迁移：按“服务器+原名”重新绑定 |

## 第二组：接入兼容性与运行可靠性

| 顺序 | 项 | 修改范围 | 依赖 | 验证 | 回滚 |
|---|---|---|---|---|---|
| 5 | F05 token 估算 | `context-budget.mjs`、`request-record.mjs` 共用一个估算函数 | 无 | 中英文单测；mock 回放 usage | 保留旧函数，用开关切换 |
| 6 | F06 默认最大输出 | `shared/model-profile.mjs:56` | 无 | 画像单测 | 修改 profileRevision，便于识别回退 |
| 7 | F18 setTools 双调用与过期工具快照 | `pi-agent-runtime.mjs:380-384, 504-520`，`fetchcv-harness.mjs` | 先核实 Pi 0.80.10 的 `tool_result` 事件和 `setTools` 语义（见 EVIDENCE 中的缺口） | 单测统计 setTools 次数；比对请求中的工具哈希 | 单文件回退 |
| 8 | F15 岗位 turn 的活动保护与 reconcile | `pi_bridge.py`，可能需要迁移（给 job 增加 active_turn_id） | 无 | 重启测试 | alembic downgrade |
| 9 | F14 checkpoint 生命周期 | `pi_bridge.py:573-586, 758` | 无 | 完成后新任务的 prompt 不含中断说明 | 单文件回退 |
| 10 | F19/F21 MCP 超时、Windows PATH、分页 | `mcp_tools.py` | F04 | 用合成的卡死服务器和分页服务器测试 | 单文件回退 |
| 11 | F31 核实重试语义 | 只读核实；如有问题再改 `provider-adapter.mjs` | 无 | mock 半截流式输出后断开 | — |
| 12 | F17/F29 统一模型调用入口 | 第一步删除死路由；第二步把岗位预览和 PDF 解析改为由 Electron 调用 pi-ai | 无 | Python 进程环境中不再有密钥 | 分两次提交，各自可单独回退 |

## 第三组：上下文、工具与知识能力

| 顺序 | 项 | 修改范围 | 验证 |
|---|---|---|---|
| 13 | F07 长结果分页与 `read_tool_result` | `context-policy.mjs`、新增只读工具、调整 `pi_domain_tools.py` 和 `interview_tools.py` 的输出顺序 | 200 条事实时仍能拿到全部 ID |
| 14 | F09/F10/F11/F32/F35 面经规则统一 | 抽出就绪判定函数；OCR 状态流转；门禁保留模型原文；在激活指引中补回规则 | mock 端到端：1 个来源、4 个小红书来源、OCR 来源三种场景 |
| 15 | F13 审批绑定版本 | `approval.py`、`pipeline.py` | 三条测试 |
| 16 | F08 摘要移出 system prompt | `context-policy.mjs`、`fetchcv-harness.mjs` | 检查请求快照 |
| 17 | F12/F16/F20/F24/F25 网关与门禁一致性 | `permissions.py`、`conversations.py`、`capabilities.py`、`policy.py`、`pi_bridge.py` | 每项各一条测试 |
| 18 | F23 Skill 哈希覆盖整个文件 | `skills.py` | 修改 frontmatter 后自动停用 |

## 第四组：可后置的维护性改进

- F22：选定一套 MCP 实现，冻结另一套。
- F26、F27、F28、F30、F33、F34、F36：逐项小改。
- 清理 `.m1-work`、`.m1-quarantine`、`backend/.venv-m1` 中的旧副本：需要用户确认后再执行，不能由开发 Agent 擅自删除。
- 在 README 中如实声明 MCP（stdio 和无认证的 streamable HTTP，不支持 resources/prompts/sampling）与模型协议的支持范围。
