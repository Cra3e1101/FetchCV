# FetchCV 最后一轮架构复核

你是独立的架构审查者。这是本轮最后一次外部架构复核，请把额度集中用于源码与设计合理性，不重复大规模功能测试，不先改代码。

项目：`D:\hesan\Desktop\VSCODES\FetchCV_Windows`
基线 HEAD：`5d39706acdb97cfd0c53c931c224b0203c206a8e`
Git 命令加 `-c safe.directory=D:/hesan/Desktop/VSCODES/FetchCV_Windows`。
当前工作树有大量历史未提交改动，HEAD 不能代表当前代码。不要 reset、checkout、清理或覆盖这些文件。

## 先读这些，再独立核实

1. `docs/audits/architecture-review-20261021/` 六份原审查文件。
2. `docs/audits/agent-review-20261021/FINDINGS.json`，仅作为较早线索；F18/F31 已撤回，不要无证据恢复。
3. `docs/audits/architecture-validation-20261021/REPORT.md`，第一批修复。
4. `docs/audits/architecture-remediation-20261021/REPORT.md`、`FINDING_DISPOSITION.json`、`SOURCE_MANIFEST.json`、`VALIDATION_COMMANDS.md`，本轮处理及证据索引。
5. `.m1-evidence/architecture-remediation-20261021/` 的测试日志及 `before/`，还有本轮差异补丁 `changes-vs-backup.patch`。备份不涵盖所有新增文件和此前修改，不要误当完整 git 基线。
6. `docs/architecture/BACKEND_TRANSITION_20261021.md`。

你必须校验 JSON 格式、确认实际 Git 状态和安装依赖版本，阅读修改后的源码，而不能采信开发 Agent 的报告或测试数量。若 shell/读取能力受限，记录限制；不要说成已运行或已验证。

依赖仍精确锁定 Pi 0.80.10。请优先对照 `node_modules/@earendil-works/pi-agent-core`、`pi-ai` 的实际源码核实契约。上游 https://github.com/earendil-works/pi 和 https://pi.dev/ 用于设计对照；https://github.com/deepseek-ai/deepseek-harness 只是设计参考，不是本项目依赖。不要把这些叫“大模型”。如果评估升级，请读取变更和破坏性差异，勿只报最新版本号或建议顺带升级。

## 重点问题：给出有判断的答案

### 1. 主体架构是否还合理
- 单一 Electron Pi 循环、Python 负责业务/权限/持久化，这个分工是否合理？
- 保留默认 Python、冻结 V2 重复业务扩展是否是可接受的收敛策略？还是应反过来迁移？必须结合当前能力覆盖、成本和数据风险回答。
- HTTP URL 形式的后端协议是否必须立即替换为类型化 AgentBackend？如果要，给出最小接口和分阶段替换边界，避免为了抽象全面重写。
- Python 仍有 JD/PDF 单次模型抽取和模型密钥，是否属于必须先消除的问题？怎样迁入 Electron 才不会使任务依赖 UI 存活或破坏导入功能？

### 2. Pi 的用法是否修对了
- execute 返回前 setTools 的时序，是否符合真实 Harness 同批工具并行、下一轮提示词构造、abort 和异常传播契约？
- 动态 systemPrompt 是否准确反映 activeTools，是否遗漏 Skill、作用域或权限；历史记忆是否真的只进入资料层？
- 真实 Harness/SDK 测试是否覆盖了原缺陷，还是仅换了一种 mock？指出关键遗漏，而非要求无限补测试。

### 3. 工具事务、恢复和审批
- `effect_scope=local_transactional` 的白名单是否全部满足只有数据库副作用？savepoint + rollback 真能证明“未执行”吗？有没有 handler 内 commit、文件写入或外部调用打破证明？
- `failed / outcome_unknown / retry_authorized / running / completed` 转移是否可能重复执行、永久阻塞、跨重启丢失批准，或用新工具修订号绕过旧未知操作？
- 简历内容哈希绑定的批准能否被绕过？回滚是否真正限定到当前 run/目标版本？
- 草稿内容检查与实际 PDF 产物检查拆分后，是否还有假完成、过早发布或旧质量报告复用？

### 4. 模型协议与“测试连接”
- 地址解析、真实运行与探测是否一致，特别是 Anthropic `/v1`、`/anthropic` 和 OpenAI 兼容网关？
- compat、thinking、输出容量及图像输入字段是否准确映射 Pi 0.80.10？有哪些可设置但实际无效/冲突的值？
- 合成工具探测是否能合理区分可对话/可调工具？不要把一次探测成功当成所有业务工具都兼容。
- 错误文本是否能帮助用户定位，又不暴露密钥？

### 5. 上下文、归档与隐私
- 整轮裁剪、调用/结果配对、输出预留、固定提示词和动态工具定义是否一致计入预算？
- 长结果预览和 `read_tool_result` 是否形成真正可用的回读链，引用是否在二次压缩后仍可达？120 个事实 ID 测试是否能代表真实失败机制？
- scope、内容哈希、SQLite 原子归档、任务删除、脱敏边界是否正确？归档无限增长、独立聊天最近 200 条、没有摘要这几项分别应定什么优先级？
- 保守字节估算应继续保留、做可校准估算还是采用 tokenizer？请区分安全边界与效率，不编造 token 降幅。

### 6. MCP、Skill、独立聊天
- MCP 别名映射/冲突、工具白名单、全局权限、整会话超时、发现分页、结构化返回及错误处理是否完整？
- stdio MCP 不是沙箱这一边界有没有在实现或 UI 中被混淆？不支持 HTTP 自定义认证头和 `.cmd` 是否应阻断当前发布？
- Skill 全文件信任、BOM、同名冲突、摘要目录、按需读取是否正确？相对资源不支持，应扩展还是明确产品范围？
- 独立聊天现在用宿主签名批准，绑定轮次/工具/参数/调用 ID/过期时间，保存回执。请重点挑战它是否仍可绕过、重放、并发覆盖，是否需要专用签名密钥，而不能只因出现 HMAC 就判安全。
- 独立聊天仍没进入 ToolGateway，现有受控只读子集是否可以暂留？若必须收敛，如何避免为了一个 run_id 强制创建假岗位/候选人？

## 工作边界

- 优先静态架构和契约审查，可解析 JSON、查 Git、阅读源码及必要的无副作用检查。
- 不访问 APPDATA 真实用户资料、不打印密钥、不请求付费模型、不启动真实 MCP 写操作、不安装升级依赖、不迁移或删除数据。
- 功能复现和后续修复由开发 Agent 执行。提出最小验证条件即可，不消耗额度重跑整套测试。
- 不能把缺失真实 PDF 的测试算成通过；不能把编译通过算安装版通过；不要重新建议关闭 Defender。
- 先独立阅读再形成结论。若使用子审查，主审必须复核 P0/P1 和最终架构判断；标明哪些来自子审查而未亲读。

## 输出到新目录

创建 `docs/audits/architecture-final-review-20261021/`，保留此前目录原样：

1. **FINAL_ARCHITECTURE_REVIEW.md**
   - 是否值得沿用当前框架，哪些边界合理；
   - 发布前必须修 / 下一迭代应修 / 可接受取舍；
   - 对以上六组问题逐项回答，指出尚无证据的部分；
   - 不泛泛堆砌最佳实践，不以“现代框架”作为理由要求重写。
2. **FINDINGS_FINAL.json**
   - 每项包含 id、对应旧 ID、新发现/未修复/修复引入回归、严重性、确认程度、实际文件与行号、因果链、触发条件、最小修复、建议验证、什么证据可以撤回。
   - 修复后的新缺陷与原缺陷未修复要区分。
3. **PREVIOUS_FINDINGS_DISPOSITION.md**
   - 覆盖 F01–F36、N01–N09、N11 和新发现 X01；
   - 每项：已修/部分修/保留取舍/未修/不成立/未核实，简述依据。
4. **NEXT_ACTIONS.md**
   - 不超过 10 项，按实际风险排序，每项给改动边界和验收条件；
   - 明确哪些不应再改，哪些需产品选择，哪些可由开发 Agent 直接执行。

最后在对话中给一个短交接摘要：架构结论、最重要的 3 个问题、仍有盲区、文件路径。
**请用户把这四份文件交回开发 Agent；不要只回传“审查通过”或只有问题标题。**
