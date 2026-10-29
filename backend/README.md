# FetchCV 本地后端

本目录提供 FastAPI API、SQLite 业务模型、工具执行与简历文档适配。桌面端的交互模型循环由 Electron 中的 Pi Runtime 承载。

## 启动

在项目根目录完成 Python 依赖安装后，于 PowerShell 中运行：

```powershell
$env:FETCHCV_PYTHON = (Resolve-Path backend\.venv\Scripts\python.exe).Path
npm run backend:dev
```

接口调试页默认位于 `http://127.0.0.1:8766/docs`。启动完整桌面应用请参考[开发指南](../docs/development.md)。

单独运行时数据库默认保存到 `backend/data/fetchcv.db`；桌面端使用相应的用户数据目录。`applyos_*` 是为兼容迁移和 Python 导入而保留的内部包名。

## 模块

- `applyos_api/`：HTTP API。
- `applyos_domain/`：业务数据模型。
- `applyos_harness/`：任务、审批、权限、版本和事实校验。
- `applyos_agent/`：业务工具、网页与扩展适配。
- `integrations/`：文档与编辑器适配。
- `tests/`：后端测试。

依赖以 `pyproject.toml` 为准，整体调用链见[架构说明](../docs/architecture.md)。
