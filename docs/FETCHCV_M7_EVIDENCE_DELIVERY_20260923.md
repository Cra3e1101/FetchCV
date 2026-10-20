# M7 等值记忆与多来源证据增量（2026-09-23）

依据原方案 §8 的 exact normalized hash、合并重复引用而不改原证据、撤回及 secret 边界。增量起点 `1ad9c17`。本次修复不等于 M5–M8 全部验收完成。

## 用户可见行为

- 相同 scope/kind/subject/predicate、相同提案有效期、等值原文只形成一个 pending 或 active 记忆，附加来源单独保留。仅 Unicode NFC 和首尾空白归一；不合并否定、大小写、内部空白、数字或不同措辞，不用模型猜同义。
- pending 仍须人工确认；active 追加相同证据不自动更改已确认内容。不同内容或明确有效期继续成为独立候选。rejected/revoked/superseded 不因新消息自动恢复。
- 界面可逐条点击查看关联来源；APP 每次核对 scope、消息状态、原文 hash 和引用范围。任意依赖消息或会话撤回，整条记忆同事务停用，原件、历史和证据行保留。
- 秘密过滤覆盖 quote、subject、predicate。只属于已实现的模式检查，不声明穷尽所有秘密格式。

## 存储与缓存

Memory feature revision 1/2→3 只追加 `equivalence_hash`、`proposal_valid_from`、`MemoryEvidence` 和约束/索引/触发器；不删除或重写原正文。旧表唯一 identity 仍保留。旧版本无法区分显式起点与确认补出的时间，因此保守回填已知值，不猜测未知时间。

每条记忆最多 20 个来源，达到上限明确拒绝继续追加。来源证据不可修改，原 proposal 重放不重复追加；来源与提案作用域双重验证。UI 的 revision 在新证据加入时递增，陈旧确认请求仍拒绝。

`reviewStateHash` 覆盖授权状态、有效期、确认身份、停用状态和不可变原 identity。仅追加等值证据不使已选入的旧工具观察自行失效；每次缓存复用/模型请求仍重查全部当前来源。新增/撤回记忆、覆盖偏好、有效期变化会改变集合快照。附加来源撤回不能通过重放仍有效的主来源绕过。

## 实测与失败记录

| 运行 | 结果 |
|---|---|
| `m7-evidence-red-01` | 3 个预期失败：跨消息重复、NFC 等值不合并、label 凭据漏检 |
| `m7-evidence-green-01` | 3 文件 10/10 通过 |
| `m7-evidence-date-red-01` | 复现未知起点错误合入明确历史起点，1 项失败 |
| `m7-evidence-cache-red-01` | 复现追加证据后旧工具观察过期，pending/active 两项失败 |
| `m7-evidence-green-02` | 6 文件 25 通过/1 失败；v2 升级用例复用了 v1 测试目录名，EEXIST；未掩盖该失败 |
| `m7-evidence-migration-green-01` | 改为独立目录后 v1/v2 升级 2/2 通过；原消息/hash/证据保留、FK 完整、未知 revision 拒绝 |
| `m7-evidence-ui-01` | 真实 Electron/preload/APP：重复偏好只显示一个 active 项，两份来源可点击，重启及撤回通过；320/768/1024/1440 无溢出、renderer error 0；既有引用与真实 LPAC 导入/搜索/撤回通过 |
| `m58-regression-06` | 61 文件、203 passed / 0 failed / 0 skipped / 0 cancelled，90.39 秒，守卫退出 0 |

修改文件 ESLint 与 git diff --check 通过。独立代码复核提出重放、缓存自失效、时间混合三项，均已复现并修复；复核未再发现该增量的阻塞。所有失败现场保留。

UI 证据：稳定测试根 `m7-evidence-ui-01/memory-evidence-ui.png`、`ui-report.json`，运行日志位于项目 `.m1-evidence`。用户旧 APPDATA、旧环境、旧数据库和原件未切换。

## 打包与回退边界

`m58-package-04` 和 `m58-packaged-ui-04` 已通过，但构建源码是增量前 `1ad9c17`，不能声称该包包含本次 MemoryEvidence。该包 installer 140,379,535 B，SHA256 `37baf703c3ee7943a4950a451882a9f480af218bb5157bb1739942a16e8c550c`，NotSigned；未安装到用户环境。其汇总为 `.m1-evidence/m58-validation-20260923-r4.json`。

本次增量已验证源码运行与桌面界面；新的完整 NSIS 构建尚未进行：D 盘剩余空间不足以保留下一套构建和提取目录。未清理既有原件/证据来掩盖空间压力。

回退代码使用本增量前 `1ad9c17`。Memory revision 3 工作区保持原位并停用；旧程序用升级前导出副本或新建工作区，不能手改 revision 数字强行降级。当前修改只在合成工作区验证，没有切换用户真实数据。

仍待完成：personal_fact 的 KnowledgeItem 引用、授权生效时间与事实有效时间的进一步分离、M6 分批后台索引、§21 人工质量集和 sealed 验收。OCR/dense/RRF 等可选能力不替代这些缺项。

收尾环境核对：D 盘仅剩约 0.46 GiB；旧中文文件名的简历 PDF 已不在原路径，当前英文名 PDF 的 hash 与旧基线不同，原因/发生时间未确认。详见 [统一状态记录](FETCHCV_M5_M8_STATUS_20260923.md)，不将路径异常写成已通过的原件保护核验。
