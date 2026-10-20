# 历史索引与桌面导航验收

依据 `FETCHCV_V2_FINAL.md` §21/22，补充 M6 的历史积累和索引期间导航证据。产品代码未改变，不重跑已通过的 219 项产品回归或重新打包。原候选 package-09 / aa53723 仍适用。

## 三代索引压力

脚本：`scripts/m5-m8/measure-history.mjs`。`m6-history-03` 使用 history-scale-2 完整跑过三代，每代 30 个新 Node 进程查询。合成工作区有 50 Candidate、500 Job、500 AgentRun、20000 Message、5000 Source，来源与消息采用偏斜分布。通过正式 source.import / ingestion.process 给 50 个来源各更新两次；解析 IR 是明确的合成替身，不作为 PDF/OCR 质量证据。

| 保留索引代数 | Document 记录 | SearchChunk 记录 | 查询 p50 / p95 ms | 最大响应 B |
|---|---:|---:|---|---:|
| 1 | 5000 | 6244 | 80.4483 / 101.9009 | 4752 |
| 2 | 5100 | 12538 | 109.6801 / 121.6736 | 4991 |
| 3 | 5200 | 18882 | 143.0603 / 156.0628 | 4750 |

三组都满足此次 ready-index APP 查询 p95≤200 ms、payload≤256 KiB；守卫退出 0。原代索引与旧版本没有删除。增量为 **100 个 parsed + 100 个 captured 文档版本**，更新来源各有五条版本记录（原始 ready v1、captured v2、ready v3、captured v4、ready v5）。

这是三个保留 generation、两个固定查询、一组 scope、OS 缓存未清的有限压力测量，不证明历史可以无限增长。时间不包含工作区打开、Electron IPC 或实际屏幕绘制。既有多版本查询算法未因测试放宽。

## 引用补验与报告纠正

history-03 原 `currentAndHistoricalCitationChecks:true` 字段范围过宽：原脚本检查了一个来源的当前版本号，但仅调用 resolveCitation 验证了历史版本。独立审查发现后，该原始报告未被覆盖；脚本 revision 3 现补齐两侧解析并标明 citationSampledSources=1。revision 3 的完整 90 次量测未重跑，不将旧采样归给新脚本。

额外的 `scripts/m5-m8/verify-saved-history.mjs` 在 history-03 数据库的新只读副本执行 `m6-history-citations-02`，覆盖全部 50 个更新来源：

- 当前 v5 引用 50 条，正文包含第三轮标记，current=true。
- 按旧 captured_at 回溯的 ready v3 引用 50 条，文档 ID 与旧版本相等、正文包含第二轮标记，current=false。
- 每条引用实际解析，返回正文与引用正文相等。
- 拷贝前后 hash 一致，核验后原 DB/WAL/SHM 的 hash 未变。

该补验退出 0，独立于性能样本，纠正原字段的证据范围。

## 真实 Electron 导航

`tests/search-navigation.e2e.mjs` / `m6-navigation-01` 使用真实 Electron 窗口、preload IPC、utility storage worker 和未建索引的 5000-source 偏斜合成库。首次 search 通过真实 preload 发起；目录切换通过 Playwright 的真实点击事件驱动，未替换目录服务。

本轮首次 search 请求持续 2129.6 ms。20 次 documents/conversations 目录切换都在该请求未结束期间返回非空目录，并在 DOM 更新后完成两次 requestAnimationFrame 回调；点击到这两个帧回调的 p50/p95/max 为 **16.5 / 23.6 / 32.4 ms**。pageerror 0，记录的 renderer longtask 0，守卫退出 0。

局限：以页面 search Promise 的结束作为时间边界，包含 IPC 回传；不直接证明每个回调时 worker 的内部构建状态。两次 RAF 只证明渲染机会，不是硬件屏幕绘制证明；一轮 20 次切换不是 30 次启动分布，也不证明所有用户操作都低于某个延迟。`navigation-during-index.png` 实际在请求完成后截图，只证明最终目录画面；索引请求期间的重叠证据来自 JSON 中的时间戳，不来自截图。

## 保留失败与证据路径

所有运行目录在 `D:\hesan\Desktop\VSCODES\FetchCV_M1_work\20260910-235136`，守卫日志在项目 `.m1-evidence`。

- history-01：工具目录 Changed，退出 86。
- history-02：把两次更新后的当前版本错当成 v3、并误取 capture 回执，测试断言失败。修正为 parsed 回执和 v5/v3 后 history-03 通过；没有更改业务代码迎合测试。
- history-citations-01：读取旧量测目录时收到 Changed，退出 86；新副本运行 citations-02 通过。未豁免通知，根因未证实。

本轮没有生产逻辑改动，三个新验收脚本可独立撤回；历史材料保留不删。正式 60 来源/400 查询/100 对话人工质量评测仍未完成，这些性能和交互结果不能替代它。

交付提交 `0bf2d64`；`.m1-evidence/m58-validation-20260928-r3.json` 汇总 161 次历史运行、88 次成功，1098 条 JS 删除成功回执中范围外 0、blocked 0（非原生文件操作穷尽审计）。保留测试树 14880816031 B，回收 0 B；原 DB hash 仍为 `11e73ec84150780d7a92fa5fd39e287e639a6164b15ed0bcdeec9c997511a565`。Git fsck --full 退出 0。完整失败现场均保留。
