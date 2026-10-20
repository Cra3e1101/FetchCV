# 下一步行动（按实际风险排序，共 10 项）

“可直接执行”表示开发 Agent 可以直接动手；“需产品选择”表示要先由产品负责人拍板。

| # | 项 | 改动边界 | 验收条件 | 执行方 |
|---|---|---|---|---|
| 1 | X03：独立聊天在网络 IO 期间持有写锁 | 只改 `conversations.py` 的 `execute_chat_tool`，拆成三段：短事务里用 CAS 登记“运行中”，IO 时不持锁，再用短事务提交结果 | 模拟 8 秒网络，两个并发 call_id 都成功；同时发起的其他写入不报 locked；同一 call_id 并发请求时第二个被拒绝 | 可直接执行 |
| 2 | X02：结果未知的守卫可被绕过 | `permissions.py` 中给外部工具增加按“工具原名 + server.id”的守卫；`pi_bridge.start_task` 遇到含未知操作的 run 时拒绝启动 | 修改修订号后用相同参数调用，handler 执行 0 次；run 被阻塞时 start_task 返回明确错误 | 可直接执行 |
| 3 | X05：“完成”的语义与产物门禁 | 在 `main.py` 的 PUT /pdf 中调用产物门禁，页数由服务端解析；编辑器保存时把旧报告标为 stale；UI 文案改为“草稿已验证、待导出” | 不存在 pdf_generated=passed 却没有真实文件的报告；编辑后旧报告失效 | 门禁部分可直接执行；COMPLETED 的展示语义**需产品选择** |
| 4 | X14：安装版禁用 V2 开关 | `electron/main.mjs` 的分支条件中加入 `!app.isPackaged` 或显式构建标志 | 安装版设置该变量后仍进入 Python 后端 | 可直接执行。若要对外提供 V2 实验功能，**需产品选择** |
| 5 | X04：审批使用专用密钥 | 主进程生成 approvalKey，只传给 sidecar 的环境变量；`host_approval.py` 和 `conversation-tools.mjs` 改用该密钥 | 用控制令牌签出的批准被拒；渲染进程参数中没有该密钥 | 可直接执行 |
| 6 | X08 + X12：工作区读取输出瘦身 | `pi_domain_tools.inspect_application_workspace` 只返回事实摘要和简历可见文本，不含图片；`trimToolResult` 正确处理非对象结果 | 120 条事实加带 base64 头像的简历：首次可见结果里有全部事实摘要，且不含 base64 | 可直接执行 |
| 7 | X09 + X10：推理预算与探测一致 | 任务模式下保证可见输出不少于 8192；探测使用运行时的 thinking 级别，maxTokens 不超过 4096 | mock Anthropic 请求体中 max_tokens 减去 budget_tokens 不小于 8192 | 可直接执行 |
| 8 | X11：面经“就绪”与“充分”分开 | 只改 `interview_evidence.py` 与检索结果字段；删除 needs_nowcoder_discovery | 小红书受阻、有 4 篇牛客时，生成 evidence_status=limited 的简报 | 可直接执行 |
| 9 | N05：AgentBackend 最小接口 | 只动 JS 层，HttpBackend 包住现有 URL，V2 改为实现接口；不改 Python 路由 | 两个适配器通过同一套契约测试 | 下一迭代，可直接执行 |
| 10 | F17 + X13：抽取迁入 Electron 主进程；归档清理 | 主进程用 pi-ai 完成 JD/PDF 抽取，sidecar 只做解析和入库；之后删除 sidecar 中的密钥字段；新增对话删除接口并清理 chat: 归档 | sidecar 环境变量中不再有模型密钥；导入预览可用；删除对话后归档随之清理 | 下一迭代；归档保留期限**需产品选择** |

## 不应再改

- **Pi 主循环、在 execute 内调用 setTools 的时序、systemPrompt 函数化。** 已与 0.80.10 的契约对齐。
- **operation_id 的语义去重，以及“结果未知即停止”的原则。** 只补全守卫，不要改成按客户端键去重。
- **保守字节预算。** 后续只可以加校准，不要换成 tokenizer。
- **简历审批的内容哈希绑定。**
- **MCP 别名、白名单和整会话超时。**
- **Skill 的全文件信任机制。**
- **不升级 Pi。** 要升级，需单独立项：先读 0.80.10 到目标版本的变更记录，再在现有契约测试上跑一遍。不要和本清单中的任何一项同时进行。

## 需要产品选择

- COMPLETED 在界面上展示成什么意思（第 3 项）。
- V2 是否对安装版用户开放（第 4 项）。
- 归档的保留期限与容量上限（第 10 项）。
- Skill 是否支持目录内的相对资源。目前建议只支持单文件 Skill，并写进产品范围。
- 是否支持 HTTP MCP 认证头。不必阻断本次发布，但需在文档中写明“暂不支持”。
