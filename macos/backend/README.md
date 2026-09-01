# FetchCV backend

本目录提供 FetchCV 的本地 FastAPI、SQLite 领域模型、Agent 流程和简历/作品集适配器。`applyos_*` 仅作为内部 Python 包名保留，避免破坏已有迁移和数据库兼容性；产品名、进程、环境变量和用户数据均使用 FetchCV。

```bash
cd "/Users/jiujiu/Desktop/vibe coding/FetchCV"
npm run backend:dev
```

接口调试页为 `http://127.0.0.1:8766/docs`。桌面 GUI 请在项目根目录执行 `npm run desktop`。

数据库默认保存为 `backend/data/fetchcv.db`；桌面版本保存到 Electron 用户数据目录。若发现旧的 `applyos.db`，首次启动会复制迁移到 `fetchcv.db`，不会删除原文件。
