# M7 记忆作用域与来源停用增量（2026-09-23）

本增量依据原方案 §8、§22，继 M5 提交 `a751582`。M5 的本机隔离与包内验收已通过；本文不把工程测试等同于 §21 的人工记忆 precision 或 M5–M8 全阶段验收。

## 行为

- 仅 preference 按 job > candidate > workspace 继承并覆盖同 subject/predicate；constraint/decision 保持精确作用域。无效、被撤回的 workspace/candidate/job 拒绝访问。分页不能重新带回被覆盖的偏好。
- `memory.list` 返回有效集合的 `snapshotHash`；APP 在复用工具缓存、发送下一次模型请求前核对整个作用域的集合及每项证据。空页后新增偏好、不同键新增、同键覆盖、失效、撤回均使旧快照失效。快照不包含原文；其散列不是授权。
- Message、Conversation、Candidate、Job、Workspace 的 tombstone 与相关记忆停用在同一 SQLite 事务发生。记忆原文与版本保留；物理状态 `revoked` 加 `disabled_reason=source_unavailable`、`disabled_at` 表示自动停用，释放 active 唯一槽，同时写 `memory.disabled` 事件。恢复父对象不会自动重新确认记忆。
- Memory FeatureSchema 1→2 只新增两列和触发器，不删表/记录，打开已有 V2 工作区时升级并回填已有失效来源。新版本号未知时拒绝打开。旧版程序会拒绝 revision 2；不能直接拿旧程序打开已升级库。

## 验证

守卫运行 `m7-memory-green-05`：5 个文件、15 项全部通过、退出 0，18.26 秒。覆盖继承/非偏好隔离/分页、空集合和新增键快照、五类来源 tombstone、升级前后原文/哈希保留、升级重复打开、未来 schema 拒绝、导出恢复、来源撤回后工具缓存与模型请求阻断、APP 恢复与幂等。

失败记录保留：`m7-memory-green-02` 记录 tests 目录 Changed，守卫终止；当时零测试输出、零删除回执，成因未证实，未放宽守卫。`green-03` 暴露新增分页测试传空 afterId 的错误；修正测试调用。`green-04` 暴露自动停用导致旧错误码变化；恢复 `memory_evidence_unavailable` 兼容后 `green-05` 全通过。此前红灯及局部通过记录也保留。

独立复核提出非偏好继承和空集合快照两个问题，已逐项修复并补测试。测试只操作合成工作区，未访问旧用户 APPDATA，未改旧 `backend/data/fetchcv.db`、原始素材、旧环境或 installer。

## 回退与未完成

仅对新建测试/候选工作区启用，不切换用户环境。源码可回到本增量前的提交；已经升级的测试工作区应保留并停用，改用升级前的导出副本或新建工作区，不能原地降 schema 版本号。M4 源码基线备份不覆盖忽略的数据目录。

M7 的人工标注 precision、跨会话任务集未完成。四类记忆中的 personal_fact 统一引用及跨消息等值证据合并仍需单独交付；不能通过复制履历事实文本形成第二权威。M6 检索契约/正式质量集、M8 最终回答的引用审计继续推进。OCR、dense/RRF、自动过程经验和高级摘要均不是原 §22 中本轮首发的强制开关。
