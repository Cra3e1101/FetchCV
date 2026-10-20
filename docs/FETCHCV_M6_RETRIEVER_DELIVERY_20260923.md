# M6 检索契约与标题索引增量（2026-09-23）

依据原方案 §9/§18/§22；默认本地 FTS，无外部服务或新依赖。完成工程增量不等于 §21 sealed 人工检索质量验收。

统一入口 `retrieve(db,{query,scope,asOf?,sourceTypes?,pinnedIds?,maxTokens?,limit?,signal?})` 返回 hits/degraded/manifest；现有 RPC `knowledge.search` 保留 items 兼容形状。sourceTypes 是 Source.kind（如 document:pdf）；pinnedIds 是 Source ID。scope 来自 APP，先验证 workspace/candidate/job 存在、归属及未撤回，再查询或重建。非法参数不触发重建。

pin、类型、时间、来源权限和 ready 质量一起过滤；pin 不绕权限/版本/预算，无效 pin 仅回显请求 ID。默认当前版，asOf 显式选择当时最新可用版。FTS 每来源最多两片后取 60，pin 合并去重后总池仍最多 60；最终最多 20，同文去重。signal 在开始、pin、选择及返回前检查；同步 SQLite 调用不承诺中途可抢占。

maxTokens 暂按整个 hit JSON 的 UTF-8 字节保守计费，包含原文和元数据，manifest 明确 `utf8_bytes_conservative`，不是某个模型 tokenizer 的精确输出；它约束证据 hit 预算，完整工具 JSON 与工具定义仍由 M8 总上下文预算计入。预算不足跳过完整片段，不切引用。FTS-only 是正常模式；尚未建索引时明确 degraded/not_indexed。

Search FeatureSchema 1→2 增加 SearchFTS2，将标题、标题层级、正文分列，BM25 权重 4:2:1（scope 权重 0），依据 [SQLite FTS5 官方语法与 BM25](https://sqlite.org/fts5.html)。新 generation 完整构建后同事务发布，失败回滚指针；旧表、旧 generations 原位保留，不删事实；引用按 Block/Document 解析，不依赖索引存活。当前实现仍是同步本地重建，大规模导航/延迟门槛待 §21 规模评测，不能宣称已达标。

## 验证与回退

`m6-contract-green-04`：4 文件、11 项通过，退出 0，17.30 秒；覆盖 scope/撤回/时间/类型/pin/预算/取消、标题专有词、4:2:1 排序、保留旧 FTS/generation 的升级、memory v1 兼容、导出恢复、APP 缓存与模型发送前验证。ESLint 和 git diff --check 通过。

红灯 `m6-title-red-01` 复现标题漏检；`m6-contract-green-01` 中新测试给 2000 字节不足以容纳两个完整 hit，调整为 3000 并保留 1 字节无返回测试，未放松生产预算。`m6-contract-red-01` 与 `m6-title-green-01` 被 tests/tests/helpers 目录 Changed 通知拦截，日志保留、成因未证明、未放宽守卫；其余失败记录也保留。独立复核提出 scope、验证顺序、合并池上限和 degraded 真实性问题，已修复并补回归。

用户原库未切换。源码回退使用本增量前提交 `3cc21d0`；新测试工作区保留，需用升级前副本供旧程序打开，不能只降 FeatureSchema 数字。旧程序会拒绝 Search revision 2。没有删除旧 cache/installer/环境/素材。

未完成：60 来源/400 查询/100 对话的人工标注与双标注、sealed recall/nDCG/语义引用 precision；无这些结果不推荐 hybrid，不声称生产质量通过。局部 11 项测试属于工程回归，不能作为上述指标的分母。

后续复核修正：去重必须先于候选截断。`m6-duplicate-red-01` 用 65 份同文来源和 1 份较长的唯一来源复现漏检；SQL 先按 text_hash 去重再限每来源/60，pin 合并也先去重/每来源约束再取 60。`m6-duplicate-green-01` 的 5 项检索测试通过，合成唯一证据不再被同文占满候选槽。

pin 路径也补充红灯 `m6-pin-red-01`：同一来源前两块重复时第三块唯一证据被原 LIMIT 2 遮挡。现在所有授权 pin 先全局同文去重（按请求次序），再每来源两片，最多 40，与 FTS 合并后最多 60。有效 pin 清单独立核验，被去重的 pin 不冒充“不可用”。`m6-pin-green-01` 6/6 通过，11.24 秒。
