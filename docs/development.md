# 开发指南

## 环境要求

- Windows 10/11 x64、Git、PowerShell。
- Node.js 22.19+（22.x）与 npm。
- Python 3.11+，建议使用 3.12。
- 首次安装 JavaScript、Python 和排版依赖时需要联网。

JavaScript 依赖使用 `package-lock.json`；Python 项目依赖以 `backend/pyproject.toml` 为准。不要跨平台复制 `node_modules` 或虚拟环境。

## 初始化

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

`FETCHCV_PYTHON` 仅在当前 PowerShell 会话中生效。新开终端后需重新设置；开发启动器会使用这个解释器启动本地后端。

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `npm run desktop:dev` | 启动支持前端热更新的 Electron 开发窗口 |
| `npm run desktop` | 构建前端与 Electron 运行时后启动桌面 |
| `npm run dev` | 仅启动 Vite 前端服务 |
| `npm run backend:dev` | 单独启动 FastAPI 后端 |
| `npm run check` | 静态检查 |
| `npm run build` | 构建前端 |
| `npm run test:unit` | 运行单元测试及后端测试 |
| `npm run test:electron` | 运行桌面端到端测试 |
| `npm run test:packaged` | 验证已构建的 Windows 应用 |

测试代码和合成 fixtures 属于源码的一部分。运行测试前查看对应脚本所需环境；不要让测试连接真实个人资料库或生产模型凭据。

## 本地数据

`desktop:dev` 默认在 `.m1-work/desktop-dev/` 下保存开发运行产物和独立用户资料。该目录已被 Git 忽略。单独启动后端时，默认数据库为 `backend/data/fetchcv.db`；普通桌面启动和安装版使用 Electron 用户数据目录。

FastAPI 接口调试页位于 `http://127.0.0.1:8766/docs`，它不是桌面客户端。应用运行时仍以实际 Sidecar 配置与认证要求为准。

桌面开发入口支持 `--electron` 指定 Electron 可执行文件，以及 `--software-rendering` 排查图形兼容问题。开发运行时和 Vite 缓存会在输入变化时更新。

## 构建 Windows 安装包

完成依赖安装后，在项目根目录执行：

```powershell
npm run resume:runtime:verify
npm run check
npm run build
npm run test:unit
npm run test:electron
npm run desktop:package
npm run test:packaged
```

`desktop:package` 会构建前端、Electron 运行时、XeLaTeX 运行时和 Python Sidecar，并生成 NSIS 安装包。产物位于：

```text
release/FetchCV-Setup-<version>-win-x64.exe
release/win-unpacked/FetchCV.exe
```

版本号来自 `package.json`。构建命令不会自动发布到 GitHub。

### 排版运行时与再分发

排版组件由 `scripts/resume-runtime.lock.json` 固定版本及校验值，从 TeX Live 镜像准备到 `build/resume-runtime`。安装包将其复制到 `resources/resume-runtime`。已有完整缓存时可执行：

```powershell
npm run resume:runtime -- --offline
```

原始宏包、字体与源码归档保存在 `build/resume-runtime-sources`。公开分发安装包前，应核对源码归档与二进制版本的对应关系、保留组件许可证，并提供所需源码材料；当前源码归档与二进制的逐一对应核验尚未完成。Windows 公开发行还需准备 Authenticode 代码签名。相关说明见[第三方组件](../THIRD_PARTY_NOTICES.md)。

开发时可用 `FETCHCV_LATEX_RUNTIME` 指定完整运行时目录，或用 `FETCHCV_RESUME_FONTS=bundled` 检查内置字体。发行包要求使用完整的随包运行时。

## 可选 Firecrawl 集成

基础网页搜索和读取不依赖 Firecrawl。需要接入时，在启动桌面前配置：

```powershell
$env:FETCHCV_FIRECRAWL_URL = "https://api.firecrawl.dev"
$env:FETCHCV_FIRECRAWL_API_KEY = "<your-api-key>"
```

自托管实例可通过 `FETCHCV_FIRECRAWL_URL` 指向本地服务，例如 `http://127.0.0.1:3002`；服务依赖与访问凭据由部署方管理，FetchCV 不会自动启动该服务。

模块分工见[架构说明](architecture.md)，提交规范见[贡献指南](../CONTRIBUTING.md)。
