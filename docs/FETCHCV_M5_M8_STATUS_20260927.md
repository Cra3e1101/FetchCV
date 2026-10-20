# M5–M8 实测状态（2026-09-27）

原设计依据：`D:\hesan\Desktop\VSCODES\linshi\FETCHCV_V2_FINAL.md` §21/22。工程增量已经交付；正式质量门槛尚未全部满足，M5–M8 不标记为全部完成。

| 阶段 | 当前工程能力 | 剩余验收 |
|---|---|---|
| M5 | 持久解析队列、不可变原文/定位、版本与撤回、LPAC 隔离，真实桌面与包内导入 | 60 来源解析 golden 与人工定位/事实覆盖率 |
| M6 | 权限/时效先过滤的 FTS、去重与原文引用、分批后台索引，单写队列中导航可继续 | 400 查询按来源家族分割、人工标注与 sealed 检索质量；规模与偏斜测量 |
| M7 | 多来源等值记忆、确认/有效时间分离、冲突/撤回；新增用户确认事实，仅引用 KnowledgeItem，版本或来源失效后停用 | 100 对话序列人工 precision/secret/撤权质量集 |
| M8 | 完整轮次与工具组预算、发送前重验、最终引用绑定选中回执；失效事实回执不能认证回答 | 正式人工语义支持与回答质量；字节保守预算不是精确 provider token 计费 |

## 本轮交付与验证

代码提交 `a5c2e16`：个人事实引用；`f53303116f3c623a6aa8b9d3cd3ee7d42c63baa0`：修复资料/简历页面记忆管理入口与撤回刷新。新增条目/引用及其导出恢复均在合成工作区验证，旧生产数据库没有迁移或切换。

- `m58-regression-09`：218 通过，0 失败/跳过/取消，235473 ms。对应个人事实核心增量；随后仅界面修复由下面两项端到端测试覆盖，没有把该回归说成在最后界面修改后重跑过。
- `m7-facts-ui-05`：真实 Electron/preload/utility、资料内确认事实、查看原文、来源撤回自动刷新通过，4 种宽度无水平溢出。
- `m58-package-08`：基于 f533031 构建成功，90 条 ASAR 路径，422 份 sidecar 与 105 份 parser 文件核验。
- `m58-packaged-ui-11`：NSIS 解压候选的 write/restart/invalid-manifest 通过；新增个人事实确认、重启持久化、来源撤回后禁用 KnowledgeItem、撤回记忆引用通过。仅模拟文件选择和模型服务端，真实 Pi/APP/隔离解析执行。

候选安装包 `D:\hesan\Desktop\VSCODES\FetchCV_M1_work\20260910-235136\m58-package-08\output\FetchCV-Setup-0.4.19-win-x64.exe`：140384269 B；SHA256 `983c12673c1ce2f39f5738f9a137a70314b30a89e5971e3b0563a160fb2dfafc`。ASAR SHA256 `8f7cd5d09fb60a1f8da4fc752cec84b98fbaf42d1985c7d006bcef5f704afef2`。NotSigned，含测试守卫，仅为验收候选，未安装、未发布。

审计：`.m1-evidence/m58-validation-20260927-r3.json`，133 次历史运行/74 次成功，其余失败现场保留。976 条 JavaScript 删除 API 成功回执未见范围外删除，blocked=0；该统计不是原生 SQLite/Chromium/构建工具或全部历史文件活动的穷尽审计。28 个 ASAR 文本文件的三类凭据模式零命中，不是任意 secret 的完整证明。保留测试树 12527788809 B，回收 0 B。

## 保留的失败与限制

- `m7-facts-ui-01/02`、`m58-packaged-ui-09` 等因旧测试/构建目录 Changed 通知退出 86。只读分类型诊断窗口记录 0 事件，没有重现或确定根因；守卫没有放宽，不能宣称环境问题已修复。
- `m58-packaged-ui-10` 发现资料页面隐藏记忆区，`m7-facts-ui-04` 发现刷新仍只接受 conversation。均已修复，ui-05 与 packaged-ui-11 实测通过；旧失败不覆盖。
- 项目树所有权仍是既有环境问题；原素材中文路径缺失/英文文件 hash 不同的先前记录继续保留，不推断二者等同，不恢复覆盖。
- 旧 `.venv` 原位；旧库 SHA256 仍为 `11e73ec84150780d7a92fa5fd39e287e639a6164b15ed0bcdeec9c997511a565`，旧 installer 和 package.json/lock 哈希仍与前次记录一致。未访问用户 APPDATA，已授权专用 parser AppContainer 除外。

## 下一步与回退

继续建立可复核的 §21 质量集、标注指南与离线评测入口，区分自动合成标签和人工标签，执行 20% 双标注及争议仲裁；随后测 50 candidates/500 jobs/20000 messages/5000 sources 的均匀与偏斜负载。没有这些实测，不能声称 recall、nDCG、precision 或 p95 已达门槛，也不默认启用 hybrid。

源码和新工作区都需保全。回退使用先前完整候选及其升级前工作区副本；先导出新写内容。旧程序不支持 personal_fact FeatureSchema，会拒绝新库，不强行降级或删除新条目。M4 源码备份仍为 `.m1-work/m5-m8-20260922-01/m4-source-baseline.zip`，旧数据与旧 installer 不动。M9/M10 未启动。
