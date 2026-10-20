# 人工标注材料检查

依据原方案 §21，新入口检查标注材料的结构，补足原检索指标入口不验证双标/仲裁记录的问题。它不认证评审人的身份、独立性或判断正确性，不替代真实人工工作。

## 使用

在项目根通过已有 run-guarded-node.mjs 分配新的稳定测试子目录，调用：

```text
D:\Nodev\node.exe scripts/m5-m8/audit-annotations.mjs <标注包绝对路径> <本次测试根内新报告绝对路径>
```

输入限项目或既有稳定根，输出只允许本次守卫根，不覆盖已有文件。退出 0 只表示生成检查报告；必须检查 `readyForMetricRun`。报告永久保留 `formalM5ToM8Complete:false`。

需要使用已审核标签评分时，在同样的守卫环境中调用：

```text
D:\Nodev\node.exe scripts/m5-m8/evaluate-retrieval.mjs <标注包绝对路径> <结果JSONL绝对路径> <本次根内新报告绝对路径> --reviewed
```

该模式先检查完整标注门槛，不满足就非零退出且不生成评分报告；通过后直接采用标注包内的仲裁结论，或无分歧的首条判断。retrieval 项还必须含非空 `slices`。400 条检索结果须与包的 revision 一致；100 条记忆记录参与标注完整性检查，但不进入检索排名指标。报告 mode=reviewed，包含标注审计和原包字节 SHA256。未指定该选项时为 standalone，用于独立指标实验，不提供这项审核门槛。两种模式均不认证真人身份，也不宣告 M5–M8 完成。

## 标注包

- 顶层：revision、documents、items。
- documents：固定版本 id、来源家族 family、split（tune/validation/sealed）、待定位的 text、原始来源 sha256。同一家族不能跨集合。sha256 当前仅验证格式，外部仍需核对原始文件；text 不是原始二进制文件的替代品。
- items：id、kind（retrieval/memory）、split、非空 families、prompt、scope.candidateId、asOf、annotations。prompt 可包含需评审的完整对话序列。评审记录不包含模型测评结果，避免先看结果再改标签。
- annotations：每条最多两个独立 reviewer 标识，at 时间、origin=human、decision。未评审时使用空数组，不写假名或伪造已完成。
- retrieval decision：answerable 与 judgments。每个 judgment 包括 documentId、grade（0/1/2）、spans；正例必须有证据，span 的 start/end 使用 Unicode 码点半开区间，quote 必须等于对应原文切片。
- memory decision：remember 布尔值和非空 reason。应在 prompt 中保留冲突、撤回及时间上下文，由评审者判断。
- 两人判断不一致时，增加 adjudication，格式同 annotation，必须是第三个 reviewer，时间不得早于原评审。顺序或表述差异目前保守视作分歧，需仲裁，而不自动合并。

## 结构门槛

`readyForMetricRun=true` 需要：400 retrieval + 100 memory 均已标注；retrieval 为 200 tune / 100 validation / 100 sealed；至少 80 条 retrieval、20 条 memory 有双标；无未解决分歧。还会拒绝重复 reviewer、重复 id、非法证据区间、跨集合来源与判断。

即使结构齐全，正式验收仍须：核实标注者与独立双标、真实来源和授权、sealed 冻结及访问记录、语义支持、完整覆盖与指标质量。这里不计算 recall/nDCG、拒答率或记忆准确率。结构齐全不等于项目通过。

## 实测

`m58-reviewed-green-01`：23/23 通过，守卫退出 0（8 条标注检查、11 条原指标测试、4 条审核评分测试）。实际 CLI 验证了原包 hash、仲裁采用、未审核材料非零退出且不产生评分文件。测试包的 500 条记录仍只是合成分支覆盖，不是人工评审成果。

`m58-annotation-green-02`：8/8 通过，守卫退出 0。包括 Unicode/emoji 位置、重复 reviewer、伪称 synthetic 为 human、分歧及第三方仲裁、400/100 与双标边界、CLI 输出、覆盖拒绝、范围外输入拒绝。

用于数量门槛测试的 500 条记录只存在于单元测试内，是重复构造的合成记录，不是已准备或已完成的 400 查询/100 对话 golden。实际样本与人工评审仍待补齐。

可运行的最小草稿示例留在稳定根 `m58-annotation-green-02/annotation-draft.json`，对应报告 `annotation-report.json` 为未就绪。它是单元测试产生的合成示例，原始 hash 为占位测试值，不能作为正式来源。
