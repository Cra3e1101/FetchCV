# Python 依赖锁与 M1 锁定环境

本目录保存 M1 阶段生成的精确依赖锁。它们描述一个可离线重建、可哈希校验的 Python 环境，
用于替代已经污染的 `backend/.venv`。

**当前环境已经建成并通过独立核验。本文件是记录，不是安装脚本。**

## 文件

| 文件 | 条数 | 内容 |
|---|---|---|
| `build.lock` | 6 | 构建期依赖（PyInstaller 链） |
| `runtime.lock` | 49 | 运行时依赖，含本地构建的 `fetchcv-backend` wheel 的 SHA-256 |
| `dev.lock` | 9 | 测试与策略依赖 |

合计 64 条 pinned 依赖，加 `pip` 本身（24.2）共 65 个 distributions。
锁的目标平台为 **Windows AMD64 上的 CPython 3.12**。

## 本地 wheelhouse

```
D:\hesan\Desktop\VSCODES\FetchCV_Windows\.m1-work\w3-python-20260911-192209\wheelhouse
```

该目录含 **64 个 `.whl`**，约 37.8 MB，是离线安装的唯一来源。
**必须与这三个锁文件一起保存**；wheelhouse 丢失则锁无法离线复现。

## 已建成的环境

固定位置：`D:\hesan\Desktop\VSCODES\FetchCV_Windows\backend\.venv-m1`

已核验状态：65 个 distributions；`pip check` 通过；64 个 wheel 的 SHA-256 与锁完全匹配；
`FETCHCV_V2_FINAL.md` 第 589 行列出的 36 项排除包全部缺席。

## 未来需要重建时的要求

**不要在当前环境上重复安装。** 重建是一个需要明确授权的新任务，动手前必须满足：

- **明确新的安装目标。** 不得就地覆盖 `backend\.venv-m1`，也不得覆盖旧 `backend\.venv`。
  移动虚拟环境会破坏 `Scripts\*.exe` 中硬编码的解释器路径，因此旧环境必须原位保留。
- **固定解释器。** 指定确切的 CPython 3.12 Windows AMD64 解释器路径，并在事后记录其版本。
- **先验证稳定临时根。** 构建与测试的临时目录不得从 `%TEMP%` 派生——本机上
  `%TEMP%` 是每会话目录，会话结束即被清理，会让后续恢复找不到路径。
  M1 使用的稳定临时根为：

  ```
  D:\hesan\Desktop\VSCODES\FetchCV_M1_work\20260910-235136
  ```

- **经受审计的安装工具离线安装。** 安装必须只从上述 wheelhouse 取包、不做依赖解析、
  并逐个校验哈希（即 `--no-index`、`--no-deps`、`--require-hashes` 三者同时成立）。
  安装顺序为 build → runtime → dev。
- **安装后核验。** 比对实际 distributions 与三个锁是否精确一致，
  并确认 36 项排除包仍然缺席。

## 回归测试的临时目录（重要）

`pytest` 在**显式指定 `--basetemp` 且该目录已存在**时，会先对整个目录执行 `rm_rf`，
然后再创建。也就是说，把 basetemp 指向项目内路径，等于让每次测试运行**递归删除该项目目录**。

因此：

- 每轮测试必须使用**全新的、项目外**的子目录作为 basetemp，不得复用上一轮的路径；
- 不要把 basetemp 放在项目树内。

关于残留目录的权限现象：本机上曾观察到由 Python 创建的临时目录出现无法读取、无法删除的
ACL 现象，并与 `mode=0o700` 的创建路径相关。**该现象的机制尚未完全解释**，
此处只记录观察结果，不作为已定论。

## 切回旧环境

把 `FETCHCV_PYTHON` 指向旧解释器的**绝对路径**即可，无需改动任何文件：

```
D:\hesan\Desktop\VSCODES\FetchCV_Windows\backend\.venv\Scripts\python.exe
```

M1 不删除旧环境、不迁移数据库、不替换已发布的 installer。

## 工具约束

`scripts/m1/` 下的脚本在处理行记录时，凡是送入 `Measure-Object`、`Group-Object`
等**属性型管道**的对象，必须使用 `[pscustomobject]` 构造；PowerShell 的有序字典
（`[ordered]@{}`）在这类管道中不可做属性绑定，曾导致汇总字段为 `null`、
`Group-Object` 分组键为空。JSON 输出的**容器**仍可保留 `[ordered]`，
但**记录元素**要用 `[pscustomobject]`。
