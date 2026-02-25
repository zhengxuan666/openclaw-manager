# OpenClaw Manager 重构计划（测试中心迁移优先 + 智能体模块）

> 更新时间：2026-02-25
> 适用范围：`/home/openclaw-manager`
> 当前状态：M1/M2/M3/M4 已完成并已部署验证（P0/P1/P2 全部落地：bindings/get_config 降级容错、批量删除与批量复制、模型/工具/sandbox 分区编辑、详情页 bindings 引用与 Channels 跳转、defaults 统一入口与分区跳转、覆盖优先级提示、保存前分区级校验与差异预检）

## 1. 已确认决策（冻结）

1. 底部标签：
   - 中文：`智能体`
   - 英文：`Agent`
2. 测试中心入口：
   - 从首页概览的 **快捷操作卡片内“诊断”按钮** 进入
3. 智能体模块首屏结构：
   - `Default Agent 卡片` + `自定义 Agent 列表`
4. 智能体模块一期范围：
   - 覆盖所有 Agent 相关配置入口（默认/自定义、模型、工具策略、路由等）
5. Settings 迁移策略：
   - 先不处理迁移提示，后续再做移除/收敛

---

## 2. 开发顺序（优先级）

## Phase A（优先）测试 Tab 迁移

目标：先把“测试”从底部导航迁移到概览二级页面，减少底部标签负担。

### A.1 导航重构

- 底部/侧边栏移除 `测试` 主 Tab
- 保留测试能力，但入口改为：
  - `概览 -> 快捷操作 -> 诊断按钮 -> 测试中心页面`

### A.2 测试中心页面形态

- 新建“测试中心”二级页面（可复用原 Testing 组件）
- 需要：
  - 顶部标题与返回按钮（返回概览）
  - 移动端可用（不遮挡底部导航）
  - 与现有测试能力（诊断、环境检测等）功能等价

### A.3 验收标准

- 点击概览“诊断”可进入测试中心
- 测试中心功能完整，不低于原 Testing Tab
- 导航切换无白屏/无死路（可返回概览）

---

## Phase B（随后）智能体模块开发

目标：新增 `智能体/Agent` 主模块，聚合 Agent 相关配置。

### B.1 页面信息架构（明确双层）

- L1：`Agent 列表页（Agent Center）`
  - `Default Agent` 卡 + `自定义 Agent 列表`
  - 列表态快速操作：设为默认（单个）、复制（单个/批量）、删除（单个/批量）、name/workspace 内联编辑
  - 展示摘要：bindings 引用数、覆盖字段数、草稿差异摘要
  - 点击任一 Agent 卡片进入详情配置页
- L2：`Agent 详情页（Agent Workspace）`
  - 顶部返回列表 + 当前 Agent 标识 + 应用/撤销操作
  - 分区编辑：
    1. 基础信息（id/name/workspace/default）
    2. 模型策略（primary/fallback/模型参数）
    3. 工具策略（allow/deny/elevated）
    4. 沙箱策略（mode/workspaceAccess/scope/workspaceRoot）
    5. 路由关系（bindings 查看、引用提示、跳转入口）
    6. 高级覆盖（extra 字段与未知字段保留）
  - 支持分区校验、差异预览、统一持久化

### B.2 数据作用域（必须可见）

在 UI 明确标识三类作用域与覆盖优先级，避免误配置：

- 全局（Gateway）
- 默认（agents.defaults）
- 单 Agent 覆盖（agents.list[i]）
- 优先级：`Agent 覆盖 > 默认 > 全局`

### B.3 关键交互（列表页）

- 新增/复制/删除 Agent（含批量复制、批量删除）
- 设为默认 Agent（单个操作，保持系统唯一默认）
- 删除前引用检查（bindings/依赖项）
- 未保存变更拦截（离开前确认、刷新/关闭确认）
- Agent 卡片内联编辑（name/workspace）
- 点击 Agent 进入详情页（带当前草稿上下文）

### B.4 关键交互（详情页）

- 按分区编辑 Agent 全量配置（模型、工具、路由、覆盖）
- 分区级错误提示与全局保存前校验
- 差异预览（新增/删除/更新字段明细）
- 应用变更后回写列表摘要；撤销变更回到基线
- 详情页离开拦截（返回列表/切换页面/关闭标签）

### B.5 验收标准

- 能完整管理 default + custom agents，且默认唯一性始终成立
- 列表页与详情页职责清晰：列表负责管理，详情负责配置
- Agent 相关配置入口集中可达（从列表一跳进入详情）
- 预览/差异/应用链路可用，错误提示清晰
- 移动端可操作（列表与详情页均无关键控件遮挡）

---

## 3. 实现细节与风险控制

### 3.1 Agent 配置覆盖矩阵（现状 vs 目标）

| 配置域             | 典型路径                                                     | 当前 Agent 列表页       | 当前 Settings/Channels    | 目标 Agent 详情页             | 备注                           |
| ------------------ | ------------------------------------------------------------ | ----------------------- | ------------------------- | ----------------------------- | ------------------------------ |
| 基础信息           | `agents.list[].id/name/workspace/default`                    | ✅（已支持）            | ⚠️（间接/非主路径）       | ✅（需完善）                  | 默认唯一性需持续校验           |
| Agent 模型覆盖     | `agents.list[].model`                                        | ❌（仅保留 extra）      | ⚠️（部分能力在 AIConfig） | ✅（优先实现）                | 需支持 primary/fallback 与参数 |
| Agent 工具覆盖     | `agents.list[].tools`                                        | ❌（仅保留 extra）      | ⚠️（分散）                | ✅（优先实现）                | allow/deny/elevated 需可视化   |
| Agent 沙箱覆盖     | `agents.list[].sandbox`                                      | ❌（仅保留 extra）      | ⚠️（分散）                | ✅（中优先）                  | 与 workspace 关联校验          |
| 默认模型策略       | `agents.defaults.model.primary`                              | 只读摘要（keys）        | ✅（已有能力）            | ✅（可读 + 跳转）             | 列表不应承担深度编辑           |
| 默认模型池         | `agents.defaults.models`                                     | 只读摘要（keys）        | ✅（已有能力）            | ✅（可读 + 跳转）             | 与模型市场配置联动             |
| 默认心跳/并发/裁剪 | `agents.defaults.heartbeat/maxConcurrent/contextPruning/...` | ❌                      | ✅（已有）                | ✅（可读 + 跳转，后续再内嵌） | 先保证入口与作用域提示         |
| bindings 路由      | `bindings[*].agentId + match`                                | ✅（引用统计/删除阻断） | ✅（完整编辑）            | ✅（查看引用 + 跳转）         | 统一以 bindings 为权威         |
| 未知字段保留       | `agents.list[].extra`                                        | ✅（保留）              | ✅                        | ✅（保留并可预览）            | 禁止保存时丢字段               |

### 3.2 后端命令能力边界（已确认）

- 已有可复用命令：
  - `get_agents_list` / `save_agents_list`（全量读写 `agents.list`）
  - `get_bindings` / `save_bindings`（全量读写 `bindings`，数组/对象双形态）
  - `get_config` / `save_config` / `apply_config_change`（全量配置流）
- 结构化校验要点（`normalize_and_validate_config`）：
  - `agents.list` 必须为数组
  - `bindings` 必须为数组或对象
- 结论：
  - **无需新增后端命令即可落地 Agent 详情页第一版**
  - 但需严格控制前端写入粒度，避免误覆盖无关分区

### 3.3 写入策略（按页面职责拆分）

- 列表页（Agent Center）：
  - 仅写 `agents.list`
  - 禁止直接写 `bindings` 与 `agents.defaults.*`
- 详情页（Agent Workspace）：
  - Agent 私有区（`agents.list[i].*`）优先走 `save_agents_list`
  - 涉及 `bindings` 编辑时走 `save_bindings`
  - 涉及 defaults 的深度编辑，先走“可读 + 跳转”，后续再评估是否纳入详情页直写
- 原则：
  - 采用 **分区脏写入（dirty-by-section）**
  - 未改动分区不写入 payload
  - 防止“只改 1 项却出现 9 项新增”噪音

### 3.4 兼容性与一致性策略

- 保留未知字段（最小侵入）
- 缺失字段读取不崩溃
- 与现有 JSON5 / `${ENV}` / `$include` 能力兼容
- `bindings` 解析/回写规则与 Settings/Channels 保持一致（数组/扁平对象/分组对象）

### 3.5 关键遗漏清单（需纳入后续里程碑）

1. `agents.defaults` 深层配置与 Agent 模块尚未收敛（当前以可读摘要 + 跳转为主）
2. Settings / Channels 与 Agent 模块仍存在双入口写入边界，缺少更明确的冲突提示
3. 保存前依赖分析与分区级冲突提示尚未落地（P2 目标）
4. `get_bindings` 间歇性失败的后端根因仍待进一步诊断与补充观测

### 3.6 UI 稳定性

- 所有关键错误统一弹框
- 成功反馈统一弹框
- 保留无改动禁用“应用配置”

### 3.7 下一步实施顺序（P0/P1/P2）

- P0（先做，打通主链路）
  1. 完成 Agent 详情页路由与页面骨架（列表 -> 详情 -> 返回列表）
  2. 建立列表页与详情页共享草稿容器，保证跨页草稿一致性
  3. 固化“页面写入边界”：列表仅写 `agents.list`，详情按分区写 `agents.list` / `bindings`
- P1（核心配置能力，已完成）
  1. ✅ `agents.list[i].model` 可视化编辑（primary/fallback/参数）
  2. ✅ `agents.list[i].tools` 可视化编辑（allow/deny/elevated）
  3. ✅ `agents.list[i].sandbox` 可视化编辑与 workspace 关联校验
  4. ✅ 详情页 bindings 引用详情与“跳转 Channels”闭环
- P2（收敛入口与体验增强，已完成）
  1. ✅ 补充 `agents.defaults.*` 在详情页的"可读 + 跳转"统一入口（可点击快捷链接直达 Settings 对应分区，显示实际值摘要）
  2. ✅ 覆盖优先级提示（模型/工具/sandbox 分区显示"覆盖 defaults"指示器，明确优先级关系）
  3. ✅ 保存前分区级校验与差异预检（tools 冲突/sandbox 缺路径阻断保存，model 警告弹 confirm，变更摘要面板实时预检）

---

## 4. 分阶段交付建议

### 里程碑 M1（测试迁移）

- 状态：✅ 已完成
- 结果：导航调整 + 测试中心二级页已上线

### 里程碑 M2（智能体模块骨架）

- 状态：✅ 已完成
- 结果：`Default Agent` + `自定义 Agent 列表` + 路由/导航接入完成

### 里程碑 M3（智能体功能收口）

- 状态：✅ 已完成
- 结果：默认切换、复制/删除、删除引用检查、未保存拦截、内联编辑、变更摘要均已可用并已部署验证

### 里程碑 M4（增强迭代）

- 状态：✅ 已完成（P0/P1/P2 全部落地）
- 完成内容：
  - 字段级差异预览、bindings/get_config 降级容错
  - 批量删除草稿 Agent、批量复制草稿 Agent
  - 模型/工具/sandbox 分区编辑
  - 详情页 bindings 引用明细 + Channels 跳转
  - `agents.defaults.*` 统一入口（可点击快捷链接直达 Settings 对应分区，显示实际值摘要）
  - 覆盖优先级提示（模型/工具/sandbox 分区显示"覆盖 defaults"指示器）
  - 保存前分区级校验（tools 冲突/sandbox 缺路径阻断保存，model 警告弹 confirm）
  - 差异预览面板实时分区预检
- 最新验证：2026-02-25 已通过 `npm run build`

---

## 5. 测试清单（每次发布前）

1. 导航：底部不再有“测试”，新增“智能体/Agent”
2. 概览：诊断按钮可进入测试中心并可返回
3. 智能体列表：Default + 自定义 Agent 列表可正常显示，批量复制/删除可用
4. 详情入口：点击任一 Agent 可进入详情页并可返回列表
   4.1 详情路由关系：可查看当前 Agent 被哪些 channel/account 引用并可快速跳转渠道配置
5. 作用域：全局/默认/单 Agent 覆盖标识与优先级展示正确
6. 配置：字段编辑差异精确，字段级变更摘要正确（含 `model.*`、`tools.allow/deny/elevated`、`sandbox.mode/workspaceAccess/scope/workspaceRoot`）
7. 校验：`tools.allow/deny` 冲突可阻断，`sandbox` 在 mode 非 `off` 且 workspace/workspaceRoot 皆空时可阻断
8. 应用：无改动禁用、回滚可用、离开拦截生效
9. 删除安全：可阻断 bindings 引用与“删空全部 Agent”风险
10. 容错：`get_bindings` 与 `get_config` 瞬时失败时均应先重试，再决定是否降级告警
11. 移动端：按钮可点、视图可滚动、无遮挡

---

## 6. 暂不处理项（明确延后）

- Settings 页中的迁移提示/旧入口下线策略
- Agent 深层高级策略（后续按需求扩展）
