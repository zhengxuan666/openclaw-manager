# runtime-diff-noise 修复总结

## 根因
Settings 预览/应用链路在 `buildGlobalInputConfigPayload` 中采用“全量组装 + 全量覆盖”策略：
- 即使用户只改 `tools.sessions.visibility` 或 `commands.native`，仍会把 `web/heartbeat/cron/hooks` 等区块按当前前端状态写回 `inputConfig`。
- 当原配置缺失这些区块时，会触发跨域 `add`（噪音差异）。

## 修复策略
改为 **分区脏写入 + 路径级 patch（path-scoped）**：
- 新增 `buildPathScopedGlobalConfigPayload(...)`，以 `fullConfig` 为基底，仅对“检测到变化”的路径写入。
- 允许父链补全（例如 `tools -> sessions -> visibility`、`commands -> native`）。
- 未改动分区保持 `fullConfig` 原值，不再注入跨域默认值。
- 保持原有预览/应用/回滚链路；`canApplyConfig` 与统一弹框逻辑未回退。

## A/B add 判定
基于可执行回归脚本（`/tmp/runtime-diff-noise-regression.ts`）实测：

### A) 仅改 `tools.sessions.visibility`
- `added`：`/tools`、`/tools/sessions`、`/tools/sessions/visibility`
- `modified`：无
- `removed`：无
- 判定：仅 tools 相关路径 + 必要父链，符合要求。

### B) 仅改 `commands.native`
- `added`：`/commands`、`/commands/native`
- `modified`：无
- `removed`：无
- 判定：仅 commands 相关路径 + 必要父链，符合要求。

## 回归结果
### C) 无改动
- diff 结果：`added=0`、`modified=0`、`removed=0`
- `hasPendingChanges=false`，`canApply=false`
- 判定：满足“diff 0/0/0 且应用禁用”。

## 构建验证
已执行：
- `npm run build`：通过
- `cargo build --release --bin web-server`：通过（仅现有 warning，无 error）

## 修改文件
- `src/components/Settings/index.tsx`
  - 新增路径级写入辅助函数：`cloneConfigRecord`、`isComparableValueEqual`、`setConfigPathValue`、`getConfigPathValue`、`deleteConfigPathValue`
  - 新增并使用 `buildPathScopedGlobalConfigPayload(...)`
  - `buildGlobalInputConfigPayload` 改为调用路径级组装
  - 导出 `buildManagedConfigSignature`（用于执行 C 场景禁用条件回归脚本）
- `docs/runtime-diff-noise-fix-summary.md`

## 边界与说明
- 本次未修改后端 diff 规则，按要求优先修复前端 payload 组装。
- 本次保持既有语义：`commands` 中未显式设置（`undefined`）字段不会主动清除后端已有值。
- 未提交 `run/web-server.pid`。
