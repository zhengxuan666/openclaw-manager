import { useEffect, useMemo, useState } from "react";
import { invokeCommand as invoke } from "../../lib/invoke";
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
} from "lucide-react";

interface InstallResult {
  success: boolean;
  message: string;
  error?: string;
}

interface SettingsProps {
  onEnvironmentChange?: () => void;
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

const BINDING_KEY_SEPARATOR = "::";

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

function validateVisualConfig(
  agents: VisualAgent[],
  bindings: VisualBinding[]
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

  return null;
}

export function Settings({ onEnvironmentChange }: SettingsProps) {
  const [identity, setIdentity] = useState({
    botName: "Clawd",
    userName: "主人",
    timezone: "Asia/Shanghai",
  });
  const [saving, setSaving] = useState(false);
  const [showUninstallConfirm, setShowUninstallConfirm] = useState(false);
  const [uninstalling, setUninstalling] = useState(false);
  const [uninstallResult, setUninstallResult] = useState<InstallResult | null>(
    null
  );

  const [agentsListText, setAgentsListText] = useState("[]");
  const [bindingsText, setBindingsText] = useState("[]");
  const [configLoading, setConfigLoading] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const [configMessage, setConfigMessage] = useState<string | null>(null);
  const [expertMode, setExpertMode] = useState(false);

  const [visualAgents, setVisualAgents] = useState<VisualAgent[]>([]);
  const [visualBindings, setVisualBindings] = useState<VisualBinding[]>([]);
  const [bindingsRaw, setBindingsRaw] = useState<unknown>([]);
  const [channelsConfig, setChannelsConfig] = useState<ChannelConfig[]>([]);

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

  const handleSave = async () => {
    setSaving(true);
    try {
      // TODO: 保存身份配置
      await new Promise((resolve) => setTimeout(resolve, 500));
      alert("设置已保存！");
    } catch (e) {
      console.error("保存失败:", e);
    } finally {
      setSaving(false);
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
    const loadAgentAndBindingConfig = async () => {
      setConfigLoading(true);
      setConfigError(null);

      try {
        const [agentsResult, bindingsResult, channelsResult] =
          await Promise.allSettled([
            invoke<unknown>("get_agents_list"),
            invoke<unknown>("get_bindings"),
            invoke<ChannelConfig[]>("get_channels_config"),
          ]);

        const warnings: string[] = [];

        const agentsList =
          agentsResult.status === "fulfilled" ? agentsResult.value : [];
        if (agentsResult.status === "rejected") {
          console.warn(
            "获取 agents.list 失败，已降级为空:",
            agentsResult.reason
          );
          warnings.push("获取 agents.list 失败，已降级为空");
        }

        const loadedBindings =
          bindingsResult.status === "fulfilled" ? bindingsResult.value : [];
        if (bindingsResult.status === "rejected") {
          console.warn(
            "获取 bindings 失败，已降级为空:",
            bindingsResult.reason
          );
          warnings.push("获取 bindings 失败，已降级为空");
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

        const parsedAgents = parseAgentsList(agentsList);
        const parsedBindings = bindingsMapToRules(
          parseBindings(loadedBindings)
        );

        setAgentsListText(JSON.stringify(agentsList ?? [], null, 2));
        setBindingsText(JSON.stringify(loadedBindings ?? [], null, 2));
        setVisualAgents(parsedAgents);
        setVisualBindings(parsedBindings);
        setBindingsRaw(loadedBindings ?? []);
        setChannelsConfig(loadedChannels ?? []);

        if (warnings.length > 0) {
          setConfigError(warnings.join("；"));
        }
      } catch (e) {
        console.error("加载 agents.list / bindings 失败:", e);
        setConfigError(String(e));
      } finally {
        setConfigLoading(false);
      }
    };

    loadAgentAndBindingConfig();
  }, []);

  const handleExpertModeToggle = (enabled: boolean) => {
    setConfigError(null);
    setConfigMessage(null);

    if (enabled) {
      syncJsonTextFromVisual(visualAgents, visualBindings, bindingsRaw);
      setExpertMode(true);
      return;
    }

    try {
      const parsedAgents = JSON.parse(agentsListText);
      const parsedBindings = JSON.parse(bindingsText);

      if (!Array.isArray(parsedAgents)) {
        throw new Error("agents.list 结构无效：必须为数组");
      }

      if (!Array.isArray(parsedBindings) && !isRecord(parsedBindings)) {
        throw new Error("bindings 结构无效：必须为数组或对象");
      }

      setVisualAgents(parseAgentsList(parsedAgents));
      setVisualBindings(bindingsMapToRules(parseBindings(parsedBindings)));
      setBindingsRaw(parsedBindings);
      setExpertMode(false);
    } catch (e) {
      console.error("专家模式切换失败:", e);
      setConfigError(`专家模式 JSON 无效，无法切换到可视化：${String(e)}`);
    }
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
      alert(message);
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

  const saveAgentAndBindingConfig = async () => {
    setConfigLoading(true);
    setConfigError(null);
    setConfigMessage(null);

    try {
      if (expertMode) {
        const parsedAgentsList = JSON.parse(agentsListText);
        const parsedBindings = JSON.parse(bindingsText);

        if (!Array.isArray(parsedAgentsList)) {
          throw new Error("agents.list 结构无效：必须为数组");
        }

        if (!Array.isArray(parsedBindings) && !isRecord(parsedBindings)) {
          throw new Error("bindings 结构无效：必须为数组或对象");
        }

        await invoke<string>("save_agents_list", {
          agentsList: parsedAgentsList,
        });
        await invoke<string>("save_bindings", { bindings: parsedBindings });

        setVisualAgents(parseAgentsList(parsedAgentsList));
        setVisualBindings(bindingsMapToRules(parseBindings(parsedBindings)));
        setBindingsRaw(parsedBindings);
        setAgentsListText(JSON.stringify(parsedAgentsList, null, 2));
        setBindingsText(JSON.stringify(parsedBindings, null, 2));
      } else {
        const normalizedAgents = normalizeVisualAgents(visualAgents);
        const normalizedBindings = normalizeVisualBindings(visualBindings);

        const validationError = validateVisualConfig(
          normalizedAgents,
          normalizedBindings
        );
        if (validationError) {
          throw new Error(validationError);
        }

        const agentsPayload = buildAgentsPayload(normalizedAgents);
        const bindingMap = bindingsRulesToMap(normalizedBindings);
        const bindingsPayload = buildBindingsPayload(bindingsRaw, bindingMap);

        await invoke<string>("save_agents_list", {
          agentsList: agentsPayload,
        });
        await invoke<string>("save_bindings", { bindings: bindingsPayload });

        setVisualAgents(normalizedAgents);
        setVisualBindings(normalizedBindings);
        setBindingsRaw(bindingsPayload);
        setAgentsListText(JSON.stringify(agentsPayload, null, 2));
        setBindingsText(JSON.stringify(bindingsPayload, null, 2));
      }

      setConfigMessage("agents.list 与 bindings 已保存");
    } catch (e) {
      console.error("保存 agents.list / bindings 失败:", e);
      setConfigError(String(e));
    } finally {
      setConfigLoading(false);
    }
  };

  return (
    <div className="module-page-shell">
      <div className="max-w-2xl space-y-6">
        {/* 身份配置 */}
        <div className="bg-dark-700 rounded-2xl p-6 border border-dark-500">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-claw-500/20 flex items-center justify-center">
              <User size={20} className="text-claw-400" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-white">身份配置</h3>
              <p className="text-xs text-gray-500">设置 AI 助手的名称和称呼</p>
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
              <label className="block text-sm text-gray-400 mb-2">时区</label>
              <select
                value={identity.timezone}
                onChange={(e) =>
                  setIdentity({ ...identity, timezone: e.target.value })
                }
                className="input-base"
              >
                <option value="Asia/Shanghai">Asia/Shanghai (北京时间)</option>
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
                <option value="Europe/London">Europe/London (伦敦时间)</option>
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
                <p className="text-xs text-gray-500">只允许白名单用户访问</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" className="sr-only peer" />
                <div className="w-11 h-6 bg-dark-500 peer-focus:ring-2 peer-focus:ring-claw-500/50 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-claw-500"></div>
              </label>
            </div>

            <div className="flex items-center justify-between p-4 bg-dark-600 rounded-lg">
              <div>
                <p className="text-sm text-white">文件访问权限</p>
                <p className="text-xs text-gray-500">允许 AI 读写本地文件</p>
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

          {configError && (
            <div className="mb-4 p-3 rounded-lg bg-red-900/30 border border-red-800 text-sm text-red-300">
              {configError}
            </div>
          )}
          {configMessage && !configError && (
            <div className="mb-4 p-3 rounded-lg bg-green-900/30 border border-green-800 text-sm text-green-300">
              {configMessage}
            </div>
          )}

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
                    字段：channel、accountId、agentId。要求 channel + accountId
                    唯一，且 agentId 必须存在于 agents.list。
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

            <div className="flex justify-end">
              <button
                onClick={saveAgentAndBindingConfig}
                disabled={configLoading}
                className="btn-secondary flex items-center gap-2"
              >
                {configLoading ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Save size={16} />
                )}
                保存 agents.list / bindings
              </button>
            </div>
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

        {/* 保存按钮 */}
        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving}
            className="btn-primary flex items-center gap-2"
          >
            {saving ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Save size={16} />
            )}
            保存设置
          </button>
        </div>
      </div>
    </div>
  );
}
