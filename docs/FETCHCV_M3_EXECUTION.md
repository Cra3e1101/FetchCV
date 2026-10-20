# M3 与后续执行记录

授权：用户于 2026-09-21 要求执行 M3 等后续流程。按原设计 §22、R2 与 R3 顺序推进；每阶段退出门槛独立，不用后续计划冒充实现。

M3 基线 `3737e88101235bb751d788c05ab95030bc0cea7c`；源码归档与哈希见 `.m1-work/m3-20260921-01/backup.json`。原有 M1 未提交文件继续保留，不纳入本阶段提交。稳定临时根启动时已核验存在，禁止回退系统 TEMP。

## M3 增量

1. 真实工具目标归属、版本检查；附件与引用按当前岗位校验，进入当前用户消息而非 system。文件：`backend/applyos_harness/permissions.py`、`backend/applyos_api/pi_bridge.py`、新增 `turn_input.py`、对应测试。
2. 版本化 RPC 和运行事件：`packages/contracts/`、`packages/app/`、Electron main/preload/runtime 接点。限制方法、载荷、期限、主 frame、事件 seq/revision；不向 renderer 暴露 SDK 对象。
3. Harness 适配、取消/资源释放、输入消费回执及基础上下文合同；沿用已安装 SDK，不升级依赖。fake/真实 SDK 同合同验证。
4. 回归、构建、浏览器流程与报告。使用现有删除守卫及每次全新临时根；保留全部失败现场。

验证入口：`scripts/m1/guarded-pytest.py`，通过 `-k` 逐增量筛选后跑全量；Node 使用 `scripts/m1/run-guarded-node.mjs --label <fresh> --temp-root <stable>/<fresh> -- <node> --test <tests>`。全部 stdout、JUnit、退出码和审计置于 `.m1-evidence/`。M3 不改变 DB schema、不迁移真实库、不更改包锁和构建脚本。

回退：先隔离本阶段修改后的文件，使用源码归档按变更清单恢复 M2 整体实现；不 reset/clean、不删除原件。通用消息记录保持旧版可读。需要回退协议时整体回退，不打开另一条 loop。

## 后续门槛

M4a 先用合成库验证实际 Electron SQLite/FTS/WAL/备份及打包加载，再进行 25 表副本映射；生产权威切换必须在一致性备份、逐行去向、崩溃与新写入回退测试通过后。M5–M9 依次依赖来源版本、解析、检索、记忆和上下文合同。M10 的真实签名、安装升级与 30 次固定机器启动必须实测，缺凭据/环境/标注集时明确记录阻塞，绝不填造结果。

原件保护与已批准的合成临时删除边界继续有效。新增依赖若无法证明 NSIS 兼容、不可读/ACL 阻塞或范围外删除时停止相关执行并报告。
