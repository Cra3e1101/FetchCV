# FetchCV

[English](README_en.md) · 中文

FetchCV 是一款本地优先的桌面求职 Agent，围绕“资料整理、岗位理解、简历定向优化、事实核验、文档导出与面试准备”建立完整工作流。仓库同时保留 Windows 与 macOS 实现，方便分别开发、测试和打包。

> 当前仓库包含开发源码，不包含安装包、API Key、用户简历、本地数据库、虚拟环境或其他个人材料。

## 核心能力

- 导入 PDF 简历，整理教育、实习、项目、技能和作品集等资料。
- 为不同岗位建立独立工作区，并读取粘贴、文本文件或公开招聘页面中的 JD。
- 基于真实经历提出可审阅的简历改写建议，不虚构经历或 ATS 通过率。
- 使用同一份简历快照进行编辑、预览，并导出 PDF；Windows 版还支持 ATS 友好的 Word 导出。
- 通过单一 Agent Loop 选择结构化工具，并由 ToolGateway 统一执行权限、审批、作用域、幂等和审计约束。
- 支持受控网页读取、Skill、MCP 和隔离工作区工具。
- API Key 使用 Electron `safeStorage` 保存在本机；Sidecar 仅监听 loopback。

## 仓库结构

```text
FetchCV/
├─ windows/    Windows 10/11 x64 版本（当前版本 0.4.19）
├─ macos/      macOS 版本（当前版本 0.2.24）
├─ README.md
└─ README_en.md
```

两个平台目录各自包含完整应用：

```text
src/                     React 桌面界面
electron/                Electron 主进程、安全存储与 Sidecar 生命周期
backend/                 FastAPI、SQLite、Agent 与领域逻辑
public/resume-editor/    嵌入式简历编辑器
scripts/                 开发、测试与打包脚本
tests/                   前端及 Electron 回归测试
docs/                    架构与审查记录
```

平台内部的详细能力、架构和打包说明请参阅 [Windows 文档](windows/README.md) 与 [macOS 文档](macos/README.md)。

## 技术栈

- React 18、Vite、Electron、Tailwind CSS、Radix UI、Framer Motion
- FastAPI、SQLAlchemy、SQLite、Alembic
- Windows Agent Runtime：`@earendil-works/pi-agent-core` 与 `@earendil-works/pi-ai`
- PDF / DOCX 简历处理、本地 Sidecar、受控 Web 与 MCP 工具

## 本地开发

### Windows

```powershell
Set-Location .\windows
npm ci
py -3 -m venv backend\.venv
backend\.venv\Scripts\python.exe -m pip install -e "backend[dev]"
npm run desktop
```

验证与打包：

```powershell
npm run check
npm run build
npm run test:unit
npm run desktop:package
```

### macOS

```bash
cd macos
npm ci
python3 -m venv backend/.venv
backend/.venv/bin/python -m pip install -e 'backend[dev]'
npm run desktop
```

验证与打包：

```bash
npm run check
npm run build
npm run backend:test
npm run desktop:package
```

请勿跨平台复用 `node_modules`、Python 虚拟环境、Sidecar 二进制文件或打包产物。

## 模型与隐私

FetchCV 支持 OpenAI-compatible 与 Anthropic-compatible 模型配置。模型连接由用户在本机配置，密钥不应写入源码、Git 历史、SQLite 业务数据或截图。仓库的忽略规则会排除本地数据库、真实测试材料和生成产物，但提交前仍应主动检查待提交内容。

网页工具默认限制为公网 HTTPS，并阻断本机、私网、URL 凭据和危险端口。验证码和登录限制不会被自动绕过。

## 项目状态

FetchCV 仍在积极开发中。Windows 与 macOS 目录目前保留独立演进历史，功能和版本号并不完全一致。正式公开分发前仍需完成对应平台的代码签名与公证流程。

## 许可

本仓库暂未附带开源许可证。在许可证明确前，代码默认保留全部权利；如需使用、修改或分发，请先联系仓库所有者。

