# Python 依赖快照

本目录保留 Windows AMD64 / CPython 3.12 环境的依赖与哈希快照：

| 文件 | 用途 |
| --- | --- |
| `build.lock` | 构建工具依赖 |
| `runtime.lock` | 运行时依赖，包含本地构建的后端 wheel |
| `dev.lock` | 开发与测试依赖 |

这些锁文件需要与对应版本的 wheelhouse 配合使用。仓库不包含该 wheelhouse，本地后端 wheel 的哈希也不代表当前工作区源码；它们不能单独作为当前版本的通用安装入口。

新开发环境请按照[开发指南](../../docs/development.md)从 `backend/pyproject.toml` 安装。维护离线依赖包时，应在独立目录重新生成 wheel 和哈希，并核对解释器、平台及源码版本。
