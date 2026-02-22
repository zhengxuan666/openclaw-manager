use crate::models::{
    AIConfigOverview, BindingEntry, BindingsConfig, ChannelConfig, ConfiguredModel,
    ConfiguredProvider, ModelConfig, ModelCostConfig, OfficialProvider,
    OpenClawConfig, ProviderConfig, SuggestedModel,
};
use crate::utils::{file, platform, shell};
use log::{debug, error, info, warn};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::time::UNIX_EPOCH;
use tauri::command;

const INCLUDE_DIRECTIVE_KEY: &str = "$include";
const MAX_INCLUDE_DEPTH: usize = 10;

/// 解析 openclaw 配置（JSON / JSON5）
fn parse_openclaw_config_content(content: &str) -> Result<Value, String> {
    // 优先兼容官方 JSON5 语法（注释、尾逗号等），同时保留对标准 JSON 的兜底兼容
    match json5::from_str(content) {
        Ok(v) => Ok(v),
        Err(json5_err) => match serde_json::from_str(content) {
            Ok(v) => Ok(v),
            Err(json_err) => Err(format!(
                "JSON/JSON5 解析失败: JSON5 错误: {}; JSON 错误: {}",
                json5_err, json_err
            )),
        },
    }
}

fn value_type_name(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "boolean",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
    }
}

fn deep_merge_json(target: &mut Value, source: Value) {
    match (target, source) {
        (Value::Object(target_map), Value::Object(source_map)) => {
            for (key, source_value) in source_map {
                if let Some(existing) = target_map.get_mut(&key) {
                    deep_merge_json(existing, source_value);
                } else {
                    target_map.insert(key, source_value);
                }
            }
        }
        (target_value, source_value) => {
            *target_value = source_value;
        }
    }
}

fn parse_include_entries(include_value: &Value, current_file: &PathBuf) -> Result<Vec<String>, String> {
    match include_value {
        Value::String(path) => {
            let trimmed = path.trim();
            if trimmed.is_empty() {
                return Err(format!(
                    "include 配置无效：路径不能为空（来源文件: {}）",
                    current_file.display()
                ));
            }
            Ok(vec![trimmed.to_string()])
        }
        Value::Array(items) => {
            let mut paths = Vec::with_capacity(items.len());
            for (index, item) in items.iter().enumerate() {
                let Value::String(path) = item else {
                    return Err(format!(
                        "include 配置无效：数组第 {} 项必须为字符串（来源文件: {}）",
                        index,
                        current_file.display()
                    ));
                };

                let trimmed = path.trim();
                if trimmed.is_empty() {
                    return Err(format!(
                        "include 配置无效：数组第 {} 项路径不能为空（来源文件: {}）",
                        index,
                        current_file.display()
                    ));
                }
                paths.push(trimmed.to_string());
            }
            Ok(paths)
        }
        _ => Err(format!(
            "include 配置无效：必须是字符串或字符串数组（来源文件: {}）",
            current_file.display()
        )),
    }
}

fn resolve_include_path(
    include_path: &str,
    current_file: &PathBuf,
    config_root: &PathBuf,
) -> Result<PathBuf, String> {
    let requested = PathBuf::from(include_path);
    let resolved = if requested.is_absolute() {
        requested
    } else {
        current_file
            .parent()
            .unwrap_or(config_root.as_path())
            .join(requested)
    };

    if !resolved.exists() {
        return Err(format!(
            "include 文件不存在: {}（来源文件: {}）",
            resolved.display(),
            current_file.display()
        ));
    }

    if !resolved.is_file() {
        return Err(format!(
            "include 路径不是文件: {}（来源文件: {}）",
            resolved.display(),
            current_file.display()
        ));
    }

    let canonical = fs::canonicalize(&resolved).map_err(|e| {
        format!(
            "解析 include 路径失败: {}（来源文件: {}，错误: {}）",
            resolved.display(),
            current_file.display(),
            e
        )
    })?;

    if !canonical.starts_with(config_root) {
        return Err(format!(
            "include 路径越界: {}（来源文件: {}，配置根目录: {}）",
            canonical.display(),
            current_file.display(),
            config_root.display()
        ));
    }

    Ok(canonical)
}

fn format_include_cycle(chain: &[PathBuf], next: &PathBuf) -> String {
    let mut items: Vec<String> = chain.iter().map(|p| p.display().to_string()).collect();
    items.push(next.display().to_string());
    items.join(" -> ")
}

fn expand_includes(
    value: Value,
    current_file: &PathBuf,
    config_root: &PathBuf,
    include_chain: &mut Vec<PathBuf>,
    depth: usize,
) -> Result<Value, String> {
    match value {
        Value::Object(mut map) => {
            if let Some(include_value) = map.remove(INCLUDE_DIRECTIVE_KEY) {
                if depth > MAX_INCLUDE_DEPTH {
                    return Err(format!(
                        "include 嵌套深度超过限制（最大 {}）: {}",
                        MAX_INCLUDE_DEPTH,
                        current_file.display()
                    ));
                }

                let include_entries = parse_include_entries(&include_value, current_file)?;
                let mut merged = Value::Object(serde_json::Map::new());

                for include_entry in include_entries {
                    let include_file = resolve_include_path(&include_entry, current_file, config_root)?;
                    if include_chain.iter().any(|path| path == &include_file) {
                        return Err(format!(
                            "检测到 include 循环引用: {}",
                            format_include_cycle(include_chain, &include_file)
                        ));
                    }

                    include_chain.push(include_file.clone());
                    let include_content = file::read_file(include_file.to_string_lossy().as_ref())
                        .map_err(|e| {
                            format!("读取 include 文件失败: {}（{}）", e, include_file.display())
                        })?;

                    let include_parsed = parse_openclaw_config_content(&include_content).map_err(|e| {
                        format!("include 文件解析失败: {}（{}）", e, include_file.display())
                    })?;

                    let include_expanded = match expand_includes(
                        include_parsed,
                        &include_file,
                        config_root,
                        include_chain,
                        depth + 1,
                    ) {
                        Ok(v) => v,
                        Err(err) => {
                            include_chain.pop();
                            return Err(err);
                        }
                    };
                    include_chain.pop();

                    if !include_expanded.is_object() {
                        return Err(format!(
                            "include 文件内容必须是对象: {}（实际: {}）",
                            include_file.display(),
                            value_type_name(&include_expanded)
                        ));
                    }

                    deep_merge_json(&mut merged, include_expanded);
                }

                let mut merged_map = match merged {
                    Value::Object(obj) => obj,
                    _ => serde_json::Map::new(),
                };

                for (key, sibling_value) in map {
                    let resolved_sibling =
                        expand_includes(sibling_value, current_file, config_root, include_chain, depth)?;
                    if let Some(existing) = merged_map.get_mut(&key) {
                        deep_merge_json(existing, resolved_sibling);
                    } else {
                        merged_map.insert(key, resolved_sibling);
                    }
                }

                Ok(Value::Object(merged_map))
            } else {
                let mut resolved_map = serde_json::Map::with_capacity(map.len());
                for (key, child) in map {
                    let resolved_child =
                        expand_includes(child, current_file, config_root, include_chain, depth)?;
                    resolved_map.insert(key, resolved_child);
                }
                Ok(Value::Object(resolved_map))
            }
        }
        Value::Array(arr) => {
            let mut resolved = Vec::with_capacity(arr.len());
            for child in arr {
                resolved.push(expand_includes(
                    child,
                    current_file,
                    config_root,
                    include_chain,
                    depth,
                )?);
            }
            Ok(Value::Array(resolved))
        }
        _ => Ok(value),
    }
}

/// 获取 openclaw.json 配置（展开 $include，不做变量替换）
fn load_openclaw_config_raw() -> Result<Value, String> {
    let config_path = PathBuf::from(platform::get_config_file_path());

    if !file::file_exists(config_path.to_string_lossy().as_ref()) {
        return Ok(json!({}));
    }

    let config_root = PathBuf::from(platform::get_config_dir());
    let canonical_root = fs::canonicalize(&config_root).map_err(|e| {
        format!(
            "解析配置目录失败: {}（错误: {}）",
            config_root.display(),
            e
        )
    })?;

    let canonical_config = fs::canonicalize(&config_path).map_err(|e| {
        format!(
            "解析主配置文件路径失败: {}（错误: {}）",
            config_path.display(),
            e
        )
    })?;

    if !canonical_config.starts_with(&canonical_root) {
        return Err(format!(
            "主配置文件越界: {}（配置根目录: {}）",
            canonical_config.display(),
            canonical_root.display()
        ));
    }

    let content = file::read_file(canonical_config.to_string_lossy().as_ref())
        .map_err(|e| format!("读取配置文件失败: {}", e))?;
    let parsed = parse_openclaw_config_content(&content)?;

    let mut include_chain = vec![canonical_config.clone()];
    expand_includes(parsed, &canonical_config, &canonical_root, &mut include_chain, 0)
}

/// 读取 ~/.openclaw/env 环境变量
fn load_env_file_vars() -> HashMap<String, String> {
    let env_path = platform::get_env_file_path();
    let mut vars = HashMap::new();

    let content = match file::read_file(&env_path) {
        Ok(c) => c,
        Err(_) => return vars,
    };

    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }

        let line = line.strip_prefix("export ").unwrap_or(line);
        if let Some((key, value)) = line.split_once('=') {
            let key = key.trim();
            let value = value.trim().trim_matches('"').trim_matches('\'');
            if !key.is_empty() {
                vars.insert(key.to_string(), value.to_string());
            }
        }
    }

    vars
}

fn format_config_path(path: &str) -> String {
    if path.is_empty() {
        "/".to_string()
    } else {
        path.to_string()
    }
}

fn escape_json_pointer_segment(segment: &str) -> String {
    segment.replace('~', "~0").replace('/', "~1")
}

fn join_config_path(path: &str, segment: &str) -> String {
    if path.is_empty() {
        format!("/{}", segment)
    } else {
        format!("{}/{}", path, segment)
    }
}

/// 字符串中的变量替换：支持 ${VAR}；支持 $${VAR} 作为字面量 ${VAR}
fn replace_config_vars_in_string(
    input: &str,
    env_file_vars: &HashMap<String, String>,
    config_path: &str,
) -> Result<String, String> {
    let mut output = String::with_capacity(input.len());
    let bytes = input.as_bytes();
    let mut i = 0;

    while i < bytes.len() {
        if bytes[i] == b'$' {
            // 转义：$${VAR} -> ${VAR}
            if i + 2 < bytes.len() && bytes[i + 1] == b'$' && bytes[i + 2] == b'{' {
                if let Some(end_rel) = input[i + 3..].find('}') {
                    let end = i + 3 + end_rel;
                    let var_name = &input[i + 3..end];
                    output.push_str("${");
                    output.push_str(var_name);
                    output.push('}');
                    i = end + 1;
                    continue;
                } else {
                    return Err(format!(
                        "配置变量替换失败: 路径 {} 存在无法解析的占位符（缺少右花括号）",
                        format_config_path(config_path)
                    ));
                }
            }

            // 常规变量：${VAR}
            if i + 1 < bytes.len() && bytes[i + 1] == b'{' {
                if let Some(end_rel) = input[i + 2..].find('}') {
                    let end = i + 2 + end_rel;
                    let var_name = input[i + 2..end].trim();
                    if var_name.is_empty() {
                        return Err(format!(
                            "配置变量替换失败: 路径 {} 变量名不能为空",
                            format_config_path(config_path)
                        ));
                    }

                    let var_value = std::env::var(var_name)
                        .ok()
                        .or_else(|| env_file_vars.get(var_name).cloned())
                        .ok_or_else(|| {
                            format!(
                                "配置变量替换失败: 路径 {} 缺失变量 {}",
                                format_config_path(config_path),
                                var_name
                            )
                        })?;

                    output.push_str(&var_value);
                    i = end + 1;
                    continue;
                } else {
                    return Err(format!(
                        "配置变量替换失败: 路径 {} 存在无法解析的占位符（缺少右花括号）",
                        format_config_path(config_path)
                    ));
                }
            }
        }

        let ch = input[i..].chars().next().unwrap_or('\0');
        output.push(ch);
        i += ch.len_utf8();
    }

    Ok(output)
}

/// 递归替换 Value 中所有字符串变量，支持对象/数组
fn replace_config_vars(
    value: &mut Value,
    env_file_vars: &HashMap<String, String>,
    path: &str,
) -> Result<(), String> {
    match value {
        Value::String(s) => {
            *s = replace_config_vars_in_string(s, env_file_vars, path)?;
        }
        Value::Array(arr) => {
            for (idx, item) in arr.iter_mut().enumerate() {
                let child_path = join_config_path(path, &idx.to_string());
                replace_config_vars(item, env_file_vars, &child_path)?;
            }
        }
        Value::Object(map) => {
            for (key, v) in map.iter_mut() {
                let child_path = join_config_path(path, &escape_json_pointer_segment(key));
                replace_config_vars(v, env_file_vars, &child_path)?;
            }
        }
        _ => {}
    }

    Ok(())
}

/// 获取 openclaw.json 配置（读取后执行 ${VAR} 替换）
fn load_openclaw_config() -> Result<Value, String> {
    let mut config = load_openclaw_config_raw()?;
    let env_file_vars = load_env_file_vars();
    replace_config_vars(&mut config, &env_file_vars, "")?;
    Ok(config)
}

/// 将 Value 按 OpenClawConfig 结构做一次校验，确保核心字段语义稳定。
/// - 缺失字段：依赖读取端默认逻辑（不强行改写原始 JSON）
/// - 未知字段：serde 默认忽略未知字段，不导致整体失败
/// - 类型错误：返回可定位语义错误，便于前端 toast
fn normalize_and_validate_config(config: &Value) -> Result<Value, String> {
    // 针对 agents.list / bindings 给出更聚焦的类型错误语义
    if let Some(agents_list) = config.pointer("/agents/list") {
        if !agents_list.is_array() {
            return Err("agents.list 结构无效：必须为数组".to_string());
        }
    }

    if let Some(bindings) = config.get("bindings") {
        if !bindings.is_array() && !bindings.is_object() {
            return Err("bindings 结构无效：必须为数组或对象".to_string());
        }
    }

    serde_json::from_value::<OpenClawConfig>(config.clone()).map_err(|e| {
        format!("配置结构无效（请检查字段类型，例如 agents.list / bindings）: {}", e)
    })?;

    Ok(config.clone())
}

/// 保存 openclaw.json 配置
fn save_openclaw_config(config: &Value) -> Result<(), String> {
    let config_path = platform::get_config_file_path();

    let normalized = normalize_and_validate_config(config)?;

    let content = serde_json::to_string_pretty(&normalized)
        .map_err(|e| format!("序列化配置失败: {}", e))?;

    file::write_file(&config_path, &content).map_err(|e| format!("写入配置文件失败: {}", e))
}

/// 获取完整配置
#[command]
pub async fn get_config() -> Result<Value, String> {
    info!("[获取配置] 读取 openclaw.json 配置...");
    let result = load_openclaw_config().and_then(|config| normalize_and_validate_config(&config));
    match &result {
        Ok(_) => info!("[获取配置] ✓ 配置读取成功"),
        Err(e) => error!("[获取配置] ✗ 配置读取失败: {}", e),
    }
    result
}

/// 合并 gateway 关键字段，避免保存配置时误丢失关键网络参数
fn merge_gateway_critical_fields(target: &mut Value, source: &Value) {
    let Some(source_gateway) = source.get("gateway").and_then(|v| v.as_object()) else {
        return;
    };

    if target.get("gateway").and_then(|v| v.as_object()).is_none() {
        target["gateway"] = json!({});
    }

    let Some(target_gateway) = target.get_mut("gateway").and_then(|v| v.as_object_mut()) else {
        return;
    };

    for field in ["port", "bind", "trustedProxies", "reload"] {
        if !target_gateway.contains_key(field) {
            if let Some(value) = source_gateway.get(field) {
                target_gateway.insert(field.to_string(), value.clone());
            }
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigValidationIssue {
    pub path: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub variable: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ConfigValidationResult {
    pub valid: bool,
    #[serde(default)]
    pub issues: Vec<ConfigValidationIssue>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigDiffItem {
    pub kind: String,
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub before: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub after: Option<Value>,
    pub masked: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ConfigDiffSummary {
    pub added: usize,
    pub modified: usize,
    pub removed: usize,
    #[serde(default)]
    pub changes: Vec<ConfigDiffItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PreviewConfigResponse {
    pub preview_config: Value,
    pub diff_summary: ConfigDiffSummary,
    pub validation: ConfigValidationResult,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApplyConfigResponse {
    pub backup_path: String,
    pub applied_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RollbackConfigResponse {
    pub restored_path: String,
    pub restored_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigBackupItem {
    pub path: String,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    pub size: u64,
}

fn format_timestamp_from_system_time(system_time: std::time::SystemTime) -> String {
    match system_time.duration_since(UNIX_EPOCH) {
        Ok(duration) => match chrono::DateTime::<chrono::Utc>::from_timestamp(duration.as_secs() as i64, 0) {
            Some(dt) => dt.to_rfc3339(),
            None => duration.as_secs().to_string(),
        },
        Err(_) => chrono::Utc::now().to_rfc3339(),
    }
}

fn format_now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn timestamp_for_backup_name() -> String {
    chrono::Utc::now().format("%Y%m%d-%H%M%S-%3f").to_string()
}

fn is_sensitive_key(key: &str) -> bool {

    let lower = key.to_ascii_lowercase();
    [
        "apikey",
        "api_key",
        "token",
        "secret",
        "password",
        "privatekey",
        "private_key",
        "authorization",
        "bearer",
    ]
    .iter()
    .any(|keyword| lower.contains(keyword))
}

fn redact_sensitive_value(value: &Value) -> Value {
    match value {
        Value::Object(obj) => {
            let mut next = serde_json::Map::new();
            for (key, nested) in obj {
                if is_sensitive_key(key) {
                    next.insert(key.clone(), Value::String("***".to_string()));
                } else {
                    next.insert(key.clone(), redact_sensitive_value(nested));
                }
            }
            Value::Object(next)
        }
        Value::Array(arr) => Value::Array(arr.iter().map(redact_sensitive_value).collect()),
        _ => value.clone(),
    }
}

const OPTIONAL_NULL_EQ_PATH_PATTERNS: &[&str] = &[
    "/bindings",
    "/tools",
    "/messages",
    "/commands",
    "/web",
    "/discovery",
    "/agents/list/*/name",
    "/agents/list/*/workspace",
    "/agents/list/*/default",
    "/agents/list/*/model",
    "/agents/list/*/tools",
    "/agents/list/*/sandbox",
    "/bindings/*/agentId",
    "/bindings/*/match",
    "/bindings/*/match/channel",
    "/bindings/*/match/accountId",
];

const OPTIONAL_FALSE_MISSING_PATH_PATTERNS: &[&str] = &["/agents/list/*/default"];

const OPTIONAL_EMPTY_MISSING_PATH_PATTERNS: &[&str] = &[
    "/bindings",
    "/tools",
    "/messages",
    "/commands",
    "/web",
    "/discovery",
    "/agents/list/*/model",
    "/agents/list/*/tools",
    "/agents/list/*/sandbox",
    "/bindings/*/match",
];

fn normalize_diff_path(path: &str) -> String {
    if path.is_empty() {
        "/".to_string()
    } else {
        path.to_string()
    }
}

fn json_pointer_segments(path: &str) -> Vec<String> {
    if path.is_empty() || path == "/" {
        return Vec::new();
    }

    path.trim_start_matches('/')
        .split('/')
        .filter(|segment| !segment.is_empty())
        .map(|segment| segment.to_string())
        .collect()
}

fn json_pointer_matches_pattern(path: &str, pattern: &str) -> bool {
    let path_segments = json_pointer_segments(path);
    let pattern_segments = json_pointer_segments(pattern);

    if path_segments.len() != pattern_segments.len() {
        return false;
    }

    path_segments
        .iter()
        .zip(pattern_segments.iter())
        .all(|(path_segment, pattern_segment)| {
            pattern_segment == "*" || path_segment == pattern_segment
        })
}

fn matches_any_json_pointer_pattern(path: &str, patterns: &[&str]) -> bool {
    patterns
        .iter()
        .any(|pattern| json_pointer_matches_pattern(path, pattern))
}

fn is_empty_container(value: &Value) -> bool {
    match value {
        Value::Object(map) => map.is_empty(),
        Value::Array(arr) => arr.is_empty(),
        _ => false,
    }
}

fn is_optional_null_equivalent(path: &str, before: Option<&Value>, after: Option<&Value>) -> bool {
    if !matches_any_json_pointer_pattern(path, OPTIONAL_NULL_EQ_PATH_PATTERNS) {
        return false;
    }

    matches!((before, after), (None, Some(Value::Null)) | (Some(Value::Null), None))
}

fn is_optional_false_missing_equivalent(
    path: &str,
    before: Option<&Value>,
    after: Option<&Value>,
) -> bool {
    if !matches_any_json_pointer_pattern(path, OPTIONAL_FALSE_MISSING_PATH_PATTERNS) {
        return false;
    }

    matches!(
        (before, after),
        (None, Some(Value::Bool(false))) | (Some(Value::Bool(false)), None)
    )
}

fn is_optional_empty_missing_equivalent(
    path: &str,
    before: Option<&Value>,
    after: Option<&Value>,
) -> bool {
    if !matches_any_json_pointer_pattern(path, OPTIONAL_EMPTY_MISSING_PATH_PATTERNS) {
        return false;
    }

    match (before, after) {
        (None, Some(value)) | (Some(value), None) => is_empty_container(value),
        _ => false,
    }
}

fn is_semantically_equal(path: &str, before: Option<&Value>, after: Option<&Value>) -> bool {
    match (before, after) {
        (None, None) => true,
        (Some(before_value), Some(after_value)) if before_value == after_value => true,
        _ => {
            is_optional_null_equivalent(path, before, after)
                || is_optional_false_missing_equivalent(path, before, after)
                || is_optional_empty_missing_equivalent(path, before, after)
        }
    }
}

fn build_diff_item(kind: &str, path: &str, before: Option<&Value>, after: Option<&Value>) -> ConfigDiffItem {
    let before_redacted = before.map(redact_sensitive_value);
    let after_redacted = after.map(redact_sensitive_value);

    let before_masked = before_redacted
        .as_ref()
        .zip(before)
        .map(|(redacted, raw)| redacted != raw)
        .unwrap_or(false);
    let after_masked = after_redacted
        .as_ref()
        .zip(after)
        .map(|(redacted, raw)| redacted != raw)
        .unwrap_or(false);

    ConfigDiffItem {
        kind: kind.to_string(),
        path: normalize_diff_path(path),
        before: before_redacted,
        after: after_redacted,
        masked: before_masked || after_masked,
    }
}

fn collect_diff_items(
    path: &str,
    before: Option<&Value>,
    after: Option<&Value>,
    changes: &mut Vec<ConfigDiffItem>,
) {
    if is_semantically_equal(path, before, after) {
        return;
    }

    match (before, after) {
        (Some(Value::Object(before_obj)), Some(Value::Object(after_obj))) => {
            let mut keys: Vec<String> = before_obj
                .keys()
                .chain(after_obj.keys())
                .cloned()
                .collect();
            keys.sort();
            keys.dedup();

            for key in keys {
                let child_path = join_config_path(path, &escape_json_pointer_segment(&key));
                collect_diff_items(&child_path, before_obj.get(&key), after_obj.get(&key), changes);
            }
        }
        (Some(Value::Array(before_arr)), Some(Value::Array(after_arr))) => {
            let max_len = before_arr.len().max(after_arr.len());
            for index in 0..max_len {
                let child_path = join_config_path(path, &index.to_string());
                collect_diff_items(&child_path, before_arr.get(index), after_arr.get(index), changes);
            }
        }
        (None, Some(after_value)) => {
            changes.push(build_diff_item("added", path, None, Some(after_value)));
        }
        (Some(before_value), None) => {
            changes.push(build_diff_item("removed", path, Some(before_value), None));
        }
        (Some(before_value), Some(after_value)) => {
            changes.push(build_diff_item(
                "modified",
                path,
                Some(before_value),
                Some(after_value),
            ));
        }
        (None, None) => {}
    }
}

fn build_config_diff_summary(before: &Value, after: &Value) -> ConfigDiffSummary {
    let mut changes: Vec<ConfigDiffItem> = Vec::new();
    collect_diff_items("", Some(before), Some(after), &mut changes);

    let mut summary = ConfigDiffSummary::default();
    for change in &changes {
        match change.kind.as_str() {
            "added" => summary.added += 1,
            "modified" => summary.modified += 1,
            "removed" => summary.removed += 1,
            _ => {}
        }
    }
    summary.changes = changes;
    summary
}

fn validate_preview_input(input_config: &Value) -> ConfigValidationResult {
    let mut issues: Vec<ConfigValidationIssue> = Vec::new();

    if let Err(error) = normalize_and_validate_config(input_config) {
        issues.push(ConfigValidationIssue {
            path: "/".to_string(),
            message: error,
            variable: None,
        });
    }

    let mut replaced = input_config.clone();
    let env_vars = load_env_file_vars();
    if let Err(error) = replace_config_vars(&mut replaced, &env_vars, "") {
        let variable = error
            .split("缺失变量 ")
            .nth(1)
            .map(|part| part.trim().to_string())
            .filter(|part| !part.is_empty());
        issues.push(ConfigValidationIssue {
            path: "/".to_string(),
            message: error,
            variable,
        });
    }

    ConfigValidationResult {
        valid: issues.is_empty(),
        issues,
    }
}

fn ensure_backup_dir() -> Result<PathBuf, String> {
    let backup_dir = PathBuf::from(platform::get_config_dir()).join("backups");
    fs::create_dir_all(&backup_dir).map_err(|e| format!("创建配置备份目录失败: {}", e))?;
    Ok(backup_dir)
}

fn create_backup_filename() -> String {
    format!("openclaw-{}.json", timestamp_for_backup_name())
}

fn write_backup_snapshot(config_value: &Value) -> Result<String, String> {
    let backup_dir = ensure_backup_dir()?;
    let backup_path = backup_dir.join(create_backup_filename());
    let backup_path_str = backup_path.to_string_lossy().to_string();

    let content = serde_json::to_string_pretty(config_value)
        .map_err(|e| format!("序列化备份配置失败: {}", e))?;
    file::write_file(&backup_path_str, &content)
        .map_err(|e| format!("写入配置备份失败: {}", e))?;

    Ok(backup_path_str)
}

fn list_backup_files_sorted() -> Result<Vec<(PathBuf, std::time::SystemTime, u64)>, String> {
    let backup_dir = ensure_backup_dir()?;
    let mut items: Vec<(PathBuf, std::time::SystemTime, u64)> = Vec::new();

    let entries = fs::read_dir(&backup_dir).map_err(|e| format!("读取备份目录失败: {}", e))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("读取备份条目失败: {}", e))?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        let metadata = entry
            .metadata()
            .map_err(|e| format!("读取备份元数据失败: {}", e))?;
        let modified = metadata
            .modified()
            .unwrap_or(std::time::SystemTime::UNIX_EPOCH);
        items.push((path, modified, metadata.len()));
    }

    items.sort_by(|a, b| b.1.cmp(&a.1));
    Ok(items)
}

fn resolve_backup_path(backup_path: &str) -> PathBuf {
    let candidate = PathBuf::from(backup_path);
    if candidate.is_absolute() {
        candidate
    } else {
        PathBuf::from(platform::get_config_dir()).join(backup_path)
    }
}
/// 保存配置
#[command]
pub async fn save_config(mut config: Value) -> Result<String, String> {

    info!("[保存配置] 保存 openclaw.json 配置...");
    debug!("[保存配置] 请求包含字段: {}", config.as_object().map(|o| o.len()).unwrap_or(0));

    // 先做结构化校验，保证类型错误能提前返回明确语义
    config = normalize_and_validate_config(&config)?;

    // 兼容旧前端可能只提交部分字段：保留既有 gateway 关键字段，避免 port/bind/trustedProxies/reload 丢失
    if let Ok(existing) = load_openclaw_config_raw() {
        merge_gateway_critical_fields(&mut config, &existing);
    }

    match save_openclaw_config(&config) {
        Ok(_) => {
            info!("[保存配置] ✓ 配置保存成功");
            Ok("配置已保存".to_string())
        }
        Err(e) => {
            error!("[保存配置] ✗ 配置保存失败: {}", e);
            Err(e)
        }
    }
}

#[command]
pub async fn preview_config_change(input_config: Value) -> Result<PreviewConfigResponse, String> {
    info!("[配置预览] 开始预览配置变更...");

    let current_config = load_openclaw_config_raw()?;
    let validation = validate_preview_input(&input_config);
    let diff_summary = build_config_diff_summary(&current_config, &input_config);

    Ok(PreviewConfigResponse {
        preview_config: redact_sensitive_value(&input_config),
        diff_summary,
        validation,
    })
}

#[command]
pub async fn apply_config_change(input_config: Value) -> Result<ApplyConfigResponse, String> {
    info!("[配置应用] 开始应用配置变更...");

    let validation = validate_preview_input(&input_config);
    if !validation.valid {
        return Err(format!(
            "配置校验失败: {}",
            validation
                .issues
                .iter()
                .map(|issue| format!("{}: {}", issue.path, issue.message))
                .collect::<Vec<String>>()
                .join("；")
        ));
    }

    let mut next_config = normalize_and_validate_config(&input_config)?;
    let existing_config = load_openclaw_config_raw()?;
    merge_gateway_critical_fields(&mut next_config, &existing_config);

    let backup_path = write_backup_snapshot(&existing_config)?;
    save_openclaw_config(&next_config)?;

    Ok(ApplyConfigResponse {
        backup_path,
        applied_at: format_now_rfc3339(),
    })
}

#[command]
pub async fn list_config_backups() -> Result<Vec<ConfigBackupItem>, String> {
    let backups = list_backup_files_sorted()?;
    let list = backups
        .into_iter()
        .map(|(path, modified, size)| ConfigBackupItem {
            path: path.to_string_lossy().to_string(),
            created_at: format_timestamp_from_system_time(modified),
            size,
        })
        .collect();
    Ok(list)
}

#[command]
pub async fn rollback_config(backup_path: Option<String>) -> Result<RollbackConfigResponse, String> {
    info!("[配置回滚] 开始回滚配置...");

    let selected_backup = if let Some(path) = backup_path {
        if path.trim().is_empty() {
            return Err("backupPath 不能为空".to_string());
        }
        resolve_backup_path(path.trim())
    } else {
        let backups = list_backup_files_sorted()?;
        let (path, _, _) = backups
            .into_iter()
            .next()
            .ok_or_else(|| "未找到可回滚的配置备份".to_string())?;
        path
    };

    if !selected_backup.exists() || !selected_backup.is_file() {
        return Err(format!(
            "备份文件不存在: {}",
            selected_backup.to_string_lossy()
        ));
    }

    let backup_content = fs::read_to_string(&selected_backup)
        .map_err(|e| format!("读取备份文件失败: {}", e))?;
    let backup_value = parse_openclaw_config_content(&backup_content)?;
    let normalized_backup = normalize_and_validate_config(&backup_value)?;

    save_openclaw_config(&normalized_backup)?;

    Ok(RollbackConfigResponse {
        restored_path: selected_backup.to_string_lossy().to_string(),
        restored_at: format_now_rfc3339(),
    })
}
/// 获取 agents.list（向后兼容：不存在时返回 []）
#[command]
pub async fn get_agents_list() -> Result<Value, String> {

    info!("[Agents List] 获取 agents.list...");
    let config = load_openclaw_config_raw()?;

    let typed: OpenClawConfig = serde_json::from_value(config).map_err(|e| {
        format!("agents.list 结构无效（应为数组）: {}", e)
    })?;

    serde_json::to_value(typed.agents.list)
        .map_err(|e| format!("agents.list 序列化失败: {}", e))
}

/// 保存 agents.list（全量写入）
#[command]
pub async fn save_agents_list(agents_list: Value) -> Result<String, String> {
    info!("[Agents List] 保存 agents.list...");

    // 显式校验：要求数组结构，便于前端定位错误
    if !agents_list.is_array() {
        return Err("agents.list 结构无效：必须为数组".to_string());
    }

    let mut config = load_openclaw_config_raw()?;

    if config.get("agents").and_then(|v| v.as_object()).is_none() {
        config["agents"] = json!({});
    }

    config["agents"]["list"] = agents_list;
    save_openclaw_config(&config)?;

    info!("[Agents List] ✓ agents.list 保存成功");
    Ok("agents.list 已保存".to_string())
}

/// 获取 bindings（向后兼容：不存在时返回 []）
#[command]
pub async fn get_bindings() -> Result<Value, String> {
    info!("[Bindings] 获取 bindings...");
    let config = load_openclaw_config_raw()?;

    let typed: OpenClawConfig = serde_json::from_value(config)
        .map_err(|e| format!("bindings 结构无效（应为数组或对象）: {}", e))?;

    Ok(typed
        .bindings
        .as_ref()
        .map(|b| b.as_value())
        .unwrap_or_else(|| json!([])))
}

/// 保存 bindings（全量写入）
#[command]
pub async fn save_bindings(bindings: Value) -> Result<String, String> {
    info!("[Bindings] 保存 bindings...");

    // 显式校验：仅接受数组或对象
    if !bindings.is_array() && !bindings.is_object() {
        return Err("bindings 结构无效：必须为数组或对象".to_string());
    }

    let mut config = load_openclaw_config_raw()?;

    // 使用强类型做一次转换校验，返回更清晰错误语义
    let typed_bindings: BindingsConfig = serde_json::from_value(bindings)
        .map_err(|e| format!("bindings 结构无效：{}", e))?;

    config["bindings"] = typed_bindings.into_value();
    save_openclaw_config(&config)?;

    info!("[Bindings] ✓ bindings 保存成功");
    Ok("bindings 已保存".to_string())
}

/// 获取环境变量值
#[command]
pub async fn get_env_value(key: String) -> Result<Option<String>, String> {
    info!("[获取环境变量] 读取环境变量: {}", key);
    let env_path = platform::get_env_file_path();
    let value = file::read_env_value(&env_path, &key);
    match &value {
        Some(v) => debug!(
            "[获取环境变量] {}={} (已脱敏)",
            key,
            if v.len() > 8 { "***" } else { v }
        ),
        None => debug!("[获取环境变量] {} 不存在", key),
    }
    Ok(value)
}

/// 保存环境变量值
#[command]
pub async fn save_env_value(key: String, value: String) -> Result<String, String> {
    info!("[保存环境变量] 保存环境变量: {}", key);
    let env_path = platform::get_env_file_path();
    debug!("[保存环境变量] 环境文件路径: {}", env_path);
    
    match file::set_env_value(&env_path, &key, &value) {
        Ok(_) => {
            info!("[保存环境变量] ✓ 环境变量 {} 保存成功", key);
            Ok("环境变量已保存".to_string())
        }
        Err(e) => {
            error!("[保存环境变量] ✗ 保存失败: {}", e);
            Err(format!("保存环境变量失败: {}", e))
        }
    }
}

// ============ Gateway Token 命令 ============

/// 生成随机 token
fn generate_token() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    
    // 使用时间戳和随机数生成 token
    let random_part: u64 = (timestamp as u64) ^ 0x5DEECE66Du64;
    format!("{:016x}{:016x}{:016x}", 
        random_part, 
        random_part.wrapping_mul(0x5DEECE66Du64),
        timestamp as u64
    )
}

/// 获取或生成 Gateway Token
#[command]
pub async fn get_or_create_gateway_token() -> Result<String, String> {
    info!("[Gateway Token] 获取或创建 Gateway Token...");
    
    let mut config = load_openclaw_config_raw()?;

    // 检查是否已有 token
    if let Some(token) = config
        .pointer("/gateway/auth/token")
        .and_then(|v| v.as_str())
    {
        if !token.is_empty() {
            info!("[Gateway Token] ✓ 使用现有 Token");
            return Ok(token.to_string());
        }
    }
    
    // 生成新 token
    let new_token = generate_token();
    info!("[Gateway Token] 生成新 Token: {}...", &new_token[..8]);
    
    // 确保路径存在
    if config.get("gateway").is_none() {
        config["gateway"] = json!({});
    }
    if config["gateway"].get("auth").is_none() {
        config["gateway"]["auth"] = json!({});
    }
    
    // 设置 token 和 mode
    config["gateway"]["auth"]["token"] = json!(new_token);
    config["gateway"]["auth"]["mode"] = json!("token");
    config["gateway"]["mode"] = json!("local");
    
    // 保存配置
    save_openclaw_config(&config)?;
    
    info!("[Gateway Token] ✓ Token 已保存到配置");
    Ok(new_token)
}

/// 获取 Dashboard URL（带 token）
#[command]
pub async fn get_dashboard_url() -> Result<String, String> {
    info!("[Dashboard URL] 获取 Dashboard URL...");

    let token = get_or_create_gateway_token().await?;
    let config = load_openclaw_config_raw()?;
    let port = config
        .pointer("/gateway/port")
        .and_then(|v| v.as_u64())
        .unwrap_or(18789);

    let url = format!("http://localhost:{}?token={}", port, token);

    info!("[Dashboard URL] ✓ URL: {}...", &url[..50.min(url.len())]);
    Ok(url)
}

// ============ AI 配置相关命令 ============

/// 获取官方 Provider 列表（预设模板）
#[command]
pub async fn get_official_providers() -> Result<Vec<OfficialProvider>, String> {
    info!("[官方 Provider] 获取官方 Provider 预设列表...");

    let providers = vec![
        OfficialProvider {
            id: "anthropic".to_string(),
            name: "Anthropic Claude".to_string(),
            icon: "🟣".to_string(),
            default_base_url: Some("https://api.anthropic.com".to_string()),
            api_type: "anthropic-messages".to_string(),
            requires_api_key: true,
            docs_url: Some("https://docs.openclaw.ai/providers/anthropic".to_string()),
            suggested_models: vec![
                SuggestedModel {
                    id: "claude-opus-4-5-20251101".to_string(),
                    name: "Claude Opus 4.5".to_string(),
                    description: Some("最强大版本，适合复杂任务".to_string()),
                    context_window: Some(200000),
                    max_tokens: Some(8192),
                    recommended: true,
                },
                SuggestedModel {
                    id: "claude-sonnet-4-5-20250929".to_string(),
                    name: "Claude Sonnet 4.5".to_string(),
                    description: Some("平衡版本，性价比高".to_string()),
                    context_window: Some(200000),
                    max_tokens: Some(8192),
                    recommended: false,
                },
            ],
        },
        OfficialProvider {
            id: "openai".to_string(),
            name: "OpenAI".to_string(),
            icon: "🟢".to_string(),
            default_base_url: Some("https://api.openai.com/v1".to_string()),
            api_type: "openai-completions".to_string(),
            requires_api_key: true,
            docs_url: Some("https://docs.openclaw.ai/providers/openai".to_string()),
            suggested_models: vec![
                SuggestedModel {
                    id: "gpt-4o".to_string(),
                    name: "GPT-4o".to_string(),
                    description: Some("最新多模态模型".to_string()),
                    context_window: Some(128000),
                    max_tokens: Some(4096),
                    recommended: true,
                },
                SuggestedModel {
                    id: "gpt-4o-mini".to_string(),
                    name: "GPT-4o Mini".to_string(),
                    description: Some("快速经济版".to_string()),
                    context_window: Some(128000),
                    max_tokens: Some(4096),
                    recommended: false,
                },
            ],
        },
        OfficialProvider {
            id: "moonshot".to_string(),
            name: "Moonshot".to_string(),
            icon: "🌙".to_string(),
            default_base_url: Some("https://api.moonshot.cn/v1".to_string()),
            api_type: "openai-completions".to_string(),
            requires_api_key: true,
            docs_url: Some("https://docs.openclaw.ai/providers/moonshot".to_string()),
            suggested_models: vec![
                SuggestedModel {
                    id: "kimi-k2.5".to_string(),
                    name: "Kimi K2.5".to_string(),
                    description: Some("最新旗舰模型".to_string()),
                    context_window: Some(200000),
                    max_tokens: Some(8192),
                    recommended: true,
                },
                SuggestedModel {
                    id: "moonshot-v1-128k".to_string(),
                    name: "Moonshot 128K".to_string(),
                    description: Some("超长上下文".to_string()),
                    context_window: Some(128000),
                    max_tokens: Some(8192),
                    recommended: false,
                },
            ],
        },
        OfficialProvider {
            id: "qwen".to_string(),
            name: "Qwen (通义千问)".to_string(),
            icon: "🔮".to_string(),
            default_base_url: Some("https://dashscope.aliyuncs.com/compatible-mode/v1".to_string()),
            api_type: "openai-completions".to_string(),
            requires_api_key: true,
            docs_url: Some("https://docs.openclaw.ai/providers/qwen".to_string()),
            suggested_models: vec![
                SuggestedModel {
                    id: "qwen-max".to_string(),
                    name: "Qwen Max".to_string(),
                    description: Some("最强大版本".to_string()),
                    context_window: Some(128000),
                    max_tokens: Some(8192),
                    recommended: true,
                },
                SuggestedModel {
                    id: "qwen-plus".to_string(),
                    name: "Qwen Plus".to_string(),
                    description: Some("平衡版本".to_string()),
                    context_window: Some(128000),
                    max_tokens: Some(8192),
                    recommended: false,
                },
            ],
        },
        OfficialProvider {
            id: "deepseek".to_string(),
            name: "DeepSeek".to_string(),
            icon: "🔵".to_string(),
            default_base_url: Some("https://api.deepseek.com".to_string()),
            api_type: "openai-completions".to_string(),
            requires_api_key: true,
            docs_url: None,
            suggested_models: vec![
                SuggestedModel {
                    id: "deepseek-chat".to_string(),
                    name: "DeepSeek V3".to_string(),
                    description: Some("最新对话模型".to_string()),
                    context_window: Some(128000),
                    max_tokens: Some(8192),
                    recommended: true,
                },
                SuggestedModel {
                    id: "deepseek-reasoner".to_string(),
                    name: "DeepSeek R1".to_string(),
                    description: Some("推理增强模型".to_string()),
                    context_window: Some(128000),
                    max_tokens: Some(8192),
                    recommended: false,
                },
            ],
        },
        OfficialProvider {
            id: "glm".to_string(),
            name: "GLM (智谱)".to_string(),
            icon: "🔷".to_string(),
            default_base_url: Some("https://open.bigmodel.cn/api/paas/v4".to_string()),
            api_type: "openai-completions".to_string(),
            requires_api_key: true,
            docs_url: Some("https://docs.openclaw.ai/providers/glm".to_string()),
            suggested_models: vec![
                SuggestedModel {
                    id: "glm-4".to_string(),
                    name: "GLM-4".to_string(),
                    description: Some("最新旗舰模型".to_string()),
                    context_window: Some(128000),
                    max_tokens: Some(8192),
                    recommended: true,
                },
            ],
        },
        OfficialProvider {
            id: "minimax".to_string(),
            name: "MiniMax".to_string(),
            icon: "🟡".to_string(),
            default_base_url: Some("https://api.minimax.io/anthropic".to_string()),
            api_type: "anthropic-messages".to_string(),
            requires_api_key: true,
            docs_url: Some("https://docs.openclaw.ai/providers/minimax".to_string()),
            suggested_models: vec![
                SuggestedModel {
                    id: "minimax-m2.1".to_string(),
                    name: "MiniMax M2.1".to_string(),
                    description: Some("最新模型".to_string()),
                    context_window: Some(200000),
                    max_tokens: Some(8192),
                    recommended: true,
                },
            ],
        },
        OfficialProvider {
            id: "venice".to_string(),
            name: "Venice AI".to_string(),
            icon: "🏛️".to_string(),
            default_base_url: Some("https://api.venice.ai/api/v1".to_string()),
            api_type: "openai-completions".to_string(),
            requires_api_key: true,
            docs_url: Some("https://docs.openclaw.ai/providers/venice".to_string()),
            suggested_models: vec![
                SuggestedModel {
                    id: "llama-3.3-70b".to_string(),
                    name: "Llama 3.3 70B".to_string(),
                    description: Some("隐私优先推理".to_string()),
                    context_window: Some(128000),
                    max_tokens: Some(8192),
                    recommended: true,
                },
            ],
        },
        OfficialProvider {
            id: "openrouter".to_string(),
            name: "OpenRouter".to_string(),
            icon: "🔄".to_string(),
            default_base_url: Some("https://openrouter.ai/api/v1".to_string()),
            api_type: "openai-completions".to_string(),
            requires_api_key: true,
            docs_url: Some("https://docs.openclaw.ai/providers/openrouter".to_string()),
            suggested_models: vec![
                SuggestedModel {
                    id: "anthropic/claude-opus-4-5".to_string(),
                    name: "Claude Opus 4.5".to_string(),
                    description: Some("通过 OpenRouter 访问".to_string()),
                    context_window: Some(200000),
                    max_tokens: Some(8192),
                    recommended: true,
                },
            ],
        },
        OfficialProvider {
            id: "ollama".to_string(),
            name: "Ollama (本地)".to_string(),
            icon: "🟠".to_string(),
            default_base_url: Some("http://localhost:11434".to_string()),
            api_type: "openai-completions".to_string(),
            requires_api_key: false,
            docs_url: Some("https://docs.openclaw.ai/providers/ollama".to_string()),
            suggested_models: vec![
                SuggestedModel {
                    id: "llama3".to_string(),
                    name: "Llama 3".to_string(),
                    description: Some("本地运行".to_string()),
                    context_window: Some(8192),
                    max_tokens: Some(4096),
                    recommended: true,
                },
            ],
        },
    ];

    info!(
        "[官方 Provider] ✓ 返回 {} 个官方 Provider 预设",
        providers.len()
    );
    Ok(providers)
}

/// 获取 AI 配置概览
#[command]
pub async fn get_ai_config() -> Result<AIConfigOverview, String> {
    info!("[AI 配置] 获取 AI 配置概览...");

    let config_path = platform::get_config_file_path();
    info!("[AI 配置] 配置文件路径: {}", config_path);

    let config = load_openclaw_config()?;
    let normalized = normalize_and_validate_config(&config)?;
    debug!(
        "[AI 配置] 配置根字段数: {}",
        normalized.as_object().map(|o| o.len()).unwrap_or(0)
    );

    // 解析主模型
    let primary_model = normalized
        .pointer("/agents/defaults/model/primary")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    info!("[AI 配置] 主模型: {:?}", primary_model);

    // 解析可用模型列表
    let available_models: Vec<String> = normalized
        .pointer("/agents/defaults/models")
        .and_then(|v| v.as_object())
        .map(|obj| obj.keys().cloned().collect())
        .unwrap_or_default();
    info!("[AI 配置] 可用模型数: {}", available_models.len());

    // 解析已配置的 Provider
    let mut configured_providers: Vec<ConfiguredProvider> = Vec::new();

    let providers_value = normalized.pointer("/models/providers");
    info!("[AI 配置] providers 节点存在: {}", providers_value.is_some());

    if let Some(providers) = providers_value.and_then(|v| v.as_object()) {
        info!("[AI 配置] 找到 {} 个 Provider", providers.len());

        for (provider_name, provider_config) in providers {
            info!("[AI 配置] 解析 Provider: {}", provider_name);

            let base_url = provider_config
                .get("baseUrl")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            let api_key = provider_config
                .get("apiKey")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());

            let api_key_masked = api_key.as_ref().map(|key| {
                if key.len() > 8 {
                    format!("{}...{}", &key[..4], &key[key.len() - 4..])
                } else {
                    "****".to_string()
                }
            });

            // 解析模型列表
            let models_array = provider_config.get("models").and_then(|v| v.as_array());
            info!(
                "[AI 配置] Provider {} 的 models 数组: {:?}",
                provider_name,
                models_array.map(|a| a.len())
            );

            let models: Vec<ConfiguredModel> = models_array
                .map(|arr| {
                    arr.iter()
                        .filter_map(|m| {
                            let id = m.get("id")?.as_str()?.to_string();
                            let name = m
                                .get("name")
                                .and_then(|v| v.as_str())
                                .unwrap_or(&id)
                                .to_string();
                            let full_id = format!("{}/{}", provider_name, id);
                            let is_primary = primary_model.as_ref() == Some(&full_id);

                            info!("[AI 配置] 解析模型: {} (is_primary: {})", full_id, is_primary);

                            Some(ConfiguredModel {
                                full_id,
                                id,
                                name,
                                api_type: m.get("api").and_then(|v| v.as_str()).map(|s| s.to_string()),
                                context_window: m
                                    .get("contextWindow")
                                    .and_then(|v| v.as_u64())
                                    .map(|n| n as u32),
                                max_tokens: m
                                    .get("maxTokens")
                                    .and_then(|v| v.as_u64())
                                    .map(|n| n as u32),
                                is_primary,
                            })
                        })
                        .collect()
                })
                .unwrap_or_default();

            info!(
                "[AI 配置] Provider {} 解析完成: {} 个模型",
                provider_name,
                models.len()
            );

            configured_providers.push(ConfiguredProvider {
                name: provider_name.clone(),
                base_url,
                api_key_masked,
                has_api_key: api_key.is_some(),
                models,
            });
        }
    } else {
        info!("[AI 配置] 未找到 providers 配置或格式不正确");
    }

    info!(
        "[AI 配置] ✓ 最终结果 - 主模型: {:?}, {} 个 Provider, {} 个可用模型",
        primary_model,
        configured_providers.len(),
        available_models.len()
    );

    let typed: OpenClawConfig = serde_json::from_value(normalized)
        .map_err(|e| format!("AI 配置结构无效: {}", e))?;

    Ok(AIConfigOverview {
        primary_model,
        configured_providers,
        available_models,
        agents_list: typed.agents.list,
        bindings: typed.bindings,
    })
}

/// 添加或更新 Provider
#[command]
pub async fn save_provider(
    provider_name: String,
    base_url: String,
    api_key: Option<String>,
    api_type: String,
    models: Vec<ModelConfig>,
) -> Result<String, String> {
    info!(
        "[保存 Provider] 保存 Provider: {} ({} 个模型)",
        provider_name,
        models.len()
    );

    let mut config = load_openclaw_config_raw()?;

    // 确保路径存在
    if config.get("models").is_none() {
        config["models"] = json!({});
    }
    if config["models"].get("providers").is_none() {
        config["models"]["providers"] = json!({});
    }
    if config.get("agents").is_none() {
        config["agents"] = json!({});
    }
    if config["agents"].get("defaults").is_none() {
        config["agents"]["defaults"] = json!({});
    }
    if config["agents"]["defaults"].get("models").is_none() {
        config["agents"]["defaults"]["models"] = json!({});
    }

    // 构建模型配置
    let models_json: Vec<Value> = models
        .iter()
        .map(|m| {
            let mut model_obj = json!({
                "id": m.id,
                "name": m.name,
                "api": m.api.clone().unwrap_or(api_type.clone()),
                "input": if m.input.is_empty() { vec!["text".to_string()] } else { m.input.clone() },
            });

            if let Some(cw) = m.context_window {
                model_obj["contextWindow"] = json!(cw);
            }
            if let Some(mt) = m.max_tokens {
                model_obj["maxTokens"] = json!(mt);
            }
            if let Some(r) = m.reasoning {
                model_obj["reasoning"] = json!(r);
            }
            if let Some(cost) = &m.cost {
                model_obj["cost"] = json!({
                    "input": cost.input,
                    "output": cost.output,
                    "cacheRead": cost.cache_read,
                    "cacheWrite": cost.cache_write,
                });
            } else {
                model_obj["cost"] = json!({
                    "input": 0,
                    "output": 0,
                    "cacheRead": 0,
                    "cacheWrite": 0,
                });
            }

            model_obj
        })
        .collect();

    // 构建 Provider 配置
    let mut provider_config = json!({
        "baseUrl": base_url,
        "models": models_json,
    });

    // 处理 API Key：如果传入了新的非空 key，使用新的；否则保留原有的
    if let Some(key) = api_key {
        if !key.is_empty() {
            // 使用新传入的 API Key
            provider_config["apiKey"] = json!(key);
            info!("[保存 Provider] 使用新的 API Key");
        } else {
            // 空字符串表示不更改，尝试保留原有的 API Key
            if let Some(existing_key) = config
                .pointer(&format!("/models/providers/{}/apiKey", provider_name))
                .and_then(|v| v.as_str())
            {
                provider_config["apiKey"] = json!(existing_key);
                info!("[保存 Provider] 保留原有的 API Key");
            }
        }
    } else {
        // None 表示不更改，尝试保留原有的 API Key
        if let Some(existing_key) = config
            .pointer(&format!("/models/providers/{}/apiKey", provider_name))
            .and_then(|v| v.as_str())
        {
            provider_config["apiKey"] = json!(existing_key);
            info!("[保存 Provider] 保留原有的 API Key");
        }
    }

    // 保存 Provider 配置
    config["models"]["providers"][&provider_name] = provider_config;

    // 将模型添加到 agents.defaults.models
    for model in &models {
        let full_id = format!("{}/{}", provider_name, model.id);
        config["agents"]["defaults"]["models"][&full_id] = json!({});
    }

    // 更新元数据
    let now = chrono::Utc::now().to_rfc3339();
    if config.get("meta").is_none() {
        config["meta"] = json!({});
    }
    config["meta"]["lastTouchedAt"] = json!(now);

    save_openclaw_config(&config)?;
    info!("[保存 Provider] ✓ Provider {} 保存成功", provider_name);

    Ok(format!("Provider {} 已保存", provider_name))
}

/// 删除 Provider
#[command]
pub async fn delete_provider(provider_name: String) -> Result<String, String> {
    info!("[删除 Provider] 删除 Provider: {}", provider_name);

    let mut config = load_openclaw_config_raw()?;

    // 删除 Provider 配置
    if let Some(providers) = config
        .pointer_mut("/models/providers")
        .and_then(|v| v.as_object_mut())
    {
        providers.remove(&provider_name);
    }

    // 删除相关模型
    if let Some(models) = config
        .pointer_mut("/agents/defaults/models")
        .and_then(|v| v.as_object_mut())
    {
        let keys_to_remove: Vec<String> = models
            .keys()
            .filter(|k| k.starts_with(&format!("{}/", provider_name)))
            .cloned()
            .collect();

        for key in keys_to_remove {
            models.remove(&key);
        }
    }

    // 如果主模型属于该 Provider，清除主模型
    if let Some(primary) = config
        .pointer("/agents/defaults/model/primary")
        .and_then(|v| v.as_str())
    {
        if primary.starts_with(&format!("{}/", provider_name)) {
            config["agents"]["defaults"]["model"]["primary"] = json!(null);
        }
    }

    save_openclaw_config(&config)?;
    info!("[删除 Provider] ✓ Provider {} 已删除", provider_name);

    Ok(format!("Provider {} 已删除", provider_name))
}

/// 设置主模型
#[command]
pub async fn set_primary_model(model_id: String) -> Result<String, String> {
    info!("[设置主模型] 设置主模型: {}", model_id);

    let mut config = load_openclaw_config_raw()?;

    // 确保路径存在
    if config.get("agents").is_none() {
        config["agents"] = json!({});
    }
    if config["agents"].get("defaults").is_none() {
        config["agents"]["defaults"] = json!({});
    }
    if config["agents"]["defaults"].get("model").is_none() {
        config["agents"]["defaults"]["model"] = json!({});
    }

    // 设置主模型
    config["agents"]["defaults"]["model"]["primary"] = json!(model_id);

    save_openclaw_config(&config)?;
    info!("[设置主模型] ✓ 主模型已设置为: {}", model_id);

    Ok(format!("主模型已设置为 {}", model_id))
}

/// 添加模型到可用列表
#[command]
pub async fn add_available_model(model_id: String) -> Result<String, String> {
    info!("[添加模型] 添加模型到可用列表: {}", model_id);

    let mut config = load_openclaw_config_raw()?;

    // 确保路径存在
    if config.get("agents").is_none() {
        config["agents"] = json!({});
    }
    if config["agents"].get("defaults").is_none() {
        config["agents"]["defaults"] = json!({});
    }
    if config["agents"]["defaults"].get("models").is_none() {
        config["agents"]["defaults"]["models"] = json!({});
    }

    // 添加模型
    config["agents"]["defaults"]["models"][&model_id] = json!({});

    save_openclaw_config(&config)?;
    info!("[添加模型] ✓ 模型 {} 已添加", model_id);

    Ok(format!("模型 {} 已添加", model_id))
}

/// 从可用列表移除模型
#[command]
pub async fn remove_available_model(model_id: String) -> Result<String, String> {
    info!("[移除模型] 从可用列表移除模型: {}", model_id);

    let mut config = load_openclaw_config_raw()?;

    if let Some(models) = config
        .pointer_mut("/agents/defaults/models")
        .and_then(|v| v.as_object_mut())
    {
        models.remove(&model_id);
    }

    save_openclaw_config(&config)?;
    info!("[移除模型] ✓ 模型 {} 已移除", model_id);

    Ok(format!("模型 {} 已移除", model_id))
}

// ============ 旧版兼容 ============

/// 获取所有支持的 AI Provider（旧版兼容）
#[command]
pub async fn get_ai_providers() -> Result<Vec<crate::models::AIProviderOption>, String> {
    info!("[AI Provider] 获取支持的 AI Provider 列表（旧版）...");

    let official = get_official_providers().await?;
    let providers: Vec<crate::models::AIProviderOption> = official
        .into_iter()
        .map(|p| crate::models::AIProviderOption {
            id: p.id,
            name: p.name,
            icon: p.icon,
            default_base_url: p.default_base_url,
            requires_api_key: p.requires_api_key,
            models: p
                .suggested_models
                .into_iter()
                .map(|m| crate::models::AIModelOption {
                    id: m.id,
                    name: m.name,
                    description: m.description,
                    recommended: m.recommended,
                })
                .collect(),
        })
        .collect();

    Ok(providers)
}

// ============ 渠道配置 ============

fn parse_account_bindings(bindings: &Value) -> HashMap<(String, String), String> {
    let mut result = HashMap::new();

    if let Ok(entries) = serde_json::from_value::<Vec<BindingEntry>>(bindings.clone()) {
        for entry in entries {
            let Some(agent_id) = entry.agent_id else {
                continue;
            };
            let Some(m) = entry.r#match else {
                continue;
            };
            let Some(channel) = m.channel else {
                continue;
            };
            let Some(account_id) = m.account_id else {
                continue;
            };

            result.insert((channel, account_id), agent_id);
        }

        if !result.is_empty() {
            return result;
        }
    }

    if let Some(arr) = bindings.as_array() {
        for item in arr {
            let Some(agent_id) = item.get("agentId").and_then(|v| v.as_str()) else {
                continue;
            };
            let Some(m) = item.get("match").and_then(|v| v.as_object()) else {
                continue;
            };
            let Some(channel) = m.get("channel").and_then(|v| v.as_str()) else {
                continue;
            };
            let Some(account_id) = m.get("accountId").and_then(|v| v.as_str()) else {
                continue;
            };
            result.insert(
                (channel.to_string(), account_id.to_string()),
                agent_id.to_string(),
            );
        }
        return result;
    }

    if let Some(obj) = bindings.as_object() {
        // 扁平格式：{"telegram/default":"main"}
        for (key, value) in obj {
            if let Some(agent_id) = value.as_str() {
                if let Some((channel, account_id)) = key.split_once('/') {
                    result.insert(
                        (channel.to_string(), account_id.to_string()),
                        agent_id.to_string(),
                    );
                    continue;
                }
                if let Some((channel, account_id)) = key.split_once(':') {
                    result.insert(
                        (channel.to_string(), account_id.to_string()),
                        agent_id.to_string(),
                    );
                    continue;
                }
                if let Some((channel, account_id)) = key.split_once('.') {
                    result.insert(
                        (channel.to_string(), account_id.to_string()),
                        agent_id.to_string(),
                    );
                    continue;
                }
            }

            // 分组格式：{"telegram":{"default":"main"}}
            if let Some(accounts_obj) = value.as_object() {
                for (account_id, nested) in accounts_obj {
                    if let Some(agent_id) = nested.as_str() {
                        result.insert(
                            (key.to_string(), account_id.to_string()),
                            agent_id.to_string(),
                        );
                        continue;
                    }

                    if let Some(nested_obj) = nested.as_object() {
                        if let Some(agent_id) = nested_obj.get("agentId").and_then(|v| v.as_str()) {
                            result.insert(
                                (key.to_string(), account_id.to_string()),
                                agent_id.to_string(),
                            );
                        }
                    }
                }
            }
        }
    }

    result
}

fn merge_bindings_payload_by_shape(
    original_bindings: &Value,
    all_pairs: &HashMap<(String, String), String>,
) -> Value {
    // 默认与数组格式都写回官方数组结构
    if original_bindings.is_array() || !original_bindings.is_object() {
        let mut entries = Vec::new();
        for ((channel, account_id), agent_id) in all_pairs {
            entries.push(json!({
                "agentId": agent_id,
                "match": {
                    "channel": channel,
                    "accountId": account_id,
                }
            }));
        }
        return Value::Array(entries);
    }

    let Some(obj) = original_bindings.as_object() else {
        return Value::Array(vec![]);
    };

    // 判断是否扁平对象
    let is_flat = obj.values().all(|v| v.is_string());
    if is_flat {
        let mut flat = serde_json::Map::new();
        for ((channel, account_id), agent_id) in all_pairs {
            flat.insert(format!("{}/{}", channel, account_id), json!(agent_id));
        }
        return Value::Object(flat);
    }

    // 分组对象
    let mut grouped: HashMap<String, serde_json::Map<String, Value>> = HashMap::new();
    for ((channel, account_id), agent_id) in all_pairs {
        grouped
            .entry(channel.clone())
            .or_default()
            .insert(account_id.clone(), json!(agent_id));
    }

    let mut grouped_obj = serde_json::Map::new();
    for (channel, accounts) in grouped {
        grouped_obj.insert(channel, Value::Object(accounts));
    }
    Value::Object(grouped_obj)
}

/// 获取渠道配置 - 从 openclaw.json 和 env 文件读取
#[command]
pub async fn get_channels_config() -> Result<Vec<ChannelConfig>, String> {
    info!("[渠道配置] 获取渠道配置列表...");

    let config = load_openclaw_config()?;
    let channels_obj = config.get("channels").cloned().unwrap_or(json!({}));
    let bindings_obj = config.get("bindings").cloned().unwrap_or(json!([]));
    let account_bindings = parse_account_bindings(&bindings_obj);
    let env_path = platform::get_env_file_path();
    debug!("[渠道配置] 环境文件路径: {}", env_path);

    let mut channels = Vec::new();

    // 支持的渠道类型列表及其测试字段
    let channel_types = vec![
        ("telegram", "telegram", vec!["userId"]),
        ("discord", "discord", vec!["testChannelId"]),
        ("slack", "slack", vec!["testChannelId"]),
        ("feishu", "feishu", vec!["testChatId"]),
        ("whatsapp", "whatsapp", vec![]),
        ("imessage", "imessage", vec![]),
        ("wechat", "wechat", vec![]),
        ("dingtalk", "dingtalk", vec![]),
    ];

    for (channel_id, channel_type, test_fields) in channel_types {
        let channel_config = channels_obj.get(channel_id);

        let mut accounts = channel_config
            .and_then(|c| c.get("accounts"))
            .and_then(|v| v.as_object())
            .map(|obj| {
                obj.iter()
                    .map(|(k, v)| (k.clone(), v.clone()))
                    .collect::<HashMap<String, Value>>()
            })
            .unwrap_or_default();

        // bindings 存在但 accounts 不存在时，自动补齐空账号节点，便于前端直接编辑
        for ((binding_channel, account_id), agent_id) in &account_bindings {
            if binding_channel == channel_id {
                let entry = accounts.entry(account_id.clone()).or_insert_with(|| json!({}));
                if let Some(obj) = entry.as_object_mut() {
                    // bindings 为权威来源，始终写入 agentId，避免账号内遗留旧值
                    obj.insert("agentId".to_string(), json!(agent_id));
                }
            }
        }

        let enabled = channel_config
            .and_then(|c| c.get("enabled"))
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        // 将渠道配置转换为 HashMap（兼容旧版前端平铺字段）
        let mut config_map: HashMap<String, Value> = if let Some(cfg) = channel_config {
            if let Some(obj) = cfg.as_object() {
                obj.iter()
                    .filter(|(k, _)| *k != "enabled" && *k != "accounts")
                    .map(|(k, v)| (k.clone(), v.clone()))
                    .collect()
            } else {
                HashMap::new()
            }
        } else {
            HashMap::new()
        };

        // 从 env 文件读取测试字段
        for field in test_fields {
            let env_key = format!(
                "OPENCLAW_{}_{}",
                channel_id.to_uppercase(),
                field.to_uppercase()
            );
            if let Some(value) = file::read_env_value(&env_path, &env_key) {
                config_map.insert(field.to_string(), json!(value));
            }
        }

        let has_accounts = !accounts.is_empty();
        let has_config = !config_map.is_empty() || enabled || has_accounts;

        channels.push(ChannelConfig {
            id: channel_id.to_string(),
            channel_type: channel_type.to_string(),
            enabled: has_config,
            config: config_map,
            accounts: if accounts.is_empty() { None } else { Some(accounts) },
        });
    }

    info!("[渠道配置] ✓ 返回 {} 个渠道配置", channels.len());
    for ch in &channels {
        debug!("[渠道配置] - {}: enabled={}", ch.id, ch.enabled);
    }
    Ok(channels)
}

/// 保存渠道配置 - 保存到 openclaw.json
#[command]
pub async fn save_channel_config(channel: ChannelConfig) -> Result<String, String> {
    info!(
        "[保存渠道配置] 保存渠道配置: {} ({})",
        channel.id, channel.channel_type
    );

    let mut config = load_openclaw_config_raw()?;
    let env_path = platform::get_env_file_path();
    debug!("[保存渠道配置] 环境文件路径: {}", env_path);

    // 确保 channels 对象存在
    if config.get("channels").is_none() {
        config["channels"] = json!({});
    }

    // 确保 plugins 对象存在
    if config.get("plugins").is_none() {
        config["plugins"] = json!({
            "allow": [],
            "entries": {}
        });
    }
    if config["plugins"].get("allow").is_none() {
        config["plugins"]["allow"] = json!([]);
    }
    if config["plugins"].get("entries").is_none() {
        config["plugins"]["entries"] = json!({});
    }

    // 这些字段只用于测试，不保存到 openclaw.json，而是保存到 env 文件
    let test_only_fields = vec!["userId", "testChatId", "testChannelId"];

    // 构建渠道配置
    let mut channel_obj = json!({
        "enabled": true
    });

    // 添加渠道特定配置
    for (key, value) in &channel.config {
        if test_only_fields.contains(&key.as_str()) {
            // 保存到 env 文件
            let env_key = format!(
                "OPENCLAW_{}_{}",
                channel.id.to_uppercase(),
                key.to_uppercase()
            );
            if let Some(val_str) = value.as_str() {
                let _ = file::set_env_value(&env_path, &env_key, val_str);
            }
        } else {
            // 保存到 openclaw.json
            channel_obj[key] = value.clone();
        }
    }

    // 保留/写入 accounts 多账号配置（兼容 channels.<provider>.accounts）
    if let Some(accounts) = &channel.accounts {
        let accounts_obj = accounts
            .iter()
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect::<serde_json::Map<String, Value>>();
        if !accounts_obj.is_empty() {
            channel_obj["accounts"] = Value::Object(accounts_obj);
        }
    } else if let Some(existing_accounts) = config
        .pointer(&format!("/channels/{}/accounts", channel.id))
        .cloned()
    {
        channel_obj["accounts"] = existing_accounts;
    }

    // 更新 channels 配置
    config["channels"][&channel.id] = channel_obj;

    // 更新 plugins.allow 数组 - 确保渠道在白名单中，并清理空字符串
    if let Some(allow_arr) = config["plugins"]["allow"].as_array_mut() {
        allow_arr.retain(|v| v.as_str().map(|s| !s.trim().is_empty()).unwrap_or(true));

        let channel_id_val = json!(&channel.id);
        if !allow_arr.contains(&channel_id_val) {
            allow_arr.push(channel_id_val);
        }
    }

    // 更新 plugins.entries - 确保插件已启用
    config["plugins"]["entries"][&channel.id] = json!({
        "enabled": true
    });

    // 同步更新 bindings：只替换当前 channel 的账号映射，其它渠道保持不变
    let existing_bindings = config.get("bindings").cloned().unwrap_or(json!([]));
    let mut all_pairs = parse_account_bindings(&existing_bindings);

    all_pairs.retain(|(binding_channel, _), _| binding_channel != &channel.id);

    if let Some(accounts) = &channel.accounts {
        for (account_id, account_cfg) in accounts {
            if let Some(obj) = account_cfg.as_object() {
                if let Some(agent_id) = obj.get("agentId").and_then(|v| v.as_str()) {
                    if !agent_id.trim().is_empty() {
                        all_pairs.insert(
                            (channel.id.clone(), account_id.clone()),
                            agent_id.to_string(),
                        );
                    }
                }
            }
        }
    }

    config["bindings"] = merge_bindings_payload_by_shape(&existing_bindings, &all_pairs);

    // 保存配置
    info!("[保存渠道配置] 写入配置文件...");
    match save_openclaw_config(&config) {
        Ok(_) => {
            info!(
                "[保存渠道配置] ✓ {} 配置保存成功",
                channel.channel_type
            );
            Ok(format!("{} 配置已保存", channel.channel_type))
        }
        Err(e) => {
            error!("[保存渠道配置] ✗ 保存失败: {}", e);
            Err(e)
        }
    }
}

/// 清空渠道配置 - 从 openclaw.json 中删除指定渠道的配置
#[command]
pub async fn clear_channel_config(channel_id: String) -> Result<String, String> {
    info!("[清空渠道配置] 清空渠道配置: {}", channel_id);

    let mut config = load_openclaw_config_raw()?;
    let env_path = platform::get_env_file_path();

    // 从 channels 对象中删除该渠道
    if let Some(channels) = config.get_mut("channels").and_then(|v| v.as_object_mut()) {
        channels.remove(&channel_id);
        info!("[清空渠道配置] 已从 channels 中删除: {}", channel_id);
    }

    // 从 plugins.allow 数组中删除
    if let Some(allow_arr) = config.pointer_mut("/plugins/allow").and_then(|v| v.as_array_mut()) {
        allow_arr.retain(|v| v.as_str() != Some(&channel_id));
        info!("[清空渠道配置] 已从 plugins.allow 中删除: {}", channel_id);
    }

    // 从 plugins.entries 中删除
    if let Some(entries) = config.pointer_mut("/plugins/entries").and_then(|v| v.as_object_mut()) {
        entries.remove(&channel_id);
        info!("[清空渠道配置] 已从 plugins.entries 中删除: {}", channel_id);
    }

    // 清除该渠道相关 bindings，避免遗留 accountId -> agentId 映射
    let existing_bindings = config.get("bindings").cloned().unwrap_or(json!([]));
    let mut all_pairs = parse_account_bindings(&existing_bindings);
    all_pairs.retain(|(binding_channel, _), _| binding_channel != &channel_id);
    config["bindings"] = merge_bindings_payload_by_shape(&existing_bindings, &all_pairs);

    // 清除相关的环境变量
    let env_prefixes = vec![
        format!("OPENCLAW_{}_USERID", channel_id.to_uppercase()),
        format!("OPENCLAW_{}_TESTCHATID", channel_id.to_uppercase()),
        format!("OPENCLAW_{}_TESTCHANNELID", channel_id.to_uppercase()),
    ];
    for env_key in env_prefixes {
        let _ = file::remove_env_value(&env_path, &env_key);
    }

    // 保存配置
    match save_openclaw_config(&config) {
        Ok(_) => {
            info!("[清空渠道配置] ✓ {} 配置已清空", channel_id);
            Ok(format!("{} 配置已清空", channel_id))
        }
        Err(e) => {
            error!("[清空渠道配置] ✗ 清空失败: {}", e);
            Err(e)
        }
    }
}

// ============ 飞书插件管理 ============

/// 飞书插件状态
#[derive(Debug, Serialize, Deserialize)]
pub struct FeishuPluginStatus {
    pub installed: bool,
    pub version: Option<String>,
    pub plugin_name: Option<String>,
}

/// 检查飞书插件是否已安装
#[command]
pub async fn check_feishu_plugin() -> Result<FeishuPluginStatus, String> {
    info!("[飞书插件] 检查飞书插件安装状态...");
    
    // 执行 openclaw plugins list 命令
    match shell::run_openclaw(&["plugins", "list"]) {
        Ok(output) => {
            debug!("[飞书插件] plugins list 输出: {}", output);
            
            // 查找包含 feishu 的行（不区分大小写）
            let lines: Vec<&str> = output.lines().collect();
            let feishu_line = lines.iter().find(|line| {
                line.to_lowercase().contains("feishu")
            });
            
            if let Some(line) = feishu_line {
                info!("[飞书插件] ✓ 飞书插件已安装: {}", line);
                
                // 尝试解析版本号（通常格式为 "name@version" 或 "name version"）
                let version = if line.contains('@') {
                    line.split('@').last().map(|s| s.trim().to_string())
                } else {
                    // 尝试匹配版本号模式 (如 0.1.2)
                    let parts: Vec<&str> = line.split_whitespace().collect();
                    parts.iter()
                        .find(|p| p.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false))
                        .map(|s| s.to_string())
                };
                
                Ok(FeishuPluginStatus {
                    installed: true,
                    version,
                    plugin_name: Some(line.trim().to_string()),
                })
            } else {
                info!("[飞书插件] ✗ 飞书插件未安装");
                Ok(FeishuPluginStatus {
                    installed: false,
                    version: None,
                    plugin_name: None,
                })
            }
        }
        Err(e) => {
            warn!("[飞书插件] 检查插件列表失败: {}", e);
            // 如果命令失败，假设插件未安装
            Ok(FeishuPluginStatus {
                installed: false,
                version: None,
                plugin_name: None,
            })
        }
    }
}

/// 安装飞书插件
#[command]
pub async fn install_feishu_plugin() -> Result<String, String> {
    info!("[飞书插件] 开始安装飞书插件...");
    
    // 先检查是否已安装
    let status = check_feishu_plugin().await?;
    if status.installed {
        info!("[飞书插件] 飞书插件已安装，跳过");
        return Ok(format!("飞书插件已安装: {}", status.plugin_name.unwrap_or_default()));
    }
    
    // 安装飞书插件
    // 注意：使用 @m1heng-clawd/feishu 包名
    info!("[飞书插件] 执行 openclaw plugins install @m1heng-clawd/feishu ...");
    match shell::run_openclaw(&["plugins", "install", "@m1heng-clawd/feishu"]) {
        Ok(output) => {
            info!("[飞书插件] 安装输出: {}", output);
            
            // 验证安装结果
            let verify_status = check_feishu_plugin().await?;
            if verify_status.installed {
                info!("[飞书插件] ✓ 飞书插件安装成功");
                Ok(format!("飞书插件安装成功: {}", verify_status.plugin_name.unwrap_or_default()))
            } else {
                warn!("[飞书插件] 安装命令执行成功但插件未找到");
                Err("安装命令执行成功但插件未找到，请检查 openclaw 版本".to_string())
            }
        }
        Err(e) => {
            error!("[飞书插件] ✗ 安装失败: {}", e);
            Err(format!("安装飞书插件失败: {}\n\n请手动执行: openclaw plugins install @m1heng-clawd/feishu", e))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        build_config_diff_summary, load_env_file_vars, load_openclaw_config_raw,
        normalize_and_validate_config, parse_openclaw_config_content, replace_config_vars,
        save_openclaw_config,
    };
    use crate::utils::{file as file_utils, platform as platform_utils};
    use serde_json::{json, Value};
    use std::fs;
    use std::path::PathBuf;
    use std::sync::{Mutex, OnceLock};
    use std::time::{SystemTime, UNIX_EPOCH};

    static TEST_ENV_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

    fn test_env_lock() -> std::sync::MutexGuard<'static, ()> {
        TEST_ENV_LOCK
            .get_or_init(|| Mutex::new(()))
            .lock()
            .expect("测试环境锁不应中毒")
    }

    struct EnvGuard {
        key: String,
        previous: Option<String>,
    }

    impl EnvGuard {
        fn set(key: &str, value: &str) -> Self {
            let previous = std::env::var(key).ok();
            unsafe {
                std::env::set_var(key, value);
            }
            Self {
                key: key.to_string(),
                previous,
            }
        }

        fn remove(key: &str) -> Self {
            let previous = std::env::var(key).ok();
            unsafe {
                std::env::remove_var(key);
            }
            Self {
                key: key.to_string(),
                previous,
            }
        }
    }

    impl Drop for EnvGuard {
        fn drop(&mut self) {
            if let Some(prev) = &self.previous {
                unsafe {
                    std::env::set_var(&self.key, prev);
                }
            } else {
                unsafe {
                    std::env::remove_var(&self.key);
                }
            }
        }
    }

    struct TempHomeGuard {
        previous_home: Option<String>,
        temp_home_dir: PathBuf,
    }

    impl TempHomeGuard {
        fn new() -> Self {
            let previous_home = std::env::var("HOME").ok();
            let unique = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos();
            let temp_home_dir = std::env::temp_dir().join(format!("openclaw-config-test-home-{}", unique));
            fs::create_dir_all(temp_home_dir.join(".openclaw"))
                .expect("应可创建临时 home 目录");

            unsafe {
                std::env::set_var("HOME", temp_home_dir.to_string_lossy().to_string());
            }

            Self {
                previous_home,
                temp_home_dir,
            }
        }

        fn openclaw_dir(&self) -> PathBuf {
            self.temp_home_dir.join(".openclaw")
        }

        fn openclaw_file_path(&self, relative_path: &str) -> PathBuf {
            self.openclaw_dir().join(relative_path)
        }

        fn write_openclaw_file(&self, relative_path: &str, content: &str) {
            let target = self.openclaw_file_path(relative_path);
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).expect("应可创建 include 文件父目录");
            }
            fs::write(target, content).expect("应可写入 include 文件");
        }

        fn write_openclaw_config(&self, content: &str) {
            self.write_openclaw_file("openclaw.json", content);
        }

        fn write_openclaw_env(&self, content: &str) {
            let env_path = self.temp_home_dir.join(".openclaw").join("env");
            fs::write(env_path, content).expect("应可写入临时 env 文件");
        }
    }

    impl Drop for TempHomeGuard {
        fn drop(&mut self) {
            if let Some(prev) = &self.previous_home {
                unsafe {
                    std::env::set_var("HOME", prev);
                }
            } else {
                unsafe {
                    std::env::remove_var("HOME");
                }
            }
            let _ = fs::remove_dir_all(&self.temp_home_dir);
        }
    }

    fn apply_replacement(mut value: Value) -> Result<Value, String> {
        let env_file_vars = load_env_file_vars();
        replace_config_vars(&mut value, &env_file_vars, "")?;
        Ok(value)
    }

    #[test]
    fn parse_pure_json_config() {
        let content = r#"{"gateway":{"auth":{"token":"test-token"}}}"#;
        let parsed = parse_openclaw_config_content(content).expect("纯 JSON 配置应可读取");

        assert_eq!(
            parsed
                .pointer("/gateway/auth/token")
                .and_then(|v| v.as_str()),
            Some("test-token")
        );
    }

    #[test]
    fn parse_json5_with_comments_and_trailing_comma() {
        let content = r#"
        {
          // JSON5 注释
          gateway: {
            auth: {
              token: "json5-token",
            },
          },
        }
        "#;

        let parsed = parse_openclaw_config_content(content).expect("JSON5 配置应可读取");

        assert_eq!(
            parsed
                .pointer("/gateway/auth/token")
                .and_then(|v| v.as_str()),
            Some("json5-token")
        );
    }

    #[test]
    fn parse_invalid_config_should_return_clear_error() {
        let content = "{ gateway: { auth: { token: } } }";
        let err = parse_openclaw_config_content(content).expect_err("非法配置应返回错误");

        assert!(
            err.contains("JSON/JSON5 解析失败"),
            "错误信息应包含 JSON/JSON5 解析失败，实际: {}",
            err
        );
    }

    #[test]
    fn parse_json5_should_preserve_core_config_fields() {
        let content = r#"
        {
          agents: {
            defaults: {
              model: { primary: "anthropic/claude-opus-4-5-20251101" },
            },
          },
          gateway: {
            auth: {
              token: "gateway-token",
            },
          },
          channels: {
            telegram: {
              accounts: [
                {
                  name: "main",
                  token: "tg-token",
                },
              ],
            },
          },
        }
        "#;

        let parsed = parse_openclaw_config_content(content).expect("回归字段应可正确解析");

        assert_eq!(
            parsed
                .pointer("/agents/defaults/model/primary")
                .and_then(|v| v.as_str()),
            Some("anthropic/claude-opus-4-5-20251101")
        );
        assert_eq!(
            parsed
                .pointer("/gateway/auth/token")
                .and_then(|v| v.as_str()),
            Some("gateway-token")
        );
        assert_eq!(
            parsed
                .pointer("/channels/telegram/accounts/0/token")
                .and_then(|v| v.as_str()),
            Some("tg-token")
        );
    }

    #[test]
    fn include_single_file_should_work() {
        let _env_lock = test_env_lock();
        let home_guard = TempHomeGuard::new();
        home_guard.write_openclaw_file(
            "providers/base.json5",
            r#"
            {
              models: {
                providers: {
                  anthropic: {
                    baseUrl: "https://api.anthropic.com",
                    apiKey: "from-base",
                  },
                },
              },
            }
            "#,
        );
        home_guard.write_openclaw_config(
            r#"
            {
              "$include": "providers/base.json5"
            }
            "#,
        );

        let expanded = load_openclaw_config_raw().expect("单文件 include 应可解析");
        assert_eq!(
            expanded
                .pointer("/models/providers/anthropic/baseUrl")
                .and_then(|v| v.as_str()),
            Some("https://api.anthropic.com")
        );
        assert_eq!(
            expanded
                .pointer("/models/providers/anthropic/apiKey")
                .and_then(|v| v.as_str()),
            Some("from-base")
        );
    }

    #[test]
    fn include_multiple_files_should_merge_in_order() {
        let _env_lock = test_env_lock();
        let home_guard = TempHomeGuard::new();
        home_guard.write_openclaw_file(
            "providers/base.json5",
            r#"
            {
              models: {
                providers: {
                  anthropic: {
                    baseUrl: "https://api.anthropic.com",
                    apiKey: "base-key",
                  },
                },
              },
            }
            "#,
        );
        home_guard.write_openclaw_file(
            "providers/override.json5",
            r#"
            {
              models: {
                providers: {
                  anthropic: {
                    apiKey: "override-key",
                  },
                },
              },
            }
            "#,
        );
        home_guard.write_openclaw_config(
            r#"
            {
              "$include": ["providers/base.json5", "providers/override.json5"]
            }
            "#,
        );

        let expanded = load_openclaw_config_raw().expect("多文件 include 应可解析");
        assert_eq!(
            expanded
                .pointer("/models/providers/anthropic/baseUrl")
                .and_then(|v| v.as_str()),
            Some("https://api.anthropic.com")
        );
        assert_eq!(
            expanded
                .pointer("/models/providers/anthropic/apiKey")
                .and_then(|v| v.as_str()),
            Some("override-key")
        );
    }

    #[test]
    fn include_nested_should_work() {
        let _env_lock = test_env_lock();
        let home_guard = TempHomeGuard::new();
        home_guard.write_openclaw_file(
            "providers/base.json5",
            r#"
            {
              models: {
                providers: {
                  anthropic: {
                    baseUrl: "https://api.anthropic.com",
                  },
                },
              },
            }
            "#,
        );
        home_guard.write_openclaw_file(
            "providers/middle.json5",
            r#"
            {
              "$include": "base.json5",
              models: {
                providers: {
                  anthropic: {
                    apiKey: "middle-key",
                  },
                },
              },
            }
            "#,
        );
        home_guard.write_openclaw_config(
            r#"
            {
              "$include": "providers/middle.json5"
            }
            "#,
        );

        let expanded = load_openclaw_config_raw().expect("嵌套 include 应可解析");
        assert_eq!(
            expanded
                .pointer("/models/providers/anthropic/baseUrl")
                .and_then(|v| v.as_str()),
            Some("https://api.anthropic.com")
        );
        assert_eq!(
            expanded
                .pointer("/models/providers/anthropic/apiKey")
                .and_then(|v| v.as_str()),
            Some("middle-key")
        );
    }

    #[test]
    fn sibling_fields_should_override_include_result() {
        let _env_lock = test_env_lock();
        let home_guard = TempHomeGuard::new();
        home_guard.write_openclaw_file(
            "providers/base.json5",
            r#"
            {
              models: {
                providers: {
                  anthropic: {
                    baseUrl: "https://api.anthropic.com",
                    apiKey: "base-key",
                  },
                },
              },
            }
            "#,
        );
        home_guard.write_openclaw_config(
            r#"
            {
              models: {
                "$include": "providers/base.json5",
                providers: {
                  anthropic: {
                    apiKey: "sibling-key",
                  },
                },
              },
            }
            "#,
        );

        let expanded = load_openclaw_config_raw().expect("sibling override 应可解析");
        assert_eq!(
            expanded
                .pointer("/models/providers/anthropic/baseUrl")
                .and_then(|v| v.as_str()),
            Some("https://api.anthropic.com")
        );
        assert_eq!(
            expanded
                .pointer("/models/providers/anthropic/apiKey")
                .and_then(|v| v.as_str()),
            Some("sibling-key")
        );
    }

    #[test]
    fn include_cycle_should_return_error() {
        let _env_lock = test_env_lock();
        let home_guard = TempHomeGuard::new();
        home_guard.write_openclaw_file("cycle/a.json5", r#"{ "$include": "b.json5" }"#);
        home_guard.write_openclaw_file("cycle/b.json5", r#"{ "$include": "a.json5" }"#);
        home_guard.write_openclaw_config(r#"{ "$include": "cycle/a.json5" }"#);

        let err = load_openclaw_config_raw().expect_err("循环 include 应返回错误");
        assert!(
            err.contains("循环引用"),
            "错误信息应包含循环引用提示，实际: {}",
            err
        );
    }

    #[test]
    fn include_missing_file_should_return_error() {
        let _env_lock = test_env_lock();
        let home_guard = TempHomeGuard::new();
        home_guard.write_openclaw_config(r#"{ "$include": "providers/not-exist.json5" }"#);

        let err = load_openclaw_config_raw().expect_err("缺失 include 文件应返回错误");
        assert!(
            err.contains("不存在"),
            "错误信息应包含文件不存在提示，实际: {}",
            err
        );
    }

    #[test]
    fn include_parse_error_should_return_error() {
        let _env_lock = test_env_lock();
        let home_guard = TempHomeGuard::new();
        home_guard.write_openclaw_file("providers/bad.json5", "{ token: }");
        home_guard.write_openclaw_config(r#"{ "$include": "providers/bad.json5" }"#);

        let err = load_openclaw_config_raw().expect_err("include 解析失败应返回错误");
        assert!(
            err.contains("include 文件解析失败"),
            "错误信息应包含 include 解析失败提示，实际: {}",
            err
        );
    }

    #[test]
    fn include_depth_limit_should_return_error() {
        let _env_lock = test_env_lock();
        let home_guard = TempHomeGuard::new();

        for idx in 0..=10 {
            home_guard.write_openclaw_file(
                format!("chain/level{}.json5", idx).as_str(),
                format!("{{ \"$include\": \"level{}.json5\" }}", idx + 1).as_str(),
            );
        }
        home_guard.write_openclaw_file("chain/level11.json5", "{}");
        home_guard.write_openclaw_config(r#"{ "$include": "chain/level0.json5" }"#);

        let err = load_openclaw_config_raw().expect_err("超过 include 深度限制应返回错误");
        assert!(
            err.contains("嵌套深度超过限制"),
            "错误信息应包含深度限制提示，实际: {}",
            err
        );
    }

    #[test]
    fn include_out_of_config_root_should_return_error() {
        let _env_lock = test_env_lock();
        let home_guard = TempHomeGuard::new();
        let outside = home_guard.temp_home_dir.join("outside-target.json5");
        fs::write(&outside, r#"{ "ok": true }"#).expect("应可写入越界 include 目标文件");
        home_guard.write_openclaw_config(r#"{ "$include": "../outside-target.json5" }"#);

        let err = load_openclaw_config_raw().expect_err("越界 include 应返回错误");
        assert!(
            err.contains("路径越界"),
            "错误信息应包含越界提示，实际: {}",
            err
        );
    }

    #[test]
    fn replace_vars_in_json_config_should_work() {
        let _env_lock = test_env_lock();
        let _process_guard = EnvGuard::set("OPENCLAW_TEST_JSON_TOKEN", "json-token-from-process");
        let _env_guard = EnvGuard::remove("OPENCLAW_TEST_JSON_SUFFIX");

        let home_guard = TempHomeGuard::new();
        home_guard.write_openclaw_env("export OPENCLAW_TEST_JSON_SUFFIX=-from-env\n");

        let parsed = parse_openclaw_config_content(
            r#"{"gateway":{"auth":{"token":"${OPENCLAW_TEST_JSON_TOKEN}${OPENCLAW_TEST_JSON_SUFFIX}"}}}"#,
        )
        .expect("JSON 配置应可解析");

        let replaced = apply_replacement(parsed).expect("JSON 配置变量应可替换");
        assert_eq!(
            replaced
                .pointer("/gateway/auth/token")
                .and_then(|v| v.as_str()),
            Some("json-token-from-process-from-env")
        );
    }

    #[test]
    fn replace_vars_in_json5_config_should_work() {
        let _env_lock = test_env_lock();
        let _process_guard = EnvGuard::set("OPENCLAW_TEST_JSON5_TOKEN", "json5-token-from-process");
        let _env_guard = EnvGuard::remove("OPENCLAW_TEST_JSON5_SUFFIX");

        let home_guard = TempHomeGuard::new();
        home_guard.write_openclaw_env("export OPENCLAW_TEST_JSON5_SUFFIX=-json5-env\n");

        let parsed = parse_openclaw_config_content(
            r#"
            {
              // JSON5 注释
              gateway: {
                auth: {
                  token: "${OPENCLAW_TEST_JSON5_TOKEN}${OPENCLAW_TEST_JSON5_SUFFIX}",
                },
              },
            }
            "#,
        )
        .expect("JSON5 配置应可解析");

        let replaced = apply_replacement(parsed).expect("JSON5 配置变量应可替换");
        assert_eq!(
            replaced
                .pointer("/gateway/auth/token")
                .and_then(|v| v.as_str()),
            Some("json5-token-from-process-json5-env")
        );
    }

    #[test]
    fn replace_multiple_placeholders_in_single_string_should_work() {
        let _env_lock = test_env_lock();
        let _api_guard = EnvGuard::set("OPENCLAW_MULTI_A", "A");
        let _token_guard = EnvGuard::set("OPENCLAW_MULTI_B", "B");
        let _secret_guard = EnvGuard::set("OPENCLAW_MULTI_C", "C");

        let parsed = parse_openclaw_config_content(
            r#"{"models":{"providers":{"demo":{"apiKey":"prefix-${OPENCLAW_MULTI_A}-${OPENCLAW_MULTI_B}-${OPENCLAW_MULTI_C}-suffix"}}}}"#,
        )
        .expect("配置应可解析");

        let replaced = apply_replacement(parsed).expect("多占位符应可替换");
        assert_eq!(
            replaced
                .pointer("/models/providers/demo/apiKey")
                .and_then(|v| v.as_str()),
            Some("prefix-A-B-C-suffix")
        );
    }

    #[test]
    fn missing_variable_should_return_error_with_path_and_name() {
        let _env_lock = test_env_lock();
        let _guard = EnvGuard::remove("OPENCLAW_MISSING_VAR_TEST");

        let parsed = parse_openclaw_config_content(
            r#"{"models":{"providers":{"anthropic":{"apiKey":"${OPENCLAW_MISSING_VAR_TEST}"}}}}"#,
        )
        .expect("配置应可解析");

        let err = apply_replacement(parsed).expect_err("缺失变量应返回错误");
        assert!(
            err.contains("/models/providers/anthropic/apiKey"),
            "错误信息应包含配置路径，实际: {}",
            err
        );
        assert!(
            err.contains("OPENCLAW_MISSING_VAR_TEST"),
            "错误信息应包含缺失变量名，实际: {}",
            err
        );
    }

    #[test]
    fn replacement_should_not_mutate_raw_placeholder_text_for_writeback() {
        let _env_lock = test_env_lock();
        let _process_guard = EnvGuard::set("OPENCLAW_WRITEBACK_VAR", "super-secret-value");

        let raw = parse_openclaw_config_content(
            r#"{"models":{"providers":{"anthropic":{"baseUrl":"https://api.anthropic.com","apiKey":"${OPENCLAW_WRITEBACK_VAR}"}}}}"#,
        )
        .expect("配置应可解析");

        let replaced = apply_replacement(raw.clone()).expect("读取期应可替换");
        assert_eq!(
            replaced
                .pointer("/models/providers/anthropic/apiKey")
                .and_then(|v| v.as_str()),
            Some("super-secret-value")
        );
        assert_eq!(
            raw.pointer("/models/providers/anthropic/apiKey")
                .and_then(|v| v.as_str()),
            Some("${OPENCLAW_WRITEBACK_VAR}")
        );

        let serialized = serde_json::to_string_pretty(&raw).expect("原始配置应可序列化");
        assert!(
            serialized.contains("${OPENCLAW_WRITEBACK_VAR}"),
            "写回内容应保留占位符"
        );
        assert!(
            !serialized.contains("super-secret-value"),
            "写回内容不应包含替换后的敏感值"
        );

        let home_guard = TempHomeGuard::new();
        let config_path = platform_utils::get_config_file_path();
        file_utils::write_file(
            &config_path,
            r#"{"models":{"providers":{"anthropic":{"baseUrl":"https://api.anthropic.com","apiKey":"${OPENCLAW_WRITEBACK_VAR}"}}}}"#,
        )
        .expect("应可写入测试配置");

        save_openclaw_config(&raw).expect("写回原始配置应成功");
        let saved = file_utils::read_file(&config_path).expect("应可读取写回结果");
        assert!(saved.contains("${OPENCLAW_WRITEBACK_VAR}"));
        assert!(!saved.contains("super-secret-value"));

        let _ = home_guard;
    }

    #[test]
    fn normalize_config_defaults_when_agents_list_and_bindings_missing() {
        let config = json!({
            "agents": {
                "defaults": {
                    "model": {
                        "primary": "anthropic/claude-opus-4-5-20251101"
                    }
                }
            }
        });

        let normalized = normalize_and_validate_config(&config)
            .expect("仅 defaults 配置应可通过结构化校验");

        assert!(normalized.pointer("/agents/list").is_none());
        assert!(normalized.get("bindings").is_none());
    }

    #[test]
    fn normalize_config_accepts_full_agents_list_and_bindings() {
        let config = json!({
            "agents": {
                "defaults": {
                    "model": { "primary": "anthropic/claude-opus-4-5-20251101" }
                },
                "list": [
                    {
                        "id": "main",
                        "name": "主助手",
                        "default": true,
                        "workspace": "/tmp/main"
                    }
                ]
            },
            "bindings": [
                {
                    "agentId": "main",
                    "match": {
                        "channel": "telegram",
                        "accountId": "default"
                    }
                }
            ]
        });

        let normalized = normalize_and_validate_config(&config)
            .expect("完整 agents.list + bindings 配置应可通过结构化校验");

        assert_eq!(
            normalized
                .pointer("/agents/list/0/id")
                .and_then(|v| v.as_str()),
            Some("main")
        );
        assert_eq!(
            normalized
                .pointer("/bindings/0/match/channel")
                .and_then(|v| v.as_str()),
            Some("telegram")
        );
    }

    #[test]
    fn normalize_config_rejects_invalid_agents_list_or_bindings_type() {
        let invalid_agents_list = json!({
            "agents": {
                "defaults": { "model": { "primary": "x/y" } },
                "list": { "id": "main" }
            }
        });
        let err = normalize_and_validate_config(&invalid_agents_list)
            .expect_err("agents.list 非数组应返回错误");
        assert!(
            err.contains("agents.list 结构无效"),
            "错误信息应明确指向 agents.list，实际: {}",
            err
        );

        let invalid_bindings = json!({
            "agents": { "defaults": { "model": { "primary": "x/y" } } },
            "bindings": 123
        });
        let err = normalize_and_validate_config(&invalid_bindings)
            .expect_err("bindings 非数组/对象应返回错误");
        assert!(
            err.contains("bindings 结构无效"),
            "错误信息应明确指向 bindings，实际: {}",
            err
        );
    }

    #[test]
    fn config_diff_ignores_semantically_equivalent_optional_values() {
        let before = json!({
            "agents": {
                "list": [
                    {
                        "id": "main",
                        "name": "主助手",
                        "workspace": "/tmp/main"
                    }
                ]
            }
        });

        let after = json!({
            "agents": {
                "list": [
                    {
                        "id": "main",
                        "name": "主助手",
                        "workspace": "/tmp/main",
                        "default": false,
                        "model": {},
                        "tools": null,
                        "sandbox": null
                    }
                ]
            },
            "bindings": []
        });

        let diff = build_config_diff_summary(&before, &after);
        assert_eq!(diff.added, 0, "语义等价字段不应计入新增");
        assert_eq!(diff.modified, 0, "语义等价字段不应计入修改");
        assert_eq!(diff.removed, 0, "语义等价字段不应计入删除");
        assert!(diff.changes.is_empty(), "语义等价字段不应产生差异项");
    }

    #[test]
    fn config_diff_reports_fine_grained_agent_field_changes() {
        let before = json!({
            "agents": {
                "list": [
                    {
                        "id": "agent-1",
                        "name": "旧名称1"
                    },
                    {
                        "id": "agent-2",
                        "name": "旧名称2"
                    }
                ]
            }
        });

        let after = json!({
            "agents": {
                "list": [
                    {
                        "id": "agent-1",
                        "name": "新名称1"
                    },
                    {
                        "id": "agent-2",
                        "name": "新名称2"
                    }
                ]
            }
        });

        let diff = build_config_diff_summary(&before, &after);
        assert_eq!(diff.added, 0);
        assert_eq!(diff.removed, 0);
        assert_eq!(diff.modified, 2);
        assert_eq!(diff.changes.len(), 2);

        assert!(diff
            .changes
            .iter()
            .any(|item| item.path == "/agents/list/0/name" && item.kind == "modified"));
        assert!(diff
            .changes
            .iter()
            .any(|item| item.path == "/agents/list/1/name" && item.kind == "modified"));
        assert!(!diff
            .changes
            .iter()
            .any(|item| item.path == "/agents" && item.kind == "modified"));
    }
}
