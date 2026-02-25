import {
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  Copy,
  Layers,
  MessageSquare,
  Network,
  RefreshCw,
  Save,
  Settings2,
  Star,
  Trash2,
  Undo2,
} from "lucide-react";
import clsx from "clsx";

import { createLogger } from "../../lib/logger";

const agentLogger = createLogger("Agent");
const BINDING_KEY_SEPARATOR = "::";

export interface AgentCenterDataState {
  loading: boolean;
  refreshing: boolean;
  saving: boolean;
  error: string | null;
  message: string | null;
  warnings: string[];
  agents: VisualAgent[];
  baselineAgents: VisualAgent[];
  bindingsMap: Record<string, string>;
  gatewaySummary: GatewaySummary;
  defaultScopeKeys: string[];
}

export interface AgentCenterDataActions {
  setError: (nextError: string | null) => void;
  setMessage: (nextMessage: string | null) => void;
  setAgents: Dispatch<SetStateAction<VisualAgent[]>>;
  setBaselineAgents: Dispatch<SetStateAction<VisualAgent[]>>;
  reload: (isRefresh?: boolean) => Promise<void>;
  persistAgents: (nextAgents: VisualAgent[]) => Promise<void>;
}

interface AgentCenterProps {
  onOpenSettings: () => void;
  onOpenChannels?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  viewMode?: "list" | "workspace";
  activeAgentId?: string | null;
  onOpenWorkspace?: (agentId: string) => void;
  onBackToList?: () => void;
  dataState: AgentCenterDataState;
  dataActions: AgentCenterDataActions;
}

export interface VisualAgent {
  id: string;
  name: string;
  workspace: string;
  default: boolean;
  extra: Record<string, unknown>;
}

export type BindingsPayload =
  | BindingEntry[]
  | Record<string, string | Record<string, string | { agentId?: string }>>;

interface BindingEntry {
  agentId?: string;
  match?: {
    channel?: string;
    accountId?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface GatewaySummary {
  port: string;
  bind: string;
  reloadMode: string;
  trustedProxies: number;
}

interface AgentFieldChange {
  agentId: string;
  changedFields: string[];
}

interface AgentChangeSummary {
  addedIds: string[];
  removedIds: string[];
  defaultSwitched: { from: string | null; to: string | null } | null;
  updatedAgents: AgentFieldChange[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function cloneVisualAgents(source: VisualAgent[]): VisualAgent[] {
  return source.map((agent) => ({
    ...agent,
    extra: { ...agent.extra },
  }));
}

function buildBindingKey(channel: string, accountId: string): string {
  return `${channel}${BINDING_KEY_SEPARATOR}${accountId}`;
}

function splitBindingKey(
  key: string
): { channel: string; accountId: string } | null {
  const index = key.indexOf(BINDING_KEY_SEPARATOR);
  if (index <= 0 || index >= key.length - BINDING_KEY_SEPARATOR.length) {
    return null;
  }

  return {
    channel: key.slice(0, index),
    accountId: key.slice(index + BINDING_KEY_SEPARATOR.length),
  };
}

function parseCompositeBindingKey(
  key: string
): { channel: string; accountId: string } | null {
  for (const separator of ["/", ":", "."]) {
    const index = key.indexOf(separator);
    if (index > 0 && index < key.length - 1) {
      return {
        channel: key.slice(0, index),
        accountId: key.slice(index + 1),
      };
    }
  }

  return null;
}
export function parseBindings(rawBindings: unknown): Record<string, string> {
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
      if (!isRecord(entry)) {
        return;
      }
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

export function parseAgentsList(rawAgents: unknown): VisualAgent[] {
  if (!Array.isArray(rawAgents)) {
    return [];
  }

  return rawAgents
    .map((item) => {
      if (typeof item === "string") {
        return {
          id: item.trim(),
          name: "",
          workspace: "",
          default: false,
          extra: {},
        };
      }

      if (!isRecord(item)) {
        return {
          id: "",
          name: "",
          workspace: "",
          default: false,
          extra: {},
        };
      }

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
        id: typeof item.id === "string" ? item.id.trim() : "",
        name: typeof item.name === "string" ? item.name.trim() : "",
        workspace:
          typeof item.workspace === "string" ? item.workspace.trim() : "",
        default: typeof item.default === "boolean" ? item.default : false,
        extra,
      };
    })
    .filter((agent) => Boolean(agent.id));
}

export function normalizeVisualAgents(agents: VisualAgent[]): VisualAgent[] {
  const trimmed = agents.map((agent) => ({
    ...agent,
    id: agent.id.trim(),
    name: agent.name.trim(),
    workspace: agent.workspace.trim(),
  }));

  let hasDefault = false;
  const normalized = trimmed.map((agent) => {
    if (agent.default && !hasDefault) {
      hasDefault = true;
      return { ...agent, default: true };
    }

    return { ...agent, default: false };
  });

  if (!hasDefault && normalized.length > 0) {
    normalized[0] = {
      ...normalized[0],
      default: true,
    };
  }

  return normalized;
}
export function buildAgentsPayload(
  agents: VisualAgent[]
): Record<string, unknown>[] {
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

function toStableComparable(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => toStableComparable(item));
  }

  if (isRecord(value)) {
    return Object.keys(value)
      .sort()
      .reduce<Record<string, unknown>>((accumulator, key) => {
        accumulator[key] = toStableComparable(value[key]);
        return accumulator;
      }, {});
  }

  return value;
}

export function buildAgentsSignature(agents: VisualAgent[]): string {
  const normalized = normalizeVisualAgents(agents);
  const payload = buildAgentsPayload(normalized);
  return JSON.stringify(toStableComparable(payload));
}

export function validateAgents(agents: VisualAgent[]): string | null {
  if (agents.length === 0) {
    return "至少保留一个 Agent";
  }

  const seen = new Set<string>();
  for (let index = 0; index < agents.length; index += 1) {
    const id = agents[index].id.trim();
    if (!id) {
      return `Agent 第 ${index + 1} 行：id 必填`;
    }
    if (seen.has(id)) {
      return `Agent id 重复：${id}`;
    }
    seen.add(id);
  }

  return null;
}
export function parseGatewaySummary(config: unknown): GatewaySummary {
  const fallback: GatewaySummary = {
    port: "18789",
    bind: "127.0.0.1",
    reloadMode: "hybrid",
    trustedProxies: 0,
  };

  if (!isRecord(config) || !isRecord(config.gateway)) {
    return fallback;
  }

  const gateway = config.gateway;
  const reload = isRecord(gateway.reload) ? gateway.reload : {};

  return {
    port:
      typeof gateway.port === "number" || typeof gateway.port === "string"
        ? String(gateway.port)
        : fallback.port,
    bind:
      typeof gateway.bind === "string" && gateway.bind.trim()
        ? gateway.bind.trim()
        : fallback.bind,
    reloadMode:
      typeof reload.mode === "string" && reload.mode.trim()
        ? reload.mode.trim()
        : fallback.reloadMode,
    trustedProxies: Array.isArray(gateway.trustedProxies)
      ? gateway.trustedProxies.filter((item) => typeof item === "string").length
      : 0,
  };
}

export function parseDefaultScopeKeys(config: unknown): string[] {
  if (!isRecord(config) || !isRecord(config.agents)) {
    return [];
  }

  const agents = config.agents;
  if (!isRecord(agents.defaults)) {
    return [];
  }

  return Object.keys(agents.defaults);
}

function buildDuplicatedAgentId(
  baseId: string,
  existingIds: Set<string>
): string {
  const normalizedBase = baseId.trim() || "agent";
  const directCandidate = `${normalizedBase}-copy`;
  if (!existingIds.has(directCandidate)) {
    return directCandidate;
  }

  let index = 2;
  while (existingIds.has(`${normalizedBase}-copy-${index}`)) {
    index += 1;
  }

  return `${normalizedBase}-copy-${index}`;
}

type EditableModelStringField = "primary" | "fallback";
type EditableModelNumberField = "temperature" | "top_p" | "max_tokens";
type EditableModelField = EditableModelStringField | EditableModelNumberField;
type EditableToolsListField = "allow" | "deny" | "elevated";
type EditableSandboxField =
  | "mode"
  | "workspaceAccess"
  | "scope"
  | "workspaceRoot";

const MODEL_EDITABLE_FIELDS: EditableModelField[] = [
  "primary",
  "fallback",
  "temperature",
  "top_p",
  "max_tokens",
];

const TOOLS_EDITABLE_FIELDS: EditableToolsListField[] = [
  "allow",
  "deny",
  "elevated",
];

const SANDBOX_EDITABLE_FIELDS: EditableSandboxField[] = [
  "mode",
  "workspaceAccess",
  "scope",
  "workspaceRoot",
];

const MODEL_EDITABLE_FIELD_SET = new Set<string>(MODEL_EDITABLE_FIELDS);
const TOOLS_EDITABLE_FIELD_SET = new Set<string>(TOOLS_EDITABLE_FIELDS);
const SANDBOX_EDITABLE_FIELD_SET = new Set<string>(SANDBOX_EDITABLE_FIELDS);

const MODEL_FIELD_LABELS: Record<EditableModelField, string> = {
  primary: "primary",
  fallback: "fallback",
  temperature: "temperature",
  top_p: "top_p",
  max_tokens: "max_tokens",
};

function parseListInput(rawValue: string): string[] {
  const tokens = rawValue
    .split(/[\n,;]+/g)
    .map((item) => item.trim())
    .filter(Boolean);

  const deduplicated: string[] = [];
  tokens.forEach((token) => {
    if (!deduplicated.includes(token)) {
      deduplicated.push(token);
    }
  });
  return deduplicated;
}

function parseStringListFromUnknown(value: unknown): string[] {
  if (Array.isArray(value)) {
    return parseListInput(
      value
        .filter((item): item is string => typeof item === "string")
        .join("\n")
    );
  }

  if (typeof value === "string") {
    return parseListInput(value);
  }

  return [];
}

function formatStringListForInput(values: string[]): string {
  return values.join("\n");
}

function findToolsListConflict(allow: string[], deny: string[]): string | null {
  const denySet = new Set(deny);
  return allow.find((item) => denySet.has(item)) ?? null;
}

function isSandboxModeRequiringWorkspace(mode: string): boolean {
  const normalized = mode.trim().toLowerCase();
  return Boolean(normalized) && normalized !== "off";
}

function getAgentModelRecord(agent: VisualAgent): Record<string, unknown> {
  return isRecord(agent.extra.model) ? { ...agent.extra.model } : {};
}

function readAgentModelField(
  agent: VisualAgent,
  field: EditableModelField
): string {
  const value = getAgentModelRecord(agent)[field];

  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return "";
}

function readAgentUnknownModelConfig(
  agent: VisualAgent
): Record<string, unknown> {
  const model = getAgentModelRecord(agent);
  return Object.entries(model).reduce<Record<string, unknown>>(
    (accumulator, [key, value]) => {
      if (!MODEL_EDITABLE_FIELD_SET.has(key)) {
        accumulator[key] = value;
      }
      return accumulator;
    },
    {}
  );
}

function countAgentUnknownModelFields(agent: VisualAgent): number {
  return Object.keys(readAgentUnknownModelConfig(agent)).length;
}

function getAgentToolsRecord(agent: VisualAgent): Record<string, unknown> {
  return isRecord(agent.extra.tools) ? { ...agent.extra.tools } : {};
}

function readAgentToolsField(
  agent: VisualAgent,
  field: EditableToolsListField
): string[] {
  return parseStringListFromUnknown(getAgentToolsRecord(agent)[field]);
}

function readAgentUnknownToolsConfig(
  agent: VisualAgent
): Record<string, unknown> {
  const tools = getAgentToolsRecord(agent);
  return Object.entries(tools).reduce<Record<string, unknown>>(
    (accumulator, [key, value]) => {
      if (!TOOLS_EDITABLE_FIELD_SET.has(key)) {
        accumulator[key] = value;
      }
      return accumulator;
    },
    {}
  );
}

function countAgentUnknownToolsFields(agent: VisualAgent): number {
  return Object.keys(readAgentUnknownToolsConfig(agent)).length;
}

function getAgentSandboxRecord(agent: VisualAgent): Record<string, unknown> {
  return isRecord(agent.extra.sandbox) ? { ...agent.extra.sandbox } : {};
}

function readAgentSandboxField(
  agent: VisualAgent,
  field: EditableSandboxField
): string {
  const value = getAgentSandboxRecord(agent)[field];
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

function readAgentUnknownSandboxConfig(
  agent: VisualAgent
): Record<string, unknown> {
  const sandbox = getAgentSandboxRecord(agent);
  return Object.entries(sandbox).reduce<Record<string, unknown>>(
    (accumulator, [key, value]) => {
      if (!SANDBOX_EDITABLE_FIELD_SET.has(key)) {
        accumulator[key] = value;
      }
      return accumulator;
    },
    {}
  );
}

function countAgentUnknownSandboxFields(agent: VisualAgent): number {
  return Object.keys(readAgentUnknownSandboxConfig(agent)).length;
}

function parseModelNumberField(
  field: EditableModelNumberField,
  rawValue: string
): { ok: true; value: number | undefined } | { ok: false; error: string } {
  const normalized = rawValue.trim();
  if (!normalized) {
    return { ok: true, value: undefined };
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    return {
      ok: false,
      error: `${MODEL_FIELD_LABELS[field]} 必须是数字`,
    };
  }

  if (field === "max_tokens") {
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return {
        ok: false,
        error: "max_tokens 必须是大于 0 的整数",
      };
    }
    return { ok: true, value: parsed };
  }

  if (field === "temperature" && (parsed < 0 || parsed > 2)) {
    return {
      ok: false,
      error: "temperature 取值范围应为 0 ~ 2",
    };
  }

  if (field === "top_p" && (parsed < 0 || parsed > 1)) {
    return {
      ok: false,
      error: "top_p 取值范围应为 0 ~ 1",
    };
  }

  return { ok: true, value: parsed };
}

export function AgentCenter({
  onOpenSettings,
  onOpenChannels,
  onDirtyChange,
  viewMode = "list",
  activeAgentId = null,
  onOpenWorkspace,
  onBackToList,
  dataState,
  dataActions,
}: AgentCenterProps) {
  const {
    loading,
    refreshing,
    saving,
    error,
    message,
    warnings,
    agents,
    baselineAgents,
    bindingsMap,
    gatewaySummary,
    defaultScopeKeys,
  } = dataState;
  const {
    setError,
    setMessage,
    setAgents,
    setBaselineAgents,
    reload,
    persistAgents,
  } = dataActions;

  const [selectedCustomAgentIds, setSelectedCustomAgentIds] = useState<
    Set<string>
  >(new Set());

  const hasPendingChanges = useMemo(
    () => buildAgentsSignature(agents) !== buildAgentsSignature(baselineAgents),
    [agents, baselineAgents]
  );

  useEffect(() => {
    onDirtyChange?.(hasPendingChanges);
  }, [hasPendingChanges, onDirtyChange]);

  useEffect(() => {
    return () => {
      onDirtyChange?.(false);
    };
  }, [onDirtyChange]);

  useEffect(() => {
    if (!hasPendingChanges) {
      return;
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [hasPendingChanges]);

  const defaultAgent = useMemo(
    () => agents.find((agent) => agent.default) ?? agents[0] ?? null,
    [agents]
  );

  const customAgents = useMemo(() => {
    if (!defaultAgent) {
      return agents;
    }
    return agents.filter((agent) => agent.id !== defaultAgent.id);
  }, [agents, defaultAgent]);

  useEffect(() => {
    setSelectedCustomAgentIds((current) => {
      if (current.size === 0) {
        return current;
      }
      const validIds = new Set(customAgents.map((agent) => agent.id));
      const next = new Set(
        Array.from(current).filter((agentId) => validIds.has(agentId))
      );
      return next.size === current.size ? current : next;
    });
  }, [customAgents]);

  const selectedCustomAgentsCount = selectedCustomAgentIds.size;
  const allCustomSelected =
    customAgents.length > 0 &&
    customAgents.every((agent) => selectedCustomAgentIds.has(agent.id));

  const toggleSelectCustomAgent = (agentId: string, checked: boolean) => {
    setSelectedCustomAgentIds((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(agentId);
      } else {
        next.delete(agentId);
      }
      return next;
    });
  };

  const handleSelectAllCustomAgents = (checked: boolean) => {
    if (checked) {
      setSelectedCustomAgentIds(new Set(customAgents.map((agent) => agent.id)));
      return;
    }
    setSelectedCustomAgentIds(new Set());
  };

  const bindingCountByAgent = useMemo(() => {
    const counter: Record<string, number> = {};
    Object.values(bindingsMap).forEach((agentId) => {
      counter[agentId] = (counter[agentId] ?? 0) + 1;
    });
    return counter;
  }, [bindingsMap]);

  const handleBatchDeleteSelected = () => {
    setError(null);
    setMessage(null);

    if (selectedCustomAgentIds.size === 0) {
      setError("请先选择要删除的自定义 Agent");
      return;
    }

    const selectedIds = Array.from(selectedCustomAgentIds);
    const referenced = selectedIds.filter(
      (agentId) => (bindingCountByAgent[agentId] ?? 0) > 0
    );

    if (referenced.length > 0) {
      setError(
        `无法批量删除：${
          referenced.length
        } 个 Agent 仍被 bindings 引用（${referenced.slice(0, 3).join("、")}${
          referenced.length > 3 ? " ..." : ""
        }）`
      );
      return;
    }

    setAgents((current) => {
      if (selectedIds.length >= current.length) {
        setError("至少保留一个 Agent，无法批量删除全部。");
        return current;
      }

      const remaining = current.filter(
        (agent) => !selectedCustomAgentIds.has(agent.id)
      );
      if (remaining.length === current.length) {
        return current;
      }

      return normalizeVisualAgents(remaining);
    });

    setSelectedCustomAgentIds(new Set());
    setMessage(
      `已从草稿中批量删除 ${selectedIds.length} 个 Agent，请点击“应用变更”后持久化`
    );
  };

  const handleBatchDuplicateSelected = () => {
    setError(null);
    setMessage(null);

    if (selectedCustomAgentIds.size === 0) {
      setError("请先选择要复制的自定义 Agent");
      return;
    }

    let duplicatedIds: string[] = [];

    setAgents((current) => {
      const selectedSet = selectedCustomAgentIds;
      const sourceAgents = current.filter((agent) => selectedSet.has(agent.id));
      if (sourceAgents.length === 0) {
        return current;
      }

      const idSet = new Set(current.map((agent) => agent.id));
      const duplicatedAgents = sourceAgents.map((agent) => {
        const duplicatedId = buildDuplicatedAgentId(agent.id, idSet);
        idSet.add(duplicatedId);
        return {
          ...agent,
          id: duplicatedId,
          name: agent.name ? `${agent.name} 副本` : "",
          default: false,
          extra: { ...agent.extra },
        };
      });

      duplicatedIds = duplicatedAgents.map((agent) => agent.id);
      return normalizeVisualAgents([...current, ...duplicatedAgents]);
    });

    if (duplicatedIds.length === 0) {
      setError("未找到可复制的 Agent，请刷新后重试");
      return;
    }

    setSelectedCustomAgentIds(new Set(duplicatedIds));
    setMessage(
      `已批量复制 ${duplicatedIds.length} 个 Agent，请点击“应用变更”后持久化`
    );
  };

  const overrideAgentsCount = useMemo(
    () => agents.filter((agent) => Object.keys(agent.extra).length > 0).length,
    [agents]
  );

  const visibleDefaultScopeKeys = defaultScopeKeys.slice(0, 3);
  const hiddenDefaultScopeCount = Math.max(
    defaultScopeKeys.length - visibleDefaultScopeKeys.length,
    0
  );

  const changeSummary = useMemo<AgentChangeSummary>(() => {
    const normalizedCurrent = normalizeVisualAgents(agents);
    const normalizedBaseline = normalizeVisualAgents(baselineAgents);

    const currentMap = new Map(
      normalizedCurrent.map((agent) => [agent.id, agent] as const)
    );
    const baselineMap = new Map(
      normalizedBaseline.map((agent) => [agent.id, agent] as const)
    );

    const displayValue = (value: string) => (value ? value : "(空)");
    const displayBoolean = (value: boolean) => (value ? "是" : "否");
    const displayListValue = (value: string[]) =>
      value.length > 0 ? value.join("、") : "(空)";

    const addedIds = normalizedCurrent
      .filter((agent) => !baselineMap.has(agent.id))
      .map((agent) => agent.id);

    const removedIds = normalizedBaseline
      .filter((agent) => !currentMap.has(agent.id))
      .map((agent) => agent.id);

    const updatedAgents: AgentFieldChange[] = [];
    normalizedCurrent.forEach((agent) => {
      const baselineAgent = baselineMap.get(agent.id);
      if (!baselineAgent) {
        return;
      }

      const changedFields: string[] = [];
      if (agent.name !== baselineAgent.name) {
        changedFields.push(
          `name: ${displayValue(baselineAgent.name)} → ${displayValue(
            agent.name
          )}`
        );
      }
      if (agent.workspace !== baselineAgent.workspace) {
        changedFields.push(
          `workspace: ${displayValue(baselineAgent.workspace)} → ${displayValue(
            agent.workspace
          )}`
        );
      }
      if (agent.default !== baselineAgent.default) {
        changedFields.push(
          `default: ${displayBoolean(baselineAgent.default)} → ${displayBoolean(
            agent.default
          )}`
        );
      }

      MODEL_EDITABLE_FIELDS.forEach((field) => {
        const currentValue = readAgentModelField(agent, field);
        const baselineValue = readAgentModelField(baselineAgent, field);
        if (currentValue !== baselineValue) {
          changedFields.push(
            `model.${field}: ${displayValue(baselineValue)} → ${displayValue(
              currentValue
            )}`
          );
        }
      });

      const currentUnknownModel = readAgentUnknownModelConfig(agent);
      const baselineUnknownModel = readAgentUnknownModelConfig(baselineAgent);
      if (
        JSON.stringify(toStableComparable(currentUnknownModel)) !==
        JSON.stringify(toStableComparable(baselineUnknownModel))
      ) {
        changedFields.push("model: 其他字段已更新");
      }

      TOOLS_EDITABLE_FIELDS.forEach((field) => {
        const currentValue = readAgentToolsField(agent, field);
        const baselineValue = readAgentToolsField(baselineAgent, field);
        if (JSON.stringify(currentValue) !== JSON.stringify(baselineValue)) {
          changedFields.push(
            `tools.${field}: ${displayListValue(
              baselineValue
            )} → ${displayListValue(currentValue)}`
          );
        }
      });

      const currentUnknownTools = readAgentUnknownToolsConfig(agent);
      const baselineUnknownTools = readAgentUnknownToolsConfig(baselineAgent);
      if (
        JSON.stringify(toStableComparable(currentUnknownTools)) !==
        JSON.stringify(toStableComparable(baselineUnknownTools))
      ) {
        changedFields.push("tools: 其他字段已更新");
      }

      SANDBOX_EDITABLE_FIELDS.forEach((field) => {
        const currentValue = readAgentSandboxField(agent, field);
        const baselineValue = readAgentSandboxField(baselineAgent, field);
        if (currentValue !== baselineValue) {
          changedFields.push(
            `sandbox.${field}: ${displayValue(baselineValue)} → ${displayValue(
              currentValue
            )}`
          );
        }
      });

      const currentUnknownSandbox = readAgentUnknownSandboxConfig(agent);
      const baselineUnknownSandbox =
        readAgentUnknownSandboxConfig(baselineAgent);
      if (
        JSON.stringify(toStableComparable(currentUnknownSandbox)) !==
        JSON.stringify(toStableComparable(baselineUnknownSandbox))
      ) {
        changedFields.push("sandbox: 其他字段已更新");
      }

      if (changedFields.length > 0) {
        updatedAgents.push({
          agentId: agent.id,
          changedFields,
        });
      }
    });

    const currentDefaultId =
      normalizedCurrent.find((agent) => agent.default)?.id ??
      normalizedCurrent[0]?.id ??
      null;
    const baselineDefaultId =
      normalizedBaseline.find((agent) => agent.default)?.id ??
      normalizedBaseline[0]?.id ??
      null;

    return {
      addedIds,
      removedIds,
      defaultSwitched:
        currentDefaultId !== baselineDefaultId
          ? {
              from: baselineDefaultId,
              to: currentDefaultId,
            }
          : null,
      updatedAgents,
    };
  }, [agents, baselineAgents]);

  const handleUpdateAgentField = (
    targetAgentId: string,
    field: "name" | "workspace",
    value: string
  ) => {
    setError(null);
    setMessage(null);
    setAgents((current) =>
      current.map((agent) => {
        if (agent.id !== targetAgentId) {
          return agent;
        }
        if (field === "name") {
          return {
            ...agent,
            name: value,
          };
        }
        return {
          ...agent,
          workspace: value,
        };
      })
    );
  };

  const handleUpdateAgentModelField = (
    targetAgentId: string,
    field: EditableModelField,
    rawValue: string
  ) => {
    setError(null);
    setMessage(null);

    let parsedValue: string | number | undefined;
    if (field === "primary" || field === "fallback") {
      const normalized = rawValue.trim();
      parsedValue = normalized ? normalized : undefined;
    } else {
      const parsedResult = parseModelNumberField(field, rawValue);
      if (!parsedResult.ok) {
        setError(parsedResult.error);
        return;
      }
      parsedValue = parsedResult.value;
    }

    setAgents((current) =>
      current.map((agent) => {
        if (agent.id !== targetAgentId) {
          return agent;
        }

        const model = getAgentModelRecord(agent);
        if (parsedValue === undefined) {
          delete model[field];
        } else {
          model[field] = parsedValue;
        }

        const nextExtra = { ...agent.extra };
        if (Object.keys(model).length > 0) {
          nextExtra.model = model;
        } else {
          delete nextExtra.model;
        }

        return {
          ...agent,
          extra: nextExtra,
        };
      })
    );
  };

  const handleUpdateAgentToolsField = (
    targetAgentId: string,
    field: EditableToolsListField,
    rawValue: string
  ) => {
    setError(null);
    setMessage(null);

    const parsedValue = parseListInput(rawValue);

    setAgents((current) =>
      current.map((agent) => {
        if (agent.id !== targetAgentId) {
          return agent;
        }

        const tools = getAgentToolsRecord(agent);
        const currentAllow =
          field === "allow" ? parsedValue : readAgentToolsField(agent, "allow");
        const currentDeny =
          field === "deny" ? parsedValue : readAgentToolsField(agent, "deny");

        const conflict = findToolsListConflict(currentAllow, currentDeny);
        if (conflict) {
          setError(
            `tools.allow/deny 冲突：${conflict} 同时存在于 allow 与 deny`
          );
          return agent;
        }

        if (parsedValue.length > 0) {
          tools[field] = parsedValue;
        } else {
          delete tools[field];
        }

        const nextExtra = { ...agent.extra };
        if (Object.keys(tools).length > 0) {
          nextExtra.tools = tools;
        } else {
          delete nextExtra.tools;
        }

        return {
          ...agent,
          extra: nextExtra,
        };
      })
    );
  };

  const handleUpdateAgentSandboxField = (
    targetAgentId: string,
    field: EditableSandboxField,
    rawValue: string
  ) => {
    setError(null);
    setMessage(null);

    const parsedValue = rawValue.trim();

    setAgents((current) =>
      current.map((agent) => {
        if (agent.id !== targetAgentId) {
          return agent;
        }

        const sandbox = getAgentSandboxRecord(agent);
        if (parsedValue) {
          sandbox[field] = parsedValue;
        } else {
          delete sandbox[field];
        }

        const nextMode =
          field === "mode" ? parsedValue : readAgentSandboxField(agent, "mode");
        const nextWorkspace =
          field === "workspaceRoot"
            ? parsedValue
            : readAgentSandboxField(agent, "workspaceRoot");

        if (
          isSandboxModeRequiringWorkspace(nextMode) &&
          !nextWorkspace &&
          !agent.workspace.trim()
        ) {
          setError(
            "sandbox 已启用隔离模式但 workspace/workspaceRoot 均为空，请先填写路径"
          );
          return agent;
        }

        const nextExtra = { ...agent.extra };
        if (Object.keys(sandbox).length > 0) {
          nextExtra.sandbox = sandbox;
        } else {
          delete nextExtra.sandbox;
        }

        return {
          ...agent,
          extra: nextExtra,
        };
      })
    );
  };

  const handleSetDefault = (targetAgentId: string) => {
    setError(null);
    setMessage(null);
    setAgents((current) =>
      current.map((agent) => ({
        ...agent,
        default: agent.id === targetAgentId,
      }))
    );
  };

  const handleDuplicateAgent = (sourceAgentId: string) => {
    setError(null);
    setMessage(null);

    setAgents((current) => {
      const sourceIndex = current.findIndex(
        (agent) => agent.id === sourceAgentId
      );
      if (sourceIndex < 0) {
        return current;
      }

      const sourceAgent = current[sourceIndex];
      const idSet = new Set(current.map((agent) => agent.id));
      const duplicatedId = buildDuplicatedAgentId(sourceAgent.id, idSet);
      const duplicatedAgent: VisualAgent = {
        ...sourceAgent,
        id: duplicatedId,
        name: sourceAgent.name ? `${sourceAgent.name} 副本` : "",
        default: false,
        extra: { ...sourceAgent.extra },
      };

      const next = [...current];
      next.splice(sourceIndex + 1, 0, duplicatedAgent);
      return next;
    });

    setMessage("已创建 Agent 副本，请点击“应用变更”后持久化");
  };

  const handleDeleteAgent = (targetAgentId: string) => {
    setError(null);
    setMessage(null);

    const references = Object.entries(bindingsMap)
      .filter(([, agentId]) => agentId === targetAgentId)
      .map(([key]) => splitBindingKey(key))
      .filter((item): item is { channel: string; accountId: string } =>
        Boolean(item)
      );

    if (references.length > 0) {
      const sample = references
        .slice(0, 3)
        .map((entry) => `${entry.channel}/${entry.accountId}`)
        .join("、");
      setError(
        `无法删除 Agent ${targetAgentId}：仍被 ${
          references.length
        } 条 bindings 引用（${sample}${
          references.length > 3 ? " ..." : ""
        }），请先解除绑定后再删除。`
      );
      return;
    }

    setAgents((current) => {
      if (current.length <= 1) {
        setError("至少保留一个 Agent，无法删除最后一个。");
        return current;
      }

      const target = current.find((agent) => agent.id === targetAgentId);
      const filtered = current.filter((agent) => agent.id !== targetAgentId);
      if (filtered.length === current.length) {
        return current;
      }

      if (target?.default && filtered.length > 0) {
        filtered[0] = {
          ...filtered[0],
          default: true,
        };
      }

      return normalizeVisualAgents(filtered);
    });

    setSelectedCustomAgentIds((current) => {
      const next = new Set(current);
      next.delete(targetAgentId);
      return next;
    });

    setMessage("已从草稿中删除 Agent，请点击“应用变更”后持久化");
  };

  const handleDiscardChanges = () => {
    setError(null);
    setMessage("已撤销未保存变更");
    setAgents(cloneVisualAgents(baselineAgents));
    setSelectedCustomAgentIds(new Set());
  };

  const handleApplyChanges = async () => {
    setError(null);
    setMessage(null);

    try {
      const normalizedAgents = normalizeVisualAgents(agents);
      const validationError = validateAgents(normalizedAgents);
      if (validationError) {
        setError(validationError);
        return;
      }
      await persistAgents(normalizedAgents);

      setAgents(cloneVisualAgents(normalizedAgents));
      setBaselineAgents(cloneVisualAgents(normalizedAgents));
      setSelectedCustomAgentIds(new Set());
    } catch (saveError) {
      setError(`保存 Agent 变更失败: ${String(saveError)}`);
      agentLogger.error("保存 Agent 变更失败", saveError);
    }
  };

  const handleOpenWorkspace = (agentId: string) => {
    onOpenWorkspace?.(agentId);
  };

  const handleBackToList = () => {
    if (!onBackToList) {
      return;
    }

    if (hasPendingChanges) {
      const confirmed = window.confirm(
        "当前 Agent 详情存在未保存变更，确认返回列表并保留草稿吗？"
      );
      if (!confirmed) {
        return;
      }
    }

    onBackToList();
  };

  const activeAgent =
    activeAgentId !== null
      ? agents.find((agent) => agent.id === activeAgentId) ?? null
      : null;

  const activeAgentModel = useMemo(() => {
    if (!activeAgent) {
      return {
        primary: "",
        fallback: "",
        temperature: "",
        top_p: "",
        max_tokens: "",
        unknownFieldsCount: 0,
      };
    }

    return {
      primary: readAgentModelField(activeAgent, "primary"),
      fallback: readAgentModelField(activeAgent, "fallback"),
      temperature: readAgentModelField(activeAgent, "temperature"),
      top_p: readAgentModelField(activeAgent, "top_p"),
      max_tokens: readAgentModelField(activeAgent, "max_tokens"),
      unknownFieldsCount: countAgentUnknownModelFields(activeAgent),
    };
  }, [activeAgent]);

  const activeAgentTools = useMemo(() => {
    if (!activeAgent) {
      return {
        allow: "",
        deny: "",
        elevated: "",
        unknownFieldsCount: 0,
      };
    }

    return {
      allow: formatStringListForInput(
        readAgentToolsField(activeAgent, "allow")
      ),
      deny: formatStringListForInput(readAgentToolsField(activeAgent, "deny")),
      elevated: formatStringListForInput(
        readAgentToolsField(activeAgent, "elevated")
      ),
      unknownFieldsCount: countAgentUnknownToolsFields(activeAgent),
    };
  }, [activeAgent]);

  const activeAgentSandbox = useMemo(() => {
    if (!activeAgent) {
      return {
        mode: "",
        workspaceAccess: "",
        scope: "",
        workspaceRoot: "",
        unknownFieldsCount: 0,
      };
    }

    return {
      mode: readAgentSandboxField(activeAgent, "mode"),
      workspaceAccess: readAgentSandboxField(activeAgent, "workspaceAccess"),
      scope: readAgentSandboxField(activeAgent, "scope"),
      workspaceRoot: readAgentSandboxField(activeAgent, "workspaceRoot"),
      unknownFieldsCount: countAgentUnknownSandboxFields(activeAgent),
    };
  }, [activeAgent]);

  const activeAgentBindingReferences = useMemo(() => {
    if (!activeAgent) {
      return [] as Array<{ channel: string; accountId: string }>;
    }

    return Object.entries(bindingsMap)
      .filter(([, agentId]) => agentId === activeAgent.id)
      .map(([key]) => splitBindingKey(key))
      .filter((item): item is { channel: string; accountId: string } =>
        Boolean(item)
      );
  }, [activeAgent, bindingsMap]);

  if (viewMode === "workspace") {
    return (
      <div className="module-page-shell">
        <div className="mx-auto max-w-5xl space-y-6">
          <div className="rounded-2xl border border-dark-500 bg-dark-700 p-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-semibold text-white">
                    Agent 详情
                  </h2>
                  {hasPendingChanges && (
                    <span className="rounded-md bg-amber-500/20 px-2 py-1 text-xs text-amber-300">
                      有未保存变更
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-gray-400">
                  已支持基础信息、模型策略、工具策略与 sandbox 分区编辑，
                  未识别字段会继续保留在原配置中。
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleBackToList}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-dark-500 bg-dark-600 px-3 text-sm text-gray-200 transition-colors hover:bg-dark-500"
                >
                  <ArrowLeft size={14} />
                  返回列表
                </button>
                <button
                  type="button"
                  onClick={handleDiscardChanges}
                  disabled={!hasPendingChanges || saving}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-dark-500 bg-dark-600 px-3 text-sm text-gray-200 transition-colors hover:bg-dark-500 disabled:opacity-50"
                >
                  <Undo2 size={14} />
                  撤销
                </button>
                <button
                  type="button"
                  onClick={() => void handleApplyChanges()}
                  disabled={
                    !hasPendingChanges || saving || loading || refreshing
                  }
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-claw-500 px-3 text-sm font-medium text-white transition-colors hover:bg-claw-600 disabled:opacity-50"
                >
                  <Save size={14} />
                  {saving ? "保存中..." : "应用变更"}
                </button>
              </div>
            </div>
          </div>

          {error && (
            <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300">
              <p>{error}</p>
            </div>
          )}

          {message && (
            <div className="rounded-xl border border-green-500/40 bg-green-500/10 p-4 text-sm text-green-300">
              <p>{message}</p>
            </div>
          )}

          {activeAgent ? (
            <div className="space-y-4">
              <div className="rounded-2xl border border-dark-500 bg-dark-700 p-6">
                <h3 className="text-lg font-semibold text-white">基础信息</h3>
                <p className="mt-2 text-xs text-gray-400">
                  当前 Agent：{activeAgent.id}
                </p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="flex flex-col gap-1 text-xs text-gray-300">
                    <span className="text-gray-400">名称（name）</span>
                    <input
                      type="text"
                      value={activeAgent.name}
                      onChange={(event) =>
                        handleUpdateAgentField(
                          activeAgent.id,
                          "name",
                          event.target.value
                        )
                      }
                      placeholder="未命名 Agent"
                      className="min-h-[36px] rounded-md border border-dark-500 bg-dark-700 px-2 text-sm text-white placeholder:text-gray-500 focus:border-claw-500 focus:outline-none"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-gray-300">
                    <span className="text-gray-400">工作目录（workspace）</span>
                    <input
                      type="text"
                      value={activeAgent.workspace}
                      onChange={(event) =>
                        handleUpdateAgentField(
                          activeAgent.id,
                          "workspace",
                          event.target.value
                        )
                      }
                      placeholder="例如 /home/openclaw-manager"
                      className="min-h-[36px] rounded-md border border-dark-500 bg-dark-700 px-2 text-sm text-white placeholder:text-gray-500 focus:border-claw-500 focus:outline-none"
                    />
                  </label>
                </div>
              </div>

              <div className="rounded-2xl border border-dark-500 bg-dark-700 p-6">
                <h3 className="text-lg font-semibold text-white">
                  模型策略（agents.list[i].model）
                </h3>
                <p className="mt-2 text-sm text-gray-400">
                  支持 primary / fallback / temperature / top_p / max_tokens
                  编辑，未知字段会保留在原配置中。
                </p>

                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="flex flex-col gap-1 text-xs text-gray-300">
                    <span className="text-gray-400">主模型（primary）</span>
                    <input
                      type="text"
                      value={activeAgentModel.primary}
                      onChange={(event) =>
                        handleUpdateAgentModelField(
                          activeAgent.id,
                          "primary",
                          event.target.value
                        )
                      }
                      placeholder="例如 openai/gpt-5"
                      className="min-h-[36px] rounded-md border border-dark-500 bg-dark-700 px-2 text-sm text-white placeholder:text-gray-500 focus:border-claw-500 focus:outline-none"
                    />
                  </label>

                  <label className="flex flex-col gap-1 text-xs text-gray-300">
                    <span className="text-gray-400">回退模型（fallback）</span>
                    <input
                      type="text"
                      value={activeAgentModel.fallback}
                      onChange={(event) =>
                        handleUpdateAgentModelField(
                          activeAgent.id,
                          "fallback",
                          event.target.value
                        )
                      }
                      placeholder="例如 anthropic/claude-sonnet"
                      className="min-h-[36px] rounded-md border border-dark-500 bg-dark-700 px-2 text-sm text-white placeholder:text-gray-500 focus:border-claw-500 focus:outline-none"
                    />
                  </label>

                  <label className="flex flex-col gap-1 text-xs text-gray-300">
                    <span className="text-gray-400">temperature（0~2）</span>
                    <input
                      type="number"
                      min={0}
                      max={2}
                      step={0.1}
                      value={activeAgentModel.temperature}
                      onChange={(event) =>
                        handleUpdateAgentModelField(
                          activeAgent.id,
                          "temperature",
                          event.target.value
                        )
                      }
                      placeholder="例如 0.7"
                      className="min-h-[36px] rounded-md border border-dark-500 bg-dark-700 px-2 text-sm text-white placeholder:text-gray-500 focus:border-claw-500 focus:outline-none"
                    />
                  </label>

                  <label className="flex flex-col gap-1 text-xs text-gray-300">
                    <span className="text-gray-400">top_p（0~1）</span>
                    <input
                      type="number"
                      min={0}
                      max={1}
                      step={0.05}
                      value={activeAgentModel.top_p}
                      onChange={(event) =>
                        handleUpdateAgentModelField(
                          activeAgent.id,
                          "top_p",
                          event.target.value
                        )
                      }
                      placeholder="例如 0.9"
                      className="min-h-[36px] rounded-md border border-dark-500 bg-dark-700 px-2 text-sm text-white placeholder:text-gray-500 focus:border-claw-500 focus:outline-none"
                    />
                  </label>

                  <label className="flex flex-col gap-1 text-xs text-gray-300 sm:col-span-2">
                    <span className="text-gray-400">
                      max_tokens（整数，&gt;0）
                    </span>
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={activeAgentModel.max_tokens}
                      onChange={(event) =>
                        handleUpdateAgentModelField(
                          activeAgent.id,
                          "max_tokens",
                          event.target.value
                        )
                      }
                      placeholder="例如 4096"
                      className="min-h-[36px] rounded-md border border-dark-500 bg-dark-700 px-2 text-sm text-white placeholder:text-gray-500 focus:border-claw-500 focus:outline-none"
                    />
                  </label>
                </div>

                {activeAgentModel.unknownFieldsCount > 0 && (
                  <p className="mt-2 text-xs text-gray-500">
                    已保留 model 其他 {activeAgentModel.unknownFieldsCount}{" "}
                    个未知字段，不会被覆盖。
                  </p>
                )}
              </div>

              <div className="rounded-2xl border border-dark-500 bg-dark-700 p-6">
                <h3 className="text-lg font-semibold text-white">
                  工具策略（agents.list[i].tools）
                </h3>
                <p className="mt-2 text-sm text-gray-400">
                  支持 allow / deny / elevated 三组清单编辑（换行、逗号、分号
                  均可分隔），并保留 tools 下其他未知字段。
                </p>

                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="flex flex-col gap-1 text-xs text-gray-300">
                    <span className="text-gray-400">allow</span>
                    <textarea
                      value={activeAgentTools.allow}
                      onChange={(event) =>
                        handleUpdateAgentToolsField(
                          activeAgent.id,
                          "allow",
                          event.target.value
                        )
                      }
                      rows={4}
                      placeholder={"filesystem-read\nterminal-execute"}
                      className="rounded-md border border-dark-500 bg-dark-700 px-2 py-2 font-mono text-xs text-white placeholder:text-gray-500 focus:border-claw-500 focus:outline-none"
                    />
                  </label>

                  <label className="flex flex-col gap-1 text-xs text-gray-300">
                    <span className="text-gray-400">deny</span>
                    <textarea
                      value={activeAgentTools.deny}
                      onChange={(event) =>
                        handleUpdateAgentToolsField(
                          activeAgent.id,
                          "deny",
                          event.target.value
                        )
                      }
                      rows={4}
                      placeholder={"shell\nrm -rf"}
                      className="rounded-md border border-dark-500 bg-dark-700 px-2 py-2 font-mono text-xs text-white placeholder:text-gray-500 focus:border-claw-500 focus:outline-none"
                    />
                  </label>

                  <label className="flex flex-col gap-1 text-xs text-gray-300 sm:col-span-2">
                    <span className="text-gray-400">elevated</span>
                    <textarea
                      value={activeAgentTools.elevated}
                      onChange={(event) =>
                        handleUpdateAgentToolsField(
                          activeAgent.id,
                          "elevated",
                          event.target.value
                        )
                      }
                      rows={3}
                      placeholder={"terminal-execute"}
                      className="rounded-md border border-dark-500 bg-dark-700 px-2 py-2 font-mono text-xs text-white placeholder:text-gray-500 focus:border-claw-500 focus:outline-none"
                    />
                  </label>
                </div>

                <p className="mt-2 text-xs text-gray-500">
                  校验规则：allow 与 deny 不可同时包含同一工具名。
                </p>
                {activeAgentTools.unknownFieldsCount > 0 && (
                  <p className="mt-1 text-xs text-gray-500">
                    已保留 tools 其他 {activeAgentTools.unknownFieldsCount}{" "}
                    个未知字段，不会被覆盖。
                  </p>
                )}
              </div>

              <div className="rounded-2xl border border-dark-500 bg-dark-700 p-6">
                <h3 className="text-lg font-semibold text-white">
                  沙箱策略（agents.list[i].sandbox）
                </h3>
                <p className="mt-2 text-sm text-gray-400">
                  支持 mode / workspaceAccess / scope / workspaceRoot
                  编辑，并进行基础校验： 当 mode 非 off 时，至少需要 workspace
                  或 workspaceRoot。
                </p>

                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="flex flex-col gap-1 text-xs text-gray-300">
                    <span className="text-gray-400">mode</span>
                    <input
                      type="text"
                      value={activeAgentSandbox.mode}
                      onChange={(event) =>
                        handleUpdateAgentSandboxField(
                          activeAgent.id,
                          "mode",
                          event.target.value
                        )
                      }
                      placeholder="off"
                      className="min-h-[36px] rounded-md border border-dark-500 bg-dark-700 px-2 text-sm text-white placeholder:text-gray-500 focus:border-claw-500 focus:outline-none"
                    />
                  </label>

                  <label className="flex flex-col gap-1 text-xs text-gray-300">
                    <span className="text-gray-400">workspaceAccess</span>
                    <input
                      type="text"
                      value={activeAgentSandbox.workspaceAccess}
                      onChange={(event) =>
                        handleUpdateAgentSandboxField(
                          activeAgent.id,
                          "workspaceAccess",
                          event.target.value
                        )
                      }
                      placeholder="rw"
                      className="min-h-[36px] rounded-md border border-dark-500 bg-dark-700 px-2 text-sm text-white placeholder:text-gray-500 focus:border-claw-500 focus:outline-none"
                    />
                  </label>

                  <label className="flex flex-col gap-1 text-xs text-gray-300">
                    <span className="text-gray-400">scope</span>
                    <input
                      type="text"
                      value={activeAgentSandbox.scope}
                      onChange={(event) =>
                        handleUpdateAgentSandboxField(
                          activeAgent.id,
                          "scope",
                          event.target.value
                        )
                      }
                      placeholder="agent"
                      className="min-h-[36px] rounded-md border border-dark-500 bg-dark-700 px-2 text-sm text-white placeholder:text-gray-500 focus:border-claw-500 focus:outline-none"
                    />
                  </label>

                  <label className="flex flex-col gap-1 text-xs text-gray-300">
                    <span className="text-gray-400">workspaceRoot</span>
                    <input
                      type="text"
                      value={activeAgentSandbox.workspaceRoot}
                      onChange={(event) =>
                        handleUpdateAgentSandboxField(
                          activeAgent.id,
                          "workspaceRoot",
                          event.target.value
                        )
                      }
                      placeholder="例如 /home/openclaw/sandboxes-main"
                      className="min-h-[36px] rounded-md border border-dark-500 bg-dark-700 px-2 text-sm text-white placeholder:text-gray-500 focus:border-claw-500 focus:outline-none"
                    />
                  </label>
                </div>

                {isSandboxModeRequiringWorkspace(activeAgentSandbox.mode) &&
                  !activeAgentSandbox.workspaceRoot &&
                  !activeAgent.workspace.trim() && (
                    <p className="mt-2 text-xs text-amber-300">
                      当前 mode 已启用隔离，但 workspace 与 workspaceRoot
                      均为空； 应用前请至少配置一个路径。
                    </p>
                  )}

                {activeAgentSandbox.unknownFieldsCount > 0 && (
                  <p className="mt-2 text-xs text-gray-500">
                    已保留 sandbox 其他 {activeAgentSandbox.unknownFieldsCount}{" "}
                    个未知字段，不会被覆盖。
                  </p>
                )}
              </div>

              <div className="rounded-2xl border border-dark-500 bg-dark-700 p-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-semibold text-white">
                      路由关系（bindings）
                    </h3>
                    <p className="mt-2 text-sm text-gray-400">
                      当前 Agent 被 {activeAgentBindingReferences.length} 条
                      bindings 引用。
                    </p>
                  </div>

                  {onOpenChannels && (
                    <button
                      type="button"
                      onClick={onOpenChannels}
                      className="inline-flex min-h-[36px] items-center gap-1 rounded-md border border-dark-500 bg-dark-700 px-2 text-xs text-gray-200 transition-colors hover:bg-dark-600"
                    >
                      <MessageSquare size={12} />
                      跳转 Channels
                    </button>
                  )}
                </div>

                {activeAgentBindingReferences.length > 0 ? (
                  <ul className="mt-3 space-y-2">
                    {activeAgentBindingReferences.slice(0, 8).map((entry) => (
                      <li
                        key={`${entry.channel}::${entry.accountId}`}
                        className="flex items-center justify-between gap-3 rounded-md border border-dark-500 bg-dark-700/40 px-3 py-2 text-xs text-gray-300"
                      >
                        <span className="truncate">
                          channel：{entry.channel}
                        </span>
                        <span className="truncate text-gray-400">
                          account：{entry.accountId}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-3 text-xs text-gray-500">
                    当前 Agent 暂无 channel/account 引用。
                  </p>
                )}

                {activeAgentBindingReferences.length > 8 && (
                  <p className="mt-2 text-xs text-gray-500">
                    其余 {activeAgentBindingReferences.length - 8} 条引用请前往
                    Channels 查看。
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-6 text-sm text-amber-300">
              <p>
                未找到目标 Agent（{activeAgentId ?? "未指定"}
                ），请返回列表重新选择。
              </p>
              <button
                type="button"
                onClick={handleBackToList}
                className="mt-3 inline-flex min-h-[36px] items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 text-xs text-amber-200 transition-colors hover:bg-amber-500/20"
              >
                <ArrowLeft size={12} />
                返回列表
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="module-page-shell">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="rounded-2xl border border-dark-500 bg-dark-700 p-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-semibold text-white">智能体中心</h2>
                {hasPendingChanges && (
                  <span className="rounded-md bg-amber-500/20 px-2 py-1 text-xs text-amber-300">
                    有未保存变更
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm text-gray-400">
                支持设为默认、复制、删除 Agent，并统一应用持久化。
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void reload(true)}
                disabled={loading || refreshing || saving}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-dark-500 bg-dark-600 px-3 text-sm text-gray-200 transition-colors hover:bg-dark-500"
              >
                <RefreshCw
                  size={14}
                  className={clsx(refreshing && "animate-spin")}
                />
                刷新
              </button>
              <button
                type="button"
                onClick={handleDiscardChanges}
                disabled={!hasPendingChanges || saving}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-dark-500 bg-dark-600 px-3 text-sm text-gray-200 transition-colors hover:bg-dark-500 disabled:opacity-50"
              >
                <Undo2 size={14} />
                撤销
              </button>
              <button
                type="button"
                onClick={() => void handleApplyChanges()}
                disabled={!hasPendingChanges || saving || loading || refreshing}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-claw-500 px-3 text-sm font-medium text-white transition-colors hover:bg-claw-600 disabled:opacity-50"
              >
                <Save size={14} />
                {saving ? "保存中..." : "应用变更"}
              </button>
              <button
                type="button"
                onClick={onOpenSettings}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-dark-500 bg-dark-600 px-3 text-sm text-gray-200 transition-colors hover:bg-dark-500"
              >
                <Settings2 size={14} />
                前往设置编辑
              </button>
            </div>
          </div>
        </div>

        {warnings.length > 0 && (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-300">
            <p className="mb-2 font-medium">部分数据已降级加载：</p>
            <ul className="list-disc space-y-1 pl-5">
              {warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300">
            <p>{error}</p>
          </div>
        )}

        {message && (
          <div className="rounded-xl border border-green-500/40 bg-green-500/10 p-4 text-sm text-green-300">
            <p>{message}</p>
          </div>
        )}

        {hasPendingChanges && (
          <div className="rounded-xl border border-cyan-500/40 bg-cyan-500/10 p-4 text-sm text-cyan-200">
            <p className="mb-2 font-medium">变更摘要（相对已保存基线）</p>
            <ul className="list-disc space-y-1 pl-5">
              {changeSummary.addedIds.length > 0 && (
                <li>新增 Agent：{changeSummary.addedIds.join("、")}</li>
              )}
              {changeSummary.removedIds.length > 0 && (
                <li>删除 Agent：{changeSummary.removedIds.join("、")}</li>
              )}
              {changeSummary.defaultSwitched && (
                <li>
                  默认 Agent：{changeSummary.defaultSwitched.from ?? "未设置"} →{" "}
                  {changeSummary.defaultSwitched.to ?? "未设置"}
                </li>
              )}
              {changeSummary.updatedAgents.length > 0 && (
                <li>
                  字段更新：
                  <ul className="mt-1 list-disc space-y-1 pl-5">
                    {changeSummary.updatedAgents.slice(0, 5).map((item) => (
                      <li key={item.agentId}>
                        <span className="font-medium">{item.agentId}</span>：
                        {item.changedFields.join("；")}
                      </li>
                    ))}
                    {changeSummary.updatedAgents.length > 5 && (
                      <li>
                        其余 {changeSummary.updatedAgents.length - 5} 个 Agent
                        仍有字段更新...
                      </li>
                    )}
                  </ul>
                </li>
              )}
              {changeSummary.addedIds.length === 0 &&
                changeSummary.removedIds.length === 0 &&
                !changeSummary.defaultSwitched &&
                changeSummary.updatedAgents.length === 0 && (
                  <li>当前草稿未检测到可摘要的结构化变更。</li>
                )}
            </ul>
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-xl border border-dark-500 bg-dark-700/70 p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium text-white">
              <Network size={16} className="text-cyan-400" />
              全局（Gateway）
            </div>
            <p className="text-xs text-gray-400">port：{gatewaySummary.port}</p>
            <p className="text-xs text-gray-400">bind：{gatewaySummary.bind}</p>
            <p className="text-xs text-gray-400">
              reload：{gatewaySummary.reloadMode} · trustedProxies：
              {gatewaySummary.trustedProxies}
            </p>
          </div>

          <div className="rounded-xl border border-dark-500 bg-dark-700/70 p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium text-white">
              <Layers size={16} className="text-purple-400" />
              默认（agents.defaults）
            </div>
            {defaultScopeKeys.length > 0 ? (
              <>
                <p className="text-xs text-gray-400">
                  作用域字段：{defaultScopeKeys.length} 项
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  {visibleDefaultScopeKeys.join(" · ")}
                  {hiddenDefaultScopeCount > 0
                    ? ` · +${hiddenDefaultScopeCount} 项`
                    : ""}
                </p>
              </>
            ) : (
              <p className="text-xs text-gray-500">
                尚未检测到 defaults 配置，将继承系统默认行为。
              </p>
            )}
          </div>

          <div className="rounded-xl border border-dark-500 bg-dark-700/70 p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium text-white">
              <AlertTriangle size={16} className="text-amber-400" />单 Agent
              覆盖（agents.list[i]）
            </div>
            <p className="text-xs text-gray-400">
              总 Agent：{agents.length} 个
            </p>
            <p className="text-xs text-gray-400">
              自定义 Agent：{customAgents.length} 个
            </p>
            <p className="text-xs text-gray-400">
              含覆盖字段：{overrideAgentsCount} 个
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-dark-500 bg-dark-700 p-6">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h3 className="text-lg font-semibold text-white">Default Agent</h3>
            <span className="rounded-md bg-dark-600 px-2 py-1 text-xs text-gray-400">
              {Object.keys(bindingsMap).length} 条 bindings
            </span>
          </div>

          {loading ? (
            <p className="text-sm text-gray-500">正在加载 Agent 数据...</p>
          ) : defaultAgent ? (
            <div className="rounded-xl border border-claw-500/40 bg-claw-500/10 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-semibold text-white">
                    <Bot size={16} className="text-claw-400" />
                    <span className="break-all">{defaultAgent.id}</span>
                  </p>
                  <p className="mt-1 text-xs text-gray-400">
                    ID 固定，name/workspace 可编辑
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {onOpenWorkspace && (
                    <button
                      type="button"
                      onClick={() => handleOpenWorkspace(defaultAgent.id)}
                      className="inline-flex min-h-[36px] items-center gap-1 rounded-md border border-dark-500 bg-dark-700 px-2 text-xs text-gray-300 transition-colors hover:bg-dark-600"
                    >
                      <Settings2 size={12} />
                      详情配置
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleDuplicateAgent(defaultAgent.id)}
                    className="inline-flex min-h-[36px] items-center gap-1 rounded-md border border-dark-500 bg-dark-700 px-2 text-xs text-gray-300 transition-colors hover:bg-dark-600"
                  >
                    <Copy size={12} />
                    复制 Agent
                  </button>
                </div>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-xs text-gray-300">
                  <span className="text-gray-400">名称（name）</span>
                  <input
                    type="text"
                    value={defaultAgent.name}
                    onChange={(event) =>
                      handleUpdateAgentField(
                        defaultAgent.id,
                        "name",
                        event.target.value
                      )
                    }
                    placeholder="未命名 Agent"
                    className="min-h-[36px] rounded-md border border-dark-500 bg-dark-700 px-2 text-sm text-white placeholder:text-gray-500 focus:border-claw-500 focus:outline-none"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-gray-300">
                  <span className="text-gray-400">工作目录（workspace）</span>
                  <input
                    type="text"
                    value={defaultAgent.workspace}
                    onChange={(event) =>
                      handleUpdateAgentField(
                        defaultAgent.id,
                        "workspace",
                        event.target.value
                      )
                    }
                    placeholder="例如 /home/openclaw-manager"
                    className="min-h-[36px] rounded-md border border-dark-500 bg-dark-700 px-2 text-sm text-white placeholder:text-gray-500 focus:border-claw-500 focus:outline-none"
                  />
                </label>
                <p className="text-xs text-gray-300">
                  绑定账号数：{bindingCountByAgent[defaultAgent.id] ?? 0}
                </p>
                <p className="text-xs text-gray-300">
                  覆盖字段：{Object.keys(defaultAgent.extra).length}
                </p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-500">
              当前未检测到可用 Agent，请先在设置页创建。
            </p>
          )}
        </div>

        <div className="rounded-2xl border border-dark-500 bg-dark-700 p-6">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h3 className="text-lg font-semibold text-white">
              自定义 Agent 列表
            </h3>
            <span className="rounded-md bg-dark-600 px-2 py-1 text-xs text-gray-400">
              {customAgents.length} 项
            </span>
          </div>

          {!loading && customAgents.length > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-dark-500 bg-dark-700/40 p-3">
              <label className="inline-flex items-center gap-2 text-xs text-gray-300">
                <input
                  type="checkbox"
                  checked={allCustomSelected}
                  onChange={(event) =>
                    handleSelectAllCustomAgents(event.target.checked)
                  }
                  className="h-4 w-4 rounded border-dark-500 bg-dark-700 text-claw-500 focus:ring-claw-500"
                />
                全选
              </label>
              <span className="text-xs text-gray-400">
                已选 {selectedCustomAgentsCount} 项
              </span>
              <button
                type="button"
                onClick={handleBatchDuplicateSelected}
                disabled={selectedCustomAgentsCount === 0 || saving}
                className="inline-flex min-h-[36px] items-center gap-1 rounded-md border border-dark-500 bg-dark-700 px-2 text-xs text-gray-200 transition-colors hover:bg-dark-600 disabled:opacity-50"
              >
                <Copy size={12} />
                批量复制选中
              </button>
              <button
                type="button"
                onClick={handleBatchDeleteSelected}
                disabled={selectedCustomAgentsCount === 0 || saving}
                className="inline-flex min-h-[36px] items-center gap-1 rounded-md border border-red-500/30 bg-red-500/10 px-2 text-xs text-red-300 transition-colors hover:bg-red-500/20 disabled:opacity-50"
              >
                <Trash2 size={12} />
                批量删除选中
              </button>
            </div>
          )}

          {!loading && customAgents.length === 0 ? (
            <div className="rounded-xl border border-dashed border-dark-500 bg-dark-700/40 p-6 text-center text-sm text-gray-500">
              暂无自定义 Agent，可前往设置页新增。
            </div>
          ) : (
            <div className="space-y-3">
              {customAgents.map((agent) => (
                <div
                  key={agent.id}
                  className="rounded-xl border border-dark-500 bg-dark-700/50 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-2">
                      <input
                        type="checkbox"
                        checked={selectedCustomAgentIds.has(agent.id)}
                        onChange={(event) =>
                          toggleSelectCustomAgent(
                            agent.id,
                            event.target.checked
                          )
                        }
                        disabled={saving}
                        className="mt-1 h-4 w-4 rounded border-dark-500 bg-dark-700 text-claw-500 focus:ring-claw-500"
                      />
                      <div className="min-w-0">
                        <p className="break-all text-sm font-medium text-white">
                          {agent.id}
                        </p>
                        <p className="mt-1 text-xs text-gray-400">
                          ID 固定，name/workspace 可编辑
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-end gap-2">
                      {onOpenWorkspace && (
                        <button
                          type="button"
                          onClick={() => handleOpenWorkspace(agent.id)}
                          className="inline-flex min-h-[36px] items-center gap-1 rounded-md border border-dark-500 bg-dark-700 px-2 text-xs text-gray-300 transition-colors hover:bg-dark-600"
                        >
                          <Settings2 size={12} />
                          详情配置
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleSetDefault(agent.id)}
                        className="inline-flex min-h-[36px] items-center gap-1 rounded-md border border-dark-500 bg-dark-700 px-2 text-xs text-gray-300 transition-colors hover:bg-dark-600"
                      >
                        <Star size={12} />
                        设为默认
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDuplicateAgent(agent.id)}
                        className="inline-flex min-h-[36px] items-center gap-1 rounded-md border border-dark-500 bg-dark-700 px-2 text-xs text-gray-300 transition-colors hover:bg-dark-600"
                      >
                        <Copy size={12} />
                        复制 Agent
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteAgent(agent.id)}
                        className="inline-flex min-h-[36px] items-center gap-1 rounded-md border border-red-500/30 bg-red-500/10 px-2 text-xs text-red-300 transition-colors hover:bg-red-500/20"
                      >
                        <Trash2 size={12} />
                        删除
                      </button>
                    </div>
                  </div>

                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <label className="flex flex-col gap-1 text-xs text-gray-300">
                      <span className="text-gray-400">名称（name）</span>
                      <input
                        type="text"
                        value={agent.name}
                        onChange={(event) =>
                          handleUpdateAgentField(
                            agent.id,
                            "name",
                            event.target.value
                          )
                        }
                        placeholder="未命名 Agent"
                        className="min-h-[36px] rounded-md border border-dark-500 bg-dark-700 px-2 text-sm text-white placeholder:text-gray-500 focus:border-claw-500 focus:outline-none"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-gray-300">
                      <span className="text-gray-400">
                        工作目录（workspace）
                      </span>
                      <input
                        type="text"
                        value={agent.workspace}
                        onChange={(event) =>
                          handleUpdateAgentField(
                            agent.id,
                            "workspace",
                            event.target.value
                          )
                        }
                        placeholder="例如 /home/openclaw-manager"
                        className="min-h-[36px] rounded-md border border-dark-500 bg-dark-700 px-2 text-sm text-white placeholder:text-gray-500 focus:border-claw-500 focus:outline-none"
                      />
                    </label>
                    <p className="text-xs text-gray-300">
                      绑定账号数：{bindingCountByAgent[agent.id] ?? 0}
                    </p>
                    <p className="text-xs text-gray-300">
                      覆盖字段：{Object.keys(agent.extra).length}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
