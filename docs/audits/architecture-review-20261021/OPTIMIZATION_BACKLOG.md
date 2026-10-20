# 整改待办（按依赖顺序）

每一项都应先由开发 Agent 按 VALIDATION_HANDOFF.md 写出会失败的验证，确认失败后再修改代码。

## 必须修复

### T0 两套后端的收敛决策（N04，F22）
- **解决的问题：** 两套后端并行，每项修改都要做两遍，而且安全模型不一致。
- **为什么值得做：** 后续 T5、T9、T10 的落点都取决于这个决策。
- **修改边界：** 只产出文档，不改代码：一份能力对照表（legacy 与 V2 各自支持哪些工具、存储和扩展），以及书面决策。
- **最小方案：** 声明 legacy 为生产后端，V2 冻结新功能。
- **长期方案：** 按能力逐项迁移，每迁移一项就下线 legacy 的对应实现。
- **风险：** 无代码风险。
- **验收：** docs 中存在决策文件，并在 README 中引用。

### T1 统一端点解析，并把连接测试改走运行时适配器（N02）
- **修改边界：** 新增 `shared/endpoint.mjs`；修改 `electron/main.mjs:189-245`、`electron/pi/provider-adapter.mjs:7-10`、`shared/model-profile.mjs:12-21`。
- **最小方案：** 三处共用同一个 `resolveEndpoint`；明确 Anthropic 的 `/v1` 处理规则（SDK 自己会追加 `/v1/messages`，所以 baseUrl 末尾的 `/v1` 要剥离）。
- **长期方案：** 连接测试改用 pi-ai `streamSimple` 发一个带工具的流式请求，结果分两级展示（可对话 / 可调工具）。
- **风险：** 已保存的 baseUrl 不需要迁移，只是解析结果变化。必须对现有用户填写的几种形式（带不带 `/v1`、带不带完整路径）逐一保持结果不变，**唯一例外**是当前错误的 `/v1/v1` 情形。
- **验收：** 参数化测试覆盖 2 种协议 × 5 种 URL 形式，测试请求地址与运行时请求地址一致。

### T2 修正 MCP 工具注册名（F03）
- **修改边界：** `backend/applyos_agent/mcp_tools.py:194-216`，新增别名到原名的映射。
- **方案：** 清洗为 `[A-Za-z0-9_-]`；超过 64 字符时截断并加 8 位哈希；冲突时拒绝注册并在 UI 中提示。
- **风险：** 已有审批绑定的是 `mcp_write:{server.id}:{original_name}`（用原名），不受影响。
- **验收：** 单测覆盖非法字符、超长、冲突三种情况；mock provider 的名称校验通过。

### T3 补全副作用工具的失败分类与恢复协议（F01、F02）
- **修改边界：** `backend/applyos_harness/permissions.py`、`backend/applyos_api/main.py:1180-1207`。
- **方案：**
  - ToolSpec 增加 `effect_scope`；
  - local_transactional 工具抛异常时，在独立事务中写 `failed`，下次相同 operation 视为可以重新认领；
  - external 工具保留 `outcome_unknown`；
  - 认领条件加入 `retry_authorized`。
- **风险：** 不需要迁移（status 字段是字符串）。effect_scope 默认值设为 external，以保持现有的保守行为。
- **验收：** 三条测试，分别覆盖本地失败后可重试、外部失败后未知、resolve 之后可重试。

### T4 修复 Pi 事件契约误用（N01）
- **修改边界：** `electron/pi-agent-runtime.mjs:497-521`、`tests/`。
- **方案：** 删除 subscribe 中的 tool_result 分支；task 模式的刷新改在 `execute()` 返回前完成（取后端在工具响应中附带的 `tools` 字段，后端需同步返回）；新增一条使用真实 AgentHarness 的宿主测试。
- **风险：** 每次工具调用多一次查询，或者由后端随响应附带工具列表（推荐后者）。
- **验收：** 真实 harness 测试中，阶段变化后下一次请求的 tools 随之更新。

### T5 长工具结果的回读通道（F07）
- **依赖：** T0（决定在哪个后端实现）。
- **最小方案：** `inspect_application_workspace` 的输出先放 ID 索引，简历正文改为按需读取；新增只读工具 `read_tool_result(ref, offset, limit)`，后端对只读工具的结果也做存档。
- **长期方案：** 与 V2 的 `read_document` 统一为同一个分页协议。
- **风险：** 新增数据表或存档字段，需要 alembic 迁移，回滚时 downgrade。
- **验收：** 合成 120 条事实时，模型可见内容中包含全部 fact_id；超长结果可以分页取回。

### T6 默认输出预算（F06）
- **修改边界：** `shared/model-profile.mjs:56`。
- **方案：** 已知上限时取 `min(ceiling, window/4, 16384)`；未知时取 8192，并在设置页提示。
- **风险：** 部分厂商在 max_tokens 超出时直接报错。依赖 T1 的连接测试来提前暴露。
- **验收：** 画像单测通过；请求快照中的 max_tokens 符合预期。

### T7 面经规则统一与门禁修正（F09、F11）
- **修改边界：** 新建 `backend/applyos_agent/interview_policy.py`；修改 `interview_tools.py:557-579, 1287-1291`、`pi_bridge.py:838-874`、`prompt_contract.py:22-32`。
- **方案：** 用一个 Policy 返回 `{ready, sufficient, missing}`；停止抓取的条件允许“平台已耗尽”；门禁保留模型原文，另存结构化结果；来源计数按本轮统计。
- **验收：** 三种来源组合下，检索、简报、门禁三处给出一致的判定；模型原文被保存。

### T8 检查点生命周期（F14）
- **修改边界：** `pi_bridge.py:573-586, 750-758`。
- **方案：** 完成时标记 settled；仅在 interrupted 时注入；注入格式为 JSON 并加不可信标记。
- **验收：** 正常完成后新任务的 prompt 中不含中断字样。

## 建议优化

| 编号 | 内容 | 依赖 | 验收 |
|---|---|---|---|
| T9 | 抽出 AgentBackend 接口与契约测试（N05） | T0 | 两个适配器都通过同一套契约测试 |
| T10 | 能力画像增加 compat 与输入模态（N03、F30），UI 提供高级选项，并公布支持矩阵 | T1 | mock 网关拒绝 developer 角色时，覆盖设置生效 |
| T11 | token 估算改进，溢出时先降级再报错（F05、N06） | — | 中文长历史不误报溢出；本轮工具结果不会被替换成占位 |
| T12 | systemPrompt 函数化，按 activeTools 组装（N09） | T4 | 切换到面经模式后，请求的 system 内容中没有 WEB/WORKSPACE 规则 |
| T13 | MCP 会话超时、Windows PATH、HTTP 认证、分页、错误文本（F19、F21、F34），以及 env 拒绝列表（F04） | T0 | 合成服务器测试集通过 |
| T14 | 收回 Python 的模型调用与密钥（F17、F29，先复核） | T1 | Python 进程环境中不再出现密钥 |
| T15 | 摘要移出 system（F08） | — | 请求快照中可见变化 |
| T16 | Pi 升级评估（N07）：先在 0.80.10 上建好契约测试，再在 0.99.x 上运行 | T4 | 契约测试在两个版本上都通过或差异有记录 |
| T17 | sidecar 日志与健康检查 nonce（N11） | — | 端口冲突和崩溃都能从日志中诊断 |
| T18 | 复核待复核线索 F10、F13、F15、F16、F23、F24、F26、F28、F33、F35、F36 | — | 每条给出明确结论 |

## 暂不值得做

- **更换运行时，或引入 DeepSeek Harness / Cordis：** 现有问题都不需要。
- **改用 Pi 的 JSONL 会话或 compaction 取代后端持久化：** 会造成两个权威来源。
- **按厂商接入真实 tokenizer：** 保守估算足够，收益不明确。
- **扩展的热更新框架。**
- **改用客户端键做幂等去重（F12）：** 现有的语义 operation_id 更安全。
- **在 T0 之前给 V2 添加新的业务工具。**
