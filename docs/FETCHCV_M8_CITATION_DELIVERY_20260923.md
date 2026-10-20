# M8 最终回答引用审计增量（2026-09-23）

依据原方案 §18 Citation 阶段；保留已实现的 whole-turn-context-2 输入预算、完整工具组、manifest 和发送前来源校验。

## 行为与边界

- 检索/原文工具返回稳定 citationId（规范 Citation JSON 的 SHA256）。模型可用 `[[cite:citationId]]` 对应回答文字；APP 只认可最后一次 provider request 实际选入的工具回执，回执须同 run、哈希正确，再检查当前 scope、来源状态、版本及精确原文。
- 未知/已裁剪/其他 run 的引用不会被认可；来源已撤回或不是当前版明确降级。逐字原文一致仅称 `exact_quote`，语义支持始终标为未自动核验；有效引用不能证明旁边任意改写的含义。没有核验的回答范围显式记录，不删、不改模型正文。
- APP 以独立 `agent.citations.reviewed` 事件保存核验结果，与 assistant message、agent.finished 同一事务写入。客户端 completion metadata 中的同名字段被丢弃；旧历史元数据不能冒充核验结果。重复 completion 复用原审计事件，保留幂等。
- history.read 只接受 APP 独立事件，校验 message/hash/schema/Unicode codepoint 范围/marker/citation identity；展示时再查来源撤回及版本。UI 用引用编号代替内部哈希，保留“未核验”“来源不可用”等区别，点击经 APP 再解析原文。
- 本阶段实现原方案的 unsupported 标注路径，没有为追求自动“通过”增加自我评分或自动重写循环。附件/用户原话/Artifact 的事实若未走检索或 read_evidence 回执，不自动获得引用核验；语义精度、数字真实性仍需 §21 人工标注与真实任务评测。

## 实测

- `m8-answer-green-04`：4 文件、17 项通过，退出 0，18.77 秒。包含完整上下文、选择性回执、来源撤回、Unicode emoji、真正引用不支持任意断言、未知 ID、客户端伪造、旧 metadata、完成重试和既有 APP 草稿/审批回归。
- `m8-ui-citations-03`：真实 Electron/preload/APP；点击回答引用、未核验提示、320 像素无横向溢出、四尺寸布局、0 renderer errors；既有记忆确认/撤回和原生选择后真实 LPAC 导入/搜索/撤回仍通过。对话内容由测试直接调用 APP bridge 准备，不冒充真实远程模型质量。
- `m8-answer-red-01` 复现缺少终态审计；`m8-review-origin-red-01` 复现旧客户端 metadata 造成历史读取异常。均已修复。`m8-answer-green-01` 被新文件所在 packages/knowledge 目录 Changed 通知拦截，未放宽守卫；`green-02` 暴露历史对象带 undefined 属性造成回执 JSON 往返不一致，改为缺值不输出。失败现场全部保留。
- 独立复核要求防旧 metadata 伪造，修复后确认来源、幂等和事务路径无新的阻塞问题。

不访问旧用户 APPDATA，不切换原用户库，不删除原件。新审核事件随工作区导出保留；回退代码可恢复到本增量前 `d8b1b21`，历史回答原文和旧事件仍在。旧代码不会展示新的审核说明，不能把这一点当作引用仍获验证。

M5–M8 全阶段尚不能标记完成：正式人工质量集、M7 personal_fact 引用/重复证据合并等仍有待交付；最终全回归及新候选包实测另记，不沿用旧包声称验证当前代码。
