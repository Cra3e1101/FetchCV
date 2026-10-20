# FetchCV UI：本机 Codex 资源取证与适配

日期：2026-10-14。目标是应用本机客户端可验证的视觉规范，保留 FetchCV 的真实业务与数据接口。

## 参照与边界

- 核实的安装路径：`C:\Program Files\WindowsApps\OpenAI.Codex_26.1007.2314.0_x64__2p2nqsd0c76g0\app`，运行进程是 `ChatGPT.exe`。
- 目录版本 `26.1007.2314.0`，`resources/app.asar` 内 package.json 的版本是 `26.1007.21434`。它们不能混写。
- 使用 `@electron/asar` 只读列出、读取选定 CSS/JS；未修改安装文件，未复制专有字体或图标。
- 本地没有安装 REA skill/MCP。已读取官方仓库 `.agents/skills/reverse-engineer-anything/SKILL.md`（version 42），采用其取证、标记不确定性及验证方法；不声称调用了 REA MCP。
- 用户随后要求不要使用 computer use，因此已停止桌面操作。此前截图尝试超时，没有取得本次参考客户端截图。项目截图由 Playwright 对 FetchCV 自身页面生成。
- **本次是本机资源默认样式适配，不是已完成当前 Codex 窗口的像素级 1:1 比对。** 当前客户端的主题覆盖、缩放、用户调整的侧栏宽度均未知。

原始小型证据文件（含选择器、字节偏移、声明及动态覆盖片段）：
`C:\Users\hesan\Documents\Codex\2026-10-11\computer-use-codex-agent-ui\codex-ui-20261014\resource-audit.json`

## 可验证的静态值

来自 `webview/assets/app-shared-9a94b907ed47.css`、`app-initial-99e8b4b455fa.css`；区分 Electron 覆盖与浏览器默认规则。

| 项目 | 资源值 | FetchCV 应用 |
| --- | --- | --- |
| UI 字体 | `-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` | 系统字体，并显式加入中文系统回退 |
| Electron 字号 | 正文 14px、小字 13px、辅助 12px | 统一 token，替换原正文 15px |
| 字重 | 430 | 正文 430，标题和强调保留 500/600 |
| 主侧栏 | 默认 275px，clamp 范围 240–520px | 大窗口 275px；窄窗口采用业务适配 |
| 聊天最大宽度 | 48rem；另有 40rem 紧凑变体 | 使用 48rem；项目根字号明确为 16px，实际 768px |
| 工具栏 / 标题栏 | 46px / `11 × .25rem` | 46px / 44px |
| 输入框 | Electron 默认圆角 22px，左右 12px，行高 20px，最小输入 44px，控件 28px，底距 16px | 共用 Composer 应用同组变量 |
| 输入框阴影 | `0 0 0 1px #0000000a, 0 2px 8px 0 #0000000a, 0 4px 80px 8px #00000006` | 原值应用 |
| 浅色表面 / 底层 | `#fff` / `#f9f9f9` | 主面板白，底层近白 |
| 文字 / 次要文字 | `#1a1c1f` / 70% / 50% | 中性色层级 |
| 菜单 | 13px，外间距 4px，项目 5px 8px | 审批与模型菜单适配 |

这些是 CSS 精确声明，rem 转 px 依赖根字号，不是从截图估出来的数值。
用户消息 CSS 常规背景为前景色 5% 透明；JS 可用主题 `userMessageBackground` / `accentBackground` 覆盖，所以不能断言本机当前气泡一定是灰色或黑色。

## 属于业务适配的部分

- 保留 FetchCV 名称、新对话、岗位、个人资料、面试知识、模型、权限和来源审阅。没有替换为演示数据或空操作。
- Codex 全局图标轨道可从资源推导为 52px，但本项目没有对应的全套跨产品入口，因此未增加空轨道。
- 设置页的分区、1040px 最大宽度、表单和统计内容、工具凭据卡片、代码块边框、12/16px 面板/菜单圆角是 FetchCV 适配，未声称是已观察到的 Codex 设置原版。
- 默认简约白。用户指定的暖色浅色/深色保留在主题设置中，与资源默认值分开。
- React 入口统一变量在 `src/ui/codex-tokens.css`，组件适配在 `workspace.css` 和 `settings.css`。IPC 独立入口 `public/workspace/interface.css` 使用对应默认值；该入口无需引入 React。
- 原 OpenBitFun vendor 文件保持原样，由测试逐一验证 102 个文件哈希。

## 验证方法与范围

构建：`node node_modules/vite/bin/vite.js build`。

单元检查：`node --test tests/composer-layout.test.mjs tests/sidebar-grouping.test.mjs tests/window-chrome.test.mjs tests/processing-disclosure.test.mjs tests/chat-scroll.test.mjs`。

浏览器集成：运行 Vite preview；设置 `FETCHCV_UI_TEST_BROWSER=1`、`FETCHCV_UI_TEST_URL=http://127.0.0.1:4174` 和独立的 `M1_ALLOWED_DELETE_ROOT`，运行 `tests/ui-source-integration.e2e.mjs dist`、`tests/ui-workspace-shell.e2e.mjs`。后者同时设置 `FETCHCV_UI_TEST_BUILD=dist`。

验证使用真正的生产构建和 Edge Chromium，1440×900、deviceScaleFactor=1；另测 1024/768/390 宽度。API/native IPC 使用测试文件中的合成 fixture，不接触用户库/API Key，不代表真实模型联网验收。生产页面未嵌入 fixture。

覆盖独立对话及岗位导航、侧栏搜索、上传到发送链路、审批保存/失败处理、模型参数保存、折叠活动、代码块、设置五分区、三主题及溢出/输入框位置。

Electron 验收宿主本轮启动等待超时，未取得原生运行截图，不能将浏览器通过等同于 Electron/NSIS 验收。本轮未重打安装包。

初次验证还发现旧测试在更改 Models URL 后仍期待原目录数据；现先检查原值，改 URL 后重新读取模型目录。业务逻辑未为测试更改。活动明细断言也按现有脱敏逻辑检查公开标签，不要求泄露原始工具内容。

本轮验证结果：

- Vite 生产构建通过；仍有超过 500KB 的 chunk 提示，本轮没有借机调整打包结构。
- 相关 19 项 Node 单元检查通过，修改涉及的 JSX/测试脚本 ESLint 通过。
- React 与独立 V2 两套浏览器集成通过，无页面异常或意外 API 路由。
- 实测主侧栏 275px，消息代码块和输入框均 768px，左右边界完全对齐；会话滚动区域底部位于输入框上方。
- 中文实用字体由 Chromium `CSS.getPlatformFontsForNode` 确认为系统 Microsoft YaHei UI。
- 设置页在 1440/768/390 宽度检查五个分区，无水平溢出；对话框及保存按钮均位于视口内。API Key 文本与图标/操作按钮有独立空间。
- 截图检查已修复旧消息宽度/复制按钮位置、设置小窗口底部裁切、API Key 图标重叠、审批菜单双层选中背景。

最终证据目录：项目 `.m1-work/codex-ui-20261014-final/`（React）及 `.m1-work/codex-ui-20261014-v2-final/`（独立 V2）。后续菜单微调使用单独 `codex-ui-20261014-final-menu/` 复验，保留前一轮证据。
