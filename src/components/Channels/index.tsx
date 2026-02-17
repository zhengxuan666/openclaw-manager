import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { invokeCommand as invoke } from "../../lib/invoke";
import {
  MessageCircle,
  Hash,
  Slack,
  MessagesSquare,
  MessageSquare,
  Check,
  X,
  Loader2,
  ChevronRight,
  ChevronDown,
  Apple,
  Bell,
  Eye,
  EyeOff,
  Play,
  QrCode,
  CheckCircle,
  XCircle,
  Download,
  Package,
  AlertTriangle,
  Trash2,
  Plus,
  Bot,
  Link2,
} from "lucide-react";
import clsx from "clsx";

interface FeishuPluginStatus {
  installed: boolean;
  version: string | null;
  plugin_name: string | null;
}

interface ChannelConfig {
  id: string;
  channel_type: string;
  enabled: boolean;
  config: Record<string, unknown>;
  /**
   * 多账号配置，key 为 accountId。
   * 兼容旧结构：无该字段时视为单账号模式。
   */
  accounts?: Record<string, Record<string, unknown>>;
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

interface TestResult {
  success: boolean;
  message: string;
  error: string | null;
}

// 渠道配置字段定义
interface ChannelField {
  key: string;
  label: string;
  type: "text" | "password" | "select";
  placeholder?: string;
  options?: { value: string; label: string }[];
  required?: boolean;
}

const channelInfo: Record<
  string,
  {
    name: string;
    icon: React.ReactNode;
    color: string;
    fields: ChannelField[];
    helpText?: string;
  }
> = {
  telegram: {
    name: "Telegram",
    icon: <MessageCircle size={20} />,
    color: "text-blue-400",
    fields: [
      {
        key: "botToken",
        label: "Bot Token",
        type: "password",
        placeholder: "从 @BotFather 获取",
        required: true,
      },
      {
        key: "userId",
        label: "User ID",
        type: "text",
        placeholder: "你的 Telegram User ID",
      },
      {
        key: "dmPolicy",
        label: "私聊策略",
        type: "select",
        options: [
          { value: "pairing", label: "配对模式" },
          { value: "open", label: "开放模式" },
          { value: "disabled", label: "禁用" },
        ],
      },
      {
        key: "groupPolicy",
        label: "群组策略",
        type: "select",
        options: [
          { value: "allowlist", label: "白名单" },
          { value: "open", label: "开放" },
          { value: "disabled", label: "禁用" },
        ],
      },
    ],
    helpText:
      "1. 搜索 @BotFather 发送 /newbot 获取 Token  2. 搜索 @userinfobot 获取 User ID",
  },
  discord: {
    name: "Discord",
    icon: <Hash size={20} />,
    color: "text-indigo-400",
    fields: [
      {
        key: "botToken",
        label: "Bot Token",
        type: "password",
        placeholder: "Discord Bot Token",
        required: true,
      },
      {
        key: "testChannelId",
        label: "测试 Channel ID",
        type: "text",
        placeholder: "用于发送测试消息的频道 ID (可选)",
      },
      {
        key: "dmPolicy",
        label: "私聊策略",
        type: "select",
        options: [
          { value: "pairing", label: "配对模式" },
          { value: "open", label: "开放模式" },
          { value: "disabled", label: "禁用" },
        ],
      },
    ],
    helpText:
      "从 Discord Developer Portal 获取，开启开发者模式可复制 Channel ID",
  },
  slack: {
    name: "Slack",
    icon: <Slack size={20} />,
    color: "text-purple-400",
    fields: [
      {
        key: "botToken",
        label: "Bot Token",
        type: "password",
        placeholder: "xoxb-...",
        required: true,
      },
      {
        key: "appToken",
        label: "App Token",
        type: "password",
        placeholder: "xapp-...",
      },
      {
        key: "testChannelId",
        label: "测试 Channel ID",
        type: "text",
        placeholder: "用于发送测试消息的频道 ID (可选)",
      },
    ],
    helpText: "从 Slack API 后台获取，Channel ID 可从频道详情复制",
  },
  feishu: {
    name: "飞书",
    icon: <MessagesSquare size={20} />,
    color: "text-blue-500",
    fields: [
      {
        key: "appId",
        label: "App ID",
        type: "text",
        placeholder: "飞书应用 App ID",
        required: true,
      },
      {
        key: "appSecret",
        label: "App Secret",
        type: "password",
        placeholder: "飞书应用 App Secret",
        required: true,
      },
      {
        key: "testChatId",
        label: "测试 Chat ID",
        type: "text",
        placeholder: "用于发送测试消息的群聊/用户 ID (可选)",
      },
      {
        key: "connectionMode",
        label: "连接模式",
        type: "select",
        options: [
          { value: "websocket", label: "WebSocket (推荐)" },
          { value: "webhook", label: "Webhook" },
        ],
      },
      {
        key: "domain",
        label: "部署区域",
        type: "select",
        options: [
          { value: "feishu", label: "国内 (feishu.cn)" },
          { value: "lark", label: "海外 (larksuite.com)" },
        ],
      },
      {
        key: "requireMention",
        label: "需要 @提及",
        type: "select",
        options: [
          { value: "true", label: "是" },
          { value: "false", label: "否" },
        ],
      },
    ],
    helpText: "从飞书开放平台获取凭证，Chat ID 可从群聊设置中获取",
  },
  imessage: {
    name: "iMessage",
    icon: <Apple size={20} />,
    color: "text-green-400",
    fields: [
      {
        key: "dmPolicy",
        label: "私聊策略",
        type: "select",
        options: [
          { value: "pairing", label: "配对模式" },
          { value: "open", label: "开放模式" },
          { value: "disabled", label: "禁用" },
        ],
      },
      {
        key: "groupPolicy",
        label: "群组策略",
        type: "select",
        options: [
          { value: "allowlist", label: "白名单" },
          { value: "open", label: "开放" },
          { value: "disabled", label: "禁用" },
        ],
      },
    ],
    helpText: "仅支持 macOS，需要授权消息访问权限",
  },
  whatsapp: {
    name: "WhatsApp",
    icon: <MessageCircle size={20} />,
    color: "text-green-500",
    fields: [
      {
        key: "dmPolicy",
        label: "私聊策略",
        type: "select",
        options: [
          { value: "pairing", label: "配对模式" },
          { value: "open", label: "开放模式" },
          { value: "disabled", label: "禁用" },
        ],
      },
      {
        key: "groupPolicy",
        label: "群组策略",
        type: "select",
        options: [
          { value: "allowlist", label: "白名单" },
          { value: "open", label: "开放" },
          { value: "disabled", label: "禁用" },
        ],
      },
    ],
    helpText:
      "需要扫描二维码登录，运行: openclaw channels login --channel whatsapp",
  },
  wechat: {
    name: "微信",
    icon: <MessageSquare size={20} />,
    color: "text-green-600",
    fields: [
      {
        key: "appId",
        label: "App ID",
        type: "text",
        placeholder: "微信开放平台 App ID",
      },
      {
        key: "appSecret",
        label: "App Secret",
        type: "password",
        placeholder: "微信开放平台 App Secret",
      },
    ],
    helpText: "微信公众号/企业微信配置",
  },
  dingtalk: {
    name: "钉钉",
    icon: <Bell size={20} />,
    color: "text-blue-600",
    fields: [
      {
        key: "appKey",
        label: "App Key",
        type: "text",
        placeholder: "钉钉应用 App Key",
      },
      {
        key: "appSecret",
        label: "App Secret",
        type: "password",
        placeholder: "钉钉应用 App Secret",
      },
    ],
    helpText: "从钉钉开放平台获取",
  },
};

const BINDING_KEY_SEPARATOR = "::";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function stringifyValue(value: unknown): string {
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return String(value ?? "");
}

function formFromConfig(
  config: Record<string, unknown>
): Record<string, string> {
  const form: Record<string, string> = {};
  Object.entries(config).forEach(([key, value]) => {
    form[key] = stringifyValue(value);
  });
  return form;
}

function configFromForm(form: Record<string, string>): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  Object.entries(form).forEach(([key, value]) => {
    if (value === "true") {
      config[key] = true;
    } else if (value === "false") {
      config[key] = false;
    } else if (value !== "") {
      config[key] = value;
    }
  });
  return config;
}

function normalizeAccounts(
  accounts: ChannelConfig["accounts"]
): Record<string, Record<string, unknown>> {
  if (!accounts || !isRecord(accounts)) {
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

function parseAgents(rawAgents: unknown): string[] {
  if (!Array.isArray(rawAgents)) {
    return [];
  }

  const parsed = rawAgents
    .map((item) => {
      if (typeof item === "string") {
        return item;
      }
      if (isRecord(item) && typeof item.id === "string") {
        return item.id;
      }
      return null;
    })
    .filter((item): item is string => Boolean(item));

  return Array.from(new Set(parsed));
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

export function Channels() {
  const [channels, setChannels] = useState<ChannelConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null);

  // 渠道默认配置（顶层字段）
  const [defaultConfigForm, setDefaultConfigForm] = useState<
    Record<string, string>
  >({});
  // accountId -> account config form
  const [accountForms, setAccountForms] = useState<
    Record<string, Record<string, string>>
  >({});
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(
    null
  );
  // 当前渠道下 accountId -> agentId
  const [accountBindings, setAccountBindings] = useState<
    Record<string, string>
  >({});

  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [loginLoading, setLoginLoading] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const [newAccountId, setNewAccountId] = useState("");

  const [availableAgents, setAvailableAgents] = useState<string[]>([]);
  const [bindingsRaw, setBindingsRaw] = useState<BindingsPayload>([]);
  const [allBindingsMap, setAllBindingsMap] = useState<Record<string, string>>(
    {}
  );

  // 飞书插件状态
  const [feishuPluginStatus, setFeishuPluginStatus] =
    useState<FeishuPluginStatus | null>(null);
  const [feishuPluginLoading, setFeishuPluginLoading] = useState(false);
  const [feishuPluginInstalling, setFeishuPluginInstalling] = useState(false);

  // 跟踪哪些密码字段显示明文
  const [visiblePasswords, setVisiblePasswords] = useState<Set<string>>(
    new Set()
  );
  const [mobileChannelListOpen, setMobileChannelListOpen] = useState(false);

  const togglePasswordVisibility = (fieldKey: string) => {
    setVisiblePasswords((prev) => {
      const next = new Set(prev);
      if (next.has(fieldKey)) {
        next.delete(fieldKey);
      } else {
        next.add(fieldKey);
      }
      return next;
    });
  };

  const checkFeishuPlugin = async () => {
    setFeishuPluginLoading(true);
    try {
      const status = await invoke<FeishuPluginStatus>("check_feishu_plugin");
      setFeishuPluginStatus(status);
    } catch (e) {
      console.error("检查飞书插件失败:", e);
      setFeishuPluginStatus({
        installed: false,
        version: null,
        plugin_name: null,
      });
    } finally {
      setFeishuPluginLoading(false);
    }
  };

  const handleInstallFeishuPlugin = async () => {
    setFeishuPluginInstalling(true);
    try {
      const result = await invoke<string>("install_feishu_plugin");
      alert(result);
      await checkFeishuPlugin();
    } catch (e) {
      alert("安装失败: " + e);
    } finally {
      setFeishuPluginInstalling(false);
    }
  };

  const getCurrentChannelBindings = (
    channelId: string,
    bindingsMap: Record<string, string>
  ): Record<string, string> => {
    const channelBindings: Record<string, string> = {};
    Object.entries(bindingsMap).forEach(([key, agentId]) => {
      const parsed = splitBindingKey(key);
      if (parsed && parsed.channel === channelId) {
        channelBindings[parsed.accountId] = agentId;
      }
    });
    return channelBindings;
  };

  const hydrateChannelEditor = (
    channelId: string,
    channelList?: ChannelConfig[],
    bindingsMap?: Record<string, string>
  ) => {
    setSelectedChannel(channelId);
    setMobileChannelListOpen(false);
    setTestResult(null);
    setShowClearConfirm(false);
    setNewAccountId("");

    const list = channelList || channels;
    const map = bindingsMap || allBindingsMap;
    const channel = list.find((c) => c.id === channelId);

    if (!channel) {
      setDefaultConfigForm({});
      setAccountForms({});
      setAccountBindings({});
      setSelectedAccountId(null);
      return;
    }

    setDefaultConfigForm(formFromConfig(channel.config));

    const normalizedAccounts = normalizeAccounts(channel.accounts);
    const accountFormMap: Record<string, Record<string, string>> = {};
    Object.entries(normalizedAccounts).forEach(([accountId, accountConfig]) => {
      accountFormMap[accountId] = formFromConfig(accountConfig);
    });

    const accountIds = Object.keys(accountFormMap);
    setAccountForms(accountFormMap);
    setSelectedAccountId(accountIds.length > 0 ? accountIds[0] : null);

    const channelBindings = getCurrentChannelBindings(channelId, map);

    // 若 bindings 缺失，回退使用 accounts.<id>.agentId，避免页面显示“未绑定”
    if (Object.keys(channelBindings).length === 0) {
      Object.entries(normalizedAccounts).forEach(
        ([accountId, accountConfig]) => {
          const fallbackAgentId = accountConfig.agentId;
          if (typeof fallbackAgentId === "string" && fallbackAgentId.trim()) {
            channelBindings[accountId] = fallbackAgentId;
          }
        }
      );
    }

    setAccountBindings(channelBindings);

    if (channel.channel_type === "feishu") {
      checkFeishuPlugin();
    }
  };

  const fetchAllData = async () => {
    try {
      // 渠道列表是核心数据，必须优先保证可展示；
      // bindings/agents 失败时降级为空，避免整个渠道页空白。
      const channelList = await invoke<ChannelConfig[]>("get_channels_config");

      const [bindingsResult, agentsResult] = await Promise.allSettled([
        invoke<BindingsPayload>("get_bindings"),
        invoke<unknown>("get_agents_list"),
      ]);

      const bindings: BindingsPayload =
        bindingsResult.status === "fulfilled" ? bindingsResult.value : [];
      const agentsList =
        agentsResult.status === "fulfilled" ? agentsResult.value : [];

      if (bindingsResult.status === "rejected") {
        console.warn("获取 bindings 失败，已降级为空:", bindingsResult.reason);
      }
      if (agentsResult.status === "rejected") {
        console.warn("获取 agents.list 失败，已降级为空:", agentsResult.reason);
      }

      const bindingMap = parseBindings(bindings);
      setChannels(channelList);
      setBindingsRaw(bindings);
      setAllBindingsMap(bindingMap);
      setAvailableAgents(parseAgents(agentsList));

      return { channelList, bindingMap, bindings };
    } catch (e) {
      console.error("获取渠道配置失败:", e);
      setChannels([]);
      setBindingsRaw([]);
      setAllBindingsMap({});
      setAvailableAgents([]);
      return {
        channelList: [],
        bindingMap: {},
        bindings: [] as BindingsPayload,
      };
    }
  };

  useEffect(() => {
    const init = async () => {
      try {
        const { channelList, bindingMap } = await fetchAllData();
        const configured = channelList.find((c) => c.enabled) ?? channelList[0];
        if (configured) {
          hydrateChannelEditor(configured.id, channelList, bindingMap);
        }
      } finally {
        setLoading(false);
      }
    };
    init();
  }, []);

  const handleDefaultFieldChange = (key: string, value: string) => {
    setDefaultConfigForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleAccountFieldChange = (
    accountId: string,
    key: string,
    value: string
  ) => {
    setAccountForms((prev) => ({
      ...prev,
      [accountId]: {
        ...(prev[accountId] || {}),
        [key]: value,
      },
    }));
  };

  const handleAddAccount = () => {
    const accountId = newAccountId.trim();
    if (!accountId) return;
    if (accountForms[accountId]) {
      alert(`账号 ${accountId} 已存在`);
      return;
    }

    setAccountForms((prev) => ({
      ...prev,
      [accountId]: {},
    }));
    setSelectedAccountId(accountId);
    setNewAccountId("");
  };

  const handleDeleteAccount = (accountId: string) => {
    const ok = confirm(`确认删除账号 ${accountId} 吗？`);
    if (!ok) return;

    setAccountForms((prev) => {
      const next = { ...prev };
      delete next[accountId];
      return next;
    });

    setAccountBindings((prev) => {
      const next = { ...prev };
      delete next[accountId];
      return next;
    });

    if (selectedAccountId === accountId) {
      const rest = Object.keys(accountForms).filter((id) => id !== accountId);
      setSelectedAccountId(rest.length > 0 ? rest[0] : null);
    }
  };

  const handleShowClearConfirm = () => {
    if (!selectedChannel) return;
    setShowClearConfirm(true);
  };

  const handleClearConfig = async () => {
    if (!selectedChannel) return;

    const channel = channels.find((c) => c.id === selectedChannel);
    const channelName = channel
      ? channelInfo[channel.channel_type]?.name || channel.channel_type
      : selectedChannel;

    setShowClearConfirm(false);
    setClearing(true);
    try {
      await invoke("clear_channel_config", { channelId: selectedChannel });

      const nextBindingsMap = { ...allBindingsMap };
      Object.keys(nextBindingsMap).forEach((key) => {
        const parsed = splitBindingKey(key);
        if (parsed?.channel === selectedChannel) {
          delete nextBindingsMap[key];
        }
      });
      const nextBindingsPayload = buildBindingsPayload(
        bindingsRaw,
        nextBindingsMap
      );
      await invoke("save_bindings", { bindings: nextBindingsPayload });

      setBindingsRaw(nextBindingsPayload);
      setAllBindingsMap(nextBindingsMap);

      const { channelList, bindingMap } = await fetchAllData();
      if (channelList.length > 0) {
        const next =
          channelList.find((c) => c.id === selectedChannel) ?? channelList[0];
        hydrateChannelEditor(next.id, channelList, bindingMap);
      } else {
        setSelectedChannel(null);
      }

      setTestResult({
        success: true,
        message: `${channelName} 配置已清空`,
        error: null,
      });
    } catch (e) {
      setTestResult({
        success: false,
        message: "清空失败",
        error: String(e),
      });
    } finally {
      setClearing(false);
    }
  };

  const handleQuickTest = async () => {
    if (!selectedChannel) return;

    setTesting(true);
    setTestResult(null);

    try {
      const result = await invoke<{
        success: boolean;
        channel: string;
        message: string;
        error: string | null;
      }>("test_channel", { channelType: selectedChannel });

      setTestResult({
        success: result.success,
        message: result.message,
        error: result.error,
      });
    } catch (e) {
      setTestResult({
        success: false,
        message: "测试失败",
        error: String(e),
      });
    } finally {
      setTesting(false);
    }
  };

  const handleWhatsAppLogin = async () => {
    setLoginLoading(true);
    try {
      await invoke("start_channel_login", { channelType: "whatsapp" });

      const pollInterval = setInterval(async () => {
        try {
          const result = await invoke<{ success: boolean; message: string }>(
            "test_channel",
            {
              channelType: "whatsapp",
            }
          );

          if (result.success) {
            clearInterval(pollInterval);
            setLoginLoading(false);
            const { channelList, bindingMap } = await fetchAllData();
            if (selectedChannel) {
              hydrateChannelEditor(selectedChannel, channelList, bindingMap);
            }
            setTestResult({
              success: true,
              message: "WhatsApp 登录成功！",
              error: null,
            });
          }
        } catch {
          // 继续轮询
        }
      }, 3000);

      setTimeout(() => {
        clearInterval(pollInterval);
        setLoginLoading(false);
      }, 60000);

      alert(
        "请在弹出的终端窗口中扫描二维码完成登录\n\n登录成功后界面会自动更新"
      );
    } catch (e) {
      alert("启动登录失败: " + e);
      setLoginLoading(false);
    }
  };

  const handleSave = async () => {
    if (!selectedChannel) return;

    const channel = channels.find((c) => c.id === selectedChannel);
    if (!channel) return;

    setSaving(true);
    try {
      const config = configFromForm(defaultConfigForm);
      const accountConfigPayload: Record<string, Record<string, unknown>> = {};

      Object.entries(accountForms).forEach(([accountId, form]) => {
        accountConfigPayload[accountId] = configFromForm(form);
      });

      await invoke("save_channel_config", {
        channel: {
          ...channel,
          config,
          accounts: accountConfigPayload,
        },
      });

      const nextBindingsMap = { ...allBindingsMap };
      Object.keys(nextBindingsMap).forEach((key) => {
        const parsed = splitBindingKey(key);
        if (parsed?.channel === selectedChannel) {
          delete nextBindingsMap[key];
        }
      });

      Object.entries(accountBindings).forEach(([accountId, agentId]) => {
        const trimmedAgentId = agentId.trim();
        if (!trimmedAgentId) return;
        if (!accountForms[accountId]) return;
        nextBindingsMap[buildBindingKey(selectedChannel, accountId)] =
          trimmedAgentId;
      });

      const nextBindingsPayload = buildBindingsPayload(
        bindingsRaw,
        nextBindingsMap
      );
      await invoke("save_bindings", {
        bindings: nextBindingsPayload,
      });

      setBindingsRaw(nextBindingsPayload);
      setAllBindingsMap(nextBindingsMap);

      const { channelList, bindingMap } = await fetchAllData();
      hydrateChannelEditor(selectedChannel, channelList, bindingMap);

      alert("渠道配置与账号绑定已保存！");
    } catch (e) {
      console.error("保存失败:", e);
      alert("保存失败: " + e);
    } finally {
      setSaving(false);
    }
  };

  const currentChannel = channels.find((c) => c.id === selectedChannel);
  const currentInfo = currentChannel
    ? channelInfo[currentChannel.channel_type]
    : null;

  const accountIds = useMemo(() => Object.keys(accountForms), [accountForms]);
  const selectedAccountForm = selectedAccountId
    ? accountForms[selectedAccountId] || {}
    : {};
  const supportsMultiAccountManage =
    currentChannel?.channel_type === "telegram";

  const hasValidConfig = (channel: ChannelConfig) => {
    const info = channelInfo[channel.channel_type];
    if (!info) return channel.enabled;

    const requiredFields = info.fields.filter((f) => f.required);
    if (requiredFields.length === 0) return channel.enabled;

    const topLevelOk = requiredFields.some((field) => {
      const value = channel.config[field.key];
      return value !== undefined && value !== null && value !== "";
    });

    const accounts = normalizeAccounts(channel.accounts);
    const accountOk = Object.values(accounts).some((account) =>
      requiredFields.some((field) => {
        const value = account[field.key];
        return value !== undefined && value !== null && value !== "";
      })
    );

    return topLevelOk || accountOk || channel.enabled;
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-claw-500" />
      </div>
    );
  }

  return (
    <div className="module-page-shell">
      <div className="max-w-6xl min-w-0">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3 md:gap-6">
          {/* 渠道列表（移动端可折叠，避免挤压主内容） */}
          <div className="order-1 space-y-2 md:order-1 md:col-span-1">
            <div className="mb-2 flex items-center justify-between md:mb-3">
              <h3 className="px-1 text-sm font-medium text-gray-400">
                消息渠道
              </h3>
              <button
                type="button"
                onClick={() => setMobileChannelListOpen((prev) => !prev)}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-dark-500 bg-dark-700 px-3 text-xs text-gray-300 transition-colors hover:border-dark-400 hover:text-white md:hidden"
              >
                <span className="max-w-[9rem] truncate">
                  {currentInfo ? `当前：${currentInfo.name}` : "切换渠道"}
                </span>
                <ChevronDown
                  size={14}
                  className={clsx(
                    "transition-transform",
                    mobileChannelListOpen ? "rotate-180" : "rotate-0"
                  )}
                />
              </button>
            </div>

            <div
              className={clsx(
                "space-y-2",
                mobileChannelListOpen ? "block" : "hidden md:block"
              )}
            >
              {channels.map((channel) => {
                const info = channelInfo[channel.channel_type] || {
                  name: channel.channel_type,
                  icon: <MessageSquare size={20} />,
                  color: "text-gray-400",
                  fields: [],
                };
                const isSelected = selectedChannel === channel.id;
                const isConfigured = hasValidConfig(channel);

                return (
                  <button
                    key={channel.id}
                    onClick={() => hydrateChannelEditor(channel.id)}
                    className={clsx(
                      "flex min-h-[44px] w-full min-w-0 items-center gap-3 rounded-xl border p-3 transition-all sm:p-4",
                      isSelected
                        ? "border-claw-500 bg-dark-600"
                        : "border-dark-500 bg-dark-700 hover:border-dark-400"
                    )}
                  >
                    <div
                      className={clsx(
                        "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
                        isConfigured ? "bg-dark-500" : "bg-dark-600"
                      )}
                    >
                      <span className={info.color}>{info.icon}</span>
                    </div>
                    <div className="min-w-0 flex-1 text-left">
                      <p
                        className={clsx(
                          "truncate text-sm font-medium",
                          isSelected ? "text-white" : "text-gray-300"
                        )}
                      >
                        {info.name}
                      </p>
                      <div className="mt-1 flex items-center gap-2">
                        {isConfigured ? (
                          <>
                            <Check size={12} className="text-green-400" />
                            <span className="text-xs text-green-400">
                              已配置
                            </span>
                          </>
                        ) : (
                          <>
                            <X size={12} className="text-gray-500" />
                            <span className="text-xs text-gray-500">
                              未配置
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                    <ChevronRight
                      size={16}
                      className={isSelected ? "text-claw-400" : "text-gray-600"}
                    />
                  </button>
                );
              })}
            </div>
          </div>

          {/* 配置面板 */}
          <div className="order-2 min-w-0 md:order-2 md:col-span-2">
            {currentChannel && currentInfo ? (
              <motion.div
                key={selectedChannel}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                className="space-y-6 rounded-2xl border border-dark-500 bg-dark-700 p-4 sm:p-6"
              >
                <div className="flex items-center gap-2">
                  <div
                    className={clsx(
                      "w-10 h-10 rounded-lg flex items-center justify-center bg-dark-500",
                      currentInfo.color
                    )}
                  >
                    {currentInfo.icon}
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-white">
                      配置 {currentInfo.name}
                    </h3>
                    {currentInfo.helpText && (
                      <p className="text-xs text-gray-500 break-words">
                        {currentInfo.helpText}
                      </p>
                    )}
                  </div>
                </div>

                {/* 飞书插件状态提示 */}
                {currentChannel.channel_type === "feishu" && (
                  <div>
                    {feishuPluginLoading ? (
                      <div className="p-4 bg-dark-600 rounded-xl border border-dark-500 flex items-center gap-3">
                        <Loader2
                          size={20}
                          className="animate-spin text-gray-400"
                        />
                        <span className="text-gray-400">
                          正在检查飞书插件状态...
                        </span>
                      </div>
                    ) : feishuPluginStatus?.installed ? (
                      <div className="p-4 bg-green-500/10 rounded-xl border border-green-500/30 flex items-center gap-3">
                        <Package size={20} className="text-green-400" />
                        <div className="flex-1">
                          <p className="text-green-400 font-medium">
                            飞书插件已安装
                          </p>
                          <p className="text-xs text-gray-400 mt-0.5">
                            {feishuPluginStatus.plugin_name ||
                              "@m1heng-clawd/feishu"}
                            {feishuPluginStatus.version &&
                              ` v${feishuPluginStatus.version}`}
                          </p>
                        </div>
                        <CheckCircle size={16} className="text-green-400" />
                      </div>
                    ) : (
                      <div className="p-4 bg-amber-500/10 rounded-xl border border-amber-500/30">
                        <div className="flex items-start gap-3">
                          <AlertTriangle
                            size={20}
                            className="text-amber-400 mt-0.5"
                          />
                          <div className="flex-1">
                            <p className="text-amber-400 font-medium">
                              需要安装飞书插件
                            </p>
                            <p className="text-xs text-gray-400 mt-1">
                              飞书渠道需要先安装 @m1heng-clawd/feishu
                              插件才能使用。
                            </p>
                            <div className="mt-3 flex flex-wrap gap-2">
                              <button
                                onClick={handleInstallFeishuPlugin}
                                disabled={feishuPluginInstalling}
                                className="btn-primary flex items-center gap-2 text-sm py-2"
                              >
                                {feishuPluginInstalling ? (
                                  <Loader2 size={14} className="animate-spin" />
                                ) : (
                                  <Download size={14} />
                                )}
                                {feishuPluginInstalling
                                  ? "安装中..."
                                  : "一键安装插件"}
                              </button>
                              <button
                                onClick={checkFeishuPlugin}
                                disabled={feishuPluginLoading}
                                className="btn-secondary flex items-center gap-2 text-sm py-2"
                              >
                                刷新状态
                              </button>
                            </div>
                            <p className="text-xs text-gray-500 mt-2">
                              或手动执行:{" "}
                              <code className="break-all rounded bg-dark-600 px-1.5 py-0.5 text-gray-400">
                                openclaw plugins install @m1heng-clawd/feishu
                              </code>
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* 三层结构：渠道默认配置 */}
                <section className="space-y-3">
                  <h4 className="text-sm font-semibold text-gray-300">
                    1) 渠道默认配置
                  </h4>
                  <div className="grid grid-cols-1 gap-4">
                    {currentInfo.fields.map((field) => {
                      const visibilityKey = `default:${field.key}`;
                      return (
                        <div key={`default-${field.key}`}>
                          <label className="block text-sm text-gray-400 mb-2">
                            {field.label}
                            {field.required && (
                              <span className="text-red-400 ml-1">*</span>
                            )}
                            {defaultConfigForm[field.key] && (
                              <span className="ml-2 text-green-500 text-xs">
                                ✓
                              </span>
                            )}
                          </label>

                          {field.type === "select" ? (
                            <select
                              value={defaultConfigForm[field.key] || ""}
                              onChange={(e) =>
                                handleDefaultFieldChange(
                                  field.key,
                                  e.target.value
                                )
                              }
                              className="input-base"
                            >
                              <option value="">请选择...</option>
                              {field.options?.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                          ) : field.type === "password" ? (
                            <div className="relative">
                              <input
                                type={
                                  visiblePasswords.has(visibilityKey)
                                    ? "text"
                                    : "password"
                                }
                                value={defaultConfigForm[field.key] || ""}
                                onChange={(e) =>
                                  handleDefaultFieldChange(
                                    field.key,
                                    e.target.value
                                  )
                                }
                                placeholder={field.placeholder}
                                className="input-base pr-10"
                              />
                              <button
                                type="button"
                                onClick={() =>
                                  togglePasswordVisibility(visibilityKey)
                                }
                                className="absolute right-1 top-1/2 inline-flex min-h-[44px] min-w-[44px] -translate-y-1/2 items-center justify-center text-gray-500 transition-colors hover:text-white"
                                title={
                                  visiblePasswords.has(visibilityKey)
                                    ? "隐藏"
                                    : "显示"
                                }
                              >
                                {visiblePasswords.has(visibilityKey) ? (
                                  <EyeOff size={18} />
                                ) : (
                                  <Eye size={18} />
                                )}
                              </button>
                            </div>
                          ) : (
                            <input
                              type={field.type}
                              value={defaultConfigForm[field.key] || ""}
                              onChange={(e) =>
                                handleDefaultFieldChange(
                                  field.key,
                                  e.target.value
                                )
                              }
                              placeholder={field.placeholder}
                              className="input-base"
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* WhatsApp 特殊处理：扫码登录按钮 */}
                  {currentChannel.channel_type === "whatsapp" && (
                    <div className="p-4 bg-green-500/10 rounded-xl border border-green-500/30">
                      <div className="flex items-center gap-3 mb-3">
                        <QrCode size={24} className="text-green-400" />
                        <div>
                          <p className="text-white font-medium">扫码登录</p>
                          <p className="text-xs text-gray-400">
                            WhatsApp 需要扫描二维码登录
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <button
                          onClick={handleWhatsAppLogin}
                          disabled={loginLoading}
                          className="btn-secondary flex min-h-[44px] w-full items-center justify-center gap-2 sm:flex-1"
                        >
                          {loginLoading ? (
                            <Loader2 size={16} className="animate-spin" />
                          ) : (
                            <QrCode size={16} />
                          )}
                          {loginLoading ? "等待登录..." : "启动扫码登录"}
                        </button>
                        <button
                          onClick={handleQuickTest}
                          disabled={testing}
                          className="btn-secondary inline-flex min-h-[44px] w-full items-center justify-center gap-2 px-4 sm:w-auto"
                          title="刷新状态"
                        >
                          {testing ? (
                            <Loader2 size={16} className="animate-spin" />
                          ) : (
                            <Check size={16} />
                          )}
                        </button>
                      </div>
                    </div>
                  )}
                </section>

                {/* 三层结构：accounts 列表 */}
                <section className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold text-gray-300">
                      2) Accounts 列表
                    </h4>
                    <span className="text-xs text-gray-500">
                      共 {accountIds.length} 个账号
                    </span>
                  </div>

                  {supportsMultiAccountManage ? (
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <input
                        value={newAccountId}
                        onChange={(e) => setNewAccountId(e.target.value)}
                        placeholder="新增 accountId，例如 default / work / research"
                        className="input-base"
                      />
                      <button
                        onClick={handleAddAccount}
                        className="btn-secondary inline-flex w-full items-center justify-center gap-1 px-3 sm:w-auto"
                      >
                        <Plus size={14} />
                        新增
                      </button>
                    </div>
                  ) : (
                    <p className="text-xs text-gray-500">
                      当前仅 Telegram
                      优先支持新增/删除账号；其它渠道保持向后兼容并可编辑已有账号。
                    </p>
                  )}

                  <div className="space-y-2">
                    {accountIds.length === 0 ? (
                      <div className="text-sm text-gray-500 bg-dark-800/60 border border-dark-500 rounded-lg p-3">
                        暂无账号。
                        {supportsMultiAccountManage
                          ? "请先新增 account。"
                          : "当前渠道无 account 配置。"}
                      </div>
                    ) : (
                      accountIds.map((accountId) => {
                        const selected = selectedAccountId === accountId;
                        const boundAgentId = accountBindings[accountId];
                        return (
                          <div
                            key={accountId}
                            className={clsx(
                              "flex items-center gap-3 rounded-lg border p-3",
                              selected
                                ? "bg-dark-600 border-claw-500/60"
                                : "bg-dark-800/70 border-dark-500"
                            )}
                          >
                            <button
                              className="flex min-h-[44px] min-w-0 flex-1 items-center gap-3 text-left"
                              onClick={() => setSelectedAccountId(accountId)}
                            >
                              <Bot
                                size={16}
                                className={
                                  selected ? "text-claw-300" : "text-gray-500"
                                }
                              />
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm text-white">
                                  {accountId}
                                </p>
                                <p className="flex items-center gap-1 truncate text-xs text-gray-500">
                                  <Link2 size={12} />
                                  绑定 Agent：{boundAgentId || "未绑定"}
                                </p>
                              </div>
                            </button>

                            {supportsMultiAccountManage && (
                              <button
                                onClick={() => handleDeleteAccount(accountId)}
                                className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg p-1 text-red-400 transition-colors hover:bg-red-500/10 hover:text-red-300"
                                title="删除账号"
                              >
                                <Trash2 size={15} />
                              </button>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </section>

                {/* 三层结构：account 详情编辑 + 绑定编辑 */}
                <section className="space-y-3">
                  <h4 className="text-sm font-semibold text-gray-300">
                    3) Account 详情编辑
                  </h4>

                  {selectedAccountId ? (
                    <div className="space-y-4 rounded-xl border border-dark-500 bg-dark-800/40 p-4">
                      <div className="flex items-center justify-between">
                        <p className="text-sm text-white">
                          当前账号：
                          <span className="text-claw-300">
                            {selectedAccountId}
                          </span>
                        </p>
                      </div>

                      <div>
                        <label className="block text-sm text-gray-400 mb-2">
                          绑定 Agent ID
                        </label>
                        <input
                          list="agent-id-options"
                          value={accountBindings[selectedAccountId] || ""}
                          onChange={(e) =>
                            setAccountBindings((prev) => ({
                              ...prev,
                              [selectedAccountId]: e.target.value,
                            }))
                          }
                          placeholder="选择或输入 agentId（可留空）"
                          className="input-base"
                        />
                        <datalist id="agent-id-options">
                          {availableAgents.map((agentId) => (
                            <option key={agentId} value={agentId} />
                          ))}
                        </datalist>
                        <p className="mt-1 break-all text-xs text-gray-500">
                          会写回 bindings：{currentChannel.id}/
                          {selectedAccountId} → agentId
                        </p>
                      </div>

                      {currentInfo.fields.map((field) => {
                        const visibilityKey = `account:${selectedAccountId}:${field.key}`;
                        return (
                          <div
                            key={`account-${selectedAccountId}-${field.key}`}
                          >
                            <label className="block text-sm text-gray-400 mb-2">
                              {field.label}
                              {field.required && (
                                <span className="text-red-400 ml-1">*</span>
                              )}
                              {selectedAccountForm[field.key] && (
                                <span className="ml-2 text-green-500 text-xs">
                                  ✓
                                </span>
                              )}
                            </label>

                            {field.type === "select" ? (
                              <select
                                value={selectedAccountForm[field.key] || ""}
                                onChange={(e) =>
                                  handleAccountFieldChange(
                                    selectedAccountId,
                                    field.key,
                                    e.target.value
                                  )
                                }
                                className="input-base"
                              >
                                <option value="">请选择...</option>
                                {field.options?.map((opt) => (
                                  <option key={opt.value} value={opt.value}>
                                    {opt.label}
                                  </option>
                                ))}
                              </select>
                            ) : field.type === "password" ? (
                              <div className="relative">
                                <input
                                  type={
                                    visiblePasswords.has(visibilityKey)
                                      ? "text"
                                      : "password"
                                  }
                                  value={selectedAccountForm[field.key] || ""}
                                  onChange={(e) =>
                                    handleAccountFieldChange(
                                      selectedAccountId,
                                      field.key,
                                      e.target.value
                                    )
                                  }
                                  placeholder={field.placeholder}
                                  className="input-base pr-10"
                                />
                                <button
                                  type="button"
                                  onClick={() =>
                                    togglePasswordVisibility(visibilityKey)
                                  }
                                  className="absolute right-1 top-1/2 inline-flex min-h-[44px] min-w-[44px] -translate-y-1/2 items-center justify-center text-gray-500 transition-colors hover:text-white"
                                  title={
                                    visiblePasswords.has(visibilityKey)
                                      ? "隐藏"
                                      : "显示"
                                  }
                                >
                                  {visiblePasswords.has(visibilityKey) ? (
                                    <EyeOff size={18} />
                                  ) : (
                                    <Eye size={18} />
                                  )}
                                </button>
                              </div>
                            ) : (
                              <input
                                type={field.type}
                                value={selectedAccountForm[field.key] || ""}
                                onChange={(e) =>
                                  handleAccountFieldChange(
                                    selectedAccountId,
                                    field.key,
                                    e.target.value
                                  )
                                }
                                placeholder={field.placeholder}
                                className="input-base"
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-sm text-gray-500 bg-dark-800/60 border border-dark-500 rounded-lg p-3">
                      请选择一个 account 进行详情编辑。
                    </div>
                  )}
                </section>

                {/* 操作按钮 */}
                <div className="flex flex-wrap items-center gap-3 border-t border-dark-500 pt-4">
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="btn-primary inline-flex min-h-[44px] w-full items-center justify-center gap-2 sm:w-auto"
                  >
                    {saving ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      <Check size={16} />
                    )}
                    保存配置
                  </button>

                  <button
                    onClick={handleQuickTest}
                    disabled={testing}
                    className="btn-secondary inline-flex min-h-[44px] w-full items-center justify-center gap-2 sm:w-auto"
                  >
                    {testing ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      <Play size={16} />
                    )}
                    快速测试
                  </button>

                  {!showClearConfirm ? (
                    <button
                      onClick={handleShowClearConfirm}
                      disabled={clearing}
                      className="btn-secondary inline-flex min-h-[44px] w-full items-center justify-center gap-2 text-red-400 hover:border-red-500/50 hover:text-red-300 sm:w-auto"
                    >
                      {clearing ? (
                        <Loader2 size={16} className="animate-spin" />
                      ) : (
                        <Trash2 size={16} />
                      )}
                      清空配置
                    </button>
                  ) : (
                    <div className="flex w-full flex-wrap items-center gap-2 rounded-lg border border-red-500/50 bg-red-500/20 px-3 py-1.5 sm:w-auto">
                      <span className="text-sm text-red-300">确定清空？</span>
                      <button
                        onClick={handleClearConfig}
                        className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded bg-red-500 px-3 py-1 text-xs text-white transition-colors hover:bg-red-600 sm:flex-none"
                      >
                        确定
                      </button>
                      <button
                        onClick={() => setShowClearConfirm(false)}
                        className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded bg-dark-600 px-3 py-1 text-xs text-gray-300 transition-colors hover:bg-dark-500 sm:flex-none"
                      >
                        取消
                      </button>
                    </div>
                  )}
                </div>

                {/* 测试结果显示 */}
                {testResult && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={clsx(
                      "mt-2 p-4 rounded-xl flex items-start gap-3",
                      testResult.success ? "bg-green-500/10" : "bg-red-500/10"
                    )}
                  >
                    {testResult.success ? (
                      <CheckCircle
                        size={20}
                        className="text-green-400 mt-0.5"
                      />
                    ) : (
                      <XCircle size={20} className="text-red-400 mt-0.5" />
                    )}
                    <div className="flex-1">
                      <p
                        className={clsx(
                          "font-medium",
                          testResult.success ? "text-green-400" : "text-red-400"
                        )}
                      >
                        {testResult.success ? "测试成功" : "测试失败"}
                      </p>
                      <p className="text-sm text-gray-400 mt-1">
                        {testResult.message}
                      </p>
                      {testResult.error && (
                        <p className="text-xs text-red-300 mt-2 whitespace-pre-wrap">
                          {testResult.error}
                        </p>
                      )}
                    </div>
                  </motion.div>
                )}
              </motion.div>
            ) : (
              <div className="h-full flex items-center justify-center text-gray-500">
                <p>选择左侧渠道进行配置</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
