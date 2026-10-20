# M5–M8 当前状态（2026-09-23）

原设计唯一权威为 `D:\hesan\Desktop\VSCODES\linshi\FETCHCV_V2_FINAL.md`。本文件区分已交付工程能力与尚未通过的正式质量验收，历史报告和失败现场不覆盖。

| 阶段 | 已交付 | 仍待完成 |
|---|---|---|
| M5 | 本地 parser/IR、持久队列、版本/幂等/撤回、Windows LPAC 隔离、桌面和候选包内导入 | §21 全量 golden 解析/定位质量；OCR 可选 |
| M6 | 统一 Retriever、标题/标题层级/正文加权、权限/时间/版本先过滤、同文去重、pin、引用回查、generation 切换 | 同步重建改为分批后台任务；400 查询人工标注与 sealed 质量 gate；dense/RRF 可选 |
| M7 | pending/确认/冲突/有效期/撤回、偏好范围覆盖、多来源等值合并、原文和 label 秘密检查 | personal_fact 仅引用 KnowledgeItem 的实现；确认/真实有效时间分离；100 对话人工 precision/secret/撤权 gate |
| M8 | 完整轮次/工具组预算、发送前来源重验、manifest、APP 独立最终引用审核、未核验提示 | §21 人工语义与回答质量；UTF-8 字节预算不是精确 provider token 计费 |

最新工程回归：`m58-regression-06`，61 文件、203 项通过、0 失败/跳过，90.39 秒。真实 Electron 多来源记忆与既有导入、引用流程：`m7-evidence-ui-01`。详情见 [M7 多来源交付](FETCHCV_M7_EVIDENCE_DELIVERY_20260923.md)。

包内实测：`m58-package-04`/`m58-packaged-ui-04`，对应源码 **1ad9c17**（尚不含本次多来源记忆增量）；提取后 write/restart/invalid-manifest 全过，88 条 ASAR 路径，422 份旧 sidecar 文件与 105 份 parser 文件 hash 核验，未安装/未切用户环境，NotSigned。

`.m1-evidence/m58-validation-20260923-r4.json` 记录该包、196 项回归和当时 93 次运行（50 次成功）；490 条 JavaScript 删除 API 回执无范围外删除。它是时间点审计，既不覆盖后续增量，也不穷尽 SQLite/Chromium/原生构建的删除操作。ASAR 26 个文本文件的三类凭据模式零命中，不是任意 secret 的穷尽证明。

正式质量集要求仍为 60 来源/400 查询/100 对话、20% 双标注与争议仲裁；现有合成工程回归不能充当人工标签或 sealed 分母。因此 **M5–M8 尚未全部完成**，未下调门槛。M9/M10 尚未启动。

备份与边界：M4 源码基线 `7fcb309` 归档原位；Git 不保护忽略的数据。旧 `.venv` 仍在；旧 `backend/data/fetchcv.db`、`release/FetchCV-Setup-0.4.19-win-x64.exe`、package.json/lock 与本轮前记录 hash 相同。不访问旧 APPDATA，专用 parser AppContainer 为此前明确授权例外。项目树所有权仍是已知环境问题。

收尾发现素材路径异常：旧记录 `test use/高子强的简历.pdf` 当前不存在，2026-09-20 的校验 hash 为 `3442470808d64250a72ec1998aa1ca8cdfbdab2105a1bef39d798482bb931485`。目录当前含 `gaoziqiang_resume.pdf`（SHA256 `709686c0bed84d1fb5ea8c0c45458c7d120ce4e6b3ef275262dc60c0305b5f84`），内容 hash 不同，不能视为同一原件改名。上述 10 个本轮/恢复运行的删除 API 日志均无该目录记录，守卫无范围外事件；这些日志不是所有历史文件活动的穷尽审计，不能推断原文件何时或被谁更改。原位保留当前文件，不擅自覆盖或恢复。

下一步顺序：完成 personal_fact 引用与生效时间语义 → 分批索引与交互并发验收 → 建立可人工复核的质量集/评测入口 → 人工标注后运行 sealed gate → 在磁盘空间充足时再构建当前版本并完成包内复验。没有把暂缺人工标签写成已达质量指标。
