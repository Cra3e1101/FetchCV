# M5 六格式合成解析验证（2026-10-03）

依据 `FETCHCV_V2_FINAL.md` §21/22，新增可复现的 60 文件合成解析检查和真实 APP 导入检查。产品逻辑、依赖和旧用户材料没有修改。以下结果不是人工 golden、复杂版面或 OCR 的最终验收。

## 实测结果

稳定根：`D:\hesan\Desktop\VSCODES\FetchCV_M1_work\20260910-235136`。每次运行使用全新子目录，保留旧结果，不清理。

| 格式 | 文件数 | 原文事实字符串恢复 | 解析块数 |
|---|---:|---:|---:|
| 文本 PDF | 10 | 40/40 | 15 |
| DOCX | 10 | 50/50 | 50 |
| HTML | 10 | 50/50 | 50 |
| Markdown | 10 | 50/50 | 50 |
| chat | 10 | 50/50 | 50 |
| 扫描 PDF | 10 | 0/40 | 0 |

`m5-corpus-02/parser-corpus/report.json`：生成器 revision 2，60 个预期结果全部符合，守卫退出 0。50 个含文本文件的 240 条事实均保留，并分别找到包含该事实的块及其原文区间。215 个块的字符范围、原文切片、索引映射边界和来源字段检查通过；定位错误列表为空。额外负例确认：事实仅在 source_text 中、没有对应块时，检查器拒绝通过。

扫描 PDF 嵌入真实栅格文字图像，没有文本层；10 个均标记 needs_review 和 ocrRequired。0/40 是未执行 OCR 的实际结果，不算扫描识别成功。文本 PDF 为 ASCII；中文和 emoji 仅由其他四种文本格式覆盖。DOCX 有表格，但此检查不衡量全部单元格和视觉版面忠实度。

`m5-corpus-app-01/corpus-app-report.json`：此前实际运行生产 Windows parser、专用 AppContainer 和持久化导入队列，60 个任务完成，50 ready、10 needs_review。原始合成文件 hash 未变；检索返回的 20 个引用逐个 resolve 后与返回原文相同，结果中没有 needs_review 来源。该运行使用生成器 revision 1；不可称作 revision 2 的 APP 重跑。revision 2 加强的是独立定位检查，不改变产品解析逻辑。

## 可复核工具与范围

- `scripts/m5-m8/parser-corpus.py`：生成原件、逐文件预期、IR、清单和报告；revision 2 在调用解析器之前以独占创建写入各自预期文件。合成预期来自模板，不来自人工标注，也不能作为正式来源家族划分依据。
- `scripts/m5-m8/measure-parser-corpus.mjs`：记录 Python 退出码、stdout、stderr。通过现有守卫运行，禁止覆盖既有输出。
- `scripts/m5-m8/verify-parser-corpus-app.mjs`：实际 APP 导入、队列、解析、检索与引用抽样。引用覆盖为这次查询命中的 20 条，不是全部来源。

所有标签明确为 synthetic、humanReviewed=false，报告保留 formalM5ToM8Complete=false。Python 审计钩子安装后的删除/移动事件数为 0；该钩子不覆盖之前的依赖 import，JavaScript API 守卫也不是全部原生操作的穷尽审计。

独立代码审查未发现 Critical/Required 问题。索引映射目前仅检查长度和范围，不证明每个归一化字符与映射字符的语义等价；不把这项结构检查称为完整映射正确率。

本次启动第一次曾因自动审批超时未执行；确认现场不存在后按工具许可重试，得到 m5-corpus-02。只读 PowerShell 汇总曾因嵌套数组展开显示 locatorErrors=1；直接用 Node 展开原始 JSON 核验为 []，原始报告没有被修改。

旧库 `backend/data/fetchcv.db` SHA256 仍为 `11e73ec84150780d7a92fa5fd39e287e639a6164b15ed0bcdeec9c997511a565`。本次工具与文档不进入产品包，无需因这些测试文件重新构建安装器。

## 尚缺的正式验收

复杂版面/完整单元格与人工语义定位、OCR 正确率、400 条按来源家族划分的人工查询、100 记忆对话、20% 双标及仲裁仍未完成。该批模板不能充当独立 sealed 来源。后续须冻结来源家族、查询、证据 span、scope/asOf 和评审记录，再用既有离线评测入口计算质量指标；不能把 synthetic 声明改成 human 代替评审。
