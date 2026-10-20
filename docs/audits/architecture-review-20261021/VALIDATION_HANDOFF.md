# 验证交接清单（只设计，不执行）

通用约束：
- 只在 `.m1-work/arch-validate-<时间戳>/` 下工作，使用合成数据。
- 先阅读 `backend/tests/conftest.py`，确认数据路径。
- Electron 端测试必须设置 `FETCHCV_E2E_USER_DATA` 为隔离目录（`electron/main.mjs:55-58`）。
- 禁止使用真实密钥和真实 MCP 服务。
- mock provider 使用本地 HTTP 服务，同时实现 OpenAI 的 `/chat/completions`（SSE）和 Anthropic 的 `/v1/messages`（SSE），并记录请求路径、请求头（密钥脱敏）和请求体。

| 编号 | 被验证的结论 | 合成输入 / mock | 观察什么 | 通过判定 | 何时撤回该结论 |
|---|---|---|---|---|---|
| V1 | N02：Anthropic 地址以 `/v1` 结尾时，连接测试与运行时地址不一致 | mock Anthropic 只响应 `/v1/messages`；baseUrl 填 `http://127.0.0.1:P/v1` | 连接测试请求的路径；Pi 运行时请求的路径 | **缺陷成立**：测试 200 而运行时 404，或运行时请求 `/v1/v1/messages` | 运行时请求的是 `/v1/messages`（说明 SDK 对 baseURL 的处理与静态判断不同） |
| V2 | N01：task 模式的工具刷新从未执行 | 真实 AgentHarness 加 mock provider，依次调用工具 A（使阶段变化）、再进行一轮；后端 GET task-tools 计数 | GET task-tools 的调用次数；第二次请求中的 tools | **缺陷成立**：调用次数为 0，且第二次请求的 tools 与第一次相同 | 调用次数大于 0（说明订阅者能收到 tool_result） |
| V3 | F31 不成立：部分流式输出后不会重试 | mock 先输出半个 tool_call，然后断开连接 | mock 收到的请求次数；工具执行次数 | **结论成立**：请求 1 次，工具 0 次 | 请求次数大于 1 |
| V4 | F01：本地事务型工具失败后被永久视为“结果未知” | pytest：注册一个 side_effect 工具，handler 抛 ValueError；同参数再调用一次 | 第二次调用的错误码 | **缺陷成立**：第二次得到 tool_outcome_unknown | 第二次重新执行 |
| V5 | F02：resolve(not_executed) 之后仍无法重试 | 承接 V4，调用 resolve，再调用一次工具 | 错误码 | **缺陷成立**：报“已被其他调用领取” | 重试成功执行 |
| V6 | F03：MCP 工具名导致所有请求失败 | 合成 FastMCP 服务，暴露名为 `a.b` 的只读工具并加入白名单；mock OpenAI 按 `^[a-zA-Z0-9_-]{1,64}$` 校验 | 一次普通的岗位聊天请求 | **缺陷成立**：普通请求也返回 400 | 注册时已被过滤或改名 |
| V7 | F06：自动输出上限 ≤ 2048 | 自动画像，contextWindow=128000 | 请求快照中的 max_tokens 或 max_completion_tokens | **缺陷成立**：值 ≤ 2048 | 值 > 2048 |
| V8 | F07：事实 ID 被截断 | 合成 1 个岗位（2 万字 JD）、120 条事实；task 模式；mock 模型第一步调用 inspect | 第二次请求中工具结果文本里出现的 fact_id 数量 | **缺陷成立**：少于 120 | 等于 120 |
| V9 | F05 / N06：中文长历史误报溢出；本轮工具结果被替换为占位 | contextWindow=32000，中文历史约 2 万字；task 模式下工具连续返回 3 次各 2 万字符 | 是否抛出 context_overflow；是否出现 truncated 占位以及重复读取 | **缺陷成立**：在真实 token 远低于窗口时报溢出，或出现占位导致的重复读取 | 无溢出，且无重复读取 |
| V10 | F09：只有小红书来源时空转 | 4 篇已分析的小红书来源，牛客 discover 返回空；mock 模型遵循 required_next_action | discover 的调用次数 | **缺陷成立**：超过 3 次仍未生成简报 | 生成了标注为证据有限的简报 |
| V11 | F11：门禁替换模型原文 | 面经模式下 mock 模型不调用 build_brief，直接回答 | 存储的 assistant content | **缺陷成立**：内容为固定文案，原文不可恢复 | 原文被保留 |
| V12 | F14：完成后仍注入“中断”说明 | 正常完成任务 1，再启动任务 2 | 任务 2 的 prompt | **缺陷成立**：含“桌面进程曾中断” | 不含 |
| V13 | N03：自定义网关不兼容 | mock 网关拒绝 `developer` 角色和 `max_completion_tokens` | 请求是否失败；有无办法通过配置绕过 | **缺陷成立**：失败且没有配置入口 | 存在可用的覆盖方式 |
| V14 | F19：MCP initialize 挂起 | 合成服务器在 initialize 后不再响应 | 工具调用返回所需时间；子进程是否残留 | **缺陷成立**：超过 60 秒或子进程残留 | 有界返回且子进程已清理 |
| V15 | 打包产物 | 在隔离目录构建安装包，检查 asar 和 sidecar 内容 | 是否包含 alembic 迁移；Pi 的 lazy 模块是否已打进 bundle | 两项都存在才算通过 | — |
| V16 | 待复核线索 F10、F13、F15、F16、F23、F24、F26、F28、F33、F35、F36 | 依照 FINDINGS_REVIEWED.json 中各条的 verification_needed | — | 每条给出“成立 / 不成立”的结论 | — |

## 对架构判断本身的撤回条件

- **N01：** 如果 V2 显示 subscribe 确实能收到 tool_result，就撤回 N01，并重新评估 F18。
- **N02 / T1：** 如果 V1 显示运行时地址正确，就把 T1 降为“建议优化”，只保留“连接测试应验证工具协议”这一部分。
- **N04：** 如果产品负责人确认 V2 已有明确的迁移计划和负责人，N04 改为“执行计划问题”，不再是“缺少决策”。
