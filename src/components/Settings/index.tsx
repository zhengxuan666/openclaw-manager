import { useEffect, useMemo, useState } from "react";
import { invokeCommand as invoke } from "../../lib/invoke";
import { useStagingSession } from "../../contexts/StagingSessionContext";
import {
  User,
  Shield,
  Save,
  Loader2,
  FolderOpen,
  FileCode,
  Trash2,
  AlertTriangle,
  X,
  Plus,
  Bot,
  Link2,
  Network,
  ArrowLeft,
  ChevronRight,
} from "lucide-react";

interface InstallResult {
  success: boolean;
  message: string;
  error?: string;
}
interface SettingsProps {
  onEnvironmentChange?: () => void;
  initialConfigCenterTab?: "agent" | "routing" | "runtime" | "advanced";
}

type BindingEntry = {
  agentId?: string;
  match?: {
    channel?: string;
    accountId?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

type BindingsPayload =
  | BindingEntry[]
  | Record<string, string | Record<string, string | { agentId?: string }>>;

interface ChannelConfig {
  id: string;
  channel_type: string;
  enabled: boolean;
  config: Record<string, unknown>;
  accounts?: Record<string, Record<string, unknown>>;
}

interface VisualAgent {
  id: string;
  name: string;
  workspace: string;
  default: boolean;
  extra: Record<string, unknown>;
}

interface VisualBinding {
  channel: string;
  accountId: string;
  agentId: string;
}

type GatewayBindPreset = "loopback" | "all" | "custom";
type GatewayReloadMode = "hybrid" | "hot" | "restart" | "off";
type CommandsNativeMode = "auto" | "true" | "false";

interface ManagedGatewayConfig {
  port: number;
  bind: string;
  trustedProxies: string[];
  reloadMode: GatewayReloadMode;
}

interface ManagedCommandsConfig {
  native?: CommandsNativeMode;
  text?: boolean;
  bash?: boolean;
  config?: boolean;
  debug?: boolean;
  restart?: boolean;
  useAccessGroups?: boolean;
  allowFromAll?: string[];
}

interface ManagedMessagesConfig {
  groupChatHistoryLimitEnabled: boolean;
  groupChatHistoryLimit: number;
}

interface ManagedWebReconnectConfig {
  initialMs: number;
  maxMs: number;
  factor: number;
  jitter: number;
  maxAttempts: number;
}

interface ManagedWebConfig {
  enabled: boolean;
  heartbeatSeconds: number;
  reconnect: ManagedWebReconnectConfig;
}

type SessionsVisibility = "self" | "tree" | "agent" | "all";

interface ManagedToolsConfig {
  allow: string[];
  deny: string[];
  sessionsVisibility: SessionsVisibility;
}

interface ManagedHeartbeatConfig {
  every: string;
  model: string;
  includeReasoning: boolean;
  target: string;
  prompt: string;
  ackMaxChars: number;
  suppressToolErrorWarnings: boolean;
}

interface ManagedCronConfig {
  enabled: boolean;
  maxConcurrentRuns: number;
  sessionRetention: string | false;
  webhook: string;
  webhookToken: string;
}

interface ManagedHooksConfig {
  enabled: boolean;
  token: string;
  path: string;
  maxBodyBytes: number;
  allowRequestSessionKey: boolean;
}

type ConfigCenterView = "general" | "center";
type ConfigCenterTab = "agent" | "routing" | "runtime" | "advanced";
type RuntimeSectionKey =
  | "commands"
  | "messages"
  | "web"
  | "tools"
  | "heartbeat"
  | "cron"
  | "hooks"
  | "sessions";
type RuntimeStatus = "connected" | "planned";

interface RuntimeFieldDoc {
  name: string;
  description: string;
  defaultHint?: string;
  recommendedHint?: string;
  riskHint?: string;
}

interface RuntimeSectionDoc {
  key: RuntimeSectionKey;
  title: string;
  status: RuntimeStatus;
  functionDescription: string;
  fields: RuntimeFieldDoc[];
  riskTip: string;
}

const CONFIG_CENTER_TABS: Array<{ key: ConfigCenterTab; label: string }> = [
  { key: "agent", label: "Agent" },
  { key: "routing", label: "Routing" },
  { key: "runtime", label: "Runtime" },
  { key: "advanced", label: "高级(JSON)" },
];

const RUNTIME_SECTION_DOCS: RuntimeSectionDoc[] = [
  {
    key: "commands",
    title: "Commands",
    status: "connected",
    functionDescription:
      "控制命令能力开关、执行方式与允许来源，决定 Runtime 可调用命令的边界。",
    fields: [
      {
        name: "native",
        description: "命令解析策略。",
        defaultHint: "auto",
        recommendedHint: "推荐保持 auto，兼顾兼容性与稳定性",
      },
      {
        name: "text",
        description: "控制纯文本命令触发能力。",
        defaultHint: "false（未设置时保持现状）",
        recommendedHint: "仅在需要时开启",
      },
      {
        name: "bash",
        description: "控制 Bash 命令执行能力。",
        defaultHint: "false（未设置时保持现状）",
        recommendedHint: "建议默认关闭",
        riskHint: "可直接执行系统命令，风险最高",
      },
      {
        name: "config",
        description: "控制配置管理类命令能力。",
        defaultHint: "false（未设置时保持现状）",
        recommendedHint: "仅在需要远程配置操作时开启",
      },
      {
        name: "debug",
        description: "控制调试诊断类命令能力。",
        defaultHint: "false（未设置时保持现状）",
        recommendedHint: "建议在排障期间临时开启",
      },
      {
        name: "restart",
        description: "控制服务重启类命令能力。",
        defaultHint: "false（未设置时保持现状）",
        recommendedHint: "仅授权给管理员来源",
        riskHint: "误触发可能导致服务中断",
      },
      {
        name: "useAccessGroups",
        description: "启用访问分组策略，配合主体授权细化控制。",
        defaultHint: "false（未设置时保持现状）",
        recommendedHint: "多租户/多群组场景建议开启",
      },
      {
        name: "allowFrom[*]",
        description: "允许触发命令的主体列表。",
        defaultHint: "空列表=不放行额外主体",
        recommendedHint: "按渠道或账号精确授权",
        riskHint: "通配或过宽授权会扩大误触发面",
      },
    ],
    riskTip:
      "开启 bash 或宽泛 allowFrom 可能带来高风险操作能力，务必限制来源并结合审计。",
  },
  {
    key: "messages",
    title: "Messages",
    status: "connected",
    functionDescription:
      "控制群聊历史截断策略，影响上下文长度、成本与响应稳定性。",
    fields: [
      {
        name: "groupChat.historyLimitEnabled",
        description: "是否启用历史条数显式配置。",
        defaultHint: "false（关闭时不写字段）",
        recommendedHint: "仅在需固定上下文窗口时开启",
      },
      {
        name: "groupChat.historyLimit",
        description: "保留的历史消息条数（>= 0 的整数）。",
        defaultHint: "0",
        recommendedHint: "常见建议 20~100",
      },
    ],
    riskTip:
      "historyLimit 过大将增加上下文成本与延迟，过小可能导致上下文不足。",
  },
  {
    key: "web",
    title: "Web",
    status: "connected",
    functionDescription:
      "控制 Runtime Web 链路开关、心跳与重连参数，影响前端连接稳定性。",
    fields: [
      {
        name: "web.enabled",
        description: "是否启用 Runtime Web 通道。",
        defaultHint: "false",
        recommendedHint: "生产环境按需开启",
      },
      {
        name: "web.heartbeatSeconds",
        description: "心跳间隔秒数（>= 5）。",
        defaultHint: "30",
        recommendedHint: "推荐 10~60",
      },
      {
        name: "web.reconnect.initialMs / maxMs / factor / jitter / maxAttempts",
        description: "基础重连参数，控制断线重试节奏与上限。",
        defaultHint: "1000 / 30000 / 2 / 0.2 / 10",
        recommendedHint: "先小后大，避免瞬时重连风暴",
        riskHint: "参数不当可能导致频繁重连或恢复过慢",
      },
    ],
    riskTip: "若心跳过低或重连参数配置异常，可能放大网络抖动影响。",
  },
  {
    key: "tools",
    title: "Tools",
    status: "connected",
    functionDescription:
      "控制全局工具访问白/黑名单，统一治理 Runtime 可调用工具范围。",
    fields: [
      {
        name: "tools.allow",
        description: "允许调用的工具名列表（string[]）。",
        defaultHint: "[]",
        recommendedHint: "按最小权限原则配置",
      },
      {
        name: "tools.deny",
        description: "禁止调用的工具名列表（string[]）。",
        defaultHint: "[]",
        recommendedHint: "高风险工具建议显式拉黑",
        riskHint: "与 allow 重复会产生策略冲突并阻止应用",
      },
    ],
    riskTip: "allow/deny 冲突会导致配置不可应用，请保持清晰单一策略。",
  },
  {
    key: "heartbeat",
    title: "Heartbeat",
    status: "connected",
    functionDescription:
      "管理 agents.defaults.heartbeat，控制心跳频率、目标与心跳消息内容。",
    fields: [
      {
        name: "agents.defaults.heartbeat.every",
        description: "心跳周期（duration）。",
        defaultHint: "5m",
      },
      {
        name: "agents.defaults.heartbeat.model",
        description: "执行心跳时使用的模型标识。",
        defaultHint: "空字符串（保持现有策略）",
      },
      {
        name: "agents.defaults.heartbeat.includeReasoning",
        description: "是否在心跳中包含 reasoning。",
        defaultHint: "false",
      },
      {
        name: "agents.defaults.heartbeat.target",
        description:
          "心跳目标（last / none / whatsapp / telegram / discord ...）。",
        defaultHint: "last",
      },
      {
        name: "agents.defaults.heartbeat.prompt",
        description: "心跳提示词（多行文本）。",
        defaultHint: "空",
      },
      {
        name: "agents.defaults.heartbeat.ackMaxChars",
        description: "心跳确认消息最大字符数。",
        defaultHint: "120",
      },
      {
        name: "agents.defaults.heartbeat.suppressToolErrorWarnings",
        description: "是否抑制工具错误告警。",
        defaultHint: "false",
      },
    ],
    riskTip: "心跳频率过高或目标配置不当，可能导致额外消耗与告警噪音。",
  },
  {
    key: "cron",
    title: "Cron",
    status: "connected",
    functionDescription:
      "管理 cron 调度基础策略，包括并发、会话保留与回调通知。",
    fields: [
      {
        name: "cron.enabled",
        description: "是否启用 cron。",
        defaultHint: "false",
      },
      {
        name: "cron.maxConcurrentRuns",
        description: "最大并发运行数（>= 1）。",
        defaultHint: "1",
      },
      {
        name: "cron.sessionRetention",
        description: "会话保留时长（duration）或 false。",
        defaultHint: "false",
      },
      {
        name: "cron.webhook",
        description: "任务回调 webhook URL，可为空。",
        defaultHint: "空",
      },
      {
        name: "cron.webhookToken",
        description: "webhook 鉴权 token，可为空。",
        defaultHint: "空",
      },
    ],
    riskTip: "并发或 webhook 配置错误可能导致调度堆积与回调失败。",
  },
  {
    key: "sessions",
    title: "Sessions Visibility",
    status: "connected",
    functionDescription:
      "管理 tools.sessions.visibility，可视化控制会话可见范围。",
    fields: [
      {
        name: "tools.sessions.visibility",
        description: "会话可见性：self / tree / agent / all。",
        defaultHint: "self",
      },
    ],
    riskTip: "可见性范围越大，跨会话信息暴露面越大。",
  },
  {
    key: "hooks",
    title: "Hooks",
    status: "connected",
    functionDescription: "管理 hooks 基础入口参数，用于接收外部回调请求。",
    fields: [
      {
        name: "hooks.enabled",
        description: "是否启用 hooks 服务。",
        defaultHint: "false",
      },
      {
        name: "hooks.token",
        description: "hooks 鉴权 token（密码）。",
        defaultHint: "空",
      },
      {
        name: "hooks.path",
        description: "hooks 路径，默认 /hooks。",
        defaultHint: "/hooks",
      },
      {
        name: "hooks.maxBodyBytes",
        description: "请求体大小限制（字节）。",
        defaultHint: "1048576",
      },
      {
        name: "hooks.allowRequestSessionKey",
        description: "是否允许请求中覆盖 session key。",
        defaultHint: "false",
      },
    ],
    riskTip: "hooks 对外暴露能力较强，务必配合 token 与最小权限策略。",
  },
];

const RUNTIME_SECTION_DOC_MAP: Record<RuntimeSectionKey, RuntimeSectionDoc> =
  RUNTIME_SECTION_DOCS.reduce((acc, section) => {
    acc[section.key] = section;
    return acc;
  }, {} as Record<RuntimeSectionKey, RuntimeSectionDoc>);

type CommandToggleField = Exclude<
  keyof ManagedCommandsConfig,
  "native" | "allowFromAll"
>;

const COMMAND_TOGGLE_FIELDS: Array<{
  field: CommandToggleField;
  label: string;
  helper: string;
  risk?: string;
}> = [
  {
    field: "text",
    label: "text",
    helper: "控制纯文本命令触发能力。默认建议按需开启。",
  },
  {
    field: "bash",
    label: "bash",
    helper: "控制 Bash 命令执行能力。",
    risk: "可直接执行系统命令，建议仅在受控环境开启。",
  },
  {
    field: "config",
    label: "config",
    helper: "控制配置管理类命令能力。",
  },
  {
    field: "debug",
    label: "debug",
    helper: "控制调试诊断类命令能力。",
  },
  {
    field: "restart",
    label: "restart",
    helper: "控制服务重启类命令能力。",
    risk: "误触发可能导致会话中断。",
  },
  {
    field: "useAccessGroups",
    label: "useAccessGroups",
    helper: "启用访问分组策略，配合主体授权细化控制。",
  },
];

const RUNTIME_STATUS_META: Record<
  RuntimeStatus,
  { label: string; className: string }
> = {
  connected: {
    label: "已接入",
    className: "text-emerald-300 bg-emerald-500/10 border-emerald-500/30",
  },
  planned: {
    label: "规划中 / Phase 2B",
    className: "text-amber-300 bg-amber-500/10 border-amber-500/30",
  },
};

const BINDING_KEY_SEPARATOR = "::";
const WEB_HEARTBEAT_MIN_SECONDS = 5;
const WEB_RECONNECT_INITIAL_MS_MIN = 100;
const WEB_RECONNECT_MAX_MS_MIN = 500;
const WEB_RECONNECT_FACTOR_MIN = 1;
const WEB_RECONNECT_JITTER_MIN = 0;
const WEB_RECONNECT_JITTER_MAX = 1;
const WEB_RECONNECT_MAX_ATTEMPTS_MIN = 0;
const HEARTBEAT_ACK_MAX_CHARS_MIN = 0;
const CRON_MAX_CONCURRENT_RUNS_MIN = 1;
const HOOKS_MAX_BODY_BYTES_MIN = 1;
const TOOL_LIST_SPLIT_PATTERN = /[\r\n,，;；]+/;

const DEFAULT_GATEWAY_CONFIG: ManagedGatewayConfig = {
  port: 18789,
  bind: "127.0.0.1",
  trustedProxies: ["127.0.0.1/32"],
  reloadMode: "hybrid",
};
const DEFAULT_MESSAGES_CONFIG: ManagedMessagesConfig = {
  groupChatHistoryLimitEnabled: false,
  groupChatHistoryLimit: 0,
};
const DEFAULT_WEB_CONFIG: ManagedWebConfig = {
  enabled: false,
  heartbeatSeconds: 30,
  reconnect: {
    initialMs: 1000,
    maxMs: 30000,
    factor: 2,
    jitter: 0.2,
    maxAttempts: 10,
  },
};
const DEFAULT_TOOLS_CONFIG: ManagedToolsConfig = {
  allow: [],
  deny: [],
  sessionsVisibility: "self",
};
const DEFAULT_HEARTBEAT_CONFIG: ManagedHeartbeatConfig = {
  every: "5m",
  model: "",
  includeReasoning: false,
  target: "last",
  prompt: "",
  ackMaxChars: 120,
  suppressToolErrorWarnings: false,
};
const DEFAULT_CRON_CONFIG: ManagedCronConfig = {
  enabled: false,
  maxConcurrentRuns: 1,
  sessionRetention: false,
  webhook: "",
  webhookToken: "",
};
const DEFAULT_HOOKS_CONFIG: ManagedHooksConfig = {
  enabled: false,
  token: "",
  path: "/hooks",
  maxBodyBytes: 1024 * 1024,
  allowRequestSessionKey: false,
};

const GATEWAY_RELOAD_MODE_OPTIONS: Array<{
  value: GatewayReloadMode;
  label: string;
  description: string;
}> = [
  {
    value: "hybrid",
    label: "hybrid（推荐）",
    description: "优先热重载，必要时自动回退重启，兼顾稳定与效率。",
  },
  {
    value: "hot",
    label: "hot",
    description: "仅尝试热重载，速度最快，但对变更类型有要求。",
  },
  {
    value: "restart",
    label: "restart",
    description: "每次应用后完整重启，最稳妥但会有短暂中断。",
  },
  {
    value: "off",
    label: "off",
    description: "关闭自动重载策略，变更后需手动控制重载。",
  },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeAccounts(
  accounts: unknown
): Record<string, Record<string, unknown>> {
  if (!isRecord(accounts)) {
    return {};
  }

  const normalized: Record<string, Record<string, unknown>> = {};
  Object.entries(accounts).forEach(([accountId, value]) => {
    if (isRecord(value)) {
      normalized[accountId] = value;
    }
  });
  return normalized;
}

function buildBindingKey(channel: string, accountId: string): string {
  return `${channel}${BINDING_KEY_SEPARATOR}${accountId}`;
}

function splitBindingKey(
  key: string
): { channel: string; accountId: string } | null {
  const idx = key.indexOf(BINDING_KEY_SEPARATOR);
  if (idx <= 0 || idx >= key.length - BINDING_KEY_SEPARATOR.length) {
    return null;
  }
  return {
    channel: key.slice(0, idx),
    accountId: key.slice(idx + BINDING_KEY_SEPARATOR.length),
  };
}

function parseCompositeBindingKey(
  key: string
): { channel: string; accountId: string } | null {
  for (const sep of ["/", ":", "."]) {
    const idx = key.indexOf(sep);
    if (idx > 0 && idx < key.length - 1) {
      return {
        channel: key.slice(0, idx),
        accountId: key.slice(idx + 1),
      };
    }
  }
  return null;
}

function parseBindings(rawBindings: unknown): Record<string, string> {
  const map: Record<string, string> = {};

  const put = (channel: unknown, accountId: unknown, agentId: unknown) => {
    if (
      typeof channel === "string" &&
      channel &&
      typeof accountId === "string" &&
      accountId &&
      typeof agentId === "string" &&
      agentId
    ) {
      map[buildBindingKey(channel, accountId)] = agentId;
    }
  };

  if (Array.isArray(rawBindings)) {
    rawBindings.forEach((entry) => {
      if (!isRecord(entry)) return;
      const match = isRecord(entry.match) ? entry.match : undefined;
      put(match?.channel, match?.accountId, entry.agentId);
    });
    return map;
  }

  if (!isRecord(rawBindings)) {
    return map;
  }

  Object.entries(rawBindings).forEach(([key, value]) => {
    if (typeof value === "string") {
      const parsedKey = parseCompositeBindingKey(key);
      if (parsedKey) {
        put(parsedKey.channel, parsedKey.accountId, value);
      }
      return;
    }

    if (isRecord(value) && isRecord(value.match)) {
      put(value.match.channel, value.match.accountId, value.agentId);
      return;
    }

    if (isRecord(value)) {
      Object.entries(value).forEach(([accountId, nested]) => {
        if (typeof nested === "string") {
          put(key, accountId, nested);
          return;
        }
        if (isRecord(nested)) {
          put(key, accountId, nested.agentId);
        }
      });
    }
  });

  return map;
}

function buildBindingsPayload(
  originalBindings: unknown,
  allBindingsMap: Record<string, string>
): BindingsPayload {
  const grouped: Record<string, Record<string, string>> = {};
  Object.entries(allBindingsMap).forEach(([key, agentId]) => {
    const parsed = splitBindingKey(key);
    if (!parsed) return;
    if (!grouped[parsed.channel]) {
      grouped[parsed.channel] = {};
    }
    grouped[parsed.channel][parsed.accountId] = agentId;
  });

  if (
    Array.isArray(originalBindings) ||
    !isRecord(originalBindings) ||
    Object.keys(originalBindings).length === 0
  ) {
    return Object.entries(grouped).flatMap(([channel, accounts]) =>
      Object.entries(accounts).map(([accountId, agentId]) => ({
        agentId,
        match: {
          channel,
          accountId,
        },
      }))
    );
  }

  const values = Object.values(originalBindings);
  const isFlatObject = values.every((v) => typeof v === "string");

  if (isFlatObject) {
    const flat: Record<string, string> = {};
    Object.entries(grouped).forEach(([channel, accounts]) => {
      Object.entries(accounts).forEach(([accountId, agentId]) => {
        flat[`${channel}/${accountId}`] = agentId;
      });
    });
    return flat;
  }

  return grouped;
}

function parseAgentsList(rawAgents: unknown): VisualAgent[] {
  if (!Array.isArray(rawAgents)) {
    return [];
  }

  return rawAgents.map((item) => {
    if (typeof item === "string") {
      return {
        id: item,
        name: "",
        workspace: "",
        default: false,
        extra: {},
      };
    }

    if (isRecord(item)) {
      const extra: Record<string, unknown> = {};
      Object.entries(item).forEach(([key, value]) => {
        if (
          key !== "id" &&
          key !== "name" &&
          key !== "workspace" &&
          key !== "default"
        ) {
          extra[key] = value;
        }
      });

      // 规范化 model 字段：将遗留的 fallbacks（复数）迁移到 fallback（单数）
      // 与 AgentCenter/index.tsx 保持一致，防止 diff 出现字段名漂移
      if (isRecord(extra.model)) {
        const model = { ...extra.model };
        if (model.fallbacks !== undefined && model.fallback === undefined) {
          model.fallback = model.fallbacks;
          delete model.fallbacks;
          extra.model = model;
        }
      }

      return {
        id: typeof item.id === "string" ? item.id : "",
        name: typeof item.name === "string" ? item.name : "",
        workspace: typeof item.workspace === "string" ? item.workspace : "",
        default: typeof item.default === "boolean" ? item.default : false,
        extra,
      };
    }

    return {
      id: "",
      name: "",
      workspace: "",
      default: false,
      extra: {},
    };
  });
}

function buildAgentsPayload(agents: VisualAgent[]): Record<string, unknown>[] {
  return agents.map((agent) => {
    const payload: Record<string, unknown> = {
      ...agent.extra,
      id: agent.id,
    };

    if (agent.name) {
      payload.name = agent.name;
    } else {
      delete payload.name;
    }

    if (agent.workspace) {
      payload.workspace = agent.workspace;
    } else {
      delete payload.workspace;
    }

    if (agent.default) {
      payload.default = true;
    } else {
      delete payload.default;
    }

    return payload;
  });
}

function bindingsMapToRules(
  bindingsMap: Record<string, string>
): VisualBinding[] {
  return Object.entries(bindingsMap)
    .map(([key, agentId]) => {
      const parsed = splitBindingKey(key);
      if (!parsed) {
        return null;
      }
      return {
        channel: parsed.channel,
        accountId: parsed.accountId,
        agentId,
      };
    })
    .filter((item): item is VisualBinding => Boolean(item))
    .sort(
      (a, b) =>
        a.channel.localeCompare(b.channel) ||
        a.accountId.localeCompare(b.accountId)
    );
}

function bindingsRulesToMap(rules: VisualBinding[]): Record<string, string> {
  const map: Record<string, string> = {};
  rules.forEach((rule) => {
    map[buildBindingKey(rule.channel, rule.accountId)] = rule.agentId;
  });
  return map;
}

function getChannelAccountsMap(
  channels: ChannelConfig[]
): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  channels.forEach((channel) => {
    map[channel.id] = Object.keys(normalizeAccounts(channel.accounts));
  });
  return map;
}

function normalizeVisualAgents(agents: VisualAgent[]): VisualAgent[] {
  return agents.map((agent) => ({
    ...agent,
    id: agent.id.trim(),
    name: agent.name.trim(),
    workspace: agent.workspace.trim(),
  }));
}

function normalizeVisualBindings(bindings: VisualBinding[]): VisualBinding[] {
  return bindings.map((binding) => ({
    channel: binding.channel.trim(),
    accountId: binding.accountId.trim(),
    agentId: binding.agentId.trim(),
  }));
}

function toStableComparable(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => toStableComparable(item));
  }

  if (isRecord(value)) {
    return Object.keys(value)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = toStableComparable(value[key]);
        return acc;
      }, {});
  }

  return value;
}

function cloneConfigRecord(
  config: Record<string, unknown>
): Record<string, unknown> {
  return JSON.parse(JSON.stringify(config)) as Record<string, unknown>;
}

function isComparableValueEqual(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true;
  }
  if (left === undefined || right === undefined) {
    return false;
  }
  return (
    JSON.stringify(toStableComparable(left)) ===
    JSON.stringify(toStableComparable(right))
  );
}

function setConfigPathValue(
  target: Record<string, unknown>,
  path: string[],
  value: unknown
): void {
  if (path.length === 0) {
    return;
  }

  let cursor: Record<string, unknown> = target;
  for (const segment of path.slice(0, -1)) {
    const next = cursor[segment];
    if (!isRecord(next)) {
      cursor[segment] = {};
    }
    cursor = cursor[segment] as Record<string, unknown>;
  }

  cursor[path[path.length - 1]] = value;
}

function getConfigPathValue(
  source: Record<string, unknown>,
  path: string[]
): unknown {
  if (path.length === 0) {
    return source;
  }

  let cursor: unknown = source;
  for (const segment of path) {
    if (!isRecord(cursor)) {
      return undefined;
    }
    cursor = cursor[segment];
  }
  return cursor;
}

function deleteConfigPathValue(
  target: Record<string, unknown>,
  path: string[]
): void {
  if (path.length === 0) {
    return;
  }

  let cursor: unknown = target;
  for (const segment of path.slice(0, -1)) {
    if (!isRecord(cursor) || !isRecord(cursor[segment])) {
      return;
    }
    cursor = cursor[segment];
  }

  if (!isRecord(cursor)) {
    return;
  }

  delete cursor[path[path.length - 1]];
}

function parseGatewayReloadMode(value: unknown): GatewayReloadMode {
  if (
    value === "hybrid" ||
    value === "hot" ||
    value === "restart" ||
    value === "off"
  ) {
    return value;
  }
  return DEFAULT_GATEWAY_CONFIG.reloadMode;
}

function normalizeGatewayPort(value: unknown): number {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isInteger(parsed)) {
      return parsed;
    }
  }
  return DEFAULT_GATEWAY_CONFIG.port;
}

function normalizeGatewayTrustedProxies(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [...DEFAULT_GATEWAY_CONFIG.trustedProxies];
  }

  const deduped = Array.from(
    new Set(
      value
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter((item) => Boolean(item))
    )
  );

  return deduped;
}

function isValidIpv4Address(value: string): boolean {
  const parts = value.split(".");
  if (parts.length !== 4) {
    return false;
  }

  return parts.every((part) => {
    if (!/^\d+$/.test(part)) {
      return false;
    }
    const num = Number(part);
    return num >= 0 && num <= 255;
  });
}

function isValidIpv6Address(value: string): boolean {
  if (!value.includes(":")) {
    return false;
  }
  if (!/^[0-9A-Fa-f:]+$/.test(value)) {
    return false;
  }

  const doubleColonParts = value.split("::");
  if (doubleColonParts.length > 2) {
    return false;
  }

  const left = doubleColonParts[0]
    ? doubleColonParts[0].split(":").filter((part) => part.length > 0)
    : [];
  const right =
    doubleColonParts.length === 2 && doubleColonParts[1]
      ? doubleColonParts[1].split(":").filter((part) => part.length > 0)
      : [];

  if (
    [...left, ...right].some(
      (part) =>
        part.length === 0 || part.length > 4 || !/^[0-9A-Fa-f]+$/.test(part)
    )
  ) {
    return false;
  }

  if (doubleColonParts.length === 1) {
    return left.length === 8;
  }

  return left.length + right.length < 8;
}

function isValidIpOrCidr(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }

  const parts = trimmed.split("/");
  if (parts.length > 2) {
    return false;
  }

  const ipPart = parts[0];
  const cidrPart = parts[1];
  const isIpv4 = isValidIpv4Address(ipPart);
  const isIpv6 = !isIpv4 && isValidIpv6Address(ipPart);

  if (!isIpv4 && !isIpv6) {
    return false;
  }

  if (cidrPart === undefined) {
    return true;
  }

  if (!/^\d+$/.test(cidrPart)) {
    return false;
  }

  const prefix = Number(cidrPart);
  return isIpv4 ? prefix >= 0 && prefix <= 32 : prefix >= 0 && prefix <= 128;
}

function parseTrustedProxyInput(value: string): string[] {
  return value
    .split(/[\s,，;；]+/)
    .map((item) => item.trim())
    .filter((item) => Boolean(item));
}

function serializeTrustedProxyInput(values: string[]): string {
  return values.join("\n");
}

function detectGatewayBindPreset(bind: string): GatewayBindPreset {
  const normalized = bind.trim();
  if (normalized === "127.0.0.1" || normalized === "loopback") {
    return "loopback";
  }
  if (normalized === "0.0.0.0" || normalized === "::") {
    return "all";
  }
  return "custom";
}

function parseGatewayConfig(config: unknown): ManagedGatewayConfig {
  if (!isRecord(config)) {
    return { ...DEFAULT_GATEWAY_CONFIG };
  }

  const gateway = isRecord(config.gateway) ? config.gateway : {};
  const reload = isRecord(gateway.reload) ? gateway.reload : {};

  return {
    port: normalizeGatewayPort(gateway.port),
    bind:
      typeof gateway.bind === "string" && gateway.bind.trim()
        ? gateway.bind.trim()
        : DEFAULT_GATEWAY_CONFIG.bind,
    trustedProxies: normalizeGatewayTrustedProxies(gateway.trustedProxies),
    reloadMode: parseGatewayReloadMode(reload.mode),
  };
}

function parseCommandsNativeMode(
  value: unknown
): CommandsNativeMode | undefined {
  if (value === "auto" || value === "true" || value === "false") {
    return value;
  }
  if (value === true) {
    return "true";
  }
  if (value === false) {
    return "false";
  }
  return undefined;
}

function parseOptionalBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  return undefined;
}

function normalizeAllowFromList(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    return Array.from(
      new Set(
        value
          .map((item) => (typeof item === "string" ? item.trim() : ""))
          .filter((item) => Boolean(item))
      )
    );
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  return undefined;
}

function parseToolNameList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return Array.from(
      new Set(
        value
          .map((item) => (typeof item === "string" ? item.trim() : ""))
          .filter((item) => Boolean(item))
      )
    );
  }

  if (typeof value === "string") {
    return Array.from(
      new Set(
        value
          .split(TOOL_LIST_SPLIT_PATTERN)
          .map((item) => item.trim())
          .filter((item) => Boolean(item))
      )
    );
  }

  return [];
}

function parseToolListInput(value: string): string[] {
  return parseToolNameList(value);
}

function parseOptionalString(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  return undefined;
}

function parseDurationOrFalse(value: unknown): string | false | undefined {
  if (value === false) {
    return false;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  return undefined;
}

function normalizeDurationOrFalse(value: unknown): string | false {
  if (value === false) {
    return false;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : false;
  }
  return false;
}

function parseIntegerFromUnknown(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.trunc(parsed);
    }
  }

  return undefined;
}

function parseNumberFromUnknown(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

function parseCommandsConfig(config: unknown): ManagedCommandsConfig {
  if (!isRecord(config) || !isRecord(config.commands)) {
    return {};
  }

  const commands = config.commands;
  const allowFrom = isRecord(commands.allowFrom)
    ? commands.allowFrom
    : undefined;

  return {
    native: parseCommandsNativeMode(commands.native),
    text: parseOptionalBoolean(commands.text),
    bash: parseOptionalBoolean(commands.bash),
    config: parseOptionalBoolean(commands.config),
    debug: parseOptionalBoolean(commands.debug),
    restart: parseOptionalBoolean(commands.restart),
    useAccessGroups: parseOptionalBoolean(commands.useAccessGroups),
    allowFromAll: allowFrom
      ? normalizeAllowFromList(allowFrom["*"])
      : undefined,
  };
}

function normalizeManagedCommands(
  commands: ManagedCommandsConfig
): ManagedCommandsConfig {
  return {
    native: commands.native,
    text: commands.text,
    bash: commands.bash,
    config: commands.config,
    debug: commands.debug,
    restart: commands.restart,
    useAccessGroups: commands.useAccessGroups,
    allowFromAll: normalizeAllowFromList(commands.allowFromAll),
  };
}

function parseMessagesConfig(config: unknown): ManagedMessagesConfig {
  if (!isRecord(config) || !isRecord(config.messages)) {
    return { ...DEFAULT_MESSAGES_CONFIG };
  }

  const messages = config.messages;
  const groupChat = isRecord(messages.groupChat)
    ? messages.groupChat
    : undefined;
  const rawHistoryLimit = groupChat?.historyLimit;
  const parsedLimit =
    typeof rawHistoryLimit === "number" &&
    Number.isInteger(rawHistoryLimit) &&
    rawHistoryLimit >= 0
      ? rawHistoryLimit
      : DEFAULT_MESSAGES_CONFIG.groupChatHistoryLimit;

  return {
    groupChatHistoryLimitEnabled:
      typeof rawHistoryLimit === "number" &&
      Number.isInteger(rawHistoryLimit) &&
      rawHistoryLimit >= 0,
    groupChatHistoryLimit: parsedLimit,
  };
}

function normalizeManagedMessages(
  messages: ManagedMessagesConfig
): ManagedMessagesConfig {
  const normalizedLimit = Number.isFinite(messages.groupChatHistoryLimit)
    ? Math.max(0, Math.trunc(messages.groupChatHistoryLimit))
    : messages.groupChatHistoryLimit;

  return {
    groupChatHistoryLimitEnabled: messages.groupChatHistoryLimitEnabled,
    groupChatHistoryLimit: normalizedLimit,
  };
}

function parseWebConfig(config: unknown): ManagedWebConfig {
  if (!isRecord(config) || !isRecord(config.web)) {
    return {
      ...DEFAULT_WEB_CONFIG,
      reconnect: { ...DEFAULT_WEB_CONFIG.reconnect },
    };
  }

  const web = config.web;
  const reconnect = isRecord(web.reconnect) ? web.reconnect : {};

  const heartbeatSeconds = parseIntegerFromUnknown(web.heartbeatSeconds);
  const initialMs = parseIntegerFromUnknown(reconnect.initialMs);
  const maxMs = parseIntegerFromUnknown(reconnect.maxMs);
  const factor = parseNumberFromUnknown(reconnect.factor);
  const jitter = parseNumberFromUnknown(reconnect.jitter);
  const maxAttempts = parseIntegerFromUnknown(reconnect.maxAttempts);

  return {
    enabled:
      typeof web.enabled === "boolean"
        ? web.enabled
        : DEFAULT_WEB_CONFIG.enabled,
    heartbeatSeconds:
      heartbeatSeconds !== undefined &&
      heartbeatSeconds >= WEB_HEARTBEAT_MIN_SECONDS
        ? heartbeatSeconds
        : DEFAULT_WEB_CONFIG.heartbeatSeconds,
    reconnect: {
      initialMs:
        initialMs !== undefined && initialMs >= WEB_RECONNECT_INITIAL_MS_MIN
          ? initialMs
          : DEFAULT_WEB_CONFIG.reconnect.initialMs,
      maxMs:
        maxMs !== undefined && maxMs >= WEB_RECONNECT_MAX_MS_MIN
          ? maxMs
          : DEFAULT_WEB_CONFIG.reconnect.maxMs,
      factor:
        factor !== undefined && factor >= WEB_RECONNECT_FACTOR_MIN
          ? factor
          : DEFAULT_WEB_CONFIG.reconnect.factor,
      jitter:
        jitter !== undefined &&
        jitter >= WEB_RECONNECT_JITTER_MIN &&
        jitter <= WEB_RECONNECT_JITTER_MAX
          ? jitter
          : DEFAULT_WEB_CONFIG.reconnect.jitter,
      maxAttempts:
        maxAttempts !== undefined &&
        maxAttempts >= WEB_RECONNECT_MAX_ATTEMPTS_MIN
          ? maxAttempts
          : DEFAULT_WEB_CONFIG.reconnect.maxAttempts,
    },
  };
}

function normalizeManagedWeb(web: ManagedWebConfig): ManagedWebConfig {
  const reconnect = {
    initialMs: Number.isFinite(web.reconnect.initialMs)
      ? Math.max(
          WEB_RECONNECT_INITIAL_MS_MIN,
          Math.trunc(web.reconnect.initialMs)
        )
      : DEFAULT_WEB_CONFIG.reconnect.initialMs,
    maxMs: Number.isFinite(web.reconnect.maxMs)
      ? Math.max(WEB_RECONNECT_MAX_MS_MIN, Math.trunc(web.reconnect.maxMs))
      : DEFAULT_WEB_CONFIG.reconnect.maxMs,
    factor: Number.isFinite(web.reconnect.factor)
      ? Math.max(WEB_RECONNECT_FACTOR_MIN, web.reconnect.factor)
      : DEFAULT_WEB_CONFIG.reconnect.factor,
    jitter: Number.isFinite(web.reconnect.jitter)
      ? Math.min(
          WEB_RECONNECT_JITTER_MAX,
          Math.max(WEB_RECONNECT_JITTER_MIN, web.reconnect.jitter)
        )
      : DEFAULT_WEB_CONFIG.reconnect.jitter,
    maxAttempts: Number.isFinite(web.reconnect.maxAttempts)
      ? Math.max(
          WEB_RECONNECT_MAX_ATTEMPTS_MIN,
          Math.trunc(web.reconnect.maxAttempts)
        )
      : DEFAULT_WEB_CONFIG.reconnect.maxAttempts,
  };

  if (reconnect.maxMs < reconnect.initialMs) {
    reconnect.maxMs = reconnect.initialMs;
  }

  return {
    enabled: Boolean(web.enabled),
    heartbeatSeconds: Number.isFinite(web.heartbeatSeconds)
      ? Math.max(WEB_HEARTBEAT_MIN_SECONDS, Math.trunc(web.heartbeatSeconds))
      : DEFAULT_WEB_CONFIG.heartbeatSeconds,
    reconnect,
  };
}

function parseToolsConfig(config: unknown): ManagedToolsConfig {
  if (!isRecord(config) || !isRecord(config.tools)) {
    return {
      ...DEFAULT_TOOLS_CONFIG,
      allow: [...DEFAULT_TOOLS_CONFIG.allow],
      deny: [...DEFAULT_TOOLS_CONFIG.deny],
    };
  }

  const tools = config.tools;
  const sessions = isRecord(tools.sessions) ? tools.sessions : {};

  return {
    allow: parseToolNameList(tools.allow),
    deny: parseToolNameList(tools.deny),
    sessionsVisibility:
      sessions.visibility === "self" ||
      sessions.visibility === "tree" ||
      sessions.visibility === "agent" ||
      sessions.visibility === "all"
        ? sessions.visibility
        : DEFAULT_TOOLS_CONFIG.sessionsVisibility,
  };
}

function normalizeManagedTools(tools: ManagedToolsConfig): ManagedToolsConfig {
  const sessionsVisibility =
    tools.sessionsVisibility === "self" ||
    tools.sessionsVisibility === "tree" ||
    tools.sessionsVisibility === "agent" ||
    tools.sessionsVisibility === "all"
      ? tools.sessionsVisibility
      : DEFAULT_TOOLS_CONFIG.sessionsVisibility;

  return {
    allow: parseToolNameList(tools.allow),
    deny: parseToolNameList(tools.deny),
    sessionsVisibility,
  };
}

function parseHeartbeatConfig(config: unknown): ManagedHeartbeatConfig {
  const heartbeat = isRecord(config)
    ? isRecord(config.agents)
      ? isRecord(config.agents.defaults)
        ? isRecord(config.agents.defaults.heartbeat)
          ? config.agents.defaults.heartbeat
          : undefined
        : undefined
      : undefined
    : undefined;

  if (!heartbeat) {
    return { ...DEFAULT_HEARTBEAT_CONFIG };
  }

  const ackMaxChars = parseIntegerFromUnknown(heartbeat.ackMaxChars);

  return {
    every:
      parseOptionalString(heartbeat.every) ?? DEFAULT_HEARTBEAT_CONFIG.every,
    model:
      parseOptionalString(heartbeat.model) ?? DEFAULT_HEARTBEAT_CONFIG.model,
    includeReasoning:
      typeof heartbeat.includeReasoning === "boolean"
        ? heartbeat.includeReasoning
        : DEFAULT_HEARTBEAT_CONFIG.includeReasoning,
    target:
      parseOptionalString(heartbeat.target) ?? DEFAULT_HEARTBEAT_CONFIG.target,
    prompt:
      parseOptionalString(heartbeat.prompt) ?? DEFAULT_HEARTBEAT_CONFIG.prompt,
    ackMaxChars:
      ackMaxChars !== undefined && ackMaxChars >= HEARTBEAT_ACK_MAX_CHARS_MIN
        ? ackMaxChars
        : DEFAULT_HEARTBEAT_CONFIG.ackMaxChars,
    suppressToolErrorWarnings:
      typeof heartbeat.suppressToolErrorWarnings === "boolean"
        ? heartbeat.suppressToolErrorWarnings
        : DEFAULT_HEARTBEAT_CONFIG.suppressToolErrorWarnings,
  };
}

function normalizeManagedHeartbeat(
  heartbeat: ManagedHeartbeatConfig
): ManagedHeartbeatConfig {
  const ackMaxChars = Number.isFinite(heartbeat.ackMaxChars)
    ? Math.max(HEARTBEAT_ACK_MAX_CHARS_MIN, Math.trunc(heartbeat.ackMaxChars))
    : DEFAULT_HEARTBEAT_CONFIG.ackMaxChars;

  return {
    every: heartbeat.every.trim(),
    model: heartbeat.model.trim(),
    includeReasoning: Boolean(heartbeat.includeReasoning),
    target: heartbeat.target.trim(),
    prompt: heartbeat.prompt,
    ackMaxChars,
    suppressToolErrorWarnings: Boolean(heartbeat.suppressToolErrorWarnings),
  };
}

function parseCronConfig(config: unknown): ManagedCronConfig {
  if (!isRecord(config) || !isRecord(config.cron)) {
    return { ...DEFAULT_CRON_CONFIG };
  }

  const cron = config.cron;
  const maxConcurrentRuns = parseIntegerFromUnknown(cron.maxConcurrentRuns);
  const sessionRetention = parseDurationOrFalse(cron.sessionRetention);

  return {
    enabled:
      typeof cron.enabled === "boolean"
        ? cron.enabled
        : DEFAULT_CRON_CONFIG.enabled,
    maxConcurrentRuns:
      maxConcurrentRuns !== undefined &&
      maxConcurrentRuns >= CRON_MAX_CONCURRENT_RUNS_MIN
        ? maxConcurrentRuns
        : DEFAULT_CRON_CONFIG.maxConcurrentRuns,
    sessionRetention:
      sessionRetention !== undefined
        ? sessionRetention
        : DEFAULT_CRON_CONFIG.sessionRetention,
    webhook: parseOptionalString(cron.webhook) ?? DEFAULT_CRON_CONFIG.webhook,
    webhookToken:
      parseOptionalString(cron.webhookToken) ??
      DEFAULT_CRON_CONFIG.webhookToken,
  };
}

function normalizeManagedCron(cron: ManagedCronConfig): ManagedCronConfig {
  const maxConcurrentRuns = Number.isFinite(cron.maxConcurrentRuns)
    ? Math.max(CRON_MAX_CONCURRENT_RUNS_MIN, Math.trunc(cron.maxConcurrentRuns))
    : DEFAULT_CRON_CONFIG.maxConcurrentRuns;

  return {
    enabled: Boolean(cron.enabled),
    maxConcurrentRuns,
    sessionRetention: normalizeDurationOrFalse(cron.sessionRetention),
    webhook: cron.webhook.trim(),
    webhookToken: cron.webhookToken,
  };
}

function parseHooksConfig(config: unknown): ManagedHooksConfig {
  if (!isRecord(config) || !isRecord(config.hooks)) {
    return { ...DEFAULT_HOOKS_CONFIG };
  }

  const hooks = config.hooks;
  const maxBodyBytes = parseIntegerFromUnknown(hooks.maxBodyBytes);
  const path = parseOptionalString(hooks.path);

  return {
    enabled:
      typeof hooks.enabled === "boolean"
        ? hooks.enabled
        : DEFAULT_HOOKS_CONFIG.enabled,
    token: parseOptionalString(hooks.token) ?? DEFAULT_HOOKS_CONFIG.token,
    path: path && path.trim() ? path.trim() : DEFAULT_HOOKS_CONFIG.path,
    maxBodyBytes:
      maxBodyBytes !== undefined && maxBodyBytes >= HOOKS_MAX_BODY_BYTES_MIN
        ? maxBodyBytes
        : DEFAULT_HOOKS_CONFIG.maxBodyBytes,
    allowRequestSessionKey:
      typeof hooks.allowRequestSessionKey === "boolean"
        ? hooks.allowRequestSessionKey
        : DEFAULT_HOOKS_CONFIG.allowRequestSessionKey,
  };
}

function normalizeManagedHooks(hooks: ManagedHooksConfig): ManagedHooksConfig {
  const maxBodyBytes = Number.isFinite(hooks.maxBodyBytes)
    ? Math.max(HOOKS_MAX_BODY_BYTES_MIN, Math.trunc(hooks.maxBodyBytes))
    : DEFAULT_HOOKS_CONFIG.maxBodyBytes;

  return {
    enabled: Boolean(hooks.enabled),
    token: hooks.token,
    path: hooks.path.trim() || DEFAULT_HOOKS_CONFIG.path,
    maxBodyBytes,
    allowRequestSessionKey: Boolean(hooks.allowRequestSessionKey),
  };
}

function buildWebPayload(web: ManagedWebConfig): Record<string, unknown> {
  const normalized = normalizeManagedWeb(web);
  return {
    enabled: normalized.enabled,
    heartbeatSeconds: normalized.heartbeatSeconds,
    reconnect: {
      initialMs: normalized.reconnect.initialMs,
      maxMs: normalized.reconnect.maxMs,
      factor: normalized.reconnect.factor,
      jitter: normalized.reconnect.jitter,
      maxAttempts: normalized.reconnect.maxAttempts,
    },
  };
}

function buildToolsPayload(tools: ManagedToolsConfig): Record<string, unknown> {
  const normalized = normalizeManagedTools(tools);
  return {
    allow: normalized.allow,
    deny: normalized.deny,
    sessions: {
      visibility: normalized.sessionsVisibility,
    },
  };
}

function buildHeartbeatPayload(
  heartbeat: ManagedHeartbeatConfig
): Record<string, unknown> {
  const normalized = normalizeManagedHeartbeat(heartbeat);
  return {
    every: normalized.every,
    model: normalized.model,
    includeReasoning: normalized.includeReasoning,
    target: normalized.target,
    prompt: normalized.prompt,
    ackMaxChars: normalized.ackMaxChars,
    suppressToolErrorWarnings: normalized.suppressToolErrorWarnings,
  };
}

function buildCronPayload(cron: ManagedCronConfig): Record<string, unknown> {
  const normalized = normalizeManagedCron(cron);
  return {
    enabled: normalized.enabled,
    maxConcurrentRuns: normalized.maxConcurrentRuns,
    sessionRetention: normalized.sessionRetention,
    webhook: normalized.webhook,
    webhookToken: normalized.webhookToken,
  };
}

function buildHooksPayload(hooks: ManagedHooksConfig): Record<string, unknown> {
  const normalized = normalizeManagedHooks(hooks);
  return {
    enabled: normalized.enabled,
    token: normalized.token,
    path: normalized.path,
    maxBodyBytes: normalized.maxBodyBytes,
    allowRequestSessionKey: normalized.allowRequestSessionKey,
  };
}

function normalizeManagedGateway(
  gateway: ManagedGatewayConfig
): ManagedGatewayConfig {
  return {
    port: Math.trunc(gateway.port),
    bind: gateway.bind.trim(),
    trustedProxies: Array.from(
      new Set(
        gateway.trustedProxies
          .map((item) => item.trim())
          .filter((item) => Boolean(item))
      )
    ),
    reloadMode: gateway.reloadMode,
  };
}

function buildCommandsPayload(
  commands: ManagedCommandsConfig
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};

  if (commands.native !== undefined) {
    payload.native = commands.native;
  }
  if (commands.text !== undefined) {
    payload.text = commands.text;
  }
  if (commands.bash !== undefined) {
    payload.bash = commands.bash;
  }
  if (commands.config !== undefined) {
    payload.config = commands.config;
  }
  if (commands.debug !== undefined) {
    payload.debug = commands.debug;
  }
  if (commands.restart !== undefined) {
    payload.restart = commands.restart;
  }
  if (commands.useAccessGroups !== undefined) {
    payload.useAccessGroups = commands.useAccessGroups;
  }

  const allowFromAll = normalizeAllowFromList(commands.allowFromAll);
  if (allowFromAll !== undefined) {
    payload.allowFrom = {
      "*": allowFromAll,
    };
  }

  return payload;
}

function buildMessagesPayload(
  messages: ManagedMessagesConfig
): Record<string, unknown> {
  if (!messages.groupChatHistoryLimitEnabled) {
    return {};
  }

  return {
    groupChat: {
      historyLimit: Math.max(0, Math.trunc(messages.groupChatHistoryLimit)),
    },
  };
}

function normalizeVisualConfig(
  agents: VisualAgent[],
  bindings: VisualBinding[],
  gateway: ManagedGatewayConfig,
  commands: ManagedCommandsConfig,
  messages: ManagedMessagesConfig,
  web: ManagedWebConfig,
  tools: ManagedToolsConfig,
  heartbeat: ManagedHeartbeatConfig,
  cron: ManagedCronConfig,
  hooks: ManagedHooksConfig
): {
  agents: VisualAgent[];
  bindings: VisualBinding[];
  gateway: ManagedGatewayConfig;
  commands: ManagedCommandsConfig;
  messages: ManagedMessagesConfig;
  web: ManagedWebConfig;
  tools: ManagedToolsConfig;
  heartbeat: ManagedHeartbeatConfig;
  cron: ManagedCronConfig;
  hooks: ManagedHooksConfig;
} {
  return {
    agents: normalizeVisualAgents(agents),
    bindings: normalizeVisualBindings(bindings),
    gateway: normalizeManagedGateway(gateway),
    commands: normalizeManagedCommands(commands),
    messages: normalizeManagedMessages(messages),
    web: normalizeManagedWeb(web),
    tools: normalizeManagedTools(tools),
    heartbeat: normalizeManagedHeartbeat(heartbeat),
    cron: normalizeManagedCron(cron),
    hooks: normalizeManagedHooks(hooks),
  };
}

export function buildManagedConfigSignature(
  agents: VisualAgent[],
  bindings: VisualBinding[],
  gateway: ManagedGatewayConfig,
  commands: ManagedCommandsConfig,
  messages: ManagedMessagesConfig,
  web: ManagedWebConfig,
  tools: ManagedToolsConfig,
  heartbeat: ManagedHeartbeatConfig,
  cron: ManagedCronConfig,
  hooks: ManagedHooksConfig
): string {
  const normalized = normalizeVisualConfig(
    agents,
    bindings,
    gateway,
    commands,
    messages,
    web,
    tools,
    heartbeat,
    cron,
    hooks
  );
  const agentsPayload = buildAgentsPayload(normalized.agents);
  const bindingsMap = bindingsRulesToMap(normalized.bindings);

  return JSON.stringify(
    toStableComparable({
      agents: agentsPayload,
      bindings: bindingsMap,
      gateway: {
        port: normalized.gateway.port,
        bind: normalized.gateway.bind,
        trustedProxies: normalized.gateway.trustedProxies,
        reload: {
          mode: normalized.gateway.reloadMode,
        },
      },
      commands: buildCommandsPayload(normalized.commands),
      messages: buildMessagesPayload(normalized.messages),
      web: buildWebPayload(normalized.web),
      tools: buildToolsPayload(normalized.tools),
      heartbeat: buildHeartbeatPayload(normalized.heartbeat),
      cron: buildCronPayload(normalized.cron),
      hooks: buildHooksPayload(normalized.hooks),
    })
  );
}

function validateVisualConfig(
  agents: VisualAgent[],
  bindings: VisualBinding[],
  gateway: ManagedGatewayConfig,
  commands: ManagedCommandsConfig,
  messages: ManagedMessagesConfig,
  web: ManagedWebConfig,
  tools: ManagedToolsConfig,
  heartbeat: ManagedHeartbeatConfig,
  cron: ManagedCronConfig,
  hooks: ManagedHooksConfig
): string | null {
  const idSet = new Set<string>();
  for (let i = 0; i < agents.length; i += 1) {
    const id = agents[i].id;
    if (!id) {
      return `Agent 第 ${i + 1} 行：id 必填`;
    }
    if (idSet.has(id)) {
      return `Agent id 重复：${id}`;
    }
    idSet.add(id);
  }

  const bindingKeySet = new Set<string>();
  for (let i = 0; i < bindings.length; i += 1) {
    const binding = bindings[i];
    if (!binding.channel || !binding.accountId || !binding.agentId) {
      return `Binding 第 ${i + 1} 行：channel / accountId / agentId 均为必填`;
    }

    const pairKey = `${binding.channel}${BINDING_KEY_SEPARATOR}${binding.accountId}`;
    if (bindingKeySet.has(pairKey)) {
      return `Binding 路由重复：${binding.channel} / ${binding.accountId}`;
    }
    bindingKeySet.add(pairKey);

    if (!idSet.has(binding.agentId)) {
      return `Binding 第 ${i + 1} 行：agentId ${
        binding.agentId
      } 不存在于 agents.list`;
    }
  }

  if (
    !Number.isInteger(gateway.port) ||
    gateway.port < 1 ||
    gateway.port > 65535
  ) {
    return "Gateway 端口无效：port 必须为 1~65535 的整数";
  }

  if (!gateway.bind.trim()) {
    return "Gateway 绑定地址无效：bind 不能为空";
  }

  if (
    gateway.reloadMode !== "hybrid" &&
    gateway.reloadMode !== "hot" &&
    gateway.reloadMode !== "restart" &&
    gateway.reloadMode !== "off"
  ) {
    return "Gateway 重载模式无效：仅支持 hybrid / hot / restart / off";
  }

  const trustedProxies = normalizeGatewayTrustedProxies(gateway.trustedProxies);
  for (let i = 0; i < trustedProxies.length; i += 1) {
    const proxy = trustedProxies[i];
    if (!isValidIpOrCidr(proxy)) {
      return `Gateway trustedProxies 第 ${
        i + 1
      } 项格式无效：${proxy}（仅支持 IP/CIDR）`;
    }
  }

  if (
    commands.native !== undefined &&
    commands.native !== "auto" &&
    commands.native !== "true" &&
    commands.native !== "false"
  ) {
    return "Commands native 无效：仅支持 auto / true / false";
  }

  const allowFromAll = normalizeAllowFromList(commands.allowFromAll);
  if (allowFromAll && allowFromAll.some((subject) => !subject.trim())) {
    return "Commands allowFrom[*] 包含空主体，请逐行填写有效主体";
  }

  if (
    messages.groupChatHistoryLimitEnabled &&
    (!Number.isInteger(messages.groupChatHistoryLimit) ||
      messages.groupChatHistoryLimit < 0)
  ) {
    return "Messages groupChat.historyLimit 无效：必须为 >= 0 的整数";
  }

  if (
    !Number.isInteger(web.heartbeatSeconds) ||
    web.heartbeatSeconds < WEB_HEARTBEAT_MIN_SECONDS
  ) {
    return `Web heartbeatSeconds 无效：必须为 >= ${WEB_HEARTBEAT_MIN_SECONDS} 的整数`;
  }

  if (
    !Number.isInteger(web.reconnect.initialMs) ||
    web.reconnect.initialMs < WEB_RECONNECT_INITIAL_MS_MIN
  ) {
    return `Web reconnect.initialMs 无效：必须为 >= ${WEB_RECONNECT_INITIAL_MS_MIN} 的整数`;
  }

  if (
    !Number.isInteger(web.reconnect.maxMs) ||
    web.reconnect.maxMs < WEB_RECONNECT_MAX_MS_MIN
  ) {
    return `Web reconnect.maxMs 无效：必须为 >= ${WEB_RECONNECT_MAX_MS_MIN} 的整数`;
  }

  if (web.reconnect.maxMs < web.reconnect.initialMs) {
    return "Web reconnect.maxMs 无效：必须 >= reconnect.initialMs";
  }

  if (
    !Number.isFinite(web.reconnect.factor) ||
    web.reconnect.factor < WEB_RECONNECT_FACTOR_MIN
  ) {
    return `Web reconnect.factor 无效：必须为 >= ${WEB_RECONNECT_FACTOR_MIN} 的数字`;
  }

  if (
    !Number.isFinite(web.reconnect.jitter) ||
    web.reconnect.jitter < WEB_RECONNECT_JITTER_MIN ||
    web.reconnect.jitter > WEB_RECONNECT_JITTER_MAX
  ) {
    return `Web reconnect.jitter 无效：必须在 ${WEB_RECONNECT_JITTER_MIN}~${WEB_RECONNECT_JITTER_MAX} 之间`;
  }

  if (
    !Number.isInteger(web.reconnect.maxAttempts) ||
    web.reconnect.maxAttempts < WEB_RECONNECT_MAX_ATTEMPTS_MIN
  ) {
    return `Web reconnect.maxAttempts 无效：必须为 >= ${WEB_RECONNECT_MAX_ATTEMPTS_MIN} 的整数`;
  }

  if (!heartbeat.every.trim()) {
    return "Heartbeat every 无效：不能为空";
  }

  if (!heartbeat.target.trim()) {
    return "Heartbeat target 无效：不能为空";
  }

  if (
    !Number.isInteger(heartbeat.ackMaxChars) ||
    heartbeat.ackMaxChars < HEARTBEAT_ACK_MAX_CHARS_MIN
  ) {
    return `Heartbeat ackMaxChars 无效：必须为 >= ${HEARTBEAT_ACK_MAX_CHARS_MIN} 的整数`;
  }

  if (!Number.isInteger(cron.maxConcurrentRuns) || cron.maxConcurrentRuns < 1) {
    return "Cron maxConcurrentRuns 无效：必须为 >= 1 的整数";
  }

  if (
    cron.sessionRetention !== false &&
    (typeof cron.sessionRetention !== "string" || !cron.sessionRetention.trim())
  ) {
    return "Cron sessionRetention 无效：必须为 duration 字符串或 false";
  }

  if (!Number.isInteger(hooks.maxBodyBytes) || hooks.maxBodyBytes < 1) {
    return "Hooks maxBodyBytes 无效：必须为 >= 1 的整数";
  }

  if (!hooks.path.trim()) {
    return "Hooks path 无效：不能为空";
  }

  const normalizedTools = normalizeManagedTools(tools);
  const toolConflict = normalizedTools.allow.find((name) =>
    normalizedTools.deny.includes(name)
  );
  if (toolConflict) {
    return `Tools allow/deny 冲突：${toolConflict} 同时存在于 allow 与 deny`;
  }

  return null;
}

interface PathScopedGlobalConfigPayloadArgs {
  fullConfig: Record<string, unknown>;
  agentsList: Record<string, unknown>[];
  bindingsPayload: BindingsPayload;
  managedGateway: ManagedGatewayConfig;
  managedCommands: ManagedCommandsConfig;
  managedMessages: ManagedMessagesConfig;
  managedWeb: ManagedWebConfig;
  managedTools: ManagedToolsConfig;
  managedHeartbeat: ManagedHeartbeatConfig;
  managedCron: ManagedCronConfig;
  managedHooks: ManagedHooksConfig;
}

export function buildPathScopedGlobalConfigPayload(
  args: PathScopedGlobalConfigPayloadArgs
): Record<string, unknown> {
  const {
    fullConfig,
    agentsList,
    bindingsPayload,
    managedGateway,
    managedCommands,
    managedMessages,
    managedWeb,
    managedTools,
    managedHeartbeat,
    managedCron,
    managedHooks,
  } = args;

  const merged = cloneConfigRecord(fullConfig);

  const existingAgentsListSource = isRecord(fullConfig.agents)
    ? (fullConfig.agents as Record<string, unknown>).list
    : [];
  const existingAgentsList = buildAgentsPayload(
    normalizeVisualAgents(parseAgentsList(existingAgentsListSource))
  );
  if (!isComparableValueEqual(existingAgentsList, agentsList)) {
    setConfigPathValue(merged, ["agents", "list"], agentsList);
  }

  const existingBindingsMap = parseBindings(
    isRecord(fullConfig) ? fullConfig.bindings : []
  );
  const nextBindingsMap = parseBindings(bindingsPayload);
  if (!isComparableValueEqual(existingBindingsMap, nextBindingsMap)) {
    setConfigPathValue(merged, ["bindings"], bindingsPayload);
  }

  const existingGateway = normalizeManagedGateway(
    parseGatewayConfig(fullConfig)
  );
  if (existingGateway.port !== managedGateway.port) {
    setConfigPathValue(merged, ["gateway", "port"], managedGateway.port);
  }
  if (existingGateway.bind !== managedGateway.bind) {
    setConfigPathValue(merged, ["gateway", "bind"], managedGateway.bind);
  }
  if (
    !isComparableValueEqual(
      existingGateway.trustedProxies,
      managedGateway.trustedProxies
    )
  ) {
    setConfigPathValue(
      merged,
      ["gateway", "trustedProxies"],
      [...managedGateway.trustedProxies]
    );
  }
  if (existingGateway.reloadMode !== managedGateway.reloadMode) {
    setConfigPathValue(
      merged,
      ["gateway", "reload", "mode"],
      managedGateway.reloadMode
    );
  }

  const existingCommands = normalizeManagedCommands(
    parseCommandsConfig(fullConfig)
  );
  if (
    managedCommands.native !== undefined &&
    managedCommands.native !== existingCommands.native
  ) {
    setConfigPathValue(merged, ["commands", "native"], managedCommands.native);
  }
  if (
    managedCommands.text !== undefined &&
    managedCommands.text !== existingCommands.text
  ) {
    setConfigPathValue(merged, ["commands", "text"], managedCommands.text);
  }
  if (
    managedCommands.bash !== undefined &&
    managedCommands.bash !== existingCommands.bash
  ) {
    setConfigPathValue(merged, ["commands", "bash"], managedCommands.bash);
  }
  if (
    managedCommands.config !== undefined &&
    managedCommands.config !== existingCommands.config
  ) {
    setConfigPathValue(merged, ["commands", "config"], managedCommands.config);
  }
  if (
    managedCommands.debug !== undefined &&
    managedCommands.debug !== existingCommands.debug
  ) {
    setConfigPathValue(merged, ["commands", "debug"], managedCommands.debug);
  }
  if (
    managedCommands.restart !== undefined &&
    managedCommands.restart !== existingCommands.restart
  ) {
    setConfigPathValue(
      merged,
      ["commands", "restart"],
      managedCommands.restart
    );
  }
  if (
    managedCommands.useAccessGroups !== undefined &&
    managedCommands.useAccessGroups !== existingCommands.useAccessGroups
  ) {
    setConfigPathValue(
      merged,
      ["commands", "useAccessGroups"],
      managedCommands.useAccessGroups
    );
  }
  if (
    managedCommands.allowFromAll !== undefined &&
    !isComparableValueEqual(
      existingCommands.allowFromAll,
      managedCommands.allowFromAll
    )
  ) {
    setConfigPathValue(
      merged,
      ["commands", "allowFrom", "*"],
      managedCommands.allowFromAll
    );
  }

  const existingMessages = normalizeManagedMessages(
    parseMessagesConfig(fullConfig)
  );
  if (managedMessages.groupChatHistoryLimitEnabled) {
    if (
      !existingMessages.groupChatHistoryLimitEnabled ||
      existingMessages.groupChatHistoryLimit !==
        managedMessages.groupChatHistoryLimit
    ) {
      setConfigPathValue(
        merged,
        ["messages", "groupChat", "historyLimit"],
        Math.max(0, Math.trunc(managedMessages.groupChatHistoryLimit))
      );
    }
  } else if (existingMessages.groupChatHistoryLimitEnabled) {
    deleteConfigPathValue(merged, ["messages", "groupChat", "historyLimit"]);
    const groupChat = getConfigPathValue(merged, ["messages", "groupChat"]);
    if (isRecord(groupChat) && Object.keys(groupChat).length === 0) {
      deleteConfigPathValue(merged, ["messages", "groupChat"]);
    }
  }

  const existingWeb = normalizeManagedWeb(parseWebConfig(fullConfig));
  if (existingWeb.enabled !== managedWeb.enabled) {
    setConfigPathValue(merged, ["web", "enabled"], managedWeb.enabled);
  }
  if (existingWeb.heartbeatSeconds !== managedWeb.heartbeatSeconds) {
    setConfigPathValue(
      merged,
      ["web", "heartbeatSeconds"],
      managedWeb.heartbeatSeconds
    );
  }
  if (existingWeb.reconnect.initialMs !== managedWeb.reconnect.initialMs) {
    setConfigPathValue(
      merged,
      ["web", "reconnect", "initialMs"],
      managedWeb.reconnect.initialMs
    );
  }
  if (existingWeb.reconnect.maxMs !== managedWeb.reconnect.maxMs) {
    setConfigPathValue(
      merged,
      ["web", "reconnect", "maxMs"],
      managedWeb.reconnect.maxMs
    );
  }
  if (existingWeb.reconnect.factor !== managedWeb.reconnect.factor) {
    setConfigPathValue(
      merged,
      ["web", "reconnect", "factor"],
      managedWeb.reconnect.factor
    );
  }
  if (existingWeb.reconnect.jitter !== managedWeb.reconnect.jitter) {
    setConfigPathValue(
      merged,
      ["web", "reconnect", "jitter"],
      managedWeb.reconnect.jitter
    );
  }
  if (existingWeb.reconnect.maxAttempts !== managedWeb.reconnect.maxAttempts) {
    setConfigPathValue(
      merged,
      ["web", "reconnect", "maxAttempts"],
      managedWeb.reconnect.maxAttempts
    );
  }

  const existingTools = normalizeManagedTools(parseToolsConfig(fullConfig));
  if (!isComparableValueEqual(existingTools.allow, managedTools.allow)) {
    setConfigPathValue(merged, ["tools", "allow"], [...managedTools.allow]);
  }
  if (!isComparableValueEqual(existingTools.deny, managedTools.deny)) {
    setConfigPathValue(merged, ["tools", "deny"], [...managedTools.deny]);
  }
  if (existingTools.sessionsVisibility !== managedTools.sessionsVisibility) {
    setConfigPathValue(
      merged,
      ["tools", "sessions", "visibility"],
      managedTools.sessionsVisibility
    );
  }

  const existingHeartbeat = normalizeManagedHeartbeat(
    parseHeartbeatConfig(fullConfig)
  );
  if (existingHeartbeat.every !== managedHeartbeat.every) {
    setConfigPathValue(
      merged,
      ["agents", "defaults", "heartbeat", "every"],
      managedHeartbeat.every
    );
  }
  if (existingHeartbeat.model !== managedHeartbeat.model) {
    setConfigPathValue(
      merged,
      ["agents", "defaults", "heartbeat", "model"],
      managedHeartbeat.model
    );
  }
  if (
    existingHeartbeat.includeReasoning !== managedHeartbeat.includeReasoning
  ) {
    setConfigPathValue(
      merged,
      ["agents", "defaults", "heartbeat", "includeReasoning"],
      managedHeartbeat.includeReasoning
    );
  }
  if (existingHeartbeat.target !== managedHeartbeat.target) {
    setConfigPathValue(
      merged,
      ["agents", "defaults", "heartbeat", "target"],
      managedHeartbeat.target
    );
  }
  if (existingHeartbeat.prompt !== managedHeartbeat.prompt) {
    setConfigPathValue(
      merged,
      ["agents", "defaults", "heartbeat", "prompt"],
      managedHeartbeat.prompt
    );
  }
  if (existingHeartbeat.ackMaxChars !== managedHeartbeat.ackMaxChars) {
    setConfigPathValue(
      merged,
      ["agents", "defaults", "heartbeat", "ackMaxChars"],
      managedHeartbeat.ackMaxChars
    );
  }
  if (
    existingHeartbeat.suppressToolErrorWarnings !==
    managedHeartbeat.suppressToolErrorWarnings
  ) {
    setConfigPathValue(
      merged,
      ["agents", "defaults", "heartbeat", "suppressToolErrorWarnings"],
      managedHeartbeat.suppressToolErrorWarnings
    );
  }

  const existingCron = normalizeManagedCron(parseCronConfig(fullConfig));
  if (existingCron.enabled !== managedCron.enabled) {
    setConfigPathValue(merged, ["cron", "enabled"], managedCron.enabled);
  }
  if (existingCron.maxConcurrentRuns !== managedCron.maxConcurrentRuns) {
    setConfigPathValue(
      merged,
      ["cron", "maxConcurrentRuns"],
      managedCron.maxConcurrentRuns
    );
  }
  if (
    !isComparableValueEqual(
      existingCron.sessionRetention,
      managedCron.sessionRetention
    )
  ) {
    setConfigPathValue(
      merged,
      ["cron", "sessionRetention"],
      managedCron.sessionRetention
    );
  }
  if (existingCron.webhook !== managedCron.webhook) {
    setConfigPathValue(merged, ["cron", "webhook"], managedCron.webhook);
  }
  if (existingCron.webhookToken !== managedCron.webhookToken) {
    setConfigPathValue(
      merged,
      ["cron", "webhookToken"],
      managedCron.webhookToken
    );
  }

  const existingHooks = normalizeManagedHooks(parseHooksConfig(fullConfig));
  if (existingHooks.enabled !== managedHooks.enabled) {
    setConfigPathValue(merged, ["hooks", "enabled"], managedHooks.enabled);
  }
  if (existingHooks.token !== managedHooks.token) {
    setConfigPathValue(merged, ["hooks", "token"], managedHooks.token);
  }
  if (existingHooks.path !== managedHooks.path) {
    setConfigPathValue(merged, ["hooks", "path"], managedHooks.path);
  }
  if (existingHooks.maxBodyBytes !== managedHooks.maxBodyBytes) {
    setConfigPathValue(
      merged,
      ["hooks", "maxBodyBytes"],
      managedHooks.maxBodyBytes
    );
  }
  if (
    existingHooks.allowRequestSessionKey !== managedHooks.allowRequestSessionKey
  ) {
    setConfigPathValue(
      merged,
      ["hooks", "allowRequestSessionKey"],
      managedHooks.allowRequestSessionKey
    );
  }

  return merged;
}

function buildIdentitySignature(id: {
  botName: string;
  userName: string;
  timezone: string;
}): string {
  return JSON.stringify({
    botName: (id.botName || "").trim(),
    userName: (id.userName || "").trim(),
    timezone: (id.timezone || "").trim(),
  });
}

export function Settings({
  onEnvironmentChange,
  initialConfigCenterTab,
}: SettingsProps) {
  const { applyChange } = useStagingSession();

  const [identity, setIdentity] = useState({
    botName: "Clawd",
    userName: "主人",
    timezone: "Asia/Shanghai",
  });
  const [showUninstallConfirm, setShowUninstallConfirm] = useState(false);
  const [uninstalling, setUninstalling] = useState(false);
  const [uninstallResult, setUninstallResult] = useState<InstallResult | null>(
    null
  );

  const [gatewayConfig, setGatewayConfig] = useState<ManagedGatewayConfig>({
    ...DEFAULT_GATEWAY_CONFIG,
  });
  const [gatewayPortInput, setGatewayPortInput] = useState(
    String(DEFAULT_GATEWAY_CONFIG.port)
  );
  const [gatewayTrustedProxyInput, setGatewayTrustedProxyInput] = useState("");
  const [gatewayBindPreset, setGatewayBindPreset] = useState<GatewayBindPreset>(
    detectGatewayBindPreset(DEFAULT_GATEWAY_CONFIG.bind)
  );
  const [commandsConfig, setCommandsConfig] = useState<ManagedCommandsConfig>(
    {}
  );
  const [commandAllowFromInput, setCommandAllowFromInput] = useState("");
  const [messagesConfig, setMessagesConfig] = useState<ManagedMessagesConfig>(
    DEFAULT_MESSAGES_CONFIG
  );
  const [messagesHistoryLimitInput, setMessagesHistoryLimitInput] = useState(
    String(DEFAULT_MESSAGES_CONFIG.groupChatHistoryLimit)
  );
  const [webConfig, setWebConfig] = useState<ManagedWebConfig>({
    ...DEFAULT_WEB_CONFIG,
    reconnect: { ...DEFAULT_WEB_CONFIG.reconnect },
  });
  const [webHeartbeatInput, setWebHeartbeatInput] = useState(
    String(DEFAULT_WEB_CONFIG.heartbeatSeconds)
  );
  const [webReconnectInitialMsInput, setWebReconnectInitialMsInput] = useState(
    String(DEFAULT_WEB_CONFIG.reconnect.initialMs)
  );
  const [webReconnectMaxMsInput, setWebReconnectMaxMsInput] = useState(
    String(DEFAULT_WEB_CONFIG.reconnect.maxMs)
  );
  const [webReconnectFactorInput, setWebReconnectFactorInput] = useState(
    String(DEFAULT_WEB_CONFIG.reconnect.factor)
  );
  const [webReconnectJitterInput, setWebReconnectJitterInput] = useState(
    String(DEFAULT_WEB_CONFIG.reconnect.jitter)
  );
  const [webReconnectMaxAttemptsInput, setWebReconnectMaxAttemptsInput] =
    useState(String(DEFAULT_WEB_CONFIG.reconnect.maxAttempts));
  const [toolsConfig, setToolsConfig] = useState<ManagedToolsConfig>({
    ...DEFAULT_TOOLS_CONFIG,
    allow: [...DEFAULT_TOOLS_CONFIG.allow],
    deny: [...DEFAULT_TOOLS_CONFIG.deny],
  });
  const [toolsAllowInput, setToolsAllowInput] = useState("");
  const [toolsDenyInput, setToolsDenyInput] = useState("");
  const [heartbeatConfig, setHeartbeatConfig] =
    useState<ManagedHeartbeatConfig>(DEFAULT_HEARTBEAT_CONFIG);
  const [heartbeatEveryInput, setHeartbeatEveryInput] = useState(
    DEFAULT_HEARTBEAT_CONFIG.every
  );
  const [heartbeatModelInput, setHeartbeatModelInput] = useState(
    DEFAULT_HEARTBEAT_CONFIG.model
  );
  const [heartbeatTargetInput, setHeartbeatTargetInput] = useState(
    DEFAULT_HEARTBEAT_CONFIG.target
  );
  const [heartbeatPromptInput, setHeartbeatPromptInput] = useState(
    DEFAULT_HEARTBEAT_CONFIG.prompt
  );
  const [heartbeatAckMaxCharsInput, setHeartbeatAckMaxCharsInput] = useState(
    String(DEFAULT_HEARTBEAT_CONFIG.ackMaxChars)
  );
  const [cronConfig, setCronConfig] =
    useState<ManagedCronConfig>(DEFAULT_CRON_CONFIG);
  const [cronMaxConcurrentRunsInput, setCronMaxConcurrentRunsInput] = useState(
    String(DEFAULT_CRON_CONFIG.maxConcurrentRuns)
  );
  const [cronSessionRetentionInput, setCronSessionRetentionInput] =
    useState("");
  const [cronSessionRetentionDisabled, setCronSessionRetentionDisabled] =
    useState(DEFAULT_CRON_CONFIG.sessionRetention === false);
  const [cronWebhookInput, setCronWebhookInput] = useState(
    DEFAULT_CRON_CONFIG.webhook
  );
  const [cronWebhookTokenInput, setCronWebhookTokenInput] = useState(
    DEFAULT_CRON_CONFIG.webhookToken
  );
  const [hooksConfig, setHooksConfig] =
    useState<ManagedHooksConfig>(DEFAULT_HOOKS_CONFIG);
  const [hooksPathInput, setHooksPathInput] = useState(
    DEFAULT_HOOKS_CONFIG.path
  );
  const [hooksTokenInput, setHooksTokenInput] = useState(
    DEFAULT_HOOKS_CONFIG.token
  );
  const [hooksMaxBodyBytesInput, setHooksMaxBodyBytesInput] = useState(
    String(DEFAULT_HOOKS_CONFIG.maxBodyBytes)
  );

  const [agentsListText, setAgentsListText] = useState("[]");
  const [bindingsText, setBindingsText] = useState("[]");

  const [, setConfigLoading] = useState(false); // 用于数据加载
  const [configError, setConfigError] = useState<string | null>(null);

  const [showConfigErrorModal, setShowConfigErrorModal] = useState(false);

  const [configMessage, setConfigMessage] = useState<string | null>(null);
  const [showConfigSuccessModal, setShowConfigSuccessModal] = useState(false);
  const [configSuccessMessage, setConfigSuccessMessage] = useState<
    string | null
  >(null);
  const [configCenterView, setConfigCenterView] =
    useState<ConfigCenterView>("general");
  const [activeCenterTab, setActiveCenterTab] =
    useState<ConfigCenterTab>("agent");

  useEffect(() => {
    if (initialConfigCenterTab) {
      setActiveCenterTab(initialConfigCenterTab);
    }
  }, [initialConfigCenterTab]);

  const [runtimeDocExpanded, setRuntimeDocExpanded] = useState<
    Record<RuntimeSectionKey, boolean>
  >({
    commands: false,
    messages: false,
    web: false,
    tools: false,
    heartbeat: false,
    cron: false,
    hooks: false,
    sessions: false,
  });
  const [expertMode, setExpertMode] = useState(false);

  const [visualAgents, setVisualAgents] = useState<VisualAgent[]>([]);
  const [visualBindings, setVisualBindings] = useState<VisualBinding[]>([]);
  const [bindingsRaw, setBindingsRaw] = useState<unknown>([]);
  const [channelsConfig, setChannelsConfig] = useState<ChannelConfig[]>([]);
  const [applyLoading, setApplyLoading] = useState(false);
  const [baselineManagedSignature, setBaselineManagedSignature] = useState("");
  const [baselineIdentitySignature, setBaselineIdentitySignature] =
    useState("");

  const managedConfigSignature = useMemo(() => {
    if (!expertMode) {
      return buildManagedConfigSignature(
        visualAgents,
        visualBindings,
        gatewayConfig,
        commandsConfig,
        messagesConfig,
        webConfig,
        toolsConfig,
        heartbeatConfig,
        cronConfig,
        hooksConfig
      );
    }

    try {
      const parsedAgentsList = JSON.parse(agentsListText);
      const parsedBindings = JSON.parse(bindingsText);

      if (!Array.isArray(parsedAgentsList)) {
        return "__invalid_agents_list__";
      }

      if (!Array.isArray(parsedBindings) && !isRecord(parsedBindings)) {
        return "__invalid_bindings__";
      }

      return buildManagedConfigSignature(
        parseAgentsList(parsedAgentsList),
        bindingsMapToRules(parseBindings(parsedBindings)),
        gatewayConfig,
        commandsConfig,
        messagesConfig,
        webConfig,
        toolsConfig,
        heartbeatConfig,
        cronConfig,
        hooksConfig
      );
    } catch {
      return "__invalid_json__";
    }
  }, [
    expertMode,
    visualAgents,
    visualBindings,
    gatewayConfig,
    commandsConfig,
    messagesConfig,
    webConfig,
    toolsConfig,
    heartbeatConfig,
    cronConfig,
    hooksConfig,
    agentsListText,
    bindingsText,
  ]);

  const identitySignature = useMemo(() => {
    return buildIdentitySignature(identity);
  }, [identity]);

  const hasPendingChanges = useMemo(() => {
    if (!baselineManagedSignature) {
      return false;
    }
    return (
      managedConfigSignature !== baselineManagedSignature ||
      identitySignature !== baselineIdentitySignature
    );
  }, [
    managedConfigSignature,
    baselineManagedSignature,
    identitySignature,
    baselineIdentitySignature,
  ]);

  const channelOptions = useMemo(() => {
    return Array.from(new Set(channelsConfig.map((channel) => channel.id)));
  }, [channelsConfig]);

  const channelAccountsMap = useMemo(() => {
    return getChannelAccountsMap(channelsConfig);
  }, [channelsConfig]);

  const agentIdOptions = useMemo(() => {
    return Array.from(
      new Set(
        visualAgents
          .map((agent) => agent.id.trim())
          .filter((agentId) => Boolean(agentId))
      )
    );
  }, [visualAgents]);

  const selectedGatewayReloadModeOption = useMemo(() => {
    return GATEWAY_RELOAD_MODE_OPTIONS.find(
      (option) => option.value === gatewayConfig.reloadMode
    );
  }, [gatewayConfig.reloadMode]);

  const gatewayValidationHint = useMemo(() => {
    const trimmedBind = gatewayConfig.bind.trim();
    if (!trimmedBind) {
      return "Gateway 绑定地址无效：bind 不能为空";
    }

    const portNumber = Number(gatewayPortInput);
    if (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535) {
      return "Gateway 端口无效：port 必须为 1~65535 的整数";
    }

    const trustedProxyCandidates = normalizeGatewayTrustedProxies(
      gatewayConfig.trustedProxies
    );

    const invalidProxy = trustedProxyCandidates.find(
      (proxy) => !isValidIpOrCidr(proxy)
    );
    if (invalidProxy) {
      return `Gateway trustedProxies 格式无效：${invalidProxy}（仅支持 IP/CIDR）`;
    }

    return null;
  }, [gatewayConfig.bind, gatewayConfig.trustedProxies, gatewayPortInput]);

  const messagesHistoryLimitHint = useMemo(() => {
    if (!messagesConfig.groupChatHistoryLimitEnabled) {
      return null;
    }

    const parsed = Number(messagesHistoryLimitInput);
    if (!Number.isInteger(parsed) || parsed < 0) {
      return "Messages historyLimit 必须为 >= 0 的整数";
    }

    return null;
  }, [messagesConfig.groupChatHistoryLimitEnabled, messagesHistoryLimitInput]);

  const webValidationHint = useMemo(() => {
    const heartbeatSeconds = Number(webHeartbeatInput);
    if (
      !Number.isInteger(heartbeatSeconds) ||
      heartbeatSeconds < WEB_HEARTBEAT_MIN_SECONDS
    ) {
      return `Web heartbeatSeconds 必须为 >= ${WEB_HEARTBEAT_MIN_SECONDS} 的整数`;
    }

    const reconnectInitialMs = Number(webReconnectInitialMsInput);
    if (
      !Number.isInteger(reconnectInitialMs) ||
      reconnectInitialMs < WEB_RECONNECT_INITIAL_MS_MIN
    ) {
      return `Web reconnect.initialMs 必须为 >= ${WEB_RECONNECT_INITIAL_MS_MIN} 的整数`;
    }

    const reconnectMaxMs = Number(webReconnectMaxMsInput);
    if (
      !Number.isInteger(reconnectMaxMs) ||
      reconnectMaxMs < WEB_RECONNECT_MAX_MS_MIN
    ) {
      return `Web reconnect.maxMs 必须为 >= ${WEB_RECONNECT_MAX_MS_MIN} 的整数`;
    }

    if (reconnectMaxMs < reconnectInitialMs) {
      return "Web reconnect.maxMs 必须 >= reconnect.initialMs";
    }

    const reconnectFactor = Number(webReconnectFactorInput);
    if (
      !Number.isFinite(reconnectFactor) ||
      reconnectFactor < WEB_RECONNECT_FACTOR_MIN
    ) {
      return `Web reconnect.factor 必须为 >= ${WEB_RECONNECT_FACTOR_MIN} 的数字`;
    }

    const reconnectJitter = Number(webReconnectJitterInput);
    if (
      !Number.isFinite(reconnectJitter) ||
      reconnectJitter < WEB_RECONNECT_JITTER_MIN ||
      reconnectJitter > WEB_RECONNECT_JITTER_MAX
    ) {
      return `Web reconnect.jitter 必须在 ${WEB_RECONNECT_JITTER_MIN}~${WEB_RECONNECT_JITTER_MAX} 之间`;
    }

    const reconnectMaxAttempts = Number(webReconnectMaxAttemptsInput);
    if (
      !Number.isInteger(reconnectMaxAttempts) ||
      reconnectMaxAttempts < WEB_RECONNECT_MAX_ATTEMPTS_MIN
    ) {
      return `Web reconnect.maxAttempts 必须为 >= ${WEB_RECONNECT_MAX_ATTEMPTS_MIN} 的整数`;
    }

    return null;
  }, [
    webHeartbeatInput,
    webReconnectInitialMsInput,
    webReconnectMaxMsInput,
    webReconnectFactorInput,
    webReconnectJitterInput,
    webReconnectMaxAttemptsInput,
  ]);

  const toolsConflictHint = useMemo(() => {
    const conflict = toolsConfig.allow.find((name) =>
      toolsConfig.deny.includes(name)
    );
    if (!conflict) {
      return null;
    }
    return `Tools allow/deny 冲突：${conflict} 同时存在于 allow 与 deny`;
  }, [toolsConfig]);

  const heartbeatValidationHint = useMemo(() => {
    if (!heartbeatEveryInput.trim()) {
      return "Heartbeat every 不能为空";
    }
    if (!heartbeatTargetInput.trim()) {
      return "Heartbeat target 不能为空";
    }

    const ackMaxChars = Number(heartbeatAckMaxCharsInput);
    if (
      !Number.isInteger(ackMaxChars) ||
      ackMaxChars < HEARTBEAT_ACK_MAX_CHARS_MIN
    ) {
      return `Heartbeat ackMaxChars 必须为 >= ${HEARTBEAT_ACK_MAX_CHARS_MIN} 的整数`;
    }

    return null;
  }, [heartbeatEveryInput, heartbeatTargetInput, heartbeatAckMaxCharsInput]);

  const cronValidationHint = useMemo(() => {
    const maxConcurrentRuns = Number(cronMaxConcurrentRunsInput);
    if (
      !Number.isInteger(maxConcurrentRuns) ||
      maxConcurrentRuns < CRON_MAX_CONCURRENT_RUNS_MIN
    ) {
      return `Cron maxConcurrentRuns 必须为 >= ${CRON_MAX_CONCURRENT_RUNS_MIN} 的整数`;
    }

    if (!cronSessionRetentionDisabled && !cronSessionRetentionInput.trim()) {
      return "Cron sessionRetention 关闭 false 后必须填写 duration 字符串";
    }

    return null;
  }, [
    cronMaxConcurrentRunsInput,
    cronSessionRetentionDisabled,
    cronSessionRetentionInput,
  ]);

  const hooksValidationHint = useMemo(() => {
    if (!hooksPathInput.trim()) {
      return "Hooks path 不能为空";
    }

    const maxBodyBytes = Number(hooksMaxBodyBytesInput);
    if (
      !Number.isInteger(maxBodyBytes) ||
      maxBodyBytes < HOOKS_MAX_BODY_BYTES_MIN
    ) {
      return `Hooks maxBodyBytes 必须为 >= ${HOOKS_MAX_BODY_BYTES_MIN} 的整数`;
    }

    return null;
  }, [hooksPathInput, hooksMaxBodyBytesInput]);

  const syncJsonTextFromVisual = (
    nextAgents: VisualAgent[],
    nextBindings: VisualBinding[],
    shapeSource: unknown
  ) => {
    const agentsPayload = buildAgentsPayload(nextAgents);
    const bindingsMap = bindingsRulesToMap(nextBindings);
    const bindingsPayload = buildBindingsPayload(shapeSource, bindingsMap);

    setAgentsListText(JSON.stringify(agentsPayload, null, 2));
    setBindingsText(JSON.stringify(bindingsPayload, null, 2));
  };

  const loadFullConfigSnapshot = async (): Promise<Record<string, unknown>> => {
    const staged = await invoke<Record<string, unknown> | null>(
      "staging_session_get_config"
    );
    if (staged && typeof staged === "object" && !Array.isArray(staged)) {
      return staged;
    }
    return invoke<Record<string, unknown>>("get_config");
  };

  const buildGlobalInputConfigPayload = async (
    fullConfig: Record<string, unknown>,
    agentsList: Record<string, unknown>[],
    bindingsPayload: BindingsPayload,
    managedGateway: ManagedGatewayConfig,
    managedCommands: ManagedCommandsConfig,
    managedMessages: ManagedMessagesConfig,
    managedWeb: ManagedWebConfig,
    managedTools: ManagedToolsConfig,
    managedHeartbeat: ManagedHeartbeatConfig,
    managedCron: ManagedCronConfig,
    managedHooks: ManagedHooksConfig
  ) => {
    return buildPathScopedGlobalConfigPayload({
      fullConfig,
      agentsList,
      bindingsPayload,
      managedGateway,
      managedCommands,
      managedMessages,
      managedWeb,
      managedTools,
      managedHeartbeat,
      managedCron,
      managedHooks,
    });
  };

  const buildInputConfigPayload = (): {
    inputConfig: {
      agents: {
        list: Record<string, unknown>[];
      };
      bindings: BindingsPayload;
    };
    normalizedAgents: VisualAgent[];
    normalizedBindings: VisualBinding[];
    normalizedGateway: ManagedGatewayConfig;
    normalizedCommands: ManagedCommandsConfig;
    normalizedMessages: ManagedMessagesConfig;
    normalizedWeb: ManagedWebConfig;
    normalizedTools: ManagedToolsConfig;
    normalizedHeartbeat: ManagedHeartbeatConfig;
    normalizedCron: ManagedCronConfig;
    normalizedHooks: ManagedHooksConfig;
    bindingsPayload: BindingsPayload;
  } => {
    const normalizedGateway = normalizeManagedGateway(gatewayConfig);
    const normalizedCommands = normalizeManagedCommands(commandsConfig);
    const normalizedMessages = normalizeManagedMessages(messagesConfig);
    const normalizedWeb = normalizeManagedWeb(webConfig);
    const normalizedTools = normalizeManagedTools(toolsConfig);
    const normalizedHeartbeat = normalizeManagedHeartbeat(heartbeatConfig);
    const normalizedCron = normalizeManagedCron(cronConfig);
    const normalizedHooks = normalizeManagedHooks(hooksConfig);

    if (expertMode) {
      const parsedAgentsList = JSON.parse(agentsListText);
      const parsedBindings = JSON.parse(bindingsText) as BindingsPayload;

      if (!Array.isArray(parsedAgentsList)) {
        throw new Error("agents.list 结构无效：必须为数组");
      }
      if (!Array.isArray(parsedBindings) && !isRecord(parsedBindings)) {
        throw new Error("bindings 结构无效：必须为数组或对象");
      }

      const normalizedAgents = parseAgentsList(parsedAgentsList);
      const normalizedBindings = bindingsMapToRules(
        parseBindings(parsedBindings)
      );
      const validationError = validateVisualConfig(
        normalizedAgents,
        normalizedBindings,
        normalizedGateway,
        normalizedCommands,
        normalizedMessages,
        normalizedWeb,
        normalizedTools,
        normalizedHeartbeat,
        normalizedCron,
        normalizedHooks
      );
      if (validationError) {
        throw new Error(validationError);
      }

      return {
        inputConfig: {
          agents: {
            list: parsedAgentsList,
          },
          bindings: parsedBindings,
        },
        normalizedAgents,
        normalizedBindings,
        normalizedGateway,
        normalizedCommands,
        normalizedMessages,
        normalizedWeb,
        normalizedTools,
        normalizedHeartbeat,
        normalizedCron,
        normalizedHooks,
        bindingsPayload: parsedBindings,
      };
    }

    const normalizedAgents = normalizeVisualAgents(visualAgents);
    const normalizedBindings = normalizeVisualBindings(visualBindings);

    const validationError = validateVisualConfig(
      normalizedAgents,
      normalizedBindings,
      normalizedGateway,
      normalizedCommands,
      normalizedMessages,
      normalizedWeb,
      normalizedTools,
      normalizedHeartbeat,
      normalizedCron,
      normalizedHooks
    );
    if (validationError) {
      throw new Error(validationError);
    }

    const agentsPayload = buildAgentsPayload(normalizedAgents);
    const bindingsMap = bindingsRulesToMap(normalizedBindings);
    const bindingsPayload = buildBindingsPayload(bindingsRaw, bindingsMap);

    return {
      inputConfig: {
        agents: {
          list: agentsPayload,
        },
        bindings: bindingsPayload,
      },
      normalizedAgents,
      normalizedBindings,
      normalizedGateway,
      normalizedCommands,
      normalizedMessages,
      normalizedWeb,
      normalizedTools,
      normalizedHeartbeat,
      normalizedCron,
      normalizedHooks,
      bindingsPayload,
    };
  };

  const handleStageConfig = async () => {
    if (!hasPendingChanges) {
      setConfigMessage("无配置变更，无需保存到 Session");
      return;
    }

    setApplyLoading(true);
    setConfigError(null);
    setConfigMessage(null);

    try {
      const payload = buildInputConfigPayload();
      const fullConfig = await loadFullConfigSnapshot();
      const globalInputConfig = await buildGlobalInputConfigPayload(
        fullConfig,
        buildAgentsPayload(payload.normalizedAgents),
        payload.bindingsPayload,
        payload.normalizedGateway,
        payload.normalizedCommands,
        payload.normalizedMessages,
        payload.normalizedWeb,
        payload.normalizedTools,
        payload.normalizedHeartbeat,
        payload.normalizedCron,
        payload.normalizedHooks
      );

      await applyChange(
        "replace_full_config",
        { config: globalInputConfig },
        "Settings: 保存 Agent/Binding/Runtime 配置"
      );

      setVisualAgents(payload.normalizedAgents);
      setVisualBindings(payload.normalizedBindings);
      setBindingsRaw(payload.bindingsPayload);
      setAgentsListText(
        JSON.stringify(buildAgentsPayload(payload.normalizedAgents), null, 2)
      );
      setBindingsText(JSON.stringify(payload.bindingsPayload, null, 2));
      setGatewayConfig(payload.normalizedGateway);
      setGatewayPortInput(String(payload.normalizedGateway.port));
      setGatewayTrustedProxyInput(
        serializeTrustedProxyInput(payload.normalizedGateway.trustedProxies)
      );
      setGatewayBindPreset(
        detectGatewayBindPreset(payload.normalizedGateway.bind)
      );
      setCommandsConfig(payload.normalizedCommands);
      setCommandAllowFromInput(
        (payload.normalizedCommands.allowFromAll ?? []).join("\n")
      );
      setMessagesConfig(payload.normalizedMessages);
      setMessagesHistoryLimitInput(
        String(payload.normalizedMessages.groupChatHistoryLimit)
      );
      setWebConfig(payload.normalizedWeb);
      setWebHeartbeatInput(String(payload.normalizedWeb.heartbeatSeconds));
      setWebReconnectInitialMsInput(
        String(payload.normalizedWeb.reconnect.initialMs)
      );
      setWebReconnectMaxMsInput(String(payload.normalizedWeb.reconnect.maxMs));
      setWebReconnectFactorInput(
        String(payload.normalizedWeb.reconnect.factor)
      );
      setWebReconnectJitterInput(
        String(payload.normalizedWeb.reconnect.jitter)
      );
      setWebReconnectMaxAttemptsInput(
        String(payload.normalizedWeb.reconnect.maxAttempts)
      );
      setToolsConfig(payload.normalizedTools);
      setToolsAllowInput(payload.normalizedTools.allow.join("\n"));
      setToolsDenyInput(payload.normalizedTools.deny.join("\n"));
      setHeartbeatConfig(payload.normalizedHeartbeat);
      setHeartbeatEveryInput(payload.normalizedHeartbeat.every);
      setHeartbeatModelInput(payload.normalizedHeartbeat.model);
      setHeartbeatTargetInput(payload.normalizedHeartbeat.target);
      setHeartbeatPromptInput(payload.normalizedHeartbeat.prompt);
      setHeartbeatAckMaxCharsInput(
        String(payload.normalizedHeartbeat.ackMaxChars)
      );
      setCronConfig(payload.normalizedCron);
      setCronMaxConcurrentRunsInput(
        String(payload.normalizedCron.maxConcurrentRuns)
      );
      setCronSessionRetentionDisabled(
        payload.normalizedCron.sessionRetention === false
      );
      setCronSessionRetentionInput(
        payload.normalizedCron.sessionRetention === false
          ? ""
          : payload.normalizedCron.sessionRetention
      );
      setCronWebhookInput(payload.normalizedCron.webhook);
      setCronWebhookTokenInput(payload.normalizedCron.webhookToken);
      setHooksConfig(payload.normalizedHooks);
      setHooksPathInput(payload.normalizedHooks.path);
      setHooksTokenInput(payload.normalizedHooks.token);
      setHooksMaxBodyBytesInput(String(payload.normalizedHooks.maxBodyBytes));

      setBaselineManagedSignature(
        buildManagedConfigSignature(
          payload.normalizedAgents,
          payload.normalizedBindings,
          payload.normalizedGateway,
          payload.normalizedCommands,
          payload.normalizedMessages,
          payload.normalizedWeb,
          payload.normalizedTools,
          payload.normalizedHeartbeat,
          payload.normalizedCron,
          payload.normalizedHooks
        )
      );
      setBaselineIdentitySignature(buildIdentitySignature(identity));
      setConfigMessage("配置已写入 Session，请在侧边栏统一保存");
    } catch (e) {
      console.error("保存到 Session 失败:", e);
      setConfigError(`保存失败: ${String(e)}`);
    } finally {
      setApplyLoading(false);
    }
  };

  const openConfigDir = async () => {
    try {
      const home = await invoke<{ config_dir: string }>("get_system_info");
      const configPath = home.config_dir;

      if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
        const { open } = await import("@tauri-apps/plugin-shell");
        await open(configPath);
      } else {
        await navigator.clipboard.writeText(configPath);
        alert("配置目录路径已复制：" + configPath);
      }
    } catch (e) {
      console.error("打开目录失败:", e);
    }
  };

  const handleUninstall = async () => {
    setUninstalling(true);
    setUninstallResult(null);
    try {
      const result = await invoke<InstallResult>("uninstall_openclaw");
      setUninstallResult(result);
      if (result.success) {
        onEnvironmentChange?.();
        setTimeout(() => {
          setShowUninstallConfirm(false);
        }, 2000);
      }
    } catch (e) {
      setUninstallResult({
        success: false,
        message: "卸载过程中发生错误",
        error: String(e),
      });
    } finally {
      setUninstalling(false);
    }
  };

  useEffect(() => {
    if (configError) {
      setShowConfigErrorModal(true);
    }
  }, [configError]);

  useEffect(() => {
    if (configMessage && !configError) {
      setConfigSuccessMessage(configMessage);
      setShowConfigSuccessModal(true);
    }
  }, [configMessage, configError]);

  useEffect(() => {
    const loadAgentAndBindingConfig = async () => {
      setConfigLoading(true);
      setConfigError(null);

      try {
        const [fullConfigResult, channelsResult] = await Promise.allSettled([
          loadFullConfigSnapshot(),
          invoke<ChannelConfig[]>("get_channels_config"),
        ]);

        const warnings: string[] = [];

        const loadedFullConfig: Record<string, unknown> =
          fullConfigResult.status === "fulfilled" ? fullConfigResult.value : {};
        if (fullConfigResult.status === "rejected") {
          console.warn(
            "获取完整配置失败，已回退默认值:",
            fullConfigResult.reason
          );
          warnings.push("获取完整配置失败，已回退默认值");
        }

        const loadedChannels =
          channelsResult.status === "fulfilled" ? channelsResult.value : [];
        if (channelsResult.status === "rejected") {
          console.warn(
            "获取渠道配置失败，Binding 的 channel/account 下拉可能受限:",
            channelsResult.reason
          );
          warnings.push("获取渠道配置失败，已降级为空");
        }

        const agentsSource = isRecord(loadedFullConfig.agents)
          ? (loadedFullConfig.agents as Record<string, unknown>).list
          : [];
        const bindingsSource = isRecord(loadedFullConfig)
          ? loadedFullConfig.bindings
          : [];

        const nextVisualAgents = parseAgentsList(agentsSource);
        const nextVisualBindings = bindingsMapToRules(
          parseBindings(bindingsSource)
        );
        const nextGatewayConfig = parseGatewayConfig(loadedFullConfig);
        const {
          nextCommandsConfig,
          nextMessagesConfig,
          nextWebConfig,
          nextToolsConfig,
          nextHeartbeatConfig,
          nextCronConfig,
          nextHooksConfig,
        } = applyRuntimeConfigSnapshot(loadedFullConfig);

        setAgentsListText(JSON.stringify(agentsSource ?? [], null, 2));
        setBindingsText(JSON.stringify(bindingsSource ?? [], null, 2));
        setVisualAgents(nextVisualAgents);
        setVisualBindings(nextVisualBindings);
        setBindingsRaw(bindingsSource ?? []);
        setChannelsConfig(loadedChannels ?? []);
        setGatewayConfig(nextGatewayConfig);
        setGatewayPortInput(String(nextGatewayConfig.port));
        setGatewayTrustedProxyInput(
          serializeTrustedProxyInput(nextGatewayConfig.trustedProxies)
        );
        setGatewayBindPreset(detectGatewayBindPreset(nextGatewayConfig.bind));
        setCommandsConfig(nextCommandsConfig);
        setCommandAllowFromInput(
          (nextCommandsConfig.allowFromAll ?? []).join("\n")
        );
        setMessagesConfig(nextMessagesConfig);
        setMessagesHistoryLimitInput(
          String(nextMessagesConfig.groupChatHistoryLimit)
        );
        setWebConfig(nextWebConfig);
        setWebHeartbeatInput(String(nextWebConfig.heartbeatSeconds));
        setWebReconnectInitialMsInput(
          String(nextWebConfig.reconnect.initialMs)
        );
        setWebReconnectMaxMsInput(String(nextWebConfig.reconnect.maxMs));
        setWebReconnectFactorInput(String(nextWebConfig.reconnect.factor));
        setWebReconnectJitterInput(String(nextWebConfig.reconnect.jitter));
        setWebReconnectMaxAttemptsInput(
          String(nextWebConfig.reconnect.maxAttempts)
        );
        setToolsConfig(nextToolsConfig);
        setToolsAllowInput(nextToolsConfig.allow.join("\n"));
        setToolsDenyInput(nextToolsConfig.deny.join("\n"));
        setHeartbeatConfig(nextHeartbeatConfig);
        setHeartbeatEveryInput(nextHeartbeatConfig.every);
        setHeartbeatModelInput(nextHeartbeatConfig.model);
        setHeartbeatTargetInput(nextHeartbeatConfig.target);
        setHeartbeatPromptInput(nextHeartbeatConfig.prompt);
        setHeartbeatAckMaxCharsInput(String(nextHeartbeatConfig.ackMaxChars));
        setCronConfig(nextCronConfig);
        setCronMaxConcurrentRunsInput(String(nextCronConfig.maxConcurrentRuns));
        setCronSessionRetentionDisabled(
          nextCronConfig.sessionRetention === false
        );
        setCronSessionRetentionInput(
          nextCronConfig.sessionRetention === false
            ? ""
            : nextCronConfig.sessionRetention
        );
        setCronWebhookInput(nextCronConfig.webhook);
        setCronWebhookTokenInput(nextCronConfig.webhookToken);
        setHooksConfig(nextHooksConfig);
        setHooksPathInput(nextHooksConfig.path);
        setHooksTokenInput(nextHooksConfig.token);
        setHooksMaxBodyBytesInput(String(nextHooksConfig.maxBodyBytes));

        setBaselineManagedSignature(
          buildManagedConfigSignature(
            nextVisualAgents,
            nextVisualBindings,
            nextGatewayConfig,
            nextCommandsConfig,
            nextMessagesConfig,
            nextWebConfig,
            nextToolsConfig,
            nextHeartbeatConfig,
            nextCronConfig,
            nextHooksConfig
          )
        );
        setBaselineIdentitySignature(buildIdentitySignature(identity));

        if (warnings.length > 0) {
          setConfigError(warnings.join("；"));
        }
      } catch (e) {
        console.error("加载 Settings 配置失败:", e);
        setConfigError(String(e));
      } finally {
        setConfigLoading(false);
      }
    };

    loadAgentAndBindingConfig();
  }, []);

  // 自动写入 Session：配置有变更时 debounce 触发
  useEffect(() => {
    if (!hasPendingChanges || applyLoading) return;
    if (managedConfigSignature === "__invalid__") return;
    const timer = setTimeout(() => {
      void handleStageConfig();
    }, 800);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasPendingChanges, managedConfigSignature, identitySignature]);

  const syncVisualModeFromJson = (): boolean => {
    try {
      const parsedAgents = JSON.parse(agentsListText);
      const parsedBindings = JSON.parse(bindingsText);

      if (!Array.isArray(parsedAgents)) {
        throw new Error("agents.list 结构无效：必须为数组");
      }

      if (!Array.isArray(parsedBindings) && !isRecord(parsedBindings)) {
        throw new Error("bindings 结构无效：必须为数组或对象");
      }

      const nextVisualAgents = parseAgentsList(parsedAgents);
      const nextVisualBindings = bindingsMapToRules(
        parseBindings(parsedBindings)
      );
      const nextGateway = normalizeManagedGateway(gatewayConfig);
      const nextCommands = normalizeManagedCommands(commandsConfig);
      const nextMessages = normalizeManagedMessages(messagesConfig);
      const nextWeb = normalizeManagedWeb(webConfig);
      const nextTools = normalizeManagedTools(toolsConfig);
      const nextHeartbeat = normalizeManagedHeartbeat(heartbeatConfig);
      const nextCron = normalizeManagedCron(cronConfig);
      const nextHooks = normalizeManagedHooks(hooksConfig);
      const validationError = validateVisualConfig(
        nextVisualAgents,
        nextVisualBindings,
        nextGateway,
        nextCommands,
        nextMessages,
        nextWeb,
        nextTools,
        nextHeartbeat,
        nextCron,
        nextHooks
      );
      if (validationError) {
        throw new Error(validationError);
      }

      setVisualAgents(nextVisualAgents);
      setVisualBindings(nextVisualBindings);
      setBindingsRaw(parsedBindings);
      setGatewayConfig(nextGateway);
      setGatewayPortInput(String(nextGateway.port));
      setGatewayTrustedProxyInput(nextGateway.trustedProxies.join("\n"));
      setGatewayBindPreset(detectGatewayBindPreset(nextGateway.bind));
      setCommandsConfig(nextCommands);
      setCommandAllowFromInput((nextCommands.allowFromAll ?? []).join("\n"));
      setMessagesConfig(nextMessages);
      setMessagesHistoryLimitInput(String(nextMessages.groupChatHistoryLimit));
      setWebConfig(nextWeb);
      setWebHeartbeatInput(String(nextWeb.heartbeatSeconds));
      setWebReconnectInitialMsInput(String(nextWeb.reconnect.initialMs));
      setWebReconnectMaxMsInput(String(nextWeb.reconnect.maxMs));
      setWebReconnectFactorInput(String(nextWeb.reconnect.factor));
      setWebReconnectJitterInput(String(nextWeb.reconnect.jitter));
      setWebReconnectMaxAttemptsInput(String(nextWeb.reconnect.maxAttempts));
      setToolsConfig(nextTools);
      setToolsAllowInput(nextTools.allow.join("\n"));
      setToolsDenyInput(nextTools.deny.join("\n"));
      setHeartbeatConfig(nextHeartbeat);
      setHeartbeatEveryInput(nextHeartbeat.every);
      setHeartbeatModelInput(nextHeartbeat.model);
      setHeartbeatTargetInput(nextHeartbeat.target);
      setHeartbeatPromptInput(nextHeartbeat.prompt);
      setHeartbeatAckMaxCharsInput(String(nextHeartbeat.ackMaxChars));
      setCronConfig(nextCron);
      setCronMaxConcurrentRunsInput(String(nextCron.maxConcurrentRuns));
      setCronSessionRetentionDisabled(nextCron.sessionRetention === false);
      setCronSessionRetentionInput(
        nextCron.sessionRetention === false ? "" : nextCron.sessionRetention
      );
      setCronWebhookInput(nextCron.webhook);
      setCronWebhookTokenInput(nextCron.webhookToken);
      setHooksConfig(nextHooks);
      setHooksPathInput(nextHooks.path);
      setHooksTokenInput(nextHooks.token);
      setHooksMaxBodyBytesInput(String(nextHooks.maxBodyBytes));
      setExpertMode(false);
      return true;
    } catch (e) {
      console.error("专家模式切换失败:", e);
      setConfigError(`专家模式 JSON 无效，无法切换到可视化：${String(e)}`);
      return false;
    }
  };

  const handleExpertModeToggle = (enabled: boolean) => {
    setConfigError(null);
    setConfigMessage(null);

    if (enabled) {
      syncJsonTextFromVisual(visualAgents, visualBindings, bindingsRaw);
      setExpertMode(true);
      return;
    }

    syncVisualModeFromJson();
  };

  const handleConfigCenterTabChange = (tab: ConfigCenterTab) => {
    setConfigError(null);
    setConfigMessage(null);

    if (tab === activeCenterTab) {
      return;
    }

    if (tab === "advanced") {
      if (!expertMode) {
        syncJsonTextFromVisual(visualAgents, visualBindings, bindingsRaw);
        setExpertMode(true);
      }
      setActiveCenterTab(tab);
      return;
    }

    if (expertMode && !syncVisualModeFromJson()) {
      return;
    }

    setActiveCenterTab(tab);
  };

  const handleOpenConfigCenter = () => {
    setConfigCenterView("center");
    setActiveCenterTab("agent");
  };

  const handleExitConfigCenter = () => {
    setConfigError(null);
    setConfigMessage(null);

    if (expertMode && !syncVisualModeFromJson()) {
      return;
    }

    setConfigCenterView("general");
  };

  const handleAddAgent = () => {
    setConfigError(null);
    setConfigMessage(null);
    setVisualAgents((prev) => [
      ...prev,
      {
        id: "",
        name: "",
        workspace: "",
        default: false,
        extra: {},
      },
    ]);
  };

  const handleAgentFieldChange = (
    index: number,
    field: "id" | "name" | "workspace" | "default",
    value: string | boolean
  ) => {
    setConfigError(null);
    setConfigMessage(null);

    setVisualAgents((prev) =>
      prev.map((agent, i) => {
        if (i !== index) {
          return agent;
        }

        if (field === "default") {
          return {
            ...agent,
            default: Boolean(value),
          };
        }

        return {
          ...agent,
          [field]: String(value),
        };
      })
    );
  };

  const handleDeleteAgent = (index: number) => {
    const target = visualAgents[index];
    const targetId = target?.id?.trim();

    if (
      targetId &&
      visualBindings.some((binding) => binding.agentId.trim() === targetId)
    ) {
      const message = `无法删除 Agent ${targetId}：仍被 Binding 路由规则引用`;
      setConfigError(message);
      return;
    }

    const ok = confirm("确认删除该 Agent 吗？");
    if (!ok) {
      return;
    }

    setConfigError(null);
    setConfigMessage(null);
    setVisualAgents((prev) => prev.filter((_, i) => i !== index));
  };

  const getAccountOptions = (channelId: string, currentAccountId: string) => {
    const options = channelAccountsMap[channelId] ?? [];
    if (!currentAccountId || options.includes(currentAccountId)) {
      return options;
    }
    return [currentAccountId, ...options];
  };

  const handleAddBinding = () => {
    setConfigError(null);
    setConfigMessage(null);

    const defaultChannel = channelOptions[0] || "";
    const defaultAccounts = channelAccountsMap[defaultChannel] || [];

    setVisualBindings((prev) => [
      ...prev,
      {
        channel: defaultChannel,
        accountId: defaultAccounts[0] || "",
        agentId: agentIdOptions[0] || "",
      },
    ]);
  };

  const handleBindingFieldChange = (
    index: number,
    field: keyof VisualBinding,
    value: string
  ) => {
    setConfigError(null);
    setConfigMessage(null);

    setVisualBindings((prev) =>
      prev.map((binding, i) => {
        if (i !== index) {
          return binding;
        }

        if (field === "channel") {
          const nextChannel = value;
          const accountOptions = channelAccountsMap[nextChannel] || [];
          const nextAccountId = accountOptions.includes(binding.accountId)
            ? binding.accountId
            : accountOptions[0] || "";
          return {
            ...binding,
            channel: nextChannel,
            accountId: nextAccountId,
          };
        }

        return {
          ...binding,
          [field]: value,
        };
      })
    );
  };

  const handleDeleteBinding = (index: number) => {
    const ok = confirm("确认删除该 Binding 路由规则吗？");
    if (!ok) {
      return;
    }

    setConfigError(null);
    setConfigMessage(null);
    setVisualBindings((prev) => prev.filter((_, i) => i !== index));
  };

  const handleGatewayPortInputChange = (value: string) => {
    setGatewayPortInput(value);
    setGatewayConfig((prev) => ({
      ...prev,
      port: Number(value),
    }));
  };

  const handleGatewayBindPresetChange = (preset: GatewayBindPreset) => {
    setGatewayBindPreset(preset);
    if (preset === "loopback") {
      setGatewayConfig((prev) => ({
        ...prev,
        bind: "127.0.0.1",
      }));
      return;
    }
    if (preset === "all") {
      setGatewayConfig((prev) => ({
        ...prev,
        bind: "0.0.0.0",
      }));
    }
  };

  const handleGatewayBindInputChange = (value: string) => {
    setGatewayBindPreset(detectGatewayBindPreset(value));
    setGatewayConfig((prev) => ({
      ...prev,
      bind: value,
    }));
  };

  const handleGatewayTrustedProxyInputChange = (value: string) => {
    setGatewayTrustedProxyInput(value);
    setGatewayConfig((prev) => ({
      ...prev,
      trustedProxies: parseTrustedProxyInput(value),
    }));
  };

  const handleGatewayReloadModeChange = (value: GatewayReloadMode) => {
    setGatewayConfig((prev) => ({
      ...prev,
      reloadMode: value,
    }));
  };

  const handleCommandsNativeChange = (value: CommandsNativeMode | "") => {
    setConfigError(null);
    setConfigMessage(null);
    setCommandsConfig((prev) => ({
      ...prev,
      native: value || undefined,
    }));
  };

  const handleCommandsToggleChange = (
    field: CommandToggleField,
    checked: boolean
  ) => {
    setConfigError(null);
    setConfigMessage(null);
    setCommandsConfig((prev) => ({
      ...prev,
      [field]: checked,
    }));
  };

  const handleCommandsAllowFromInputChange = (value: string) => {
    setConfigError(null);
    setConfigMessage(null);
    setCommandAllowFromInput(value);
    setCommandsConfig((prev) => ({
      ...prev,
      allowFromAll: value
        .split(/\r?\n/)
        .map((item) => item.trim())
        .filter((item) => Boolean(item)),
    }));
  };

  const handleMessagesHistoryLimitEnabledChange = (checked: boolean) => {
    setConfigError(null);
    setConfigMessage(null);
    setMessagesConfig((prev) => ({
      ...prev,
      groupChatHistoryLimitEnabled: checked,
    }));
  };

  const handleMessagesHistoryLimitInputChange = (value: string) => {
    setConfigError(null);
    setConfigMessage(null);
    setMessagesHistoryLimitInput(value);

    const parsed = Number(value);
    setMessagesConfig((prev) => ({
      ...prev,
      groupChatHistoryLimit: Number.isInteger(parsed) ? parsed : Number.NaN,
    }));
  };

  const handleWebEnabledChange = (checked: boolean) => {
    setConfigError(null);
    setConfigMessage(null);
    setWebConfig((prev) => ({
      ...prev,
      enabled: checked,
    }));
  };

  const handleWebHeartbeatInputChange = (value: string) => {
    setConfigError(null);
    setConfigMessage(null);
    setWebHeartbeatInput(value);

    const parsed = Number(value);
    setWebConfig((prev) => ({
      ...prev,
      heartbeatSeconds: Number.isInteger(parsed) ? parsed : Number.NaN,
    }));
  };

  const handleWebReconnectInitialMsInputChange = (value: string) => {
    setConfigError(null);
    setConfigMessage(null);
    setWebReconnectInitialMsInput(value);

    const parsed = Number(value);
    setWebConfig((prev) => ({
      ...prev,
      reconnect: {
        ...prev.reconnect,
        initialMs: Number.isInteger(parsed) ? parsed : Number.NaN,
      },
    }));
  };

  const handleWebReconnectMaxMsInputChange = (value: string) => {
    setConfigError(null);
    setConfigMessage(null);
    setWebReconnectMaxMsInput(value);

    const parsed = Number(value);
    setWebConfig((prev) => ({
      ...prev,
      reconnect: {
        ...prev.reconnect,
        maxMs: Number.isInteger(parsed) ? parsed : Number.NaN,
      },
    }));
  };

  const handleWebReconnectFactorInputChange = (value: string) => {
    setConfigError(null);
    setConfigMessage(null);
    setWebReconnectFactorInput(value);

    const parsed = Number(value);
    setWebConfig((prev) => ({
      ...prev,
      reconnect: {
        ...prev.reconnect,
        factor: Number.isFinite(parsed) ? parsed : Number.NaN,
      },
    }));
  };

  const handleWebReconnectJitterInputChange = (value: string) => {
    setConfigError(null);
    setConfigMessage(null);
    setWebReconnectJitterInput(value);

    const parsed = Number(value);
    setWebConfig((prev) => ({
      ...prev,
      reconnect: {
        ...prev.reconnect,
        jitter: Number.isFinite(parsed) ? parsed : Number.NaN,
      },
    }));
  };

  const handleWebReconnectMaxAttemptsInputChange = (value: string) => {
    setConfigError(null);
    setConfigMessage(null);
    setWebReconnectMaxAttemptsInput(value);

    const parsed = Number(value);
    setWebConfig((prev) => ({
      ...prev,
      reconnect: {
        ...prev.reconnect,
        maxAttempts: Number.isInteger(parsed) ? parsed : Number.NaN,
      },
    }));
  };

  const handleToolsAllowInputChange = (value: string) => {
    setConfigError(null);
    setConfigMessage(null);
    setToolsAllowInput(value);
    setToolsConfig((prev) => ({
      ...prev,
      allow: parseToolListInput(value),
    }));
  };

  const handleToolsDenyInputChange = (value: string) => {
    setConfigError(null);
    setConfigMessage(null);
    setToolsDenyInput(value);
    setToolsConfig((prev) => ({
      ...prev,
      deny: parseToolListInput(value),
    }));
  };

  const handleToolsSessionsVisibilityChange = (value: SessionsVisibility) => {
    setConfigError(null);
    setConfigMessage(null);
    setToolsConfig((prev) => ({
      ...prev,
      sessionsVisibility: value,
    }));
  };

  const handleHeartbeatEnabledChange = (checked: boolean) => {
    setConfigError(null);
    setConfigMessage(null);
    setHeartbeatConfig((prev) => ({
      ...prev,
      includeReasoning: checked,
    }));
  };

  const handleHeartbeatSuppressWarningsChange = (checked: boolean) => {
    setConfigError(null);
    setConfigMessage(null);
    setHeartbeatConfig((prev) => ({
      ...prev,
      suppressToolErrorWarnings: checked,
    }));
  };

  const handleHeartbeatEveryInputChange = (value: string) => {
    setConfigError(null);
    setConfigMessage(null);
    setHeartbeatEveryInput(value);
    setHeartbeatConfig((prev) => ({
      ...prev,
      every: value,
    }));
  };

  const handleHeartbeatModelInputChange = (value: string) => {
    setConfigError(null);
    setConfigMessage(null);
    setHeartbeatModelInput(value);
    setHeartbeatConfig((prev) => ({
      ...prev,
      model: value,
    }));
  };

  const handleHeartbeatTargetInputChange = (value: string) => {
    setConfigError(null);
    setConfigMessage(null);
    setHeartbeatTargetInput(value);
    setHeartbeatConfig((prev) => ({
      ...prev,
      target: value,
    }));
  };

  const handleHeartbeatPromptInputChange = (value: string) => {
    setConfigError(null);
    setConfigMessage(null);
    setHeartbeatPromptInput(value);
    setHeartbeatConfig((prev) => ({
      ...prev,
      prompt: value,
    }));
  };

  const handleHeartbeatAckMaxCharsInputChange = (value: string) => {
    setConfigError(null);
    setConfigMessage(null);
    setHeartbeatAckMaxCharsInput(value);
    const parsed = Number(value);
    setHeartbeatConfig((prev) => ({
      ...prev,
      ackMaxChars: Number.isInteger(parsed) ? parsed : Number.NaN,
    }));
  };

  const handleCronEnabledChange = (checked: boolean) => {
    setConfigError(null);
    setConfigMessage(null);
    setCronConfig((prev) => ({
      ...prev,
      enabled: checked,
    }));
  };

  const handleCronMaxConcurrentRunsInputChange = (value: string) => {
    setConfigError(null);
    setConfigMessage(null);
    setCronMaxConcurrentRunsInput(value);
    const parsed = Number(value);
    setCronConfig((prev) => ({
      ...prev,
      maxConcurrentRuns: Number.isInteger(parsed) ? parsed : Number.NaN,
    }));
  };

  const handleCronSessionRetentionDisabledChange = (checked: boolean) => {
    setConfigError(null);
    setConfigMessage(null);
    setCronSessionRetentionDisabled(checked);
    setCronConfig((prev) => ({
      ...prev,
      sessionRetention: checked
        ? false
        : prev.sessionRetention === false
        ? ""
        : prev.sessionRetention,
    }));
  };

  const handleCronSessionRetentionInputChange = (value: string) => {
    setConfigError(null);
    setConfigMessage(null);
    setCronSessionRetentionInput(value);
    setCronConfig((prev) => ({
      ...prev,
      sessionRetention: value,
    }));
  };

  const handleCronWebhookInputChange = (value: string) => {
    setConfigError(null);
    setConfigMessage(null);
    setCronWebhookInput(value);
    setCronConfig((prev) => ({
      ...prev,
      webhook: value,
    }));
  };

  const handleCronWebhookTokenInputChange = (value: string) => {
    setConfigError(null);
    setConfigMessage(null);
    setCronWebhookTokenInput(value);
    setCronConfig((prev) => ({
      ...prev,
      webhookToken: value,
    }));
  };

  const handleHooksEnabledChange = (checked: boolean) => {
    setConfigError(null);
    setConfigMessage(null);
    setHooksConfig((prev) => ({
      ...prev,
      enabled: checked,
    }));
  };

  const handleHooksPathInputChange = (value: string) => {
    setConfigError(null);
    setConfigMessage(null);
    setHooksPathInput(value);
    setHooksConfig((prev) => ({
      ...prev,
      path: value,
    }));
  };

  const handleHooksTokenInputChange = (value: string) => {
    setConfigError(null);
    setConfigMessage(null);
    setHooksTokenInput(value);
    setHooksConfig((prev) => ({
      ...prev,
      token: value,
    }));
  };

  const handleHooksMaxBodyBytesInputChange = (value: string) => {
    setConfigError(null);
    setConfigMessage(null);
    setHooksMaxBodyBytesInput(value);
    const parsed = Number(value);
    setHooksConfig((prev) => ({
      ...prev,
      maxBodyBytes: Number.isInteger(parsed) ? parsed : Number.NaN,
    }));
  };

  const handleHooksAllowRequestSessionKeyChange = (checked: boolean) => {
    setConfigError(null);
    setConfigMessage(null);
    setHooksConfig((prev) => ({
      ...prev,
      allowRequestSessionKey: checked,
    }));
  };

  const handleRuntimeDocToggle = (sectionKey: RuntimeSectionKey) => {
    setRuntimeDocExpanded((prev) => ({
      ...prev,
      [sectionKey]: !prev[sectionKey],
    }));
  };

  const renderRuntimeDoc = (sectionKey: RuntimeSectionKey) => {
    const section = RUNTIME_SECTION_DOC_MAP[sectionKey];
    const statusMeta = RUNTIME_STATUS_META[section.status];
    const expanded = runtimeDocExpanded[sectionKey];

    return (
      <div className="rounded-lg border border-dark-500 bg-dark-700/60 p-3 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-white">
                {section.title} 说明
              </p>
              <span
                className={`text-[11px] px-2 py-0.5 rounded-full border ${statusMeta.className}`}
              >
                {statusMeta.label}
              </span>
            </div>
            <p className="text-xs text-gray-400">
              {section.functionDescription}
            </p>
          </div>
          <button
            type="button"
            onClick={() => handleRuntimeDocToggle(sectionKey)}
            className="text-xs px-2.5 py-1.5 rounded-md bg-dark-600 hover:bg-dark-500 text-gray-200 transition-colors"
          >
            {expanded ? "收起说明" : "展开说明"}
          </button>
        </div>

        {expanded && (
          <div className="space-y-3 text-xs">
            <div className="space-y-2">
              <p className="text-gray-300">参数说明：</p>
              <ul className="space-y-2">
                {section.fields.map((field) => (
                  <li
                    key={`${section.key}-${field.name}`}
                    className="rounded-md border border-dark-500 bg-dark-700/70 p-2 space-y-1"
                  >
                    <p className="text-gray-100 font-medium">{field.name}</p>
                    <p className="text-gray-400">{field.description}</p>
                    {field.defaultHint && (
                      <p className="text-gray-500">
                        默认值：{field.defaultHint}
                      </p>
                    )}
                    {field.recommendedHint && (
                      <p className="text-cyan-300">
                        推荐值：{field.recommendedHint}
                      </p>
                    )}
                    {field.riskHint && (
                      <p className="text-amber-300">风险：{field.riskHint}</p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
            <p className="text-amber-300">风险提示：{section.riskTip}</p>
          </div>
        )}
      </div>
    );
  };

  const applyRuntimeConfigSnapshot = (fullConfig: unknown) => {
    const nextCommandsConfig = parseCommandsConfig(fullConfig);
    const nextMessagesConfig = parseMessagesConfig(fullConfig);
    const nextWebConfig = parseWebConfig(fullConfig);
    const nextToolsConfig = parseToolsConfig(fullConfig);
    const nextHeartbeatConfig = parseHeartbeatConfig(fullConfig);
    const nextCronConfig = parseCronConfig(fullConfig);
    const nextHooksConfig = parseHooksConfig(fullConfig);

    setCommandsConfig(nextCommandsConfig);
    setCommandAllowFromInput(
      (nextCommandsConfig.allowFromAll ?? []).join("\n")
    );
    setMessagesConfig(nextMessagesConfig);
    setMessagesHistoryLimitInput(
      String(nextMessagesConfig.groupChatHistoryLimit)
    );
    setWebConfig(nextWebConfig);
    setWebHeartbeatInput(String(nextWebConfig.heartbeatSeconds));
    setWebReconnectInitialMsInput(String(nextWebConfig.reconnect.initialMs));
    setWebReconnectMaxMsInput(String(nextWebConfig.reconnect.maxMs));
    setWebReconnectFactorInput(String(nextWebConfig.reconnect.factor));
    setWebReconnectJitterInput(String(nextWebConfig.reconnect.jitter));
    setWebReconnectMaxAttemptsInput(
      String(nextWebConfig.reconnect.maxAttempts)
    );
    setToolsConfig(nextToolsConfig);
    setToolsAllowInput(nextToolsConfig.allow.join("\n"));
    setToolsDenyInput(nextToolsConfig.deny.join("\n"));
    setHeartbeatConfig(nextHeartbeatConfig);
    setHeartbeatEveryInput(nextHeartbeatConfig.every);
    setHeartbeatModelInput(nextHeartbeatConfig.model);
    setHeartbeatTargetInput(nextHeartbeatConfig.target);
    setHeartbeatPromptInput(nextHeartbeatConfig.prompt);
    setHeartbeatAckMaxCharsInput(String(nextHeartbeatConfig.ackMaxChars));
    setCronConfig(nextCronConfig);
    setCronMaxConcurrentRunsInput(String(nextCronConfig.maxConcurrentRuns));
    setCronSessionRetentionDisabled(nextCronConfig.sessionRetention === false);
    setCronSessionRetentionInput(
      nextCronConfig.sessionRetention === false
        ? ""
        : nextCronConfig.sessionRetention
    );
    setCronWebhookInput(nextCronConfig.webhook);
    setCronWebhookTokenInput(nextCronConfig.webhookToken);
    setHooksConfig(nextHooksConfig);
    setHooksPathInput(nextHooksConfig.path);
    setHooksTokenInput(nextHooksConfig.token);
    setHooksMaxBodyBytesInput(String(nextHooksConfig.maxBodyBytes));

    return {
      nextCommandsConfig,
      nextMessagesConfig,
      nextWebConfig,
      nextToolsConfig,
      nextHeartbeatConfig,
      nextCronConfig,
      nextHooksConfig,
    };
  };

  const configCenterPanel = (
    <div className="bg-dark-700 rounded-2xl p-6 border border-dark-500 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleExitConfigCenter}
            className="p-2 rounded-lg bg-dark-600 hover:bg-dark-500 transition-colors"
            title="返回设置页"
          >
            <ArrowLeft size={16} className="text-gray-300" />
          </button>
          <div>
            <h3 className="text-lg font-semibold text-white">
              Agent & Runtime 配置中心
            </h3>
            <p className="text-xs text-gray-500">
              二级视图：统一管理 Agent、Routing、Runtime 与高级(JSON)
            </p>
          </div>
        </div>
        {hasPendingChanges && (
          <div className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
            检测到未应用变更
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {CONFIG_CENTER_TABS.map((tab) => {
          const isActive = activeCenterTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => handleConfigCenterTabChange(tab.key)}
              className={`px-4 py-2.5 rounded-lg text-sm transition-colors min-h-[40px] ${
                isActive
                  ? "bg-cyan-500 text-white"
                  : "bg-dark-600 text-gray-300 hover:bg-dark-500"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeCenterTab === "agent" && (
        <div className="rounded-xl border border-dark-500 bg-dark-600 p-4 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Bot size={16} className="text-cyan-400" />
              <h4 className="text-sm font-semibold text-white">Agent 管理</h4>
            </div>
            <button
              type="button"
              onClick={handleAddAgent}
              className="px-3 py-2.5 min-h-[40px] rounded-lg bg-dark-500 hover:bg-dark-400 text-sm text-white transition-colors flex items-center gap-2"
            >
              <Plus size={16} />
              新增 Agent
            </button>
          </div>

          <p className="text-xs text-gray-500">
            字段：id（必填且唯一）、name（可选）、workspace（可选）、default（可选）
          </p>

          {visualAgents.length === 0 ? (
            <div className="text-xs text-gray-500 p-3 rounded-lg bg-dark-700/60 border border-dashed border-dark-500">
              暂无 Agent，请先新增。
            </div>
          ) : (
            <div className="space-y-3">
              {visualAgents.map((agent, index) => (
                <div
                  key={`agent-${index}`}
                  className="p-3 rounded-lg bg-dark-700/70 border border-dark-500 space-y-3"
                >
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">
                        id *
                      </label>
                      <input
                        type="text"
                        value={agent.id}
                        onChange={(e) =>
                          handleAgentFieldChange(index, "id", e.target.value)
                        }
                        placeholder="例如：assistant"
                        className="input-base text-sm"
                      />
                    </div>

                    <div>
                      <label className="block text-xs text-gray-400 mb-1">
                        name
                      </label>
                      <input
                        type="text"
                        value={agent.name}
                        onChange={(e) =>
                          handleAgentFieldChange(index, "name", e.target.value)
                        }
                        placeholder="可选显示名称"
                        className="input-base text-sm"
                      />
                    </div>

                    <div>
                      <label className="block text-xs text-gray-400 mb-1">
                        workspace
                      </label>
                      <input
                        type="text"
                        value={agent.workspace}
                        onChange={(e) =>
                          handleAgentFieldChange(
                            index,
                            "workspace",
                            e.target.value
                          )
                        }
                        placeholder="可选工作目录"
                        className="input-base text-sm"
                      />
                    </div>

                    <div className="flex items-end justify-between gap-3">
                      <label className="inline-flex items-center gap-2 text-sm text-gray-300 py-2">
                        <input
                          type="checkbox"
                          checked={agent.default}
                          onChange={(e) =>
                            handleAgentFieldChange(
                              index,
                              "default",
                              e.target.checked
                            )
                          }
                          className="h-4 w-4 rounded border-dark-400 bg-dark-600 text-cyan-500 focus:ring-cyan-500"
                        />
                        default
                      </label>

                      <button
                        type="button"
                        onClick={() => handleDeleteAgent(index)}
                        className="px-3 py-2.5 min-h-[40px] rounded-lg bg-red-900/30 hover:bg-red-800/40 text-red-300 text-sm transition-colors"
                      >
                        删除
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeCenterTab === "routing" && (
        <div className="rounded-xl border border-dark-500 bg-dark-600 p-4 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Link2 size={16} className="text-cyan-400" />
              <h4 className="text-sm font-semibold text-white">
                Binding 路由规则
              </h4>
            </div>
            <button
              type="button"
              onClick={handleAddBinding}
              className="px-3 py-2.5 min-h-[40px] rounded-lg bg-dark-500 hover:bg-dark-400 text-sm text-white transition-colors flex items-center gap-2"
            >
              <Plus size={16} />
              新增规则
            </button>
          </div>

          <p className="text-xs text-gray-500">
            字段：channel、accountId、agentId。要求 channel + accountId 唯一，且
            agentId 必须存在于 agents.list。
          </p>

          {visualBindings.length === 0 ? (
            <div className="text-xs text-gray-500 p-3 rounded-lg bg-dark-700/60 border border-dashed border-dark-500">
              暂无 Binding 路由规则，请先新增。
            </div>
          ) : (
            <div className="space-y-3">
              {visualBindings.map((binding, index) => {
                const channelSelectOptions =
                  binding.channel && !channelOptions.includes(binding.channel)
                    ? [binding.channel, ...channelOptions]
                    : channelOptions;

                const accountOptions = getAccountOptions(
                  binding.channel,
                  binding.accountId
                );

                const agentSelectOptions =
                  binding.agentId && !agentIdOptions.includes(binding.agentId)
                    ? [binding.agentId, ...agentIdOptions]
                    : agentIdOptions;

                return (
                  <div
                    key={`binding-${index}`}
                    className="p-3 rounded-lg bg-dark-700/70 border border-dark-500"
                  >
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">
                          channel
                        </label>
                        <select
                          value={binding.channel}
                          onChange={(e) =>
                            handleBindingFieldChange(
                              index,
                              "channel",
                              e.target.value
                            )
                          }
                          className="input-base text-sm"
                        >
                          <option value="">请选择渠道</option>
                          {channelSelectOptions.map((channelId) => (
                            <option key={channelId} value={channelId}>
                              {channelId}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-xs text-gray-400 mb-1">
                          accountId
                        </label>
                        {accountOptions.length > 0 ? (
                          <select
                            value={binding.accountId}
                            onChange={(e) =>
                              handleBindingFieldChange(
                                index,
                                "accountId",
                                e.target.value
                              )
                            }
                            className="input-base text-sm"
                          >
                            <option value="">请选择账号</option>
                            {accountOptions.map((accountId) => (
                              <option key={accountId} value={accountId}>
                                {accountId}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type="text"
                            value={binding.accountId}
                            onChange={(e) =>
                              handleBindingFieldChange(
                                index,
                                "accountId",
                                e.target.value
                              )
                            }
                            placeholder="手动输入 accountId"
                            className="input-base text-sm"
                          />
                        )}
                      </div>

                      <div>
                        <label className="block text-xs text-gray-400 mb-1">
                          agentId
                        </label>
                        <select
                          value={binding.agentId}
                          onChange={(e) =>
                            handleBindingFieldChange(
                              index,
                              "agentId",
                              e.target.value
                            )
                          }
                          className="input-base text-sm"
                        >
                          <option value="">请选择 Agent</option>
                          {agentSelectOptions.map((agentId) => (
                            <option key={agentId} value={agentId}>
                              {agentId}
                            </option>
                          ))}
                        </select>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleDeleteBinding(index)}
                        className="px-3 py-2.5 min-h-[40px] rounded-lg bg-red-900/30 hover:bg-red-800/40 text-red-300 text-sm transition-colors"
                      >
                        删除
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {activeCenterTab === "runtime" && (
        <div className="space-y-4">
          <div className="rounded-xl border border-dark-500 bg-dark-600 p-4 space-y-4">
            <div className="flex items-center gap-2">
              <Network size={16} className="text-indigo-300" />
              <h4 className="text-sm font-semibold text-white">Gateway 配置</h4>
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-2">
                监听端口
              </label>
              <input
                type="number"
                min={1}
                max={65535}
                value={gatewayPortInput}
                onChange={(e) => handleGatewayPortInputChange(e.target.value)}
                className="input-base"
              />
              <p className="text-xs text-gray-500 mt-1">
                Web Server 监听端口，默认 18789，建议范围 1024~49151。
              </p>
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-2">
                绑定地址
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <select
                  value={gatewayBindPreset}
                  onChange={(e) =>
                    handleGatewayBindPresetChange(
                      e.target.value as GatewayBindPreset
                    )
                  }
                  className="input-base"
                >
                  <option value="loopback">仅本机（127.0.0.1）</option>
                  <option value="all">全部网卡（0.0.0.0）</option>
                  <option value="custom">自定义</option>
                </select>
                <input
                  type="text"
                  value={gatewayConfig.bind}
                  onChange={(e) => handleGatewayBindInputChange(e.target.value)}
                  disabled={gatewayBindPreset !== "custom"}
                  className="input-base disabled:opacity-60"
                />
              </div>
              <p className="text-xs text-gray-500 mt-1">
                推荐“仅本机”，如需外部访问请结合反向代理与访问控制。
              </p>
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-2">
                trustedProxies
              </label>
              <textarea
                value={gatewayTrustedProxyInput}
                onChange={(e) =>
                  handleGatewayTrustedProxyInputChange(e.target.value)
                }
                rows={4}
                className="input-base font-mono text-xs"
                placeholder={"127.0.0.1/32\n10.0.0.0/8"}
              />
              <p className="text-xs text-gray-500 mt-1">
                代理信任源（IP/CIDR），支持空格、换行、逗号、分号分隔。
              </p>
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-2">
                重载模式
              </label>
              <select
                value={gatewayConfig.reloadMode}
                onChange={(e) =>
                  handleGatewayReloadModeChange(
                    e.target.value as GatewayReloadMode
                  )
                }
                className="input-base"
              >
                {GATEWAY_RELOAD_MODE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              {selectedGatewayReloadModeOption && (
                <p className="text-xs text-gray-500 mt-1">
                  {selectedGatewayReloadModeOption.description}
                </p>
              )}
            </div>

            <div
              className={`text-xs ${
                gatewayValidationHint ? "text-amber-300" : "text-emerald-300"
              }`}
            >
              {gatewayValidationHint ?? "Gateway 参数校验通过"}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div className="rounded-xl border border-dark-500 bg-dark-600 p-4 space-y-4">
              {renderRuntimeDoc("commands")}

              <div>
                <label className="block text-sm text-gray-400 mb-2">
                  native
                </label>
                <select
                  value={commandsConfig.native ?? ""}
                  onChange={(e) =>
                    handleCommandsNativeChange(
                      e.target.value as CommandsNativeMode | ""
                    )
                  }
                  className="input-base"
                >
                  <option value="">未设置（保持现状）</option>
                  <option value="auto">auto</option>
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
                <p className="text-xs text-gray-500 mt-1">
                  命令解析模式，默认建议 auto；仅在兼容性排障时改为 true/false。
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm text-gray-300">
                {COMMAND_TOGGLE_FIELDS.map((item) => (
                  <div
                    key={item.field}
                    className="rounded-lg border border-dark-500 bg-dark-700/70 p-3 space-y-2"
                  >
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={commandsConfig[item.field] ?? false}
                        onChange={(e) =>
                          handleCommandsToggleChange(
                            item.field,
                            e.target.checked
                          )
                        }
                        className="h-4 w-4 rounded border-dark-400 bg-dark-600 text-cyan-500 focus:ring-cyan-500"
                      />
                      {item.label}
                    </label>
                    <p className="text-xs text-gray-500">{item.helper}</p>
                    {item.risk && (
                      <p className="text-xs text-amber-300">
                        风险：{item.risk}
                      </p>
                    )}
                  </div>
                ))}
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-2">
                  allowFrom（每行一个主体）
                </label>
                <textarea
                  value={commandAllowFromInput}
                  onChange={(e) =>
                    handleCommandsAllowFromInputChange(e.target.value)
                  }
                  rows={4}
                  className="input-base font-mono text-xs"
                  placeholder={"*\ntelegram:123456"}
                />
                <p className="text-xs text-gray-500 mt-1">
                  写入
                  commands.allowFrom["*"]，建议按账号精确授权，避免使用全量通配。
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-dark-500 bg-dark-600 p-4 space-y-4">
              {renderRuntimeDoc("messages")}

              <div className="flex items-center justify-between p-3 rounded-lg bg-dark-700/60 border border-dark-500">
                <div>
                  <p className="text-sm text-white">
                    groupChat.historyLimitEnabled
                  </p>
                  <p className="text-xs text-gray-500">
                    开启后写入 historyLimit；关闭则不写字段并回退默认行为。
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={messagesConfig.groupChatHistoryLimitEnabled}
                    onChange={(e) =>
                      handleMessagesHistoryLimitEnabledChange(e.target.checked)
                    }
                  />
                  <div className="w-11 h-6 bg-dark-500 peer-focus:ring-2 peer-focus:ring-cyan-500/50 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-cyan-500"></div>
                </label>
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-2">
                  historyLimit (&gt;= 0)
                </label>
                <input
                  type="number"
                  min={0}
                  value={messagesHistoryLimitInput}
                  onChange={(e) =>
                    handleMessagesHistoryLimitInputChange(e.target.value)
                  }
                  disabled={!messagesConfig.groupChatHistoryLimitEnabled}
                  className="input-base disabled:opacity-60"
                />
                <p
                  className={`text-xs mt-1 ${
                    messagesHistoryLimitHint
                      ? "text-amber-300"
                      : "text-gray-500"
                  }`}
                >
                  {messagesHistoryLimitHint ??
                    "默认 0，建议 20~100；过大会增加成本与延迟。"}
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="rounded-xl border border-dark-500 bg-dark-600 p-4 space-y-4">
              {renderRuntimeDoc("web")}

              <div className="flex items-center justify-between p-3 rounded-lg bg-dark-700/60 border border-dark-500">
                <div>
                  <p className="text-sm text-white">web.enabled</p>
                  <p className="text-xs text-gray-500">
                    控制 Runtime Web 通道启停。
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={webConfig.enabled}
                    onChange={(e) => handleWebEnabledChange(e.target.checked)}
                  />
                  <div className="w-11 h-6 bg-dark-500 peer-focus:ring-2 peer-focus:ring-cyan-500/50 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-cyan-500"></div>
                </label>
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-2">
                  heartbeatSeconds (&gt;= {WEB_HEARTBEAT_MIN_SECONDS})
                </label>
                <input
                  type="number"
                  min={WEB_HEARTBEAT_MIN_SECONDS}
                  value={webHeartbeatInput}
                  onChange={(e) =>
                    handleWebHeartbeatInputChange(e.target.value)
                  }
                  className="input-base"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">
                    reconnect.initialMs
                  </label>
                  <input
                    type="number"
                    min={WEB_RECONNECT_INITIAL_MS_MIN}
                    value={webReconnectInitialMsInput}
                    onChange={(e) =>
                      handleWebReconnectInitialMsInputChange(e.target.value)
                    }
                    className="input-base text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">
                    reconnect.maxMs
                  </label>
                  <input
                    type="number"
                    min={WEB_RECONNECT_MAX_MS_MIN}
                    value={webReconnectMaxMsInput}
                    onChange={(e) =>
                      handleWebReconnectMaxMsInputChange(e.target.value)
                    }
                    className="input-base text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">
                    reconnect.factor
                  </label>
                  <input
                    type="number"
                    min={WEB_RECONNECT_FACTOR_MIN}
                    step="0.1"
                    value={webReconnectFactorInput}
                    onChange={(e) =>
                      handleWebReconnectFactorInputChange(e.target.value)
                    }
                    className="input-base text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">
                    reconnect.jitter
                  </label>
                  <input
                    type="number"
                    min={WEB_RECONNECT_JITTER_MIN}
                    max={WEB_RECONNECT_JITTER_MAX}
                    step="0.01"
                    value={webReconnectJitterInput}
                    onChange={(e) =>
                      handleWebReconnectJitterInputChange(e.target.value)
                    }
                    className="input-base text-sm"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs text-gray-400 mb-1">
                    reconnect.maxAttempts
                  </label>
                  <input
                    type="number"
                    min={WEB_RECONNECT_MAX_ATTEMPTS_MIN}
                    value={webReconnectMaxAttemptsInput}
                    onChange={(e) =>
                      handleWebReconnectMaxAttemptsInputChange(e.target.value)
                    }
                    className="input-base text-sm"
                  />
                </div>
              </div>

              <p
                className={`text-xs ${
                  webValidationHint ? "text-amber-300" : "text-emerald-300"
                }`}
              >
                {webValidationHint ?? "Web 参数校验通过"}
              </p>
            </div>

            <div className="rounded-xl border border-dark-500 bg-dark-600 p-4 space-y-4">
              {renderRuntimeDoc("tools")}

              <div>
                <label className="block text-sm text-gray-400 mb-2">
                  tools.allow（换行/逗号/分号分隔）
                </label>
                <textarea
                  value={toolsAllowInput}
                  onChange={(e) => handleToolsAllowInputChange(e.target.value)}
                  rows={4}
                  className="input-base font-mono text-xs"
                  placeholder={"filesystem-read\nterminal-execute"}
                />
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-2">
                  tools.deny（换行/逗号/分号分隔）
                </label>
                <textarea
                  value={toolsDenyInput}
                  onChange={(e) => handleToolsDenyInputChange(e.target.value)}
                  rows={4}
                  className="input-base font-mono text-xs"
                  placeholder={"shell\nrm -rf"}
                />
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-2">
                  tools.sessions.visibility
                </label>
                <select
                  value={toolsConfig.sessionsVisibility}
                  onChange={(e) =>
                    handleToolsSessionsVisibilityChange(
                      e.target.value as SessionsVisibility
                    )
                  }
                  className="input-base"
                >
                  <option value="self">self</option>
                  <option value="tree">tree</option>
                  <option value="agent">agent</option>
                  <option value="all">all</option>
                </select>
              </div>

              <p
                className={`text-xs ${
                  toolsConflictHint ? "text-amber-300" : "text-emerald-300"
                }`}
              >
                {toolsConflictHint ?? "Tools allow/deny 校验通过"}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div className="rounded-xl border border-dark-500 bg-dark-600 p-4 space-y-4">
              {renderRuntimeDoc("heartbeat")}

              <div>
                <label className="block text-sm text-gray-400 mb-2">
                  every (duration)
                </label>
                <input
                  type="text"
                  value={heartbeatEveryInput}
                  onChange={(e) =>
                    handleHeartbeatEveryInputChange(e.target.value)
                  }
                  className="input-base"
                />
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-2">
                  model
                </label>
                <input
                  type="text"
                  value={heartbeatModelInput}
                  onChange={(e) =>
                    handleHeartbeatModelInputChange(e.target.value)
                  }
                  className="input-base"
                />
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-2">
                  target
                </label>
                <input
                  type="text"
                  value={heartbeatTargetInput}
                  onChange={(e) =>
                    handleHeartbeatTargetInputChange(e.target.value)
                  }
                  className="input-base"
                />
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-2">
                  prompt
                </label>
                <textarea
                  value={heartbeatPromptInput}
                  onChange={(e) =>
                    handleHeartbeatPromptInputChange(e.target.value)
                  }
                  rows={4}
                  className="input-base"
                />
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-2">
                  ackMaxChars (&gt;= {HEARTBEAT_ACK_MAX_CHARS_MIN})
                </label>
                <input
                  type="number"
                  min={HEARTBEAT_ACK_MAX_CHARS_MIN}
                  value={heartbeatAckMaxCharsInput}
                  onChange={(e) =>
                    handleHeartbeatAckMaxCharsInputChange(e.target.value)
                  }
                  className="input-base"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="inline-flex items-center gap-2 text-sm text-gray-300">
                  <input
                    type="checkbox"
                    checked={heartbeatConfig.includeReasoning}
                    onChange={(e) =>
                      handleHeartbeatEnabledChange(e.target.checked)
                    }
                    className="h-4 w-4 rounded border-dark-400 bg-dark-600 text-cyan-500 focus:ring-cyan-500"
                  />
                  includeReasoning
                </label>

                <label className="inline-flex items-center gap-2 text-sm text-gray-300">
                  <input
                    type="checkbox"
                    checked={heartbeatConfig.suppressToolErrorWarnings}
                    onChange={(e) =>
                      handleHeartbeatSuppressWarningsChange(e.target.checked)
                    }
                    className="h-4 w-4 rounded border-dark-400 bg-dark-600 text-cyan-500 focus:ring-cyan-500"
                  />
                  suppressToolErrorWarnings
                </label>
              </div>

              <p
                className={`text-xs ${
                  heartbeatValidationHint
                    ? "text-amber-300"
                    : "text-emerald-300"
                }`}
              >
                {heartbeatValidationHint ?? "Heartbeat 参数校验通过"}
              </p>
            </div>

            <div className="rounded-xl border border-dark-500 bg-dark-600 p-4 space-y-4">
              {renderRuntimeDoc("cron")}

              <div className="flex items-center justify-between p-3 rounded-lg bg-dark-700/60 border border-dark-500">
                <span className="text-sm text-white">cron.enabled</span>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={cronConfig.enabled}
                    onChange={(e) => handleCronEnabledChange(e.target.checked)}
                  />
                  <div className="w-11 h-6 bg-dark-500 peer-focus:ring-2 peer-focus:ring-cyan-500/50 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-cyan-500"></div>
                </label>
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-2">
                  maxConcurrentRuns (&gt;= {CRON_MAX_CONCURRENT_RUNS_MIN})
                </label>
                <input
                  type="number"
                  min={CRON_MAX_CONCURRENT_RUNS_MIN}
                  value={cronMaxConcurrentRunsInput}
                  onChange={(e) =>
                    handleCronMaxConcurrentRunsInputChange(e.target.value)
                  }
                  className="input-base"
                />
              </div>

              <div className="space-y-2">
                <label className="inline-flex items-center gap-2 text-sm text-gray-300">
                  <input
                    type="checkbox"
                    checked={cronSessionRetentionDisabled}
                    onChange={(e) =>
                      handleCronSessionRetentionDisabledChange(e.target.checked)
                    }
                    className="h-4 w-4 rounded border-dark-400 bg-dark-600 text-cyan-500 focus:ring-cyan-500"
                  />
                  sessionRetention = false
                </label>
                <input
                  type="text"
                  value={cronSessionRetentionInput}
                  onChange={(e) =>
                    handleCronSessionRetentionInputChange(e.target.value)
                  }
                  disabled={cronSessionRetentionDisabled}
                  className="input-base disabled:opacity-60"
                  placeholder="例如 24h"
                />
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-2">
                  webhook
                </label>
                <input
                  type="text"
                  value={cronWebhookInput}
                  onChange={(e) => handleCronWebhookInputChange(e.target.value)}
                  className="input-base"
                />
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-2">
                  webhookToken
                </label>
                <input
                  type="password"
                  value={cronWebhookTokenInput}
                  onChange={(e) =>
                    handleCronWebhookTokenInputChange(e.target.value)
                  }
                  className="input-base"
                />
              </div>

              <p
                className={`text-xs ${
                  cronValidationHint ? "text-amber-300" : "text-emerald-300"
                }`}
              >
                {cronValidationHint ?? "Cron 参数校验通过"}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div className="rounded-xl border border-dark-500 bg-dark-600 p-4 space-y-4">
              {renderRuntimeDoc("hooks")}

              <div className="flex items-center justify-between p-3 rounded-lg bg-dark-700/60 border border-dark-500">
                <span className="text-sm text-white">hooks.enabled</span>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={hooksConfig.enabled}
                    onChange={(e) => handleHooksEnabledChange(e.target.checked)}
                  />
                  <div className="w-11 h-6 bg-dark-500 peer-focus:ring-2 peer-focus:ring-cyan-500/50 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-cyan-500"></div>
                </label>
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-2">path</label>
                <input
                  type="text"
                  value={hooksPathInput}
                  onChange={(e) => handleHooksPathInputChange(e.target.value)}
                  className="input-base"
                />
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-2">
                  token
                </label>
                <input
                  type="password"
                  value={hooksTokenInput}
                  onChange={(e) => handleHooksTokenInputChange(e.target.value)}
                  className="input-base"
                />
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-2">
                  maxBodyBytes (&gt;= {HOOKS_MAX_BODY_BYTES_MIN})
                </label>
                <input
                  type="number"
                  min={HOOKS_MAX_BODY_BYTES_MIN}
                  value={hooksMaxBodyBytesInput}
                  onChange={(e) =>
                    handleHooksMaxBodyBytesInputChange(e.target.value)
                  }
                  className="input-base"
                />
              </div>

              <label className="inline-flex items-center gap-2 text-sm text-gray-300">
                <input
                  type="checkbox"
                  checked={hooksConfig.allowRequestSessionKey}
                  onChange={(e) =>
                    handleHooksAllowRequestSessionKeyChange(e.target.checked)
                  }
                  className="h-4 w-4 rounded border-dark-400 bg-dark-600 text-cyan-500 focus:ring-cyan-500"
                />
                allowRequestSessionKey
              </label>

              <p
                className={`text-xs ${
                  hooksValidationHint ? "text-amber-300" : "text-emerald-300"
                }`}
              >
                {hooksValidationHint ?? "Hooks 参数校验通过"}
              </p>
            </div>

            <div className="rounded-xl border border-dark-500 bg-dark-600 p-4 space-y-4">
              {renderRuntimeDoc("sessions")}

              <div>
                <label className="block text-sm text-gray-400 mb-2">
                  tools.sessions.visibility
                </label>
                <select
                  value={toolsConfig.sessionsVisibility}
                  onChange={(e) =>
                    handleToolsSessionsVisibilityChange(
                      e.target.value as SessionsVisibility
                    )
                  }
                  className="input-base"
                >
                  <option value="self">self</option>
                  <option value="tree">tree</option>
                  <option value="agent">agent</option>
                  <option value="all">all</option>
                </select>
                <p className="text-xs text-gray-500 mt-1">
                  该字段写入 tools.sessions.visibility，用于控制会话可见范围。
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeCenterTab === "advanced" && (
        <div className="space-y-4">
          <div className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
            JSON 专家模式：直接编辑 agents.list 与
            bindings，切回其他页签会自动校验并同步回可视化。
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-2">
              agents.list (JSON)
            </label>
            <textarea
              value={agentsListText}
              onChange={(e) => setAgentsListText(e.target.value)}
              rows={8}
              className="input-base font-mono text-xs"
            />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-2">
              bindings (JSON)
            </label>
            <textarea
              value={bindingsText}
              onChange={(e) => setBindingsText(e.target.value)}
              rows={8}
              className="input-base font-mono text-xs"
            />
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="module-page-shell">
      <div className="max-w-2xl space-y-6">
        {configCenterView === "center" ? (
          configCenterPanel
        ) : (
          <>
            <div className="bg-dark-700 rounded-2xl p-5 border border-dark-500">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <h3 className="text-base sm:text-lg font-semibold text-white">
                    Agent & Runtime 配置中心
                  </h3>
                  <p className="text-xs text-gray-500 mt-1">
                    进入二级视图统一管理 Agent / Routing / Runtime / 高级(JSON)
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleOpenConfigCenter}
                  className="btn-secondary inline-flex items-center justify-center gap-2 min-h-[40px]"
                >
                  进入配置中心
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>

            {/* Gateway 配置 */}
            <div className="bg-dark-700 rounded-2xl p-6 border border-dark-500">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-indigo-500/20 flex items-center justify-center">
                  <Network size={20} className="text-indigo-300" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-white">
                    Gateway 配置
                  </h3>
                  <p className="text-xs text-gray-500">
                    Web Server 顶部入口参数
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-2">
                    监听端口
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={65535}
                    value={gatewayPortInput}
                    onChange={(e) =>
                      handleGatewayPortInputChange(e.target.value)
                    }
                    className="input-base"
                  />
                </div>

                <div>
                  <label className="block text-sm text-gray-400 mb-2">
                    绑定地址
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <select
                      value={gatewayBindPreset}
                      onChange={(e) =>
                        handleGatewayBindPresetChange(
                          e.target.value as GatewayBindPreset
                        )
                      }
                      className="input-base"
                    >
                      <option value="loopback">仅本机（127.0.0.1）</option>
                      <option value="all">全部网卡（0.0.0.0）</option>
                      <option value="custom">自定义</option>
                    </select>
                    <input
                      type="text"
                      value={gatewayConfig.bind}
                      onChange={(e) =>
                        handleGatewayBindInputChange(e.target.value)
                      }
                      disabled={gatewayBindPreset !== "custom"}
                      className="input-base disabled:opacity-60"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm text-gray-400 mb-2">
                    trustedProxies
                  </label>
                  <textarea
                    value={gatewayTrustedProxyInput}
                    onChange={(e) =>
                      handleGatewayTrustedProxyInputChange(e.target.value)
                    }
                    rows={4}
                    className="input-base font-mono text-xs"
                    placeholder={"127.0.0.1/32\n10.0.0.0/8"}
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    支持空格、换行、逗号、分号分隔。
                  </p>
                </div>

                <div>
                  <label className="block text-sm text-gray-400 mb-2">
                    重载模式
                  </label>
                  <select
                    value={gatewayConfig.reloadMode}
                    onChange={(e) =>
                      handleGatewayReloadModeChange(
                        e.target.value as GatewayReloadMode
                      )
                    }
                    className="input-base"
                  >
                    {GATEWAY_RELOAD_MODE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  {selectedGatewayReloadModeOption && (
                    <p className="text-xs text-gray-500 mt-1">
                      {selectedGatewayReloadModeOption.description}
                    </p>
                  )}
                </div>

                <div
                  className={`text-xs ${
                    gatewayValidationHint
                      ? "text-amber-300"
                      : "text-emerald-300"
                  }`}
                >
                  {gatewayValidationHint ?? "Gateway 参数校验通过"}
                </div>
              </div>
            </div>

            {/* 身份配置 */}
            <div className="bg-dark-700 rounded-2xl p-6 border border-dark-500">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-claw-500/20 flex items-center justify-center">
                  <User size={20} className="text-claw-400" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-white">身份配置</h3>
                  <p className="text-xs text-gray-500">
                    设置 AI 助手的名称和称呼
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-2">
                    AI 助手名称
                  </label>
                  <input
                    type="text"
                    value={identity.botName}
                    onChange={(e) =>
                      setIdentity({ ...identity, botName: e.target.value })
                    }
                    placeholder="Clawd"
                    className="input-base"
                  />
                </div>

                <div>
                  <label className="block text-sm text-gray-400 mb-2">
                    你的称呼
                  </label>
                  <input
                    type="text"
                    value={identity.userName}
                    onChange={(e) =>
                      setIdentity({ ...identity, userName: e.target.value })
                    }
                    placeholder="主人"
                    className="input-base"
                  />
                </div>

                <div>
                  <label className="block text-sm text-gray-400 mb-2">
                    时区
                  </label>
                  <select
                    value={identity.timezone}
                    onChange={(e) =>
                      setIdentity({ ...identity, timezone: e.target.value })
                    }
                    className="input-base"
                  >
                    <option value="Asia/Shanghai">
                      Asia/Shanghai (北京时间)
                    </option>
                    <option value="Asia/Hong_Kong">
                      Asia/Hong_Kong (香港时间)
                    </option>
                    <option value="Asia/Tokyo">Asia/Tokyo (东京时间)</option>
                    <option value="America/New_York">
                      America/New_York (纽约时间)
                    </option>
                    <option value="America/Los_Angeles">
                      America/Los_Angeles (洛杉矶时间)
                    </option>
                    <option value="Europe/London">
                      Europe/London (伦敦时间)
                    </option>
                    <option value="UTC">UTC</option>
                  </select>
                </div>
              </div>
            </div>

            {/* 安全设置 */}
            <div className="bg-dark-700 rounded-2xl p-6 border border-dark-500">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center">
                  <Shield size={20} className="text-amber-400" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-white">安全设置</h3>
                  <p className="text-xs text-gray-500">权限和访问控制</p>
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-dark-600 rounded-lg">
                  <div>
                    <p className="text-sm text-white">启用白名单</p>
                    <p className="text-xs text-gray-500">
                      只允许白名单用户访问
                    </p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" className="sr-only peer" />
                    <div className="w-11 h-6 bg-dark-500 peer-focus:ring-2 peer-focus:ring-claw-500/50 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-claw-500"></div>
                  </label>
                </div>

                <div className="flex items-center justify-between p-4 bg-dark-600 rounded-lg">
                  <div>
                    <p className="text-sm text-white">文件访问权限</p>
                    <p className="text-xs text-gray-500">
                      允许 AI 读写本地文件
                    </p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" className="sr-only peer" />
                    <div className="w-11 h-6 bg-dark-500 peer-focus:ring-2 peer-focus:ring-claw-500/50 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-claw-500"></div>
                  </label>
                </div>
              </div>
            </div>

            {/* 高级设置 */}
            <div className="bg-dark-700 rounded-2xl p-6 border border-dark-500">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-purple-500/20 flex items-center justify-center">
                  <FileCode size={20} className="text-purple-400" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-white">高级设置</h3>
                  <p className="text-xs text-gray-500">配置文件和目录</p>
                </div>
              </div>

              <div className="space-y-3">
                <button
                  onClick={openConfigDir}
                  className="w-full flex items-center gap-3 p-4 bg-dark-600 rounded-lg hover:bg-dark-500 transition-colors text-left"
                >
                  <FolderOpen size={18} className="text-gray-400" />
                  <div className="flex-1">
                    <p className="text-sm text-white">打开配置目录</p>
                    <p className="text-xs text-gray-500">~/.openclaw</p>
                  </div>
                </button>
              </div>
            </div>

            {/* Agent 与 Binding 配置 */}
            <div className="bg-dark-700 rounded-2xl p-6 border border-dark-500">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-cyan-500/20 flex items-center justify-center">
                  <FileCode size={20} className="text-cyan-400" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-white">
                    Agent 与 Binding 配置
                  </h3>
                  <p className="text-xs text-gray-500">
                    默认使用可视化配置，可切换专家模式直接编辑 JSON
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                <div className="p-4 rounded-lg bg-dark-600 border border-dark-500 flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm text-white font-medium">
                      专家模式（JSON）
                    </p>
                    <p className="text-xs text-gray-500">
                      开启后可直接编辑 agents.list 与 bindings 原始 JSON
                    </p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      className="sr-only peer"
                      checked={expertMode}
                      onChange={(e) => handleExpertModeToggle(e.target.checked)}
                    />
                    <div className="w-11 h-6 bg-dark-500 peer-focus:ring-2 peer-focus:ring-cyan-500/50 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-cyan-500"></div>
                  </label>
                </div>

                {!expertMode ? (
                  <div className="space-y-4">
                    <div className="rounded-xl border border-dark-500 bg-dark-600 p-4 space-y-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <Bot size={16} className="text-cyan-400" />
                          <h4 className="text-sm font-semibold text-white">
                            Agent 管理
                          </h4>
                        </div>
                        <button
                          type="button"
                          onClick={handleAddAgent}
                          className="px-3 py-2.5 min-h-[40px] rounded-lg bg-dark-500 hover:bg-dark-400 text-sm text-white transition-colors flex items-center gap-2"
                        >
                          <Plus size={16} />
                          新增 Agent
                        </button>
                      </div>

                      <p className="text-xs text-gray-500">
                        字段：id（必填且唯一）、name（可选）、workspace（可选）、default（可选）
                      </p>

                      {visualAgents.length === 0 ? (
                        <div className="text-xs text-gray-500 p-3 rounded-lg bg-dark-700/60 border border-dashed border-dark-500">
                          暂无 Agent，请先新增。
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {visualAgents.map((agent, index) => (
                            <div
                              key={`agent-${index}`}
                              className="p-3 rounded-lg bg-dark-700/70 border border-dark-500 space-y-3"
                            >
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div>
                                  <label className="block text-xs text-gray-400 mb-1">
                                    id *
                                  </label>
                                  <input
                                    type="text"
                                    value={agent.id}
                                    onChange={(e) =>
                                      handleAgentFieldChange(
                                        index,
                                        "id",
                                        e.target.value
                                      )
                                    }
                                    placeholder="例如：assistant"
                                    className="input-base text-sm"
                                  />
                                </div>

                                <div>
                                  <label className="block text-xs text-gray-400 mb-1">
                                    name
                                  </label>
                                  <input
                                    type="text"
                                    value={agent.name}
                                    onChange={(e) =>
                                      handleAgentFieldChange(
                                        index,
                                        "name",
                                        e.target.value
                                      )
                                    }
                                    placeholder="可选显示名称"
                                    className="input-base text-sm"
                                  />
                                </div>

                                <div>
                                  <label className="block text-xs text-gray-400 mb-1">
                                    workspace
                                  </label>
                                  <input
                                    type="text"
                                    value={agent.workspace}
                                    onChange={(e) =>
                                      handleAgentFieldChange(
                                        index,
                                        "workspace",
                                        e.target.value
                                      )
                                    }
                                    placeholder="可选工作目录"
                                    className="input-base text-sm"
                                  />
                                </div>

                                <div className="flex items-end justify-between gap-3">
                                  <label className="inline-flex items-center gap-2 text-sm text-gray-300 py-2">
                                    <input
                                      type="checkbox"
                                      checked={agent.default}
                                      onChange={(e) =>
                                        handleAgentFieldChange(
                                          index,
                                          "default",
                                          e.target.checked
                                        )
                                      }
                                      className="h-4 w-4 rounded border-dark-400 bg-dark-600 text-cyan-500 focus:ring-cyan-500"
                                    />
                                    default
                                  </label>

                                  <button
                                    type="button"
                                    onClick={() => handleDeleteAgent(index)}
                                    className="px-3 py-2.5 min-h-[40px] rounded-lg bg-red-900/30 hover:bg-red-800/40 text-red-300 text-sm transition-colors"
                                  >
                                    删除
                                  </button>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="rounded-xl border border-dark-500 bg-dark-600 p-4 space-y-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <Link2 size={16} className="text-cyan-400" />
                          <h4 className="text-sm font-semibold text-white">
                            Binding 路由规则
                          </h4>
                        </div>
                        <button
                          type="button"
                          onClick={handleAddBinding}
                          className="px-3 py-2.5 min-h-[40px] rounded-lg bg-dark-500 hover:bg-dark-400 text-sm text-white transition-colors flex items-center gap-2"
                        >
                          <Plus size={16} />
                          新增规则
                        </button>
                      </div>

                      <p className="text-xs text-gray-500">
                        字段：channel、accountId、agentId。要求 channel +
                        accountId 唯一，且 agentId 必须存在于 agents.list。
                      </p>

                      {visualBindings.length === 0 ? (
                        <div className="text-xs text-gray-500 p-3 rounded-lg bg-dark-700/60 border border-dashed border-dark-500">
                          暂无 Binding 路由规则，请先新增。
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {visualBindings.map((binding, index) => {
                            const channelSelectOptions =
                              binding.channel &&
                              !channelOptions.includes(binding.channel)
                                ? [binding.channel, ...channelOptions]
                                : channelOptions;

                            const accountOptions = getAccountOptions(
                              binding.channel,
                              binding.accountId
                            );

                            const agentSelectOptions =
                              binding.agentId &&
                              !agentIdOptions.includes(binding.agentId)
                                ? [binding.agentId, ...agentIdOptions]
                                : agentIdOptions;

                            return (
                              <div
                                key={`binding-${index}`}
                                className="p-3 rounded-lg bg-dark-700/70 border border-dark-500"
                              >
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
                                  <div>
                                    <label className="block text-xs text-gray-400 mb-1">
                                      channel
                                    </label>
                                    <select
                                      value={binding.channel}
                                      onChange={(e) =>
                                        handleBindingFieldChange(
                                          index,
                                          "channel",
                                          e.target.value
                                        )
                                      }
                                      className="input-base text-sm"
                                    >
                                      <option value="">请选择渠道</option>
                                      {channelSelectOptions.map((channelId) => (
                                        <option
                                          key={channelId}
                                          value={channelId}
                                        >
                                          {channelId}
                                        </option>
                                      ))}
                                    </select>
                                  </div>

                                  <div>
                                    <label className="block text-xs text-gray-400 mb-1">
                                      accountId
                                    </label>
                                    {accountOptions.length > 0 ? (
                                      <select
                                        value={binding.accountId}
                                        onChange={(e) =>
                                          handleBindingFieldChange(
                                            index,
                                            "accountId",
                                            e.target.value
                                          )
                                        }
                                        className="input-base text-sm"
                                      >
                                        <option value="">请选择账号</option>
                                        {accountOptions.map((accountId) => (
                                          <option
                                            key={accountId}
                                            value={accountId}
                                          >
                                            {accountId}
                                          </option>
                                        ))}
                                      </select>
                                    ) : (
                                      <input
                                        type="text"
                                        value={binding.accountId}
                                        onChange={(e) =>
                                          handleBindingFieldChange(
                                            index,
                                            "accountId",
                                            e.target.value
                                          )
                                        }
                                        placeholder="手动输入 accountId"
                                        className="input-base text-sm"
                                      />
                                    )}
                                  </div>

                                  <div>
                                    <label className="block text-xs text-gray-400 mb-1">
                                      agentId
                                    </label>
                                    <select
                                      value={binding.agentId}
                                      onChange={(e) =>
                                        handleBindingFieldChange(
                                          index,
                                          "agentId",
                                          e.target.value
                                        )
                                      }
                                      className="input-base text-sm"
                                    >
                                      <option value="">请选择 Agent</option>
                                      {agentSelectOptions.map((agentId) => (
                                        <option key={agentId} value={agentId}>
                                          {agentId}
                                        </option>
                                      ))}
                                    </select>
                                  </div>

                                  <button
                                    type="button"
                                    onClick={() => handleDeleteBinding(index)}
                                    className="px-3 py-2.5 min-h-[40px] rounded-lg bg-red-900/30 hover:bg-red-800/40 text-red-300 text-sm transition-colors"
                                  >
                                    删除
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm text-gray-400 mb-2">
                        agents.list (JSON)
                      </label>
                      <textarea
                        value={agentsListText}
                        onChange={(e) => setAgentsListText(e.target.value)}
                        rows={8}
                        className="input-base font-mono text-xs"
                      />
                    </div>

                    <div>
                      <label className="block text-sm text-gray-400 mb-2">
                        bindings (JSON)
                      </label>
                      <textarea
                        value={bindingsText}
                        onChange={(e) => setBindingsText(e.target.value)}
                        rows={8}
                        className="input-base font-mono text-xs"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* 危险操作 */}
            <div className="bg-dark-700 rounded-2xl p-6 border border-red-900/30">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-red-500/20 flex items-center justify-center">
                  <AlertTriangle size={20} className="text-red-400" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-white">危险操作</h3>
                  <p className="text-xs text-gray-500">
                    以下操作不可撤销，请谨慎操作
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                <button
                  onClick={() => setShowUninstallConfirm(true)}
                  className="w-full flex items-center gap-3 p-4 bg-red-950/30 rounded-lg hover:bg-red-900/40 transition-colors text-left border border-red-900/30"
                >
                  <Trash2 size={18} className="text-red-400" />
                  <div className="flex-1">
                    <p className="text-sm text-red-300">卸载 OpenClaw</p>
                    <p className="text-xs text-red-400/70">
                      从系统中移除 OpenClaw CLI 工具
                    </p>
                  </div>
                </button>
              </div>
            </div>
          </>
        )}

        {/* 成功提示弹框 */}
        {showConfigSuccessModal && configSuccessMessage && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-dark-700 rounded-2xl p-6 border border-green-800 max-w-md w-full mx-4 shadow-2xl">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-green-500/20 flex items-center justify-center">
                  <Save size={20} className="text-green-300" />
                </div>
                <h3 className="text-lg font-semibold text-white">设置成功</h3>
              </div>

              <p className="text-sm text-green-300 whitespace-pre-wrap break-words">
                {configSuccessMessage}
              </p>

              <div className="mt-6 flex justify-end">
                <button
                  onClick={() => {
                    setShowConfigSuccessModal(false);
                    setConfigSuccessMessage(null);
                    setConfigMessage(null);
                  }}
                  className="px-4 py-2.5 bg-green-600 hover:bg-green-500 text-white rounded-lg transition-colors"
                >
                  确定
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 错误提示弹框 */}
        {showConfigErrorModal && configError && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-dark-700 rounded-2xl p-6 border border-red-800 max-w-md w-full mx-4 shadow-2xl">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-red-500/20 flex items-center justify-center">
                  <AlertTriangle size={20} className="text-red-400" />
                </div>
                <h3 className="text-lg font-semibold text-white">操作失败</h3>
              </div>

              <p className="text-sm text-red-300 whitespace-pre-wrap break-words">
                {configError}
              </p>

              <div className="mt-6 flex justify-end">
                <button
                  onClick={() => {
                    setShowConfigErrorModal(false);
                    setConfigError(null);
                  }}
                  className="px-4 py-2.5 bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors"
                >
                  确定
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 卸载确认对话框 */}
        {showUninstallConfirm && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-dark-700 rounded-2xl p-6 border border-dark-500 max-w-md w-full mx-4 shadow-2xl">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-red-500/20 flex items-center justify-center">
                    <AlertTriangle size={20} className="text-red-400" />
                  </div>
                  <h3 className="text-lg font-semibold text-white">确认卸载</h3>
                </div>
                <button
                  onClick={() => {
                    setShowUninstallConfirm(false);
                    setUninstallResult(null);
                  }}
                  className="text-gray-400 hover:text-white transition-colors"
                >
                  <X size={20} />
                </button>
              </div>

              {!uninstallResult ? (
                <>
                  <p className="text-gray-300 mb-4">
                    确定要卸载 OpenClaw 吗？此操作将：
                  </p>
                  <ul className="text-sm text-gray-400 mb-6 space-y-2">
                    <li className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 bg-red-400 rounded-full"></span>
                      停止正在运行的服务
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 bg-red-400 rounded-full"></span>
                      移除 OpenClaw CLI 工具
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 bg-yellow-400 rounded-full"></span>
                      配置文件将被保留在 ~/.openclaw
                    </li>
                  </ul>

                  <div className="flex gap-3">
                    <button
                      onClick={() => setShowUninstallConfirm(false)}
                      className="flex-1 px-4 py-2.5 bg-dark-600 hover:bg-dark-500 text-white rounded-lg transition-colors"
                    >
                      取消
                    </button>
                    <button
                      onClick={handleUninstall}
                      disabled={uninstalling}
                      className="flex-1 px-4 py-2.5 bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      {uninstalling ? (
                        <>
                          <Loader2 size={16} className="animate-spin" />
                          卸载中...
                        </>
                      ) : (
                        <>
                          <Trash2 size={16} />
                          确认卸载
                        </>
                      )}
                    </button>
                  </div>
                </>
              ) : (
                <div
                  className={`p-4 rounded-lg ${
                    uninstallResult.success
                      ? "bg-green-900/30 border border-green-800"
                      : "bg-red-900/30 border border-red-800"
                  }`}
                >
                  <p
                    className={`text-sm ${
                      uninstallResult.success
                        ? "text-green-300"
                        : "text-red-300"
                    }`}
                  >
                    {uninstallResult.message}
                  </p>
                  {uninstallResult.error && (
                    <p className="text-xs text-red-400 mt-2 font-mono">
                      {uninstallResult.error}
                    </p>
                  )}
                  {uninstallResult.success && (
                    <p className="text-xs text-gray-400 mt-3">
                      对话框将自动关闭...
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
