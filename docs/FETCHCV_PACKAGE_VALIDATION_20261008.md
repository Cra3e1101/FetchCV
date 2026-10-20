# DOCX 修复候选包验收（2026-10-08）

代码基线 `8805fa2`。本次为产品代码变化后的重新构建，补齐 `FETCHCV_M5_DOCX_FIX_20261007.md` 中“尚未重建 installer”的限制。

`m58-package-17` 使用显式 `--offline-verified-tools`，固定 hash 校验压缩归档后在全新缓存解包；未复用旧解包的可执行文件。构建守卫退出 0，ASAR 包含 90 个路径。

`m58-packaged-ui-15` 从本次 installer 解包，核对 ASAR、422 个 sidecar 文件及 parser 清单，运行实际 Electron write/restart/invalid-manifest 流程并通过，守卫退出 0。重启截图已人工视读核对，显示撤回来源与记忆状态。包内测试的导入样本是 TXT，多段 DOCX 的专门回归和 60 份隔离导入证据见前述修复记录，不声称在 installer 内重新执行了 DOCX 专门用例。

## 产物

- 路径：`D:\hesan\Desktop\VSCODES\FetchCV_M1_work\20260910-235136\m58-package-17\output\FetchCV-Setup-0.4.19-win-x64.exe`
- 大小：140384691 B。
- SHA256：`52cb30c39b963dbab39c0ca6947d205f48c86a86fedf3fa04f98f80d3fae6b74`。
- ASAR SHA256：`ad5f6f8b13a2e610a690b8613e93b01ac33786fc1d19086fa16f573076c21804`。
- parser `formats.py`：8310 B，SHA256 `83576426a22254ce6f9d0bd4c91bd29d054fd4a18c4a93fd1efed3de76a330ea`，与当前源码一致。
- Authenticode 实测：NotSigned。构建日志出现 signing 步骤不等于有有效签名。

报告：各运行根的 `package-report.json`、`packaged-report.json`，及项目 `.m1-evidence` 对应 `*-node-exit.json`。两个 run_verdict 均 success=true、exit_code=0。旧库 SHA256 仍为 `11e73ec84150780d7a92fa5fd39e287e639a6164b15ed0bcdeec9c997511a565`。

这是包含守卫的候选包验收，未安装、未发布、未切换用户工作区，旧产物未清理。磁盘检查时 C 约 3.62 GiB、D 约 16.32 GiB 可用。扫描 OCR、复杂版面与正式人工质量评测仍未完成；本次没有重跑全部 219 项产品测试，也没有重新审计 Defender 事件或宣称整机安全状态。
