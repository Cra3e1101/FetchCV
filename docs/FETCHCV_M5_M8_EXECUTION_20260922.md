# M5–M8 实施记录（2026-09-22）

> 本文保留初始实施计划及早期 r2 状态；后续实测更新见 [M5 受限解析与桌面导入 r3](FETCHCV_M5_PARSER_DELIVERY_20260922.md)。OS 隔离、自动队列、原生文件导入及包内调用已通过；§21 的人工质量集仍待完成。下文早期失败不代表当前代码。

用户已授权完成 M5–M8，并允许基于近期官方项目优化实现。原设计 §7–9、§18、§20–22 的证据、权限、不可变来源、单写者和质量门槛继续适用。不是 M9/M10 发布许可。

基线 `7fcb309`；源码备份 `.m1-work/m5-m8-20260922-01/m4-source-baseline.zip`，SHA256 `43583fc0c17f0a2834c0d4579bc00aa332ef839502324a036a0f2793d5e387e0`；git fsck 通过。备份不覆盖被忽略的数据。旧库、旧环境、原素材、旧 installer 不动，APPDATA 不访问；测试在既有稳定根的新子目录运行，保留现场和删除审计。M1 既有未提交内容不混入新提交。

## 新核实的参考与取舍

- [MinerU 4.0.0，2026-09-16](https://github.com/opendatalab/MinerU/releases/tag/mineru-4.0.0-released)：借鉴质量分层、渐进读取、稳定定位。4.0.5（9月20日，commit 前缀 5115829）仍快速修订；不直接升级或把重模型装进基础包。当前资料默认本地处理，不上传第三方。
- [Docling 结构分块](https://github.com/docling-project/docling/blob/main/docs/concepts/chunking.md)：保留段落/标题/表格及元数据，原文定位和检索表示分离；先复用现有 pypdf 6.4.1 与轻量标准库解析，再用黄金样例评估复杂解析器。
- [2026 文档转换评测预印本](https://arxiv.org/abs/2604.04948)：转换器之外也须测试元数据及结构分块；不将论文成绩当本项目成绩。
- [SimpleMem，2026](https://github.com/aiming-lab/SimpleMem)：借鉴原子候选、时间/实体条件和按需读取；个人事实仍需原文证据和确认，不能让自动总结改变权限或冒充无损压缩。
- [Pi](https://github.com/earendil-works/pi)、[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)：继续使用当前锁定的 Pi 0.80.10 接点，按能力组合，不创建第二个模型循环。
- [pypdf 官方限制](https://github.com/py-pdf/pypdf/blob/main/docs/user/extract-text.md)：文本提取不等于 OCR，压缩流也可能耗尽内存；需要独立进程、资源上限和明确的 needs_review。
- [Windows AppContainer](https://learn.microsoft.com/en-us/windows/win32/secauthz/implementing-an-appcontainer)：普通子进程不算 OS 安全沙箱；隔离方案须实际 canary 验证，未通过前不得宣称网络/路径被 OS 阻断。

上述 main 页面为本日阅读的设计参考，未固定的远端源码不进入产品依赖。新依赖需精确版本、许可证、锁及打包验证。

## 增量、验证与回退

|阶段|实施范围|实测门槛|回退|
|---|---|---|---|
|M5|workers/parser、packages/knowledge、APP ingestion 命令；PDF/DOCX/HTML/MD/text/chat IR、捕获/幂等队列、质量分层、版本及撤回传播|合成格式/表格/Unicode 定位/zip bomb/过期 lease/出网与越界 canary，真实 utility 及打包|关闭新解析任务，保留原 blob、旧 Document 和失败现场|
|M6|scope 先过滤的 FTS、结构块、查询条件与引用；可选语义融合须独立证明收益|按 §21 组织版本化评测，分离合成 pilot 与人工标注 sealed；权限/撤回/时间是硬门槛|FTS 或旧 generation，来源版本不变|
|M7|待确认记忆、来源、冲突、有效期/撤回、用户审阅、Agent 按需读|跨会话任务、否定/第三方/秘密/冲突/失效测试；不伪造人工 precision|禁用记忆读取，保留候选和事件|
|M8|模型预算、完整工具组、按需读取、manifest/引用/事实核对、选择性历史精简|8k/32k、中文、长 schema、取消/新输入、来源撤回和引用测试；最后全量回归/打包|M3 基础合法组装及硬预算保护|

每阶段先行为测试再实现，成功增量独立提交。未完成的人工质量标注、远程模型质量或可选重模型验证如实列出，不降低 §21 数字或用自生成测试冒充双标注 sealed。

## 当前进度

这是实施状态，不能替代原方案 §21/22 的阶段验收。

|阶段|已实现|尚未满足的退出条件|
|---|---|---|
|M5|六种格式的纯解析 IR、持久捕获、幂等任务、版本/lease 栅栏、撤回传播；原文和检索文字分离|Windows AppContainer 实测启动失败；尚未接入 APP 自动解析、原生文件导入及扫描件 OCR；不能宣称 OS 隔离完成|
|M6|结构分块、中文 FTS、检索前 scope/撤回/时间过滤、代际索引、引用重核、最小搜索界面|合成 pilot 不是人工密封集；原 §21 检索/引用质量指标未完成；dense/RRF 保持可选且未启用|
|M7|有原文证据的偏好/约束/决策候选、用户确认/冲突替换/有效期/撤回、来源审阅、分页、按需工具读取|跨会话任务成功/记忆 precision 正式评测尚未完成；过程经验归纳及 personal_fact 统一引用尚未交付|
|M8|模型容量预算、完整轮次选择、工具结果显式凭据占位、请求清单、发送前证据与记忆复核、超预算拒绝|目前以安全选择/裁剪为主；高级摘要与缓存收益的任务级评测未完成，不声称语义无损|

独立 review 的三项阻塞已修复：附件/引用消息在发送前检查撤回；按实际选入的工具结果复核（被裁剪或丢弃的旧结果不阻塞请求），缓存复用单独复核原调用；预算满足后立即停止裁剪。续接任务保留引用凭据，目录里的资料摘要也须重新授权。常见裸露密钥不进入记忆；这不是任意 secret 检测证明。

请求上下文清单升级为 `whole-turn-context-2`。APP 只接受本进程可信 host 的清单，renderer 没有请求记录写接口；清单中的调用 ID 只定位已有回执，不赋予权限。原文/回执哈希与 scope 仍由 APP 重查。新的 `FeatureSchema` 管理 memory/search 派生结构版本；导出/恢复包含这两类结构。

Windows 实验位于 `workers/parser/`，明确标记未验收、未打包。无 AppContainer profile 的启动在 `m5-container-02` 返回 Winerror 2，不能确定缺少 profile 是唯一原因。后续官方做法需系统创建专用 profile（含 APPDATA 目录），已就原 APPDATA 禁令请求窄范围授权，未获回答前不执行。不得回退为不受限 Python 子进程。

测试/打包记录见 `.m1-evidence/m58-*` 与稳定工作根各同名子目录。成功和失败现场均保留；最终状态以 `docs/FETCHCV_M5_M8_STATUS_20260922.md` 的实测与限制为准。新候选包含测试删除守卫，只用于验收，不能当正式发布版。
