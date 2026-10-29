# 架构说明

FetchCV 将桌面交互、模型决策与业务执行分开。默认桌面路径使用 Electron 中的 Pi Agent 循环，以及本机 FastAPI + SQLite 后端。

```text
React 桌面界面
    │
Electron 宿主 / Pi Agent Runtime
    │ 模型流、工具调用、任务控制
FetchCV ToolGateway
    │ 权限、审批、作用域、版本与执行记录
FastAPI / SQLite
    ├─ 个人资料、岗位、简历与提案
    ├─ 面经来源、知识检索与引用
    └─ PDF、Word、网页、Skill 与 MCP 适配
```

## 模块分工

| 目录 | 职责 |
| --- | --- |
| `src/` | 工作台、岗位对话、设置与文档交互 |
| `electron/` | 窗口、模型连接、安全存储、Pi 宿主与 Sidecar 生命周期 |
| `backend/applyos_api/` | 本地 HTTP API |
| `backend/applyos_domain/` | SQLAlchemy 数据模型 |
| `backend/applyos_harness/` | 权限、审批、任务状态、版本与事实校验 |
| `backend/applyos_agent/` | 业务工具、网页、Skill 与 MCP 适配 |
| `backend/integrations/` | 文档转换与简历编辑器适配 |
| `public/resume-editor/` | 嵌入式简历编辑器 |

`applyos_*` 是保留的内部 Python 包名，用于保持现有导入和迁移兼容性。

## 模型与工具执行

Pi 负责接收上下文、调用模型、选择工具并继续决策。默认桌面业务路径的 Python Sidecar 提供确定性工具执行，不另开一套交互模型循环。

工具调用经过 ToolGateway，按候选人、岗位和文件范围检查权限。需要确认的修改进入审批流程；写操作使用稳定操作标识和版本约束。无法确定操作是否成功时进入待核对状态，不能直接重放副作用。

模型连接适配 OpenAI Chat Completions 与 Anthropic Messages 兼容接口。主进程管理模型凭据，界面消费规范化事件。详细契约见[运行时兼容性](sdk_compatibility.md)。

## 资料与文档

默认后端使用 SQLite FTS5 / BM25 检索本地面经、简报与对话资料，先限定资料范围，再排序返回片段；当前为关键词检索。

简历改写关联岗位要求、事实依据和版本。PDF 预览与导出使用同一 XeLaTeX 编译结果；DOCX 由独立的单栏导出路径生成。导入的 TeX 仅静态解析，输出使用固定模板和转义后的内容。

## 扩展与边界

Skill 从受控目录读取，MCP 支持 stdio 或 HTTP 连接。扩展授权由应用管理，不能仅凭扩展自行声明“只读”获得权限。当前应用层权限控制不等同于操作系统级沙箱。

网页请求通过专用工具处理公网地址、重定向与响应大小等限制，动态页面可使用受控浏览器。详见[网页工具](web_tools.md)与[数据与隐私](privacy.md)。

## 可选存储实现

仓库保留 JS/V2 存储与 `workers/parser/` 等模块。`FETCHCV_V2_STORAGE_ROOT` 选择可选实现；默认启动路径仍为 Python Sidecar。两者的简历业务、工具契约与数据模型尚未完全对等，不应直接切换现有用户资料。

涉及后端切换的开发应先核对业务契约，并使用资料副本验证迁移与回滚。
