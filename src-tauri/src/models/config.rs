use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// OpenClaw 完整配置 - 对应 openclaw.json 结构
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct OpenClawConfig {
    /// Agent 配置
    #[serde(default)]
    pub agents: AgentsConfig,
    /// 模型配置
    #[serde(default)]
    pub models: ModelsConfig,
    /// 网关配置
    #[serde(default)]
    pub gateway: GatewayConfig,
    /// 渠道配置
    #[serde(default)]
    pub channels: HashMap<String, ChannelProviderConfig>,
    /// 插件配置
    #[serde(default)]
    pub plugins: PluginsConfig,
    /// 路由绑定配置（支持数组与对象两种常见写法）
    #[serde(default)]
    pub bindings: Option<BindingsConfig>,
    /// 工具配置
    #[serde(default)]
    pub tools: Option<serde_json::Value>,
    /// 消息配置
    #[serde(default)]
    pub messages: Option<serde_json::Value>,
    /// 命令配置
    #[serde(default)]
    pub commands: Option<serde_json::Value>,
    /// Web 配置
    #[serde(default)]
    pub web: Option<serde_json::Value>,
    /// 发现配置
    #[serde(default)]
    pub discovery: Option<serde_json::Value>,
    /// 元数据
    #[serde(default)]
    pub meta: MetaConfig,
}

/// Agent 配置
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AgentsConfig {
    /// 默认配置
    #[serde(default)]
    pub defaults: AgentDefaults,
    /// Agent 列表（兼容官方 agents.list）
    #[serde(default)]
    pub list: Vec<AgentEntry>,
}

/// Agent 默认配置
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AgentDefaults {
    /// 模型配置
    #[serde(default)]
    pub model: AgentModelConfig,
    /// 可用模型列表 (provider/model -> {})
    #[serde(default)]
    pub models: HashMap<String, serde_json::Value>,
    /// 压缩配置
    #[serde(default)]
    pub compaction: Option<serde_json::Value>,
    /// 上下文裁剪
    #[serde(rename = "contextPruning", default)]
    pub context_pruning: Option<serde_json::Value>,
    /// 心跳配置
    #[serde(default)]
    pub heartbeat: Option<serde_json::Value>,
    /// 最大并发数
    #[serde(rename = "maxConcurrent", default)]
    pub max_concurrent: Option<u32>,
    /// 子代理配置
    #[serde(default)]
    pub subagents: Option<serde_json::Value>,
}

/// Agent 模型配置
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AgentModelConfig {
    /// 主模型 (格式: provider/model-id)
    #[serde(default)]
    pub primary: Option<String>,
}

/// Agent 列表项（强类型 + flatten 兼容未知字段）
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AgentEntry {
    /// Agent 唯一标识
    #[serde(default)]
    pub id: Option<String>,
    /// 显示名称
    #[serde(default)]
    pub name: Option<String>,
    /// 是否默认 Agent
    #[serde(default)]
    pub default: Option<bool>,
    /// 工作目录
    #[serde(default)]
    pub workspace: Option<String>,
    /// Agent 模型配置
    #[serde(default)]
    pub model: Option<serde_json::Value>,
    /// Agent 工具配置
    #[serde(default)]
    pub tools: Option<serde_json::Value>,
    /// Agent 沙箱配置
    #[serde(default)]
    pub sandbox: Option<serde_json::Value>,
    /// Agent 额外字段（未知字段不报错）
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

/// bindings 支持结构
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum BindingsConfig {
    /// 官方数组结构
    Entries(Vec<BindingEntry>),
    /// 对象结构（扁平/分组）
    Map(serde_json::Map<String, serde_json::Value>),
}

impl Default for BindingsConfig {
    fn default() -> Self {
        Self::Entries(Vec::new())
    }
}

impl BindingsConfig {
    pub fn as_value(&self) -> serde_json::Value {
        match self {
            Self::Entries(entries) => serde_json::to_value(entries)
                .unwrap_or_else(|_| serde_json::Value::Array(vec![])),
            Self::Map(map) => serde_json::Value::Object(map.clone()),
        }
    }

    pub fn into_value(self) -> serde_json::Value {
        match self {
            Self::Entries(entries) => {
                serde_json::to_value(entries).unwrap_or_else(|_| serde_json::Value::Array(vec![]))
            }
            Self::Map(map) => serde_json::Value::Object(map),
        }
    }
}

/// 单条 bindings 路由
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct BindingEntry {
    #[serde(rename = "agentId", default)]
    pub agent_id: Option<String>,
    #[serde(default)]
    pub r#match: Option<BindingMatch>,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

/// bindings 匹配条件
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct BindingMatch {
    #[serde(default)]
    pub channel: Option<String>,
    #[serde(rename = "accountId", default)]
    pub account_id: Option<String>,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

/// 模型配置
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ModelsConfig {
    /// Provider 配置映射
    #[serde(default)]
    pub providers: HashMap<String, ProviderConfig>,
}

/// Provider 配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderConfig {
    /// API 地址
    #[serde(rename = "baseUrl")]
    pub base_url: String,
    /// API Key
    #[serde(rename = "apiKey")]
    pub api_key: Option<String>,
    /// 模型列表
    #[serde(default)]
    pub models: Vec<ModelConfig>,
}

/// 模型配置详情
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelConfig {
    /// 模型 ID
    pub id: String,
    /// 显示名称
    pub name: String,
    /// API 类型 (anthropic-messages / openai-completions)
    #[serde(default)]
    pub api: Option<String>,
    /// 支持的输入类型
    #[serde(default)]
    pub input: Vec<String>,
    /// 上下文窗口大小
    #[serde(rename = "contextWindow", default)]
    pub context_window: Option<u32>,
    /// 最大输出 Token
    #[serde(rename = "maxTokens", default)]
    pub max_tokens: Option<u32>,
    /// 是否支持推理模式
    #[serde(default)]
    pub reasoning: Option<bool>,
    /// 成本配置
    #[serde(default)]
    pub cost: Option<ModelCostConfig>,
}

/// 模型成本配置
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ModelCostConfig {
    #[serde(default)]
    pub input: f64,
    #[serde(default)]
    pub output: f64,
    #[serde(rename = "cacheRead", default)]
    pub cache_read: f64,
    #[serde(rename = "cacheWrite", default)]
    pub cache_write: f64,
}

/// 网关配置
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct GatewayConfig {
    /// 模式：local 或 cloud
    #[serde(default)]
    pub mode: Option<String>,
    /// 监听端口
    #[serde(default)]
    pub port: Option<u16>,
    /// 监听地址
    #[serde(default)]
    pub bind: Option<String>,
    /// 可信代理列表
    #[serde(rename = "trustedProxies", default)]
    pub trusted_proxies: Option<Vec<String>>,
    /// 热重载配置
    #[serde(default)]
    pub reload: Option<serde_json::Value>,
    /// 认证配置
    #[serde(default)]
    pub auth: Option<GatewayAuthConfig>,
}

/// 网关认证配置
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct GatewayAuthConfig {
    #[serde(default)]
    pub mode: Option<String>,
    #[serde(default)]
    pub token: Option<String>,
}

/// 渠道 Provider 配置（兼容 accounts 多账号）
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ChannelProviderConfig {
    /// 是否启用
    #[serde(default)]
    pub enabled: Option<bool>,
    /// 多账号配置
    #[serde(default)]
    pub accounts: HashMap<String, serde_json::Value>,
    /// 其余字段保持兼容
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

/// 插件配置
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PluginsConfig {
    #[serde(default)]
    pub allow: Vec<String>,
    #[serde(default)]
    pub entries: HashMap<String, serde_json::Value>,
    #[serde(default)]
    pub installs: HashMap<String, serde_json::Value>,
}

/// 元数据配置
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct MetaConfig {
    #[serde(rename = "lastTouchedAt", default)]
    pub last_touched_at: Option<String>,
    #[serde(rename = "lastTouchedVersion", default)]
    pub last_touched_version: Option<String>,
}

// ============ 前端展示用数据结构 ============

/// 官方 Provider 预设（用于前端展示）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OfficialProvider {
    /// Provider ID (用于配置中)
    pub id: String,
    /// 显示名称
    pub name: String,
    /// 图标（emoji）
    pub icon: String,
    /// 官方 API 地址
    pub default_base_url: Option<String>,
    /// API 类型
    pub api_type: String,
    /// 推荐模型列表
    pub suggested_models: Vec<SuggestedModel>,
    /// 是否需要 API Key
    pub requires_api_key: bool,
    /// 文档链接
    pub docs_url: Option<String>,
}

/// 推荐模型
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SuggestedModel {
    /// 模型 ID
    pub id: String,
    /// 显示名称
    pub name: String,
    /// 描述
    pub description: Option<String>,
    /// 上下文窗口
    pub context_window: Option<u32>,
    /// 最大输出
    pub max_tokens: Option<u32>,
    /// 是否推荐
    pub recommended: bool,
}

/// 已配置的 Provider（从配置文件读取）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfiguredProvider {
    /// Provider 名称 (配置中的 key)
    pub name: String,
    /// API 地址
    pub base_url: String,
    /// API Key (脱敏显示)
    pub api_key_masked: Option<String>,
    /// 是否有 API Key
    pub has_api_key: bool,
    /// 配置的模型列表
    pub models: Vec<ConfiguredModel>,
}

/// 已配置的模型
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfiguredModel {
    /// 完整模型 ID (provider/model-id)
    pub full_id: String,
    /// 模型 ID
    pub id: String,
    /// 显示名称
    pub name: String,
    /// API 类型
    pub api_type: Option<String>,
    /// 上下文窗口
    pub context_window: Option<u32>,
    /// 最大输出
    pub max_tokens: Option<u32>,
    /// 是否为主模型
    pub is_primary: bool,
}

/// AI 配置概览（返回给前端）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AIConfigOverview {
    /// 主模型
    pub primary_model: Option<String>,
    /// 已配置的 Provider 列表
    pub configured_providers: Vec<ConfiguredProvider>,
    /// 可用模型列表
    pub available_models: Vec<String>,
    /// agents.list（用于配置总览与最小可视化编辑流）
    #[serde(default)]
    pub agents_list: Vec<AgentEntry>,
    /// bindings（数组/对象均可）
    #[serde(default)]
    pub bindings: Option<BindingsConfig>,
}

// ============ 旧数据结构保持兼容 ============

/// AI Provider 选项（用于前端展示）- 旧版兼容
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AIProviderOption {
    /// Provider ID
    pub id: String,
    /// 显示名称
    pub name: String,
    /// 图标（emoji）
    pub icon: String,
    /// 官方 API 地址
    pub default_base_url: Option<String>,
    /// 推荐模型列表
    pub models: Vec<AIModelOption>,
    /// 是否需要 API Key
    pub requires_api_key: bool,
}

/// AI 模型选项 - 旧版兼容
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AIModelOption {
    /// 模型 ID
    pub id: String,
    /// 显示名称
    pub name: String,
    /// 描述
    pub description: Option<String>,
    /// 是否推荐
    pub recommended: bool,
}

/// 渠道配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChannelConfig {
    /// 渠道 ID
    pub id: String,
    /// 渠道类型
    pub channel_type: String,
    /// 是否启用
    pub enabled: bool,
    /// 配置详情（兼容旧版前端平铺字段）
    pub config: HashMap<String, serde_json::Value>,
    /// 多账号配置（兼容 channels.<provider>.accounts）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub accounts: Option<HashMap<String, serde_json::Value>>,
}

/// 环境变量配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnvConfig {
    pub key: String,
    pub value: String,
}
