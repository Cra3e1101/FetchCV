# 最终验证命令与证据

执行目录均为 `D:\hesan\Desktop\VSCODES\FetchCV_Windows`，解释器是项目现有 Python 和 `D:\Nodev\node.exe`。不安装依赖。重跑时换新的临时目录名，避免混淆之前的证据。

## 后端最终套件

```powershell
$env:FETCHCV_WORKSPACE_ROOT="$PWD/.m1-work/remediation-release-workspace"
$env:PYTHONDONTWRITEBYTECODE='1'
$env:PYTHONUTF8='1'
Remove-Item Env:FETCHCV_SETTINGS_FILE -ErrorAction SilentlyContinue
& .\backend\.venv-m1\Scripts\python.exe -B -m pytest backend/tests -q -p no:cacheprovider --basetemp .m1-work/remediation-release-suite -o addopts='' -k 'not test_real_pdf_and_jd_domain_flow_preserves_original_resume and not test_real_resume_redaction_and_ai_preview_do_not_send_pdf_or_identity and not test_legacy_job_snapshot_rebases_on_source_layout_without_losing_body_edit'
```

输出：`.m1-evidence/architecture-remediation-20261021/python-release.txt`。
只排除这三项缺少真实 PDF 的测试。之前使用 `--deselect` 的完整 nodeid 在此 Windows 环境没有匹配成功，所以 `python-final-closure.txt` 仍实际运行了三项并报文件缺失；不能把那次称作通过。最终改为精确测试函数名筛选，日志会列出 deselected 数量。

## 最后宿主与签名批准测试

```powershell
& 'D:\Nodev\node.exe' --test tests/conversation-tools.test.mjs tests/pi-agent-runtime.test.mjs tests/pi-contract-regression.test.mjs
```

输出：`chat-host-tests.txt`，24 passed。测试使用合成响应，不调用真实付费服务。

## 最后后端定向测试

```powershell
$env:FETCHCV_WORKSPACE_ROOT="$PWD/.m1-work/remediation-chat2-workspace"
$env:PYTHONDONTWRITEBYTECODE='1'
& .\backend\.venv-m1\Scripts\python.exe -B -m pytest backend/tests/test_standalone_conversations.py backend/tests/test_result_archive.py backend/tests/test_prompt_contract.py backend/tests/test_pi_bridge.py -q -p no:cacheprovider --basetemp .m1-work/remediation-chat2-tests -o addopts=''
```

输出：`chat-approval-tests-2.txt`，22 passed。覆盖参数不匹配/过期签名、布尔批准无效、相同调用回放、同调用改参数拒绝、权限撤销、归档分页和迁移。

## 编译与静态检查

```powershell
& 'D:\Nodev\node.exe' .m1-evidence/architecture-remediation-20261021/build-runtime.mjs
& 'D:\Nodev\node.exe' node_modules/eslint/bin/eslint.js electron/main.mjs electron/pi-agent-runtime.mjs electron/sidecar.mjs electron/pi/context-budget.mjs electron/pi/context-policy.mjs electron/pi/fetchcv-harness.mjs electron/pi/provider-adapter.mjs electron/pi/provider-probe.mjs electron/pi/compatible-payload.mjs electron/pi/conversation-tools.mjs shared/model-profile.mjs shared/provider-endpoint.mjs src/components/InterviewSourceReader.jsx src/components/ModelParameters.jsx src/components/ModelSettingsDialog.jsx src/lib/api.js
```

输出：`electron-build-final.txt`、`lint-release.txt`，两条命令退出 0。构建入口脚本保留了实际 esbuild 参数，输出隔离于 `.m1-work/architecture-remediation-build/`。

前端构建日志为 `frontend-build-final.txt`。后来修改仅涉及后端/宿主与测试，没有继续改前端。

## 证据解释

- 不把不同批次且有重叠的通过数相加。
- JSON 与源码哈希清单用于定位审查对象，不等于行为证明。
- 真实 Pi/SDK 测试仍使用合成 provider；不能推断每家代理服务都通过。
- 构建检查没有执行 NSIS 安装和真实用户数据库迁移。
- `SOURCE_MANIFEST.json` 不是完整发布清单；本轮已有修改前备份的文件提供单独补丁，其他文件明确标为无本轮备份。
