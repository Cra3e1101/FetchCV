# 评审草稿 pilot 1

这批内容是 AI 起草的虚构调优材料，不含真实简历或凭据，不是人工 golden。它先解决“没有可供审阅的具体材料”，不据此声称完成 400 查询、100 记忆对话或质量门槛。

## 材料

源稿为 `scripts/m5-m8/review-pilot.json`：6 份中文纯文本来源、12 条检索问题、10 条独立记忆场景。包含同一简历的旧版与确认版、同名项目的另一候选人、岗位 JD、非官方面试笔记、记忆场景说明。简历两个版本共用 family；所有内容只分配到 tune，不污染 validation/sealed。

检索问题覆盖待确认数字、版本替代、否定事实、跨候选人同名项目、岗位硬条件/加分项、缺失薪酬、来源权威性、技术改写和跨来源学历核对。记忆场景覆盖显式长期偏好、临时请求、更正、撤回、引用文本、助手推断、凭据占位符、过期安排和他人事实。

scope 默认 pilot-a，来源 resume-b 的 candidateId 为 pilot-b。后续检索执行器必须据此构建独立授权范围；当前导出器和评分器不执行授权过滤，不能把候选人字段存在等同隔离通过。r01 的历史 asOf 与 m08 的过期 asOf 单独保存。记忆问题指定被评审的具体事实，remember 仅表达该事实是否应作为所问的有效长期记忆；不是完整的记忆更新/撤销操作协议。

r01 的目录仍含 8 月发布的 v2 作为未来版本干扰项；结构审计不会按 asOf 自动剔除它。评审者必须按 7 月 15 日当时可用证据判断，后续执行器仍需独立验证时间过滤。完整原文包供审核使用，不应原样作为无权限过滤的模型上下文。

## 导出及评审

通过已有守卫分配新的稳定运行根后运行 `D:\Nodev\node.exe scripts/m5-m8/prepare-review-pilot.mjs`。只创建本次根下的 `review-pilot`，已有目录立即失败，不覆盖、不清理。

导出物：6 份 UTF-8 TXT 原文、`packet.json`、`audit.json`。packet 的 sha256 对应同目录 TXT 的精确字节，text 与 TXT 内容一致；audit 另记录源稿 JSON 的 hash。原文为本次合成生成，不是 PDF/OCR 的解析结果。

所有 annotations 为空，reviewed=0，readyForMetricRun=false。读者先检查原文和问题是否合理，再按 `FETCHCV_ANNOTATION_REVIEW.md` 填写判断、证据区间及独立评审记录。不能把模型答案记为 human，也不能把本次材料复制扩充到规定数量就当作正式验收。

批量扩展前仍需确定：来源多样性、独立家族划分、完整检索语料与负例、真人评审安排、sealed 的冻结与访问控制。正式 recall/nDCG、记忆精度和拒答率均未在此包上测量。

## 留存位置与验证

最新材料：`D:\hesan\Desktop\VSCODES\FetchCV_M1_work\20260910-235136\m58-pilot-green-02\review-pilot\packet.json`。同目录保留六份 TXT 与 audit。守卫退出 0；集成测试验证逐份原文字节 hash、22 条空标注、m08 时间、重复运行拒绝覆盖且原 packet 字节不变。`green-01` 原件保留，但其中 m08 的默认 asOf 与问题内日期不一致，不再使用；green-02 修正后通过。独立只读审查无必改项。
