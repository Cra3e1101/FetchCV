# 来源核验真实界面验收

在项目根目录执行：

```powershell
& 'D:\Nodev\node.exe' tests/interview-evidence-review.e2e.mjs
```

依赖项目现有 Node、Vite、Playwright，已安装的 Microsoft Edge，以及 `backend/.venv-m1/Scripts/python.exe`。可通过 `FETCHCV_TEST_PYTHON` 指定另一个已经具备项目后端依赖的 Python。脚本不安装任何依赖。

入口会自行构建真实 `SourceReaderDialog` 和生产 CSS，启动绑定随机 loopback 端口的静态服务器与真实 FastAPI。后端只放一条明确标为合成数据的面经，使用独立 SQLite，绝不复制真实数据库。临时浏览器 profile、APPDATA/LOCALAPPDATA、TEMP/TMP 和后端 workspace 都在此次 `.m1-evidence/evidence-review-ui-随机后缀/` 下。API 使用随机控制令牌与精确 CORS origin。页面请求限制在本次两个 loopback 端口。

验收内容：

- 从真实 UI 确认作者亲历，监听准确的 POST 回执；随后重新 GET 并以独立只读 SQLite 连接核实落库。
- 重载页面后，来源类型、来源链接、原文依据均回填。
- 通过 UI 撤回核验，再检查 POST、GET、SQLite 和重载后撤回提示，避免旧成功提示导致误判。
- 使用生产 `applyInterfaceTheme` 和 `applyAppearance` 切换简约白、深色，分别检查 1200×900、420×760 的文档和控件水平溢出；核验正文及主要按钮文字对比度。
- 保存四张真实渲染截图、计算样式/尺寸、回执和结果至 `report.json`；验证 Escape 到达关闭回调。
- `finally` 关闭本次浏览器、HTTP 服务器和自己创建的 Python 进程树，不触碰用户已有软件，保留诊断与数据库供复查。

退出 0 才代表本次断言通过；失败退出非零，保留 `failure.png`（能截图时）、API 日志与失败报告。报告和截图是合成数据上的真实组件/API 集成验收，不代表小红书采集、Electron 启动或真实账号数据的端到端验收。

旧 `.m1-evidence/evidence-review-ui/` 手动固定端口 fixture 已由此自包含入口取代，不需要预先启动任何服务器。
