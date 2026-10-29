# 第三方组件说明

FetchCV 原创代码采用 [MIT License](LICENSE)。第三方代码、资源和发行组件继续遵循各自许可证；根目录许可证不替代这些授权。

## 仓库内保留的第三方代码

| 组件 | 许可证位置 |
| --- | --- |
| cc-switch 相关代码 | [shared/vendor/cc-switch/LICENSE](shared/vendor/cc-switch/LICENSE) |
| OpenBitFun 相关代码 | [src/vendor/openbitfun/LICENSE](src/vendor/openbitfun/LICENSE) |
| OpenBitFun Design System | [src/vendor/openbitfun/design-system/LICENSE](src/vendor/openbitfun/design-system/LICENSE) |

以上目录保留来源说明和版权声明；目录存在不表示所有内容都会进入默认运行路径。

## 包管理依赖

JavaScript 依赖记录在 `package.json` 与 `package-lock.json`；Python 依赖记录在 `backend/pyproject.toml`。依赖的使用和再分发应遵循对应发行包中的许可证。

## 排版与桌面发行组件

Windows 构建包含 Electron、Python Sidecar，以及 XeLaTeX / TeX Live 宏包和字体。构建生成的排版运行时保留许可证与来源清单，源码和原始归档输出到 `build/resume-runtime-sources`。

分发安装包时，需要按组件许可证保留声明并提供必要的源码材料。构建缓存不等同于已核验的可分发源码包；当前源码归档与二进制的逐一对应核验尚未完成。具体构建入口见[开发指南](docs/development.md)。
