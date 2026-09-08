# 牛客面经补充

## 使用

打开目标岗位的「面试」页，使用原有「开始面试调研／更新面试情报」。默认包含牛客，无新增平台按钮。小红书受限时继续读取牛客；来源须经过正文和引文验证。

## 改进

- 独立牛客 SSR 解析，只读取当前帖子正文，排除推荐列表和评论。
- 支持数字 ID 讨论帖与 UUID 动态帖，排除话题、搜索和聚合页。
- 统一移动端/桌面端、HTTP/HTTPS、追踪参数；旧帖跳转后按最终链接去重。
- 提取原帖创建时间，保留原帖入口与本地正文快照。
- 从搜索结果记录提取标题和摘要；摘要只用于相关性筛选，不能作为问题证据。
- 扩展公司/业务线/岗位词，读取服务端分页信息。默认每组词最多 3 页，本轮站内搜索有 60 秒预算，请求间隔至少 0.6 秒。未完成时返回续查位置，预算不截断已发现的结果集。
- 分别记录重复页、空壳页、访问保护、请求失败，不把它们等同于「没有面经」。遇到访问限制停止，不绕过验证或尝试登录。
- 问题继续接受逐字引文校验，重复来源复用已有记录。

## 工具参数

`discover_interview_sources` 可用 `platforms: ["nowcoder"]` 独立检索，默认仍查所有支持的平台。新增 `nowcoder_page_limit`（默认 3）、`nowcoder_start_page`（默认 1）、`nowcoder_query`（默认空）。

返回 `nowcoder_pages`、`nowcoder_continuations`、`nowcoder_stop_reason`。续查时把 continuation 的 `query` 原样传入 `nowcoder_query`，`page` 传入 `nowcoder_start_page`。遇到访问保护或连续失败不要立即循环重试。

## 验证与边界

- 使用公开讨论帖 https://www.nowcoder.com/discuss/740298 验证旧链接跳转、正文和发布时间；另验证公开动态帖的数据结构。
- 牛客分页实测有时返回 HTTP 200 空壳页，已标记未完成；没有声称能完整抓取平台全部面经。
- 后端全套回归通过；新增测试覆盖 URL、正文、分页续查、空壳页、入库去重、引文拒绝和 HTTP 429 停止。
- 浏览器验收验证原入口发送默认包含牛客的调研请求；前端与 Electron Runtime 构建通过。
- 入口测试使用模拟模型，没有调用付费模型。尚未生成新的 Windows 安装包。

复验：`node scripts/run-python.mjs -m pytest backend/tests/test_nowcoder.py backend/tests/test_interview_knowledge.py`
