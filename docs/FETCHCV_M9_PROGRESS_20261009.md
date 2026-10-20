# M9 界面与受控扩展执行记录（2026-10-09）

> 当前结论（2026-10-09）：M9 本阶段内部验收已完成。最新证据为 `.m1-evidence/m9-validation-20261009-r3.json`，完整交付说明见 `FETCHCV_M9_ACCEPTANCE_20261009.md`。下文保留逐轮历史，“尚未完成/尚未打包”描述的是当轮状态；不要以它覆盖本条最新结论。M5–M8 真人质量验收仍延期，M10 未执行。

用户本轮明确要求先进入下一步。执行解释：暂缓 M5–M8 的真人标注/独立质量验收，允许开展 M9；不将缺失标签改为通过。400 检索题/100 记忆草稿仍未人工评审，全部拟议 split 已公开执行，不是 sealed 指标。M10 发布仍须单独核对全部门槛。

## 范围与顺序

依据原方案 §11–13、§22 及项目内 2026 执行修订表：

1. 来源阅读：搜索/回答引用打开本地原文，版本、字符定位、高亮、不可用提示，键盘及窄窗可操作。
2. 对象导航：资料/岗位/会话的标签与范围，保留旧 Artifact reader；跨会话恢复与撤权可见。
3. 草稿审阅：前后对比、明确确认、保存新版本及带出处导出；完整求职链端到端。
4. 活动与记忆界面：状态、来源、时间、适用条件、取消及回执；隐藏思考和秘密不展示。
5. 声明式扩展/MCP 配置：版本快照、逐工具权限、撤权/卸载、资源路径校验；不把可信 server 等同于所有工具已授权。

每个切片有针对性测试、实际 Electron 验收和独立代码审查。尚未实现的切片不会显示为通过；不启动 M10 签名、安装或发布。

## 第一切片

新增 public/workspace/source-reader.js，以原生 dialog 从搜索结果和回答引用进入；显示引用及前后最多 300 字符，不冒称完整 PDF 页面预览。字符偏移遵循 Unicode codepoint。文本用 textContent/text node 渲染，不解析原文 HTML。Escape 关闭并恢复触发按钮焦点。

打开/重新核对时先 citation.resolve，再 document.read；每次都经过 APP 权限检查，并核对 textHash 与引用字串。无法读取显示不可用状态，不沿用上次正文。资料内容是否支持回答仍由用户核对。

resolveCitation 在原权限谓词之后返回 sourceScope；读取 candidate-wide 资料时使用它，解决岗位范围与资料范围不一致的问题。未放宽 AUTHORIZED 或 document.read 条件。数据库结构和旧数据不变。

## 验证记录

- m9-reader-red-01：新增共享来源测试因缺少 sourceScope 如预期失败，现场保留。
- m9-reader-green-01：11/11 来源、引用、权限、撤回及 Unicode 分页测试通过，guard exit 0。
- m9-reader-ui-01：真实 Electron/preload/utility 和 LPAC 导入链通过；回答引用、搜索两处入口已测试，mark 非空、Escape 关闭恢复焦点、320px 对话框无横向溢出；整页 320/768/1024/1440px 检查通过，rendererErrors=[]。沿用合成文件选择器，不声称用户实际点选过原件。
- 独立只读代码审查无 Required 项。已查看 source-reader-narrow.png；这是已保存原文的文本邻域视图，不是 PDF 原图。
- 产品 reader 本轮改动尚未重建 installer；当前候选 package-18 不包含本切片。未安装、未发布。

本切片仅显示原文文本位置和可用页码，PDF bbox 图形定位、版本切换、完整对象标签、diff 和扩展配置仍未完成。源文件回退应使用本切片独立提交的 revert；保留合成证据与所有既有素材。

## 对象标签页增量

导航缓存只含 kind/id，按 workspace 隔离，最多 12 项；恢复通过 workspace.catalogue 的精确 objectId 重新查询，失效记录不恢复正文。关闭标签只移除导航记录，不删除业务对象。忙碌会话和未确认备注保存仍阻止切换。

独立审查指出的两阶段导航竞争已修正：查询前票据、查询后列表等待票据均可失效，关闭的标签不会被迟到结果重新打开。m9-tabs-unit-04 的 4 项测试通过（其中 1 项是尚待集成的草稿 diff 保真测试）。m9-tabs-ui-02 完整 Electron 验收通过，刷新自动恢复最后对象，rendererErrors=[]，四档宽度通过；之后仅补充第二阶段取消票据及单元回归，最终全流程仍需再跑。

失败现场：m9-tabs-unit-01 因守卫记录 tests 目录 Changed 退出 86；不推断来源、不计通过。m9-tabs-ui-01 导入后等待“查看解析正文”超时，添加失败截图/控件状态诊断后 ui-02 未复现，原因尚未确定，保留为最终综合验收关注项。无放宽守卫或清理现场。

## 草稿审阅与出处导出增量

新增完整原文/草稿双栏对比（窄屏顺序排列），以公共前后缀标示整段变化；确认仍走精确操作哈希与版本校验，保留历史版本。APP 对提议正文记录引用回执；已确认版本可经原生保存对话框导出 JSON 归档，包含正文、版本、可用引用及未核验标记。撤回来源不再导出原文，草稿不能导出。保存对话框返回后重验权限，独占创建文件，拒绝覆盖。当前不是排版型 DOCX/PDF 导出。

- m9-draft-unit-02：10/10 通过，覆盖 Unicode diff、审批、引用、跨候选人拒绝、撤回后不泄露原文。
- m9-draft-ui-03：真实 Electron + APP + Pi 本地合成供应商完整生成、审阅、确认、取消导出、保存、拒绝覆盖通过；320/768/1024/1440px 无横向溢出，rendererErrors=[]。已查看窄屏 diff 截图。原生选择器为合成选择，未连接真实模型。
- m9-draft-ui-01 失败根因：测试 bundle 缺正式构建已有的 createRequire，Pi 依赖报 Dynamic require of process。修正测试 banner。
- m9-draft-ui-02 失败根因：夹具已有历史版本 2，新增版本正确为 3，断言错误写死为 2；改为从初始历史最大版本计算。失败现场保留。
- m9-draft-unit-01 守卫报告 tests 目录 Changed，未视为通过或放宽规则。
- 独立代码审查无 Required 项。尚未重建 installer；岗位、运行活动、扩展配置与最终综合验收仍待完成。

## 岗位与运行活动增量

岗位目录可打开岗位概况、分页查看本候选人与此岗位/通用范围的会话、资料、简历、运行和草稿，并创建绑定该岗位的新对话。岗位及运行支持已有对象标签恢复。运行面板展示状态、开始/结束时间、白名单工具名和回执存在性；按需刷新、分页、进入所属会话。不返回原始提示词、参数、结果、错误正文或凭据，不自动重放中断任务。

- m9-objects-unit-02：4/4 通过，范围、墓碑、摘要字段与标签竞争覆盖。
- m9-objects-unit-01：守卫记录 tests 目录 Changed 后退出 86，未有删除审计行，原因未确定；未计通过、未放宽守卫。
- m9-objects-ui-01：真实 Electron 全流程通过，新增岗位关联/新岗位会话和运行活动可达；rendererErrors=[]，四档宽度通过。
- 独立只读审查无 Required；建议后续增加敏感值 canary 与摘要第二页覆盖。

受控扩展配置、来源版本选择/原图定位、完整键盘验收与最终候选打包仍未完成，M9 尚不能标记为完成。

## 声明式原生能力扩展增量

UTF-8 JSON 本地包经原生选择器进入 APP 私有导入，最多 256 KiB；只含 manifest 和内联文本资源，不执行/解压代码。内容 hash 校验、逻辑路径限制、版本不可变，首次导入及升级均禁用。设置页展示完整声明和资源，逐工具授权；Agent 新运行锁定说明/技能/工具快照，技能正文按需读取，工具预算 1–32。停用/撤权/逻辑移除阻止旧运行后续调用与模型请求；不删除包历史、原件或用户产物。格式见 FETCHCV_M9_DECLARATIVE_PACKAGES.md。

- m9-extensions-unit-02：2/2 包格式、授权、升级、撤权测试通过。
- m9-extensions-runtime-01：11/11，包括 Pi 快照/按需技能/工具过滤/预算/撤权与原有 Agent、引用回归。
- m9-extensions-ui-01：真实 Electron 全流程通过，新增包导入/预览/授权/选择 Agent/恢复内置/停用/移除/Escape 焦点恢复；四档宽度通过，rendererErrors=[]。已查看 extensions-narrow.png。
- m9-extensions-unit-01：tests 目录 Changed 守卫失败保留，无删除记录，未计通过。
- 独立审查无 Required。Optional：选择 Agent 时提前检查授予能力完整性，当前在新运行开始时安全拒绝。

此增量尚不接外部 MCP；mcp 非空包明确拒绝。完整 M9 仍缺 MCP 通道与授权 UI、来源版本/原图定位、全流程纯键盘与最终打包验收，不以该切片冒充 M9 完成。

## 来源版本选择增量

来源阅读页按 Source 提供显式版本切换，标识当前/历史/正在查看；未解析版本不可打开。版本列表以可访问 Document 为权限锚点，核对 workspace/candidate/job 与墓碑、撤权，50 项分页。切换仍读取对应版本的不可变 ID/hash，原引用不会指向新版本。

- m9-versions-unit-02：2/2 通过，覆盖版本、权限、撤回及已有来源引用范围。
- m9-versions-unit-01：守卫 tests 目录 Changed 失败，0 字节删除审计；保留且不计通过。
- m9-versions-ui-01：真实 Electron 全流程通过，新增历史正文→当前正文切换；既有草稿导出/扩展生命周期/岗位/记忆/LPAC 导入仍通过，四档宽度，rendererErrors=[]。版本切换用合成解析内容，原 LPAC 导入仍独立实跑。
- 独立审查无 Required；后续可补超过 50 版本边界和更多墓碑测试。

尚缺 MCP 外部工具通道及审批界面、PDF 页图/bbox、全流程纯键盘与最终打包。当前没有完成这些项的声明。

## MCP stdio 传输核心（尚未开放给 UI）

采用官方固定版本协议 [stdio](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports) / [lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle) 的 UTF-8 换行 JSON-RPC 和初始化顺序。不使用 shell；仅必要 Windows 环境和指定临时目录，不继承 provider key。错误和 stderr 不原样返回 UI。请求/消息/工具枚举有限额，空闲关闭、超时取消标为 outcome_unknown，不自动重试。仅为显式可信本地程序的 APP 私有组件，尚无 renderer 启动入口。

- m9-mcp-stdio-unit-03：2/2 通过（多分支），覆盖握手/UTF-8/工具列表、schema 变化通知、无秘密继承、错误协议/输出、超时与取消。
- unit-01/02 分别因 tests、tests/fixtures 目录 Changed 守卫中止，均无删除审计行；02 首个测试通过但整轮不通过。目录 LastWriteTime 仍为创建测试时的 19:10:41 UTC，早于通知；不足以证明通知成因或抵消失败。
- 独立审查确认 fixture 无文件/网络/子进程操作，传输无项目文件写入路径；未发现 Required。
- 明确边界：普通 MCP 子进程不是 OS 沙箱，可信程序仍有本机访问权；child.kill 只保证请求终止直接子进程，不保证其后代。此能力不用于不可信 executable。

接下来仍须 MCP schema/逐工具授权、目标绑定审批、结果回执及设置 UI；此协议核心不能算完整 MCP 或 M9 完成。

## MCP private approval ledger increment

Added closed input-schema validation and a private MCP manager with explicit server trust, schema-bound tool grants, scope-bound one-shot approval hashes, persisted receipts, no automatic retries, and unknown outcomes after interrupted dispatch. Not yet wired into APP/renderer/model; no claim of complete MCP support. Local stdio servers are trusted user processes, not OS-sandboxed.

Validation: m9-mcp-manager-unit-04 passed 7/7, exit 0. Independent read-only review confirmed the type-inapplicable schema keyword issue is resolved. Earlier unit-01 watcher interruption and unit-02 config validation failure remain preserved.

## Focused Agent UI and MCP integration

The workspace is now a bounded desktop shell: compact navigation, independent reading area, bottom composer, and on-demand import/search/memory/note drawer. Narrow navigation has explicit open/close, inert background and keyboard focus restoration. Source-scope option markup was corrected after independent review. Details and actual upstream source references: FETCHCV_M9_UI_REDESIGN_20261009.md.

MCP is now connected through APP requests and settings. Disabled configurations require explicit local-program trust, discovery and per-tool grants. Each scoped operation has a separate parameter review and approval, stored receipt, cancellation and revocation. Agent receives list/propose/read-receipt capabilities only; no configure/trust/grant/execute capability. Model receipt view excludes UI-only arguments and approval hashes. MCP proposals and Agent tool receipts commit atomically. Caller must provide the exact input/output schema hash. Unsupported schema keywords/results fail closed. Current support: trusted local stdio servers, closed schema subset, text content and validated structured results; no HTTP transport, OAuth/secret-reference provisioning, image/resource renderer, OS sandbox or descendant process guarantee.

Evidence:
- m9-shell-ui-02: complete real Electron regression passed, screenshots inspected.
- m9-mcp-app-unit-02: 10/10. m9-mcp-agent-unit-02: 12/12 including a real worker with an intentionally held import, where cancel/revoke complete before the import is released.
- m9-mcp-agent-unit-01: 11 pass / 1 fail; nested transaction in proposal+receipt. Fixed using AgentRepository.finishToolWith producer inside one transaction; failed evidence retained.
- m9-mcp-agent-unit-03: 8/8 MCP canary / existing Agent runtime / extension regressions.
- m9-mcp-ui-01 and m9-keyboard-ui-01: complete Electron path passed; explicit trust/grant/propose/approve/receipt/revoke, prior import/citations/draft/export/memory/versions preserved; four viewport widths, rendererErrors=[]; keyboardCoreActions uses real Tab/Enter for navigation, import, search, send, approve and export. Native pickers and model remain synthetic. Not every setup action in the harness is keyboard-only.
- Independent review Required findings (control queue delay; excess model receipt fields) both fixed and re-reviewed.

No new installer has been built yet. M9 final comprehensive regression/candidate verification remains open. Text source locator degrades to known quote/page when no real bbox exists; no PDF page image renderer has been implemented.

## 作品历史版本与综合回归

作品阅读页现可按不可变版本 ID 查看旧版本并返回当前版本，50 项分页；切换不修改 current_version_id。当前对象授权、范围和墓碑检查仍由 APP 完成。独立只读审查无 Required。

- m9-artifact-versions-unit-01：3/3 通过。
- m9-regression-01：270/270 通过，0 跳过，退出 0。
- m9-final-ui-01：失败；夹具旧版本状态为 draft，真实按钮附有“待审阅”，测试精确名称遗漏该标记；产品状态未修改。
- m9-final-ui-02：完整真实 Electron 验收通过，rendererErrors=[]；历史来源/作品版本、MCP 生命周期、键盘核心链、导入/引用/审阅/导出/记忆与四档宽度全部通过。保留失败现场。
- 打包 E2E 操作路径适配按需资料面板及默认对话导航，原业务断言未放宽；独立审查发现的首次作品导航遗漏已补齐。

接下来构建并验证包含以上源码的候选包，当前还不能将该项计为通过。

## 候选包与异常重启后的证据边界

产品源码提交 fbe28fa，候选 m9-package-01 构建通过。NSIS 140,404,990 B，SHA256 cb9af3d55a31cce99801dbdea1b87b809d79bffb2cba3f41aaca04fc184006b4；app.asar SHA256 c68c0574c16cc2a8db433395c5c1c862c16ef5f7a459dff2f68afdfc1d6b9904。签名实测 NotSigned，含测试守卫，未安装/发布。

m9-packaged-ui-02 完整包内首次写入、重启恢复、无效 manifest 拒绝通过；真实 APP/Pi 与 LPAC 导入、记忆/事实/出处撤权通过，422 sidecar 与105 parser文件逐项哈希匹配。模型供应商和文件选择是合成夹具。16个 public/workspace 文件逐字节哈希与ASAR一致。产物路径及37个文本文件的3类凭据模式扫描无命中；不是穷尽秘密证明。

包内追加 MCP 验证仍未验收：
- ui-01 在标签恢复后同名“来源资料”按钮歧义，修正测试导航/目录定位，未改业务断言；ui-02 通过。
- ui-03 守卫退出86；Renamed记录3146新名称为空，3148旧名称为空，不擅自配对或豁免；删除API日志0字节。
- ui-04 终端功能日志出现success，但node-exit.json 14,672 B与packaged-report.json 4,142 B均全NUL，watcher-stop.json 100 B全NUL，fswatch日志部分NUL。此轮不可认证，不能用功能stdout替代守卫退出。现场原样保留。
- 只读System事件查询发现2026-10-09 20:35:50（北京时间）Kernel-Power 41：系统未正常关机后重启。时间接近，但未证明根因；正询问用户是否主动重启。读盘时C剩466,432,000 B、D剩9,936,195,584 B，不能归因为D盘满。

汇总 .m1-evidence/m9-validation-20261009.json 已回读验证JSON有效、0个NUL，m9FullyAccepted=false。已可解析轮次的JS删除API成功回执共152条、可核对路径均在各自批准根内；可能重复，不等于底层文件数量，不涵盖全部native操作，也不能覆盖ui-04损坏日志。全部现场保留，回收0 B。旧backend/data/fetchcv.db仍为11e73ec84150780d7a92fa5fd39e287e639a6164b15ed0bcdeec9c997511a565。

M9此时仍未标记完成。PDF页图/bbox渲染未实现；当前提供精确文字邻域/已知页码。JSON归档导出不是排版DOCX/PDF。M5–M8人工标签仍按用户要求延期，没有伪称通过；M10签名/发布未开始。

## 主动重启确认与最终恢复验收

用户明确确认之前为主动重启。保留 ui-04 全零原件及不可认证结论，不推断它曾通过。新目录 m9-packaged-ui-05 在相同守卫与相同候选包下独立通过：run_verdict.success=true，exit_code=0；MCP 配置/信任/逐工具授权/提议/审批/回执/禁用成功，首次写入、重启恢复、无效 manifest 拒绝仍通过。守卫退出报告14,672 B、包内报告4,144 B均为有效JSON、0个NUL。

独立只读审查未发现 M9 硬门槛缺口（其范围依据项目内修订执行表）；主代理另行核对原报告§13/§22及§7/§23的缺失位置降级要求。M9 阶段验收完成，不等于全部设计愿景或 M10 发布完成。最终审计r3保留历史失败轮次与158条可解析JS删除API回执；ui-04日志不完整，不能声称全历史审计穷尽。
