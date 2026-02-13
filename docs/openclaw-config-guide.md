# OpenClaw 配置说明（基于官方文档 + 本地配置实例）

> 生成时间：2026-02-13  
> 官方依据：`https://docs.openclaw.ai/gateway/configuration`（官方 Configuration 页面）  
> 分析样本：`/home/openclaw-manager/openclaw.json.bak.20260213_060456`

---

## 1. 最新配置编写规范（官方）

## 1.1 配置文件位置与格式
- 默认配置文件：`~/.openclaw/openclaw.json`
- 格式：**JSON5**（支持注释、尾逗号等）
- 文件缺失时：系统使用安全默认值启动

## 1.2 严格校验规则（非常重要）
官方配置是严格 schema 校验：
- 未知字段（unknown keys）
- 类型错误（wrong types）
- 枚举/取值不合法（invalid values）

都会导致网关启动失败（gateway won’t boot）。

## 1.3 推荐组织方式
- 小规模：单文件 `openclaw.json`
- 中大型：使用 `$include` 拆分模块（如 `agents.json5`、`channels.json5`）
- 含敏感信息：优先使用环境变量占位 `${VAR}`，不要明文写 key/token

## 1.4 `$include` 规则
- 对象 include：可直接替换该对象
- 数组 include：按顺序深合并，后者覆盖前者
- include 后同级字段：会继续覆盖 include 内容
- 最大嵌套层级：10
- 相对路径：相对“当前包含它的文件”解析

---

## 2. 核心配置域与参数含义（官方语义）

## 2.1 `channels`（渠道接入与访问策略）
路径：`channels.<provider>`，例如 `channels.telegram`

关键参数：
- `enabled`: 是否启用该渠道
- `botToken`: 机器人 Token（渠道相关）
- `dmPolicy`: 私聊策略
  - `pairing`：默认；陌生用户先走配对码
  - `allowlist`：仅允许白名单
  - `open`：开放私聊（通常需配合 `allowFrom: ["*"]`）
  - `disabled`：关闭私聊
- `allowFrom`: 私聊白名单（配合策略使用）
- `groupPolicy` / `groupAllowFrom`: 群聊访问策略与白名单
- `accounts`: 多账号子配置（同一渠道多 bot/多身份）

## 2.2 `agents`（智能体定义与默认参数）
- `agents.defaults`: 所有 agent 的默认值
  - `workspace`: 默认工作目录
  - `model`: 默认主模型与回退模型
  - `models`: 可选模型目录与别名/参数
  - `sandbox`: 沙箱模式与作用域
  - `heartbeat`: 心跳消息周期与目标
- `agents.list[]`: 具体 agent 列表
  - `id`: 唯一标识
  - `default`: 默认 agent
  - `name`: 显示名称
  - `workspace`: 覆盖默认工作目录
  - `model`: 该 agent 专属模型策略
  - `tools`: 工具 allow/deny
  - `sandbox`: 该 agent 沙箱策略

## 2.3 `models`（模型与供应商）
- `models.providers.<provider>`: 提供方定义
  - `baseUrl`: 兼容 API 地址
  - `apiKey`: 密钥
  - `api`: 接口族（如 openai-completions）
  - `models[]`: 模型元数据列表
- 模型引用格式：`provider/model`（例如 `2api/gpt-5.2`）

## 2.4 `bindings`（渠道账号到 agent 路由）
- 将某个 `channel + accountId` 映射到指定 `agentId`
- 常用于同一渠道多 bot、多业务线隔离

## 2.5 `session`（会话隔离与重置）
官方示例包含：
- `dmScope`: 会话作用域
- `reset.mode`: 重置模式（如 daily）
- `atHour` / `idleMinutes`: 定时与空闲重置条件

## 2.6 `hooks` / `cron` / `heartbeat`
- `hooks`: Webhook 入站映射（path->agent）
- `cron`: 定时任务执行并发与保留策略
- `heartbeat`: 周期性主动 check-in

## 2.7 `gateway`（网关）
- `port`, `bind`, `mode`
- `auth.token`: 网关认证令牌
- `trustedProxies`: 反向代理可信来源
- `reload.mode`: 热重载策略（`hybrid|hot|restart|off`）

## 2.8 `env`（环境变量）
来源优先级（官方描述）：
1) 父进程环境变量
2) 当前目录 `.env`
3) `~/.openclaw/.env`

可在配置中使用 `${VAR}` 替换，缺失时会报错；`$${VAR}` 可转义为字面量。

---

## 3. 对备份配置的逐项解析

分析文件：`/home/openclaw-manager/openclaw.json.bak.20260213_060456`

## 3.1 `meta`
- `lastTouchedVersion`: `2026.2.9`
- `lastTouchedAt`: 最近修改时间

作用：版本追踪与运维审计；通常不影响运行逻辑。

## 3.2 `env.shellEnv.enabled: true`
含义：允许加载 shell 环境变量（方便复用服务器环境中的 key）。

注意：对生产环境是双刃剑，建议配合最小化环境变量暴露策略。

## 3.3 `models.providers.2api`
你定义了一个自建/第三方 OpenAI 兼容供应商：
- `baseUrl`: `https://2api.seanzx.top/v1`
- `api`: `openai-completions`
- `models[]`: `gemini-3-flash-preview` / `gemini-3-pro-preview` / `gpt-5.2` / `gpt-5.3-codex`

每个模型声明了：
- 输入模态 `input: ["text", "image"]`
- `contextWindow`、`maxTokens`
- `reasoning` 与 `compat`（部分模型）

这让 `/model` 与路由层能识别能力与限制。

## 3.4 `agents.defaults`
关键点：
- `workspace`: `/home/openclaw/workspace`
- `memorySearch.enabled: true`，并配置 remote embedding 检索
- `compaction.mode: "safeguard"`
- `elevatedDefault: "full"`
- `maxConcurrent: 4`
- `subagents.maxConcurrent: 8`

解读：
- 你启用了较积极的并发与子代理能力，吞吐不错，但也会提高资源占用和外部 API 请求并发。

## 3.5 `agents.list`
共 3 个 agent：`main`、`work`、`research`

### `main`
- 默认 agent
- 主模型 `2api/gemini-3-pro-preview`
- 回退：`gemini-3-flash-preview -> gpt-5.2`
- `sandbox.mode: off`

### `work`
- 偏编程模型：`2api/gpt-5.3-codex`
- 允许全部工具：`allow: ["*"]`
- 沙箱字段存在但 `mode: off`（即当前并未真正启用隔离）

### `research`
- 主模型：`2api/gpt-5.2`
- `sandbox.mode: all`（启用隔离）
- 工具全开但禁用了 `group:runtime`

## 3.6 `tools`
- `tools.web.search.enabled: true`，provider=brave
- `agentToAgent.enabled: true`

说明：支持联网检索与 agent 间协作。

## 3.7 `bindings`
你做了三条 Telegram 账户路由：
- `telegram/default -> main`
- `telegram/research -> research`
- `telegram/work -> work`

这是多 bot 多角色路由的标准用法。

## 3.8 `messages` / `commands` / `web`
- `messages.ackReactionScope: group-mentions`
- 全局与 telegram 下均关闭 native 命令：`native=false`, `nativeSkills=false`
- `web.enabled: true`

## 3.9 `channels.telegram`
顶层 telegram + `accounts` 子账号同时配置：
- 顶层有 `botToken`、`dmPolicy`、`groupPolicy`
- `accounts.default/research/work` 也分别有 `botToken` 与策略

说明：你采用了“渠道默认 + 账号覆写”的模式。

## 3.10 `discovery` / `gateway` / `plugins`
- `discovery.wideArea.enabled: true`
- `gateway.port: 18789`, `mode: local`, `bind: loopback`, `auth.token` 已设置
- `plugins.enabled: true`, `slots.memory: memory-core`

其中 `plugins.allow` 里有空字符串 `""`：
```json
"allow": ["", "telegram"]
```
此项可能是历史残留，建议清理（见后文建议）。

---

## 4. 与“最新官方规范”对照后的建议

## 4.1 安全加固（优先级最高）
你当前备份中存在多个明文敏感值：
- 多个 Telegram `botToken`
- 网关 `auth.token`
- 供应商 `apiKey`
- Brave `apiKey`

建议改为环境变量：
```json5
{
  models: {
    providers: {
      "2api": {
        apiKey: "${OPENCLAW_2API_KEY}"
      }
    }
  },
  channels: {
    telegram: {
      botToken: "${TG_BOT_TOKEN_MAIN}",
      accounts: {
        research: { botToken: "${TG_BOT_TOKEN_RESEARCH}" },
        work: { botToken: "${TG_BOT_TOKEN_WORK}" }
      }
    }
  },
  gateway: {
    auth: { token: "${OPENCLAW_GATEWAY_TOKEN}" }
  }
}
```

## 4.2 清理潜在 schema 风险
建议重点检查：
1. `plugins.allow` 中空字符串 `""`（应删除）
2. 所有自定义字段是否仍被当前版本支持（严格校验下未知键会启动失败）

## 4.3 沙箱策略统一
当前 `work` 配置了完整沙箱参数但 `mode: off`，容易造成“以为隔离、实际未隔离”的误解。建议：
- 要么改 `mode: all/non-main`
- 要么删除无效沙箱子项（保持配置清晰）

## 4.4 配置拆分维护
当 agent/account 增长后，推荐改用 `$include`：
- `openclaw.json` 放总入口
- `agents.json5`、`channels.telegram.json5`、`models.2api.json5` 分拆

收益：更易审计、变更风险更低。

---

## 5. 快速自检清单（上线前）
- [ ] 所有密钥改为 `${ENV_VAR}`
- [ ] 删除空值、无效值、历史残留字段
- [ ] `dmPolicy/groupPolicy` 与白名单策略一致
- [ ] `bindings` 中每个 `agentId` 都存在
- [ ] 模型引用 `provider/model` 能在 `models.providers` 中解析
- [ ] 如启用热重载，确认 `gateway.reload.mode` 符合运维策略

---

## 6. 结论
你的配置整体结构已经比较成熟（多 agent、多账号路由、模型回退、检索能力都具备）。当前最需要优先处理的是：
1) **敏感信息明文化**；
2) **潜在 schema 风险项（如 plugins.allow 空字符串）**；
3) **work agent 沙箱配置语义不一致**。

按本文建议收敛后，可显著提升稳定性与安全性。