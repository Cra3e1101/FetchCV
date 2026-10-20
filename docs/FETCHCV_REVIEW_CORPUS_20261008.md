# 完整数量评审草稿（2026-10-08）

已准备 20 个不同虚构项目场景、60 份 TXT 原文、400 条检索问题、100 条独立记忆场景。所有 annotations 为空，已完成人工评审数量为 0。它是待审材料，不是 golden，不是 M5–M8 完成证明。

## 打开材料

最新导出目录：

`D:\hesan\Desktop\VSCODES\FetchCV_M1_work\20260910-235136\m58-corpus-draft-green-02\review-corpus\`

- `tune-review.md`：前 10 个场景，200 检索问题、50 记忆场景，包含各场景原文和题目，便于直接阅读。
- `validation-review.md`：5 个场景，100 检索问题、25 记忆场景。
- `sealed-review.md`：5 个场景，100 检索问题、25 记忆场景。名字表示拟议分组，当前**没有封存**。
- `packet.json`：机器可读原文、问题、候选人和时间、空标签。
- `sources/`：60 份精确 UTF-8 原文，packet 中保存相同字节的 SHA256。
- `review-assignments.json`：主审全部 500 条；第二人复核 80 检索 + 20 记忆。每家族取 4 条检索、1 条记忆，按固定轮换选择，属于覆盖平衡样本，不是统计随机抽样。reviewer 尚未指派。
- `audit.json`：结构计数和 reviewed=0、readyForMetricRun=false。
- `manifest.json`：其余 66 文件字节数和 SHA256、三个生成器源文件 SHA256，不对自己自哈希。

旧 `green-01` 留存，未包含分工清单；以 green-02 作为当前草稿。

## 来源与限制

源文件 `scripts/m5-m8/review-scenarios.mjs` 中逐项写出工单检索、仓储盘点、推荐评估、移动缓存、支付幂等、视觉检测、路径规划、日志异常、排课、语音识别、审计追踪、销量预测、无障碍前端、文档去重、温控、实验数据清洗、容器发布、问卷分析、缓存一致性与课程答疑。每个场景保留初稿、更正和岗位公告，初稿/更正共用一个来源家族。

问题覆盖数字口径、旧版冲突、历史时间、否定、职责归属、岗位要求与本人经历区分、未知薪酬/面试轮数、引用来源，以及记忆的明确授权、临时请求、更正、撤回、过期、助手推断与凭据占位符。无真实履历、秘密或企业资料。

20 组问题使用共用框架，唯一 prompt 字符串不意味着语义独立，样本重复度和家族划分仍需审阅。split 按场景顺序拟定，未随机化、未冻结、未建立独立访问控制，不能用本包声称 sealed 成绩。60 TXT 也不替代六格式解析 golden。

candidateId/availableFrom/asOf 是明确评审上下文，结构审计和评分器不自动执行授权或历史时间过滤。完整原文包供评审，不能未经 scope/asOf 过滤就整体送入被测模型。新增 `run-review-corpus.mjs` 已用实际 APP 检索核验这些边界，见下文；这不改变原审计器和评分器的能力。

## 真人评审步骤

1. 先检查来源、题意与家族划分；删除或修订不合理题时保留旧版本、重新计算清单，不能为了凑数保留歧义。
2. 指派两位独立真人。主审填写全部判断；第二人完成分工表中的 100 条，不先查看主审答案。
3. 检索填 answerable、0/1/2 relevance 和原文证据 span；记忆填明确目标是否应记住及理由。记录真实 reviewer、时间。详见 `FETCHCV_ANNOTATION_REVIEW.md`。
4. 分歧由独立第三人仲裁，不自动复制主审结论。先完成标签和封存规则，再运行被测系统，避免看模型答案后修改标签。
5. 结构审计通过后，使用 `evaluate-retrieval.mjs ... --reviewed` 评分；指标结果、来源权限、语义支持及 memory/answer 质量仍需分别验收。

自动 agent 不能把这些空记录填上假人名或把模型答案声明为 human。缺少真人输入时，正式质量验收仍不能完成；不是构建或运行权限阻塞。

## 实测

`m58-corpus-draft-red-01` 在实现缺失时按预期失败。`m58-corpus-draft-green-01`：14 项草稿/标注/评分回归通过；新增分工清单后 `m58-corpus-draft-green-02`：2 项生成与导出测试通过。两次成功运行守卫退出 0；核对 400/100、200/100/100、全部空标签、每份原文字节 hash、分工配额、导出文件 hash、重复运行拒绝覆盖且 packet 字节未变。独立只读审查无必改项；确认 scope/time 尚属元数据的限制。

只新增评审工具和材料，不改产品代码或 installer；最近产品回归 246 项与 package-18/packaged-ui-16 证据继续有效，不把本次测试叠加成一次产品全量运行。

## 实际 APP 检索补验

`m58-corpus-app-02`：20 个合成候选人、60 份 TXT 经真实 LPAC parser 1.2 导入，全部 ready，文本逐字相等。400 条实际检索使用同一非空索引代次，返回 1084 个片段，逐条核对候选人、历史可见时间和 citation.resolve 原文，全部通过。另有 20 组显式 pinned 校准：本人的历史材料为非空正例，未来更正及外人材料均被排除。不是 recall/nDCG 或语义相关性测量。

首次 `m58-corpus-app-01` 失败：脚本尝试在导入后 UPDATE captured_at，被不可变约束正确拒绝。修复仅在合成脚本使用 Node mock.timers 模拟 Date，在正常导入/解析期间冻结日期，finally 恢复；不修改产品、约束或已入库时间。失败现场原样保留。

结果根：`D:\hesan\Desktop\VSCODES\FetchCV_M1_work\20260910-235136\m58-corpus-app-02\`。其中 `input-packet.json` 保留逻辑 ID，`mapped-packet.json` 保存实际文档及候选人 ID，`results.jsonl` 保存实际排序与耗时，`review-corpus-app-report.json` 保存绑定和校准记录。全部拟议 split 已公开执行，不能再把这次运行称为独立 sealed 验收；100 条记忆草稿没有被这个检索脚本执行。

两次运行的 JS 删除回执文件均为空，守卫无范围外通知；首轮 child exit 1，第二轮 run_verdict success=true/exit 0。不是原生文件操作的穷尽审计。完整证据位于项目 `.m1-evidence/m58-corpus-app-01-*` 与 `m58-corpus-app-02-*`。
