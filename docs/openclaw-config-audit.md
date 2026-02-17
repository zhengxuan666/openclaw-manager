# OpenClaw 配置能力审计与优化清单（结合官方规范 / 现有配置 / 代码实现）

> 生成时间：2026-02-13  
> 官方依据：`https://docs.openclaw.ai/gateway/configuration`  
> 本地配置样本：`/home/openclaw-manager/openclaw.json.bak.20260213_060456`  
> 代码实现依据：`src-tauri/src/models/config.rs`、`src-tauri/src/commands/config.rs`、`src-tauri/src/utils/platform.rs`

---

## 1. 当前项目“实际支持”的配置能力（以代码为准）

> 说明：以下为项目**真正读取/写入**的配置能力，来自 Tauri 后端命令与模型定义。

## 1.1 配置文件位置与格式

- **路径**：`~/.openclaw/openclaw.json`（见 `get_config_file_path()`）
- **读取方式**：优先 `json5::from_str`（兼容注释/尾逗号等 JSON5 语法），失败后兜底 `serde_json::from_str`（保持纯 JSON 100% 向下兼容）
- **写入方式**：`serde_json::to_string_pretty`（仍写回标准 JSON）

✅ 已完成：读取已兼容 JSON5，写回策略保持 JSON pretty，不引入行为突变。

## 1.2 顶层配置结构（OpenClawConfig）

代码结构支持的顶层字段：

- `agents`
- `models`
- `gateway`
- `channels`
- `plugins`
- `meta`

## 1.3 Agents（仅 defaults 定义）

当前代码模型中 **只声明了 defaults**：

- `agents.defaults.model.primary`
- `agents.defaults.models`（可用模型列表）
- `agents.defaults.compaction`
- `agents.defaults.contextPruning`
- `agents.defaults.heartbeat`
- `agents.defaults.maxConcurrent`
- `agents.defaults.subagents`

⚠️ 没有 `agents.list` 的结构定义与读写逻辑（但你的备份配置在使用）。

## 1.4 Models（Provider 与模型配置）

支持：

- `models.providers.<name>.baseUrl`
- `models.providers.<name>.apiKey`
- `models.providers.<name>.models[]`
  - `id`, `name`, `api`, `input`, `contextWindow`, `maxTokens`, `reasoning`, `cost`

代码提供：

- 添加/删除 Provider
- 设定主模型
- 维护可用模型列表
- 输出 AI 配置概览（用于前端）

## 1.5 Gateway

代码只显式支持：

- `gateway.mode`
- `gateway.auth.mode`
- `gateway.auth.token`

此外：

- 提供 `get_or_create_gateway_token` 自动生成 token 并写入配置。

## 1.6 Channels

支持渠道类型（固定列表）：

- telegram / discord / slack / feishu / whatsapp / imessage / wechat / dingtalk

实际读取逻辑：

- 从 `channels.<channelId>` 读取配置
- `enabled` 字段用于判定是否启用
- 测试字段（`userId/testChatId/testChannelId`）保存在 **env 文件**，不写入 JSON

## 1.7 Plugins

- `plugins.allow`（白名单）
- `plugins.entries`（插件启用状态）
- `plugins.installs`（存在字段，但代码未读写）

配置逻辑：保存渠道配置时自动写入 `plugins.allow` 和 `plugins.entries`。

## 1.8 Meta

- `meta.lastTouchedAt`
- `meta.lastTouchedVersion`

写入：保存 Provider 时自动更新 `lastTouchedAt`。

---

## 2. 当前“实际使用配置”的关键结构（来自备份文件）

### 已使用但**代码未结构化支持**的能力

- `agents.list[]`（多 agent）
- `bindings`（路由）
- `messages` / `commands` / `web`
- `tools`（web search / agentToAgent）
- `discovery` / `plugins.slots`
- `gateway.port` / `gateway.bind` / `gateway.trustedProxies`
- `env.shellEnv`（shell 环境变量加载）

### 已使用且与官方一致的能力

- `models.providers` + `agents.defaults.models`
- `gateway.auth.token`
- `channels.telegram` 基本结构
- `channels.<provider>.accounts`（多账号读取/保存/UI 已支持）

---

## 3. 官方规范与当前项目能力对照

| 领域             | 官方规范要求               | 当前代码支持                          | 当前配置使用         | 结论                        |
| ---------------- | -------------------------- | ------------------------------------- | -------------------- | --------------------------- |
| JSON5            | 官方要求 JSON5             | **已支持读取 JSON5（向下兼容 JSON）** | 使用 JSON/JSON5 均可 | **已完成（写回仍为 JSON）** |
| `agents.list`    | 官方支持多 agent           | **未结构化支持**                      | 已使用               | **功能缺口**                |
| `bindings`       | 官方支持                   | **未读取/写入**                       | 已使用               | **功能缺口**                |
| `channels`       | 官方支持多策略 / allowlist | 部分读取写入                          | 已使用               | **部分支持**                |
| `gateway.reload` | 官方支持                   | 未支持                                | 未使用               | **功能缺口**                |
| `$include`       | 官方支持                   | 未支持                                | 未使用               | **缺口（可选）**            |
| `env` & `${VAR}` | 官方支持                   | 支持 env 文件读取，但**未做变量替换** | 未使用               | **功能缺口**                |

---

## 4. 必须修复的问题（强制项）

## 4.1 JSON5 读取兼容（已完成）

- 已实现：读取时优先使用 `json5::from_str`，支持 JSON5 语法（注释/尾逗号等）
- 已实现：为保证纯 JSON 向下兼容，JSON5 失败后会兜底 `serde_json::from_str`
- 已确认：写回策略保持 `serde_json::to_string_pretty`，仍输出标准 JSON（不强制写回 JSON5）

说明：

- 解析失败时会返回明确的“JSON/JSON5 解析失败”语义错误，便于前端提示

## 4.2 已使用配置字段无结构化支持

- `agents.list` / `bindings` / `tools` / `messages` / `commands` / `web`
- 这些字段在配置里存在，但**代码不识别、不校验、不提供 UI 管理**

建议：

- 至少在 `OpenClawConfig` 中添加结构体字段或 `serde_json::Value`
- 提供读取与展示，避免“存在但系统不可见”

## 4.3 channels 多账号策略（已完成）

- 已实现 `channels.<provider>.accounts` 多账号读取与保存
- `get_channels_config` 已纳入 `accounts` 处理与回传
- 前端渠道页面已支持多账号展示、编辑与绑定联动

说明：

- 该项审计结论已过时，当前版本已对齐官方多账号行为（在现有支持范围内）

---

## 5. 应完善的配置能力（建议项）

## 5.1 支持 `$include` 分拆配置

- 官方推荐大配置拆分
- 当前工具链无 include 解析

价值：提升维护性、可审计性

## 5.2 支持 `${ENV}` 变量替换（已完成）

- 官方支持配置中 `${VAR}` 语法
- 当前实现已在**读取配置阶段**对字符串执行变量替换，不改写源文件占位符文本

当前边界与策略：

- 支持语法：`${VAR}`（完整值与内嵌字符串均支持）、单字符串内多个占位符
- 变量来源优先级：进程环境变量（`std::env`）优先，其次 `~/.openclaw/env`
- 仅处理字符串值，非字符串类型不参与替换
- 缺失变量或占位符语法不完整时，读取整体失败，并返回“配置路径 + 变量名/错误原因”
- 写回仍保持 `serde_json::to_string_pretty`，不会将替换后的敏感值反写入配置文件

## 5.3 增补 gateway 关键字段支持

- 官方：`port/bind/auth/reload/trustedProxies` 等
- 当前仅 `mode/auth.token`

建议：

- 模型结构扩展 + UI 展示 + 保存逻辑

## 5.4 支持 session / hooks / cron / heartbeat

- 官方作为核心能力提供
- 当前无结构化支持，也无法管理

建议：

- 若项目目标面向完整 gateway 管理，应补充

---

## 6. 基于你当前配置的具体整改建议

1. **配置解析升级为 JSON5**（必须）
2. **为 `agents.list` / `bindings` 提供结构支持**（你的配置已使用）
3. **多账号 channels 支持**（你的 telegram 配置已使用）
4. **环境变量替换支持**（你现在明文 key，升级后可安全存储）
5. **补齐 gateway.port/bind/trustedProxies 等字段**（与你配置一致）
6. **插件 allow 中空字符串清理**（潜在 schema 风险）

---

## 7. 结论

当前项目的配置管理能力**显著落后于官方规范**，且与你实际使用配置存在结构化鸿沟。优先建议：

**第一优先级**：

- JSON5 支持
- agents.list / bindings / channels.accounts 结构化支持

**第二优先级**：

- env 变量替换
- gateway 扩展字段

按此补齐后，项目可达到“官方规范一致 + 现有配置可视化可管理”的基线。
