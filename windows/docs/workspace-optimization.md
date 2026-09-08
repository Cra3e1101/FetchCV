# 求职工作台与前端框架优化

## 界面与流程

- 默认进入求职工作台，展示简历、岗位分析、面经调研三个入口。
- 基于本地岗位数据统计目标岗位、准备中、待确认与已记录投递；导出简历不算实际投递。
- 支持公司/岗位搜索和状态筛选，岗位行可直接打开简历或面经页。
- 面经页无需先生成简历；调研由用户在岗位中触发，保留已有 Agent 与权限流程。
- 复用主题变量，支持明暗主题、窄窗口、键盘焦点和减少动画设置。

## 框架

| 模块 | 职责 |
| --- | --- |
| `CareerDashboard` | 工作台展示、搜索、筛选和导航 |
| `workspace-summary` | 从真实岗位阶段归类进度，独立于 UI |
| `http-client` | 普通请求的超时、取消、结构化错误和控制令牌 |
| `WorkspaceBoundary` | 隔离页面渲染错误，保留侧栏导航和重试 |
| `App` | 组合页面、协调选中岗位与资料库加载 |

岗位工作区按需加载；流式 API 仍由 Agent 任务控制生命周期。写操作不自动重试，防止重复提交。模型状态、资料库或岗位详情读取失败不再直接等同于整个本地服务离线。岗位切换显示加载和错误重试状态，资料库请求用序号避免旧响应覆盖新选择，启动加载不会覆盖用户已经切换的岗位。

## 验证

- ESLint 与 Vite 生产构建通过。
- Node 测试 92 项通过，包括新增请求客户端和岗位状态测试，以及已有 Sidecar 启停测试。
- Edge 无头浏览器使用隔离测试数据验证搜索、筛选、面经导航、错误重试、明暗/窄窗口、模型状态失败降级和首次使用；无页面运行错误。
- 视觉验收图片位于 `artifacts/workspace-optimization/`，使用测试数据。
- 未调用付费模型或抓取外部面经；本次未验证真实模型与平台联调，也未重新生成 Windows 安装包。

## 复验

```powershell
node node_modules/eslint/bin/eslint.js .
node node_modules/vite/bin/vite.js build
node --test tests/*.test.mjs
```

UI 测试需先启动开发服务，再在另一个终端运行：

```powershell
node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5188 --strictPort
node tests/career-dashboard.e2e.mjs
```

UI 测试默认使用已安装的 Edge；可用 `FETCHCV_BROWSER_CHANNEL` 指定其他 Playwright 浏览器通道。
