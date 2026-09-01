# FetchCV for macOS

FetchCV 是本地优先的 macOS 桌面求职 Agent。它把个人资料、目标岗位、简历版本、面试情报和真实工具记录组织在同一个岗位工作区中，帮助用户完成：

```text
读取原简历
→ 理解并调研岗位
→ 找到可复用的真实经历
→ 提出有证据的改写建议
→ 请求用户确认
→ 修改同一份简历模板
→ 校验事实与岗位要求覆盖
→ 导出 PDF / Word
→ 准备面试
```

macOS 版已经与 Windows `0.4.19` 核心代码对齐，同时保留原生窗口行为、Keychain 安全存储、无扩展名 Sidecar、DMG/ZIP/PKG、Hardened Runtime、Developer ID 签名与 Apple 公证流程。

## 当前版本

- 产品版本：`0.4.19`
- 平台：macOS（Apple Silicon 与 Intel，需分别在目标架构构建）
- 前端：React 18、Vite、Electron、Radix UI、Framer Motion
- Agent Runtime：`@earendil-works/pi-agent-core`、`@earendil-works/pi-ai`
- 本地 Sidecar：FastAPI、SQLAlchemy、SQLite
- Python：3.11 或更高版本

## 核心能力

### 资料库与岗位 Agent

- 导入 PDF 简历并在本地提取教育、实习、项目、技能、奖项和个人信息。
- 保存作品集、网站、代码仓库、证书和其他求职材料。
- 为每个岗位保留独立对话、任务、审批、活动状态和简历版本。
- 支持粘贴 JD、导入文本文件或读取公开招聘页面。
- 使用单一 Pi Agent Loop 选择结构化工具；所有工具统一经过权限、审批、作用域、幂等、版本与审计约束。
- 给出有事实依据、可采用、可拒绝、可编辑的改写建议，不虚构经历或 ATS 通过率。

### 简历与面试工作台

- 同一份编辑器快照驱动编辑、预览与 PDF 输出。
- 可导出单栏、可编辑且适合 ATS 解析的 Word 文档。
- 用“支持 / 部分支持 / 暂无证据”矩阵解释岗位要求覆盖情况。
- 支持本地面试知识库、公开面经来源、证据引文与面试准备简报。
- 对小红书等来源采用只读、有限预算和熔断策略；遇到登录、验证码或访问限制时停止，不绕过平台控制。

### Web、Skill 与 MCP

- 普通问题与求职任务使用同一个 Agent Loop。
- 提供受控的网页搜索、正文读取和隔离浏览器能力。
- 网页请求限制为公网 HTTPS，阻断本机、私网、URL 凭据、危险端口和未校验重定向。
- 可加载受控目录中的 `SKILL.md`，并连接经明确授权的 stdio 或 HTTP MCP Server。
- Agent 工作区仅允许受控文件读取、搜索和预定义检查，不开放任意 Shell。

## macOS 适配

- 使用原生 `hiddenInset` 标题栏与红黄绿窗口控制，不渲染 Windows 自定义按钮。
- 关闭最后一个窗口后应用仍保留在 Dock；点击 Dock 图标可重新创建窗口。
- API Key 通过 Electron `safeStorage` 使用 macOS Keychain 加密。
- 本地数据默认位于 `~/Library/Application Support/fetchcv-desktop/`。
- 开发环境使用 `backend/.venv/bin/python`；打包后的 Sidecar 名称为 `fetchcv-api`，不带 `.exe`。
- Electron 主进程在打包前通过 esbuild 生成轻量运行时，安装包不携带整棵 `node_modules`。
- 打包配置启用 Hardened Runtime，并使用 `build/entitlements.mac*.plist`。
- 诊断脚本同时识别 `mac-arm64`、`mac-x64`、`mac`、`mac-universal` 和 `FETCHCV_MAC_APP` 指定的应用路径。

## 开发环境

安装 Node.js、Python 3.11+ 和 Xcode Command Line Tools，然后执行：

```bash
cd macos
npm ci
python3 -m venv backend/.venv
backend/.venv/bin/python -m pip install -e 'backend[dev]'
npm run desktop
```

请勿复用 Windows 生成的 `node_modules`、Python 虚拟环境、Sidecar 或 Electron 构建产物。

## 校验

```bash
npm run check
npm run build
npm run electron:runtime
npm run backend:test
npm run test:unit
npm run test:electron
```

`npm run test:unit` 已包含后端测试，因此单独执行 `backend:test` 不是必需步骤。依赖真实模型、真实材料或已打包应用的 E2E 测试需要相应本地配置。

## 打包

生成当前架构的 DMG 与 ZIP：

```bash
npm run desktop:package
```

生成 ZIP 后再使用 `pkgbuild` 生成 PKG：

```bash
npm run desktop:package:installer
```

构建脚本会按当前架构在 `release/` 下寻找 `FetchCV.app`。Apple Silicon 与 Intel 应在各自目标环境构建，或另行配置 Electron Builder universal 流程。

## 签名与公证

先检查签名、公证凭据和已有产物：

```bash
npm run signing:check
node scripts/check-macos-signing.mjs --artifact release/mac-arm64/FetchCV.app
```

配置 Developer ID 与以下任一公证方式后执行：

```bash
npm run desktop:package:signed
```

支持的公证凭据组合：

- `APPLE_API_KEY`、`APPLE_API_KEY_ID`、`APPLE_API_ISSUER`
- `APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID`
- `APPLE_KEYCHAIN`、`APPLE_KEYCHAIN_PROFILE`

缺少签名或公证凭据时，严格模式会失败，不会把未签名产物标记为正式发布版本。

## 安全与隐私

- API Key 只保存在本机 Keychain 包装的设置文件中，不进入源码、SQLite、Trace 或渲染页面。
- Sidecar 只监听 loopback，并要求每次桌面进程生成的控制令牌。
- 写操作使用稳定 `operation_id`；结果未知时不会自动重放。
- 模型出口递归处理姓名、邮箱、电话、证件号、本地路径、Cookie、Bearer、API Key 和私钥。
- `test use/`、`backend/data/`、数据库、安装包、构建目录和真实回归材料均不得提交到 GitHub。

## 目录

```text
src/                         React 桌面界面
electron/                    Electron、Pi Runtime、安全存储、Sidecar 生命周期
backend/applyos_api/         FastAPI API
backend/applyos_domain/      SQLAlchemy 领域模型
backend/applyos_harness/     权限、审批、状态机、版本、事实与审计
backend/applyos_agent/       业务工具、网页、Skill、MCP 与兼容层
backend/integrations/        PDF、DOCX、简历编辑器和外部适配
public/resume-editor/        嵌入式简历编辑器
scripts/                     开发、平台路径、签名与打包脚本
tests/                       前端、Electron 和 Pi Runtime 回归测试
docs/                        架构、交互与审查记录
build/                       entitlements；生成的 Electron runtime 被忽略
```

## 许可

本仓库暂未附带开源许可证。在许可证明确前，代码默认保留全部权利。
