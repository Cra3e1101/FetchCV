# FetchCV UI 对齐交付记录 · 2026-10-19

本轮依据本地 `codex-ui-replica/HANDOFF.md`、静态页面交互及用户给定度量完成 UI 改造。使用 Playwright 驱动真实 Edge 浏览器，没有使用 computer-use，也没有读取 APPDATA 用户资料。修改的是项目源码与候选构建，尚未替换已安装桌面版或生成新 installer。

## 1. 取舍决策表

“删除”指不引入参考物中的不适用功能，或移除旧界面中没有后端能力的禁用选项，不删除业务能力。

| 元素 | 参考物做法 | 本项目对应能力 | 决定 | 理由与替代入口 |
|---|---|---|---|---|
| 标题栏与窗口按钮 | 桌面标题带、窗口控制 | 已有 Electron 控制 | 保留 | 保留平台原生行为，标题带 44px |
| 左侧 rail | 多产品入口 | 工作区、资料、知识、设置 | 改造 | 52px rail，仅放真实入口 |
| 空间 | 通用空间 | 无相同模型 | 删除 | 岗位与独立聊天继续在侧栏管理 |
| 定时任务 | 定时运行 | 未提供相应 UI/服务 | 删除 | 不提供假调度入口，现有任务正常手动运行 |
| 插件市场、探索 | 市场发现 | 本地 Skills、MCP、扩展 | 改造 | 放设置页，保留真实安装、启停与配置能力 |
| 代码审查、站点 | 编码业务入口 | 无 | 删除 | 简历审核与求职功能保留自己的入口，不伪装成代码审查 |
| 产品切换、dot、通知角标 | Codex/ChatGPT 等 | 没有同等数据 | 删除 | 保留 FetchCV 名称，不伪造未读或产品切换 |
| 侧栏 | 项目、最近聊天 | 岗位、最近对话 | 改造 | 288px，保留搜索、管理、选择、收起 |
| 新聊天 | 独立会话 | 已支持 | 保留 | 新对话不强制先建岗位 |
| 命令菜单 | Ctrl+K，搜索与快捷操作 | 已加载聊天/岗位与现有操作 | 改造 | 520×487，支持键盘导航、Enter、Alt+数字；仅搜索已加载列表 |
| 命令菜单设置分组 | 大量设置命令 | 设置较少 | 改造 | 合并为打开设置快捷操作，不复制空分类 |
| 打开目录/搜索代码 | 编码入口 | 导入材料、岗位/聊天搜索 | 改造 | 调用原有真实入口，不做虚假文件树 |
| 顶栏 | 聊天标题与面板 | 岗位标题、对话/简历/面试 | 改造 | 52px 行高，保留业务标签和右侧上下文面板 |
| 输入框 | 底部 composer | 真实消息输入、粘贴、上传 | 改造 | 22px 圆角与测量阴影，沿用现有输入及 IME 处理 |
| 附件加号 | 上传 | 文件选择和材料导入 | 保留 | 继续走原接口，不使用演示附件 |
| 发送、停止 | 执行控制 | 已实现 | 保留 | 继续由实际执行状态驱动，禁用态保留 |
| 模型弹层 | 固定模型清单 | 用户配置的模型档案 | 改造 | 254px 宽，只列真实配置，提供模型管理入口 |
| 强度滑块 | 六档 | quick/balanced/deep 三档 | 改造 | 保留三个实际映射值，未增加不存在的推理档位 |
| 闪电、麦克风 | 速度/语音 | 未有对应能力 | 删除 | 使用既有投入选择和文字/附件输入 |
| 权限菜单 | 默认/完整访问 | 网络与文件分项策略 | 改造 | 请求批准/允许联网保留；不会把文件权限悄悄升级成全访问 |
| 完整访问权限 | 高权限模式 | 无对应一键后端 | 删除 | 用户仍可在权限设置中配置真实策略 |
| 用户消息 | 黑色气泡 | 已有消息 | 保留 | 浅色 #0d0d0d、白字、18px、最大 62%；深色用主题语义反色 |
| Markdown、代码、表格 | 富文本输出 | 已有渲染器 | 保留 | 使用相同卡片 token，不改变内容数据 |
| 复制 | 剪贴板与反馈 | 已有 | 保留 | 实际写剪贴板并显示“已复制” |
| 朗读、聊天分支、分享 | 消息动作 | 无对应后端 | 删除 | 复制与现有导出保留；不把新聊天冒充完整分支 |
| 状态行 | 运行、完成摘要 | 实际 activity/trace | 改造 | 真实成功、失败、中断、待确认，未知显示未知；无时长则不编造 |
| 两级折叠 | 命令组→单条输出 | 工具结果记录 | 改造 | 工具组→实际工具→结果，双向 0.3s 高度动画 |
| Shell 输出块 | 命令/stdout/耗时 | 当前 UI 只有工具结果摘要 | 改造 | 同样的卡片外观，标题“工具结果”；不伪造 Shell 原始输出 |
| subagent/skill 状态芯片 | 代理活动 | 当前链路未完整暴露 | 删除 | 不新增虚构代理状态，实际工具记录继续可见 |
| 自动压缩提示 | 上下文事件 | 当前视图缺可信事件字段 | 删除 | 不显示假“已自动压缩”；不影响运行时既有能力 |
| 空态、首屏加载、失败 | 部分展示 | 真实请求状态 | 改造 | 保留真实加载/错误、输入与任务控制；不无限自动重试 |
| 暂停/继续/取消 | 执行状态控制 | 已有任务操作 | 保留 | 不让已终止任务显示虚假“继续” |
| 设置整页 | rail 右侧全页 | 原设置浮层 | 改造 | x52/y36 起全页，保留焦点约束及 Esc；视觉不再是居中卡片 |
| 外观、密度 | 通用设置 | 已有白/暖色主题与密度 | 保留 | 新增简约深色，原暖色主题保留 |
| 模型/API、Skills、MCP | 服务配置 | 真实接口 | 保留 | 原配置/测试/启停逻辑继续使用 |
| 浏览器权限 | 通用浏览器设置 | browser bridge 真实权限 | 改造 | 保留相关权限设置，不照搬无用浏览器管理项 |
| 云环境、Worktrees、Codex 云端 | 编码环境 | 无 | 删除 | 不显示空设置；现有本地工作区不受影响 |
| 电脑操控、云电脑、快照 | 通用执行环境 | 无对应产品界面 | 删除 | 保留已存在工具及审批，不新增空控制页 |
| Mini、宠物 | 附属能力 | 无 | 删除 | 无替代需求，不占导航 |
| 开机启动、家长控制、联系人 | 客户端设置 | 未提供对应功能 | 删除 | 不制造不能保存的开关 |
| 使用情况/计费、邀请、账号退出 | 云账户业务 | 无该账户体系 | 删除 | 模型供应商配置照常使用 |
| 权限开关 | 二值开关 | 部分策略是多态 | 改造 | 仅真实 boolean 使用 32×20 开关；多态权限保留选择控件 |
| 岗位/JD/经历/事实 | 参考物未体现 | 核心业务 | 新增适配 | 保留原入口和组件，以共用 token 承载 |
| 简历修改、diff、确认、版本 | 参考物偏代码 | 核心业务 | 新增适配 | 保留审阅接受/拒绝及编辑，不将建议直接写入成品 |
| PDF/简历编辑与导出 | 无 | 已有 | 新增适配 | 保留原编辑器与导出流程，未更换生成实现 |
| 面试知识、资料、引用阅读 | 无 | 已有 | 新增适配 | 资料与面试知识独立 rail 入口，原阅读/管理保留 |
| 操作/文件/MCP 审批 | 通用权限控制 | 实际审批数据 | 新增适配 | 统一按钮/面板外观，保持对象、作用域和授权语义 |
| 求职信、ATS、作品集、投递记录 | 无 | 现有业务模块 | 新增适配 | 原业务入口保留；本轮没有重写其数据逻辑 |

## 2. 改动与证据

本轮改动 22 个已有文件，新增 7 个实现/测试文件；详细路径及前后 SHA256：
[change-manifest.json](../../.m1-work/ui-align-20261019/change-manifest.json)。此清单只比较本轮备份，不把仓库原有未提交改动算作本轮成果。

- 共用 token、布局适配：`src/ui/codex-tokens.css`、`replica-alignment.css`。
- rail、命令菜单、双向高度动画：`WorkspaceRail.jsx`、`CommandMenu.jsx`、`AnimatedCollapse.jsx`。
- 消息、工具卡片、模型弹层、设置页：原 React 组件适配，业务接口未替换。
- IPC 工作区：`public/workspace/replica-shell.css`、`settings-shell.js`，保留原存储桥接。
- `codex-ui-replica/app-shared.css` 未修改；未向产品复制参考客户端的字体包或资源包。

## 3. 实测值

生产构建运行于 Edge，1296×950 CSS px，DPR=1。`getBoundingClientRect()` 与 `getComputedStyle()` 原始结果、85 条断言、动画事件及错误列表见：
[production-metrics/metrics.json](../../.m1-work/ui-align-20261019/production-metrics/metrics.json)。85 通过，0 失败，页面与控制台错误为空。

| 对象 | 要求 | 实测 | 结论 |
|---|---|---|---|
| rail / 侧栏 / 顶栏 | 52 / 288 / 52px | 52 / 288 / 52px | 对齐 |
| rail 图标键 | 36×36，圆角12.5，行距44 | 同要求 | 对齐 |
| 基础文字 | 16/24 w430 | 16/24 w430 | 对齐 |
| 侧栏文字、分组 | 13/18.57 w430；14/21 w500 | 同要求 | 对齐 |
| composer | 圆角22，白底与指定阴影 | 圆角22，rgb(255,255,255)，样式断言通过 | 对齐 |
| 用户气泡 | #0d0d0d，白字，圆角18 | 同要求 | 对齐（浅色） |
| 命令菜单 | 520×487，y118，圆角20 | 同要求 | 对齐 |
| 强度 / 模型弹层 | 254×98 / 254×314，圆角20 | 同要求 | 对齐；仅三个真实强度 |
| 强度轨道 | 230×24，圆角12 | 同要求 | 对齐 |
| 设置页起点 | x52 y36 | x52 y36，1244×914 | 对齐 |
| 设置导航 | x60，262×30，圆角12.5，13/18.57 w400 | 同要求，首项y163 | 对齐 |
| 设置搜索 | x96 y105，224×18，14/18 | 同要求 | 对齐 |
| 设置页标题 / 内容 | x448，28/33.6；列宽732 | 同要求；实际文字框高33.59375 | 亚像素布局误差<1px |
| 行标题 / 行说明 | 13/18.57 w500；12/16 w430，偏移21 | 同要求；偏移20.984375px | 亚像素布局误差<1px |
| 开关 | 32×20，开启#3a83f7 | 同要求 | 对齐 |
| 状态行 | 13/18.57 w430，40%文字色 | 同要求 | 对齐 |
| 工具结果卡片 | 圆角12.5，1px ink/.118，背景ink/.055 | 同要求 | 同 Shell 外观，内容为实际工具摘要 |

动效实测：按下 transform=scale(.94)；hover 0.12s；折叠收起/展开均触发 transitionend，分别高0/74px，elapsedTime均0.3s；开关滑块位移12px、transform 0.2s snappy；颜色0.12s。弹层使用0.2s snappy、translateY 3px、scale .98；箭头使用0.2s。开启系统减少动效时主动缩减动画。

不是第4节每个细项都已单独逐像素验收：当前85项覆盖主要几何、字体、颜色和关键动效，尚未逐一测量所有图标路径、滑块伪元素阴影、所有菜单行/所有业务弹窗的每个状态。因此不宣称全界面满足1:1或全部硬指标。

## 4. 改前/改后实际截图

以下都来自真实浏览器渲染。内容是自动测试的明确合成样例，不是产品写死演示数据，也不是模型真实回答。设置对照均为1440×900、DPR1；新增简约深色无旧版同主题基线，故前后深色对照使用原有暖色深色。

| 主题 | 改前 | 改后 |
|---|---|---|
| 简约白 | [原设置浮层](../../.m1-work/ui-align-20261019/before-evidence/settings-theme-white.png) | [全页设置](../../.m1-work/ui-align-20261019/production-integration/settings-theme-white.png) |
| 暖色深色 | [原设置浮层](../../.m1-work/ui-align-20261019/before-evidence/settings-theme-dark.png) | [全页设置](../../.m1-work/ui-align-20261019/production-integration/settings-theme-dark.png) |
| 对话浅色 | [原对话](../../.m1-work/ui-align-20261019/before-evidence/desktop-tools-code.png) | [新对话](../../.m1-work/ui-align-20261019/production-integration/desktop-tools-code.png) |

新增简约深色与核心组件：

- [浅色对话与两级工具结果](../../.m1-work/ui-align-20261019/production-metrics/conversation-light.png)
- [深色对话](../../.m1-work/ui-align-20261019/production-metrics/conversation-dark.png)
- [简约深色设置](../../.m1-work/ui-align-20261019/production-metrics/settings-dark.png)
- [命令菜单](../../.m1-work/ui-align-20261019/production-metrics/command-light.png)
- [真实模型列表的深色状态](../../.m1-work/ui-align-20261019/production-metrics/model-list-dark.png)
- [390px 小窗口](../../.m1-work/ui-align-20261019/production-metrics/narrow-dark.png)
- [IPC 工作区](../../.m1-work/ui-align-20261019/production-ipc-r2/v2-desktop.png)、[扩展设置](../../.m1-work/ui-align-20261019/production-ipc-r2/v2-extensions.png)、[MCP 设置](../../.m1-work/ui-align-20261019/production-ipc-r2/v2-mcp.png)

已查看截图并对照：旧版居中模态卡片改成从rail右侧开始的整页设置；导航/正文字号、留白、气泡、输入框、工具卡片与深色文字同步修正。暖色主题继续使用用户此前要求的字体与配色，不当作 Codex 中性主题的1:1证据。

## 5. 验证命令与结果

在项目根运行，浏览器指向 `http://127.0.0.1:5198/` 的候选生产构建。三个浏览器脚本使用各自独立证据目录。

```powershell
$env:TEMP = '<项目>\.m1-work\ui-align-20261019\temp'
$env:TMP = $env:TEMP
node node_modules/vite/bin/vite.js build --outDir .m1-work/ui-align-20261019/build
node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 5198 --strictPort --outDir .m1-work/ui-align-20261019/build
$env:FETCHCV_UI_TEST_BROWSER = '1'
$env:FETCHCV_UI_TEST_URL = 'http://127.0.0.1:5198/'
# 各脚本的 M1_ALLOWED_DELETE_ROOT / FETCHCV_UI_EVIDENCE 应分别设置为新的项目内证据目录
node tests/ui-source-integration.e2e.mjs
node tests/ui-workspace-shell.e2e.mjs
node tests/ui-replica-metrics.e2e.mjs
node --test tests/composer-layout.test.mjs tests/sidebar-grouping.test.mjs tests/window-chrome.test.mjs tests/processing-disclosure.test.mjs tests/chat-scroll.test.mjs
```

| 验证 | 结果 | 证据 |
|---|---|---|
| Vite production build | 成功，6.92s；主chunk约610KB，仍有500KB阈值提示 | [build.log](../../.m1-work/ui-align-20261019/build.log) |
| React 主界面回归 | 通过：独立聊天、岗位、上传到发送、权限持久化/失败保存、主题、模型、面板、1440/1024/768/390 | [ui-integration.json](../../.m1-work/ui-align-20261019/production-integration/ui-integration.json) |
| IPC 工作区回归 | 通过：历史、导入桥接、发送、审批、主题、响应式，外观→扩展→MCP→外观 | [v2-integration.json](../../.m1-work/ui-align-20261019/production-ipc-r2/v2-integration.json) |
| 几何/样式/交互 | 85通过，0失败 | [metrics.json](../../.m1-work/ui-align-20261019/production-metrics/metrics.json) |
| 相关 Node 单元测试 | 19通过，0失败 | 本轮实际运行输出；脚本见上 |
| 本轮实现文件 ESLint 前后比较 | 没有新增诊断；App原有5条、extensions原有1条仍在 | [lint-comparison.json](../../.m1-work/ui-align-20261019/lint-comparison.json) |
| 上游 OpenBitFun 文件 | 原102个文件哈希验证通过 | 主界面回归结果 |

失败记录没有算作通过：首次构建因系统 TEMP 中 esbuild 文件删除权限失败，随后使用本任务工作区 temp 构建成功，未处理那个系统临时文件。最终 IPC 回归第一次因背景入口与设置导航同名而严格定位失败；把测试选择器限定到当前 dialog 后重跑成功，未为测试更改业务行为。

## 6. 未完成与差异边界

1. 未生成安装包，未更新正在安装/运行的桌面版本；本报告只验收源码与浏览器候选构建。
2. 浏览器验证使用合成 API/IPC 返回，未调用真实模型，未访问真实简历或执行真实审批、导出、网络抓取。真实服务商对推理参数的支持仍依配置与后端行为，不以本轮 UI 回归证明。
3. 未重新验证所有简历编辑器、ATS、投递历史等深层业务流程；保留其实现与入口，但不能据此宣称全业务验收通过。
4. Cmd菜单只检索已加载的列表，没有新增全库搜索服务。
5. 当前工具记录缺少原始Shell stdout和子代理事件，界面只显示真实摘要，不编造“Shell成功”或代理轨迹。未知时长/工具状态/统计数据不填假值。
6. 无真实朗读、分支、语音、云环境等能力，因此不显示假按钮。三档强度有实际映射，不复制参考物六档。
7. 参考静态页存在 Ctrl+, 重复监听、深色硬编码浅面板等问题，本轮不复制这些缺陷。参考运行中命令菜单高度484、强度面板96，与用户给出的487/98不同，本轮采用用户明确硬指标。
8. 白色/中性深色使用系统UI字体。没有将参考客户端字体包复制进产品，跨系统中文字体栅格化仍可能不同。
9. IPC 工作区保留自身业务层级，视觉对齐，不与React工作区强行合并。其扩展/MCP页面属于业务适配设计。
10. 当前 App.jsx 既有 hooks/memo lint问题，以及 extensions.js 既有未用参数诊断尚未处理；未用“全部lint通过”掩盖。构建chunk大小告警也保留。

## 7. 回退

修改前原件在 `.m1-work/ui-align-20261019/before/`，与项目相对路径一致。恢复时仅依据 `change-manifest.json` 中 changed 清单逐项比对后复制备份；added 文件移入隔离目录。不要使用全仓 `git reset --hard`，仓库有其他既有未提交工作。数据库、原始材料、旧 installer 未由本轮改动。
