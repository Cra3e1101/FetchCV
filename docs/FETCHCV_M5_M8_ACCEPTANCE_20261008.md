# M5–M8 阶段验收核对（2026-10-08）

**整体未正式完成。** 本轮完成当前源码的回归、PDF 旋转文字缺陷修复、隔离解析验证和候选包验收；不能以这些结果替代原方案 §21 的独立人工标签及质量指标。最新产品代码 `b0735e8`。

## 按 §22 逐项判定

| 阶段 | 已验证 | 仍缺 | 判定 |
|---|---|---|---|
| M5 ingestion | worker/IR/队列、重试与幂等、撤回传播、60 份六格式合成输入；DOCX 多段保留；新增双栏/单元格/旋转事实覆盖与定位 | 全部 golden 的关键事实/完整单元格质量及语义定位；当前模板和字串测试不能证明跨栏关联、嵌套表格等全面正确 | 核心实现与工程回归通过，正式 golden 未完成 |
| M6 retrieval | FTS、权限/时效/版本检查、后台索引与既有规模/偏斜测量；评分及审核入口 | 400 查询独立家族划分、真人标签、sealed recall@20/nDCG@10 正式结果 | 工程通过，质量门槛待验；不推荐 hybrid |
| M7 memory | pending/确认/冲突/有效期/撤回、secret 拒绝及来源查看、持久化/撤权回归 | 100 对话真人标签、20% 双标与仲裁、active precision 等正式质量结果 | 工程通过，质量门槛待验 |
| M8 context | 8k/32k、完整工具组、长结果引用、附件/引用绑定、overflow 显式失败与发送前重验 | 整体 §21 的人工回答语义质量不由上下文结构测试证明 | §22 所列功能测试通过；不据此宣布整体质量完成 |

纠正此前进度表述：原方案 §22 写的是“**OCR 可选**”，§21 允许扫描件分层报告、不合格进入 needs_review。尚未安装 OCR 能力包不是单独否决 M5 的理由。扫描识别仍为未执行，不能写成 OCR 成功。

## 本轮发现与修复

10 份合成 PDF 含双栏、表格单元格与旋转文字，共 140 条预期字串。旧实现只恢复 130 条，10 条旋转事实丢失，但文档仍为 ready。`m5-layout-red-01` 实际失败并留存报告。

pypdf 6.4.1 本地 `_page.py` 的布局模式默认剔除旋转文字；[官方参数说明](https://pypdf.readthedocs.io/en/6.12.0/user/extract-text.html)亦描述此行为。没有升级依赖。现在使用 `layout_mode_strip_rotated=False`，捕获每页 extract_text 期间的 WARNING，仅记录布尔量；发生警告则 needs_review/layoutWarning。此捕获不覆盖 PdfReader 构造或 get_contents，也不宣称没有警告就版面正确。

解析结果版本为 local-structured-1.2，协议 1 明确接受 1/1.1/1.2，入库保存实际版本。旧已完成文档保留，不自动重解析。

## 实测清单

- `m58-regression-11`：修复前当前基线 245/245，0 失败，85094.1564 ms。
- `m5-layout-green-01`：4/4 定向测试通过；10 PDF 恢复 140/140 字串，定位区间合法，全部标记 needs_review。这里不是人工表格语义准确率。
- `m5-layout-app-01`：真实 LPAC worker → APP 入库为 1.2；旋转原文可读，待复核结果不进入可信检索（0 hits），原件 hash 不变。
- `m58-regression-12`：最终 70 个测试文件，246/246，0 失败/跳过/取消，77403.9909 ms。完整命令和日志在对应 `.m1-evidence` 文件中。
- `m58-package-18`：90 条 ASAR 路径，新候选构建通过。
- `m58-packaged-ui-16`：新 installer 解包核对 ASAR/422 sidecar/parser 清单，实际 Electron write/restart/invalid-manifest 通过；已查看重启截图。包内导入样本为 TXT；PDF 旋转专项在上述隔离 APP 测试执行，不混称为包内 PDF 专项。

以上通过运行的 run_verdict 均 success=true、exit_code=0。故意复现失败的 red-01 不计为成功。

## 最新候选及审计

候选路径：`D:\hesan\Desktop\VSCODES\FetchCV_M1_work\20260910-235136\m58-package-18\output\FetchCV-Setup-0.4.19-win-x64.exe`。

- installer：140384870 B，SHA256 `5fe0661594d0246a88d7f1d86015258ea6df009a87fd4c2d8e160cc2052df4a8`，实测 NotSigned。
- ASAR：`0f692f2d21139c19c84261fef59956eb480eaf9ed6ec8f9a9093504adf946c0d`。
- parser formats.py：8974 B，`44263fdb8a44e6cb5ad7f5e2259a7dd1fb3d20bdb433a9159f44d8ebb88efdd7`。
- 本轮七次运行的 JS 删除 API 成功回执共 128（构建 122、包内验证 6），均在各自批准运行根内，blocked=0、范围外=0；不是原生操作的穷尽审计。汇总 `.m1-evidence/m58-closeout-20261008.json`。
- 旧库 hash 仍为 `11e73ec84150780d7a92fa5fd39e287e639a6164b15ed0bcdeec9c997511a565`。未安装、未发布、未清理旧产物、未扩展 APPDATA 授权；旧安全事件的来源仍未查明。

## 完成正式验收所需外部输入

早期 pilot 为 6 来源、12 检索题、10 记忆场景。现已补齐 20 个虚构场景、60 份 TXT、400 检索题和 100 记忆场景的待审草稿，以及 80 检索/20 记忆的第二人分工清单，见 `FETCHCV_REVIEW_CORPUS_20261008.md`。人工标注仍为零，共用问题框架和拟议 split 不等于独立 golden。真实标签须由真人形成，其中至少 80 条查询、20 条记忆对话独立双标，分歧经第三人仲裁。不能由 agent 编造评审者或自称已完成人工审核。

新增 `m58-corpus-app-02` 完成 60 TXT 真实隔离解析、400 APP 检索、1084 次引用原文一致性及候选人/时间边界检查；20 组 pinned 校准排除未来和外人材料。全部拟议 split 已公开执行，不是 sealed 评分；没有生成相关性或记忆人工标签。

新增 `m5-corpus-app-03` 对当前 parser 1.2 重新执行六格式 60 份合成样本：全部完成解析，50 ready、10 扫描件 needs_review；非扫描 240 条预期字串恢复，扫描件不执行 OCR，20 个检索结果引用核对通过。两轮成功运行 guard exit 0，无 JS 删除回执和范围外通知。旧库 SHA256 再核对不变。候选包无需因验收脚本变化重建。

用户尚未选择人工评审安排。自动工程测试无需等待该选择，但缺少这些输入就不能计算并宣布正式质量门槛通过。M9/M10 未启动。

## 回退

本次不改变数据库结构或旧文档。源码可用独立 revert 提交撤回 `b0735e8`；未提交的用户文件不参与。候选未安装，日常环境无需切换。若选用旧候选，应连同其兼容工作区副本使用，并保全新写内容，不能让旧程序强行打开不兼容的新 schema。保存 captured 原件和所有失败/成功证据，不执行清理。
