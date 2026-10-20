# M9 本地声明包格式（当前实现）

设置入口为“扩展与 Agent 设置”。选择一个 UTF-8 JSON 文件，最多 256 KiB，应用保存其不可变快照；原件保持原位。包不执行 JavaScript、Python、shell 或安装脚本，没有 ZIP 解压和路径取文件行为。

最小示例：

```json
{"manifest":{"schema":1,"id":"local.resume-review","version":"1.0.0","requiresApp":"2.x","skills":[],"agents":[{"id":"reviewer","title":"简历审阅","instructions":"只根据已有材料给出建议，不编造事实。","skills":[],"tools":["read_artifact"],"maxToolCalls":8}],"mcp":[],"requestedCapabilities":["read_artifact"],"files":{}},"resources":{}}
```

资源放在 `resources` 中，以逻辑相对路径映射 UTF-8 文本；`manifest.files` 对应值为 `sha256:` 加文本 UTF-8 字节的 SHA256。只能使用 md/txt/json，禁止绝对路径、父目录、反斜杠、设备名和其他扩展名。最多 32 个资源，各 65536 字符，整个包仍须满足 256 KiB。不会按这些路径访问磁盘或解析资源中的链接。

技能 `{id,title,path}` 指向包内资源。Agent 的 `skills` 引用技能 ID；有技能的 Agent 必须把 `read_skill` 放入 tools 和 requestedCapabilities。说明正文只在模型调用 read_skill 时提供；其内容不能提升工具或数据权限。

可声明工具：read_memory、propose_memory、search_knowledge、read_evidence、inspect_application_workspace、read_artifact、read_document、read_conversation、propose_artifact、read_skill。无跨候选人/岗位读取例外，propose_artifact 仍仅生成待确认草稿。maxToolCalls 为每次新运行最多 1–32 个唯一工具调用。

导入不等于授权。先查看完整说明和资源，逐项勾选工具，确认启用，再选择 Agent。少授予一个 Agent 所需的工具，新运行会明确拒绝启动。每次运行锁定 Agent/包的内容指纹和工具集合；切换 Agent 只影响新运行。同 package ID+version 内容变化会拒绝导入；升级使用新版本号，重新授权。旧版本运行可继续使用原快照，直至该版本停用、撤权或移除。

停用及移除立即阻止该版本后续模型请求/工具调用，不自动回滚已完成的操作。逻辑移除保留历史快照、用户资料和产物；不删除用户文件。恢复内置助手与撤销包授权是两个独立动作。

当前此切片仅实现声明式原生能力扩展，mcp 必须为空；MCP 连接、schema 发现和逐工具外部写授权仍是 M9 后续工作，不能以本切片通过代替完整 M9 验收。旧 MCP 配置保持需要复核状态，没有启动任何真实服务器。内容哈希验证一致性，不证明发布者可信或指令安全。
