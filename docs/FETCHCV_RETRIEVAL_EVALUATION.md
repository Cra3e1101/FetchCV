# 离线检索评测入口

依据 `FETCHCV_V2_FINAL.md` §21。该入口计算**唯一文档版本**的 recall@20 与分级 nDCG@10，供调优和复核；不是 §21 全部验收的替代品，不调用网络或模型。新增依赖为零。

## 输入

数据集 JSON：

```json
{
  "version": 1,
  "revision": "example-synthetic-1",
  "annotationOrigin": "synthetic",
  "documents": [{"id": "document-version-id", "family": "source-family-a", "split": "sealed"}],
  "queries": [{
    "id": "q1", "split": "sealed", "families": ["source-family-a"], "slices": ["exact-id"], "answerable": true,
    "judgments": [{"documentId": "document-version-id", "grade": 2}]
  }]
}
```

结果 JSONL，每查询一行：

```json
{"queryId":"q1","datasetRevision":"example-synthetic-1","revisions":{"index":"generation-id","config":"configuration-revision","model":"none","prompt":"none"},"documentIds":["document-version-id"]}
```

`documents.id` 必须指向固定 Document 版本，不用 URL 或可变 Source 替代；工具依赖该 ID 约定，不自行打开原库验证身份。一个来源家族包含同一原文的版本、重复 URL、改写和派生格式；整个家族只能归入 tune、validation、sealed 之一。每条查询（包括无答案）须记录非空的原始来源 `families` 和 `slices`；来源家族、标注和返回文档须处于该 split。数据集中的文档表应包含该 split 的整个可检索语料，而不是只列正例。

结果由原始 chunk 排名按 documentId **保留第一次出现**转成文档排序；输入中的重复文档会被拒绝。这不是 chunk 级或证据 span 级指标，不能与其直接混比。结果必须完整覆盖所有查询，且 dataset/index/config/model/prompt 版本一致；缺失查询、重复结果或混合版本都会失败。索引测试模式不使用模型时明确写 `none`。

## 运行与输出

通过现有 `run-guarded-node.mjs` 分配**全新**运行 label 和稳定临时目录，然后调用：

```text
D:\Nodev\node.exe scripts/m5-m8/evaluate-retrieval.mjs <dataset.json绝对路径> <results.jsonl绝对路径> <新运行根内report.json绝对路径>
```

项目工作目录为 `D:\hesan\Desktop\VSCODES\FetchCV_Windows`；稳定临时父目录为 `D:\hesan\Desktop\VSCODES\FetchCV_M1_work\20260910-235136`，恢复前确认存在，不回退系统 TEMP。输入实际路径必须位于项目或稳定临时根，输出父目录必须在守卫批准的本次运行根内。`wx` 拒绝覆盖已有报告；不清理旧结果。不访问 APPDATA。

报告包含两个原始输入文件的 SHA256、版本、逐查询指标、split/slice 宏平均与缺失标注数量。relevance 取 0/1/2，DCG 增益为 `2^grade - 1`，折扣为 `log2(rank+1)`。recall 分母是全部 grade>0 的文档版本；未标注命中按 0 分计，同时单列数量。不可回答查询不进入 recall/nDCG 的平均分母；无可计算查询时为 null，绝不计成 1。该工具没有回答生成，因此不测“正确拒答率”。

`annotationOrigin: human` 只是输入声明，不是人工标注真实性证明。工具始终输出 `formalM5ToM8Complete: false`，不把少量合成题的满分当产品质量。未实现统计显著性、hybrid 对比或 bootstrap CI，不据此推荐 hybrid。

## 人工验收仍需提供的材料

2026-10-05 新增标注结构检查及 `--reviewed` 模式，见 `FETCHCV_ANNOTATION_REVIEW.md`。使用该模式时，第一个输入改为完整标注包，评分前强制检查双标、仲裁和证据位置，并直接采用包中的最终判断。无选项的 standalone 模式仍供合成指标实验。结构检查通过不等同人工质量通过。

- 60 份合成或获授权脱敏来源：文本 PDF、扫描、DOCX、HTML、MD、chat 各 10；记录原始文件 hash、source family、版本、授权与格式。真实私人履历不上传 CI。
- 400 查询：200 tune、100 validation、100 sealed，按来源家族分割。在查看被测结果前冻结 sealed 的原文、查询和标签版本。
- 每查询保留 scope/asOf、0/1/2 标注、必要证据 spans、可回答性、标注者及时间；0=不支持，1=部分相关，2=直接支持。数字/否定/时间/跨 candidate/重复版本等 slice 必须覆盖。
- 20% 独立双标、分歧与第三方仲裁记录。reviewed 模式验证记录结构，不能认证真人身份与独立性，不能用把 annotationOrigin 改成 human 的方式补齐。
- citation 可解析/授权、人工语义支持、answer faithfulness/拒答、100 记忆对话、secret/撤权、解析定位、偏斜性能仍由各自证据验收。document recall/nDCG 通过也不能替代这些门槛。

## 已完成验证

`m6-eval-green-04`：12/12 通过（11 项纯指标/边界测试，1 项真实 APP 导入→检索→JSONL→CLI 集成）。独立审查发现的无答案来源家族缺失、空 slice 及 cwd 扩大输入边界已加负例修正。解析 IR 为明示合成测试替身，未冒充实际 PDF/OCR 解析。正例和无答案各一题只验证管线，标签由合成设计确定，不是人工 golden。

样例及报告保留在稳定根 `m6-eval-green-04/retrieval-evaluation-cli/copies/v2/{dataset.json,results.jsonl,evaluation.json}`。覆盖已有报告的负例实测 EEXIST，原报告逐字节不变；从 Node 安装目录启动，仍拒绝把安装目录内文件作为输入。此前 green-02 因测试 IR 缺合同字段失败；修复测试输入后通过，没有放宽产品校验。red-01/green-01 的目录 Changed 守卫失败亦保留。
