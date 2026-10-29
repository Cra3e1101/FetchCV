<div align="center">
  <img src="FetchCV_LOGO.png" alt="FetchCV" width="88" />
  <h1>FetchCV</h1>
  <p><strong>从真实经历出发，为每一个目标岗位做好准备。</strong></p>
  <p>本地优先的 AI 求职工作台 · 简历定制 · 岗位研究 · 面试准备</p>
  <p>
    <img src="https://img.shields.io/badge/Windows-10%20%2F%2011-0078D4" alt="Windows 10 / 11" />
    <img src="https://img.shields.io/badge/Local--first-Desktop-2F6B50" alt="Local-first desktop" />
    <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-3B82F6" alt="MIT License" /></a>
  </p>
  <p>
    <a href="#快速开始">快速开始</a> ·
    <a href="docs/getting-started.md">使用指南</a> ·
    <a href="docs/README.md">项目文档</a> ·
    <a href="https://github.com/Cra3e1101/FetchCV/issues">反馈建议</a>
  </p>
</div>

---

FetchCV 将个人资料、目标岗位、简历版本和面试材料放进同一个桌面工作台。导入已有简历，添加目标岗位，让 AI 协助理解岗位要求、整理相关经历并提出改写建议；由你确认后，再编辑、导出和准备面试。

**经历是基础，依据可回查，修改由你决定。** 每个岗位拥有独立工作区，方便同时推进不同求职机会。

## 核心功能

| 功能 | 你可以完成的工作 |
| --- | --- |
| **个人资料库** | 导入 PDF、Word、LaTeX 或 JSON 简历，核对教育、实习、项目和技能，积累可复用的经历与材料。 |
| **岗位工作区** | 粘贴职位描述、导入文本或读取公开招聘页面，集中管理岗位对话、任务和简历版本。 |
| **有依据的简历定制** | 查看改写建议对应的岗位要求与经历依据，采用、调整或拒绝建议，保留基础简历。 |
| **简历编辑与导出** | 在工作台编辑和预览简历，导出排版 PDF 或单栏、可编辑的 Word 文档。 |
| **面试情报** | 结合本地知识库与公开面经整理问题、来源引文和准备建议，随时回查原文。 |
| **可扩展的 Agent** | 配置兼容的模型服务，通过 Skill 与 MCP 接入额外能力，并管理工具授权。 |

桌面支持浅色、深色和跟随系统外观。API Key 在本机加密保存，资料保存在本地；使用云端模型与网页研究时仍会产生相应网络请求，详见[数据与隐私](docs/privacy.md)。

## 一条完整的求职准备流程

```text
导入简历 → 核对个人资料 → 添加目标岗位 → 审阅改写建议 → 编辑与导出 → 准备面试
```

1. **建立自己的经历库**：导入简历并核对解析结果，补充项目、作品集和证书等材料。
2. **围绕岗位调整表达**：添加 JD，在对话中分析岗位要求，选择有依据的改写建议。
3. **交付求职材料**：检查简历内容和版式，导出 PDF / Word，再整理相关面经与准备重点。

## 快速开始

当前提供源码运行与 Windows 构建方式，尚未发布可下载的 GitHub Release。桌面目标平台为 **Windows 10/11 x64**。

准备 Git、**Node.js 22.19+（22.x）** 和 **Python 3.11+**，建议使用 Python 3.12。在 PowerShell 中执行：

```powershell
git clone https://github.com/Cra3e1101/FetchCV.git
cd FetchCV

npm ci
python -m venv backend\.venv
backend\.venv\Scripts\python.exe -m pip install -e "backend[dev]"

$env:FETCHCV_PYTHON = (Resolve-Path backend\.venv\Scripts\python.exe).Path
npm run resume:runtime
npm run desktop:dev
```

首次准备排版运行时需要联网下载依赖。启动后，在设置中添加模型服务的请求地址、API Key 和模型，完成连接配置，再导入简历。支持 OpenAI Chat Completions 与 Anthropic Messages 兼容接口；具体工具调用能力取决于所选模型和服务。

详细步骤与常见问题见[使用指南](docs/getting-started.md)，安装包构建见[开发指南](docs/development.md)。

## 使用说明

- **导入格式**：PDF 需包含可提取文本；扫描件请先 OCR。Word 支持 `.docx`，旧 `.doc` 请先转换；TeX 仅静态解析，不执行导入源码。
- **内容核对**：解析结果与 AI 建议均需审阅。岗位匹配以要求和经历依据呈现，不提供第三方 ATS 通过率承诺。
- **文档输出**：PDF 使用内置简历模板；Word 为单栏可编辑版本。导入原件的版式不保证逐像素复现。
- **模型服务**：需自行配置兼容服务，服务费用与数据处理规则由所选提供方决定。
- **网页来源**：公开面经的可用性受来源网站限制；遇到登录、验证码或访问限制时可能无法继续读取。

## 项目文档

| 文档 | 内容 |
| --- | --- |
| [使用指南](docs/getting-started.md) | 首次运行、模型配置、简历导入与常见问题 |
| [开发指南](docs/development.md) | 开发环境、检查命令和 Windows 安装包构建 |
| [架构说明](docs/architecture.md) | 桌面端、Agent 循环、工具网关与本地后端 |
| [数据与隐私](docs/privacy.md) | 本地存储、模型请求和扩展权限 |
| [贡献指南](CONTRIBUTING.md) | 问题反馈、功能建议与代码贡献 |

## 技术栈

**React + Electron** 构建桌面体验，**Pi Agent Runtime** 驱动模型与工具交互，**FastAPI + SQLite** 提供本地业务服务，**XeLaTeX** 负责 PDF 排版。

```text
src/                 桌面界面
electron/            桌面宿主与 Agent 运行时
backend/             本地 API、业务模型与文档适配
public/resume-editor/ 简历编辑器
scripts/             开发与构建工具
tests/               自动化测试
docs/                使用与开发文档
```

## 参与贡献

欢迎通过 [Issues](https://github.com/Cra3e1101/FetchCV/issues) 报告问题或提出建议，也欢迎提交改进代码和文档的 Pull Request。开始前请阅读[贡献指南](CONTRIBUTING.md)；反馈问题时请使用脱敏示例。

## 许可证与致谢

FetchCV 的原创代码以 [MIT License](LICENSE) 发布。第三方代码、字体和运行时组件遵循各自许可证，见[第三方组件说明](THIRD_PARTY_NOTICES.md)。

感谢 Pi、Electron、React、FastAPI、SQLite 与 TeX Live 等开源项目提供的基础能力。
