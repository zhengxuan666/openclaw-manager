use log::{info, warn};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    net::SocketAddr,
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::{SystemTime, UNIX_EPOCH},
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    sync::RwLock,
};

mod commands;
mod models;
mod utils;

use commands::{config, diagnostics, installer, process, service};

const SESSION_COOKIE: &str = "openclaw_manager_session";
const SESSION_TTL_SECONDS: u64 = 60 * 60 * 8;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AuthConfig {
    username: String,
    salt: String,
    password_hash: String,
    created_at: u64,
}

#[derive(Debug, Clone)]
struct SessionInfo {
    username: String,
    expires_at: u64,
}

#[derive(Clone)]
struct AppState {
    sessions: Arc<RwLock<HashMap<String, SessionInfo>>>,
    auth_config_path: PathBuf,
    static_dir: PathBuf,
    cookie_secure: bool,
    session_counter: Arc<AtomicU64>,
}

#[derive(Debug, Deserialize)]
struct InvokeRequest {
    cmd: String,
    #[serde(default)]
    args: Value,
}

#[derive(Debug, Deserialize)]
struct SetupRequest {
    username: String,
    password: String,
}

#[derive(Debug, Deserialize)]
struct LoginRequest {
    username: String,
    password: String,
}

#[derive(Debug, Serialize)]
struct ApiSuccess<T>
where
    T: Serialize,
{
    success: bool,
    data: T,
}

#[derive(Debug, Serialize)]
struct ApiError {
    success: bool,
    error: String,
}

#[derive(Debug, Serialize)]
struct AuthStatusResponse {
    needs_setup: bool,
    authenticated: bool,
    username: Option<String>,
}

#[derive(Debug)]
struct SimpleRequest {
    method: String,
    path: String,
    headers: HashMap<String, String>,
    body: Vec<u8>,
}

#[derive(Debug)]
struct SimpleResponse {
    status: u16,
    reason: &'static str,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
}

#[tokio::main]
async fn main() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    let state = AppState {
        sessions: Arc::new(RwLock::new(HashMap::new())),
        auth_config_path: get_auth_config_path(),
        static_dir: get_static_dir(),
        cookie_secure: get_cookie_secure(),
        session_counter: Arc::new(AtomicU64::new(1)),
    };

    let host = std::env::var("OPENCLAW_WEB_HOST").unwrap_or_else(|_| "0.0.0.0".to_string());
    let port = std::env::var("OPENCLAW_WEB_PORT")
        .ok()
        .and_then(|v| v.parse::<u16>().ok())
        .unwrap_or(17890);

    let addr: SocketAddr = format!("{}:{}", host, port)
        .parse()
        .expect("无效监听地址");

    let listener = TcpListener::bind(addr).await.expect("监听失败");
    info!("🌐 OpenClaw Manager Web 启动: http://{}", addr);
    info!("📦 静态目录: {}", state.static_dir.display());

    loop {
        let (stream, peer) = match listener.accept().await {
            Ok(value) => value,
            Err(error) => {
                warn!("接收连接失败: {}", error);
                continue;
            }
        };

        let cloned_state = state.clone();
        tokio::spawn(async move {
            if let Err(error) = handle_connection(stream, cloned_state).await {
                warn!("处理连接失败 {}: {}", peer, error);
            }
        });
    }
}

async fn handle_connection(mut stream: TcpStream, state: AppState) -> Result<(), String> {
    let request = match read_http_request(&mut stream).await {
        Ok(Some(value)) => value,
        Ok(None) => return Ok(()),
        Err(error) => {
            let response = text_response(400, "Bad Request", error);
            write_response(&mut stream, response).await?;
            return Ok(());
        }
    };

    let response = route_request(request, state).await;
    write_response(&mut stream, response).await?;
    Ok(())
}

async fn read_http_request(stream: &mut TcpStream) -> Result<Option<SimpleRequest>, String> {
    let mut buffer = Vec::new();
    let mut temp = [0_u8; 1024];
    let mut header_end = None;

    loop {
        let read = stream
            .read(&mut temp)
            .await
            .map_err(|e| format!("读取请求失败: {}", e))?;

        if read == 0 {
            if buffer.is_empty() {
                return Ok(None);
            }
            break;
        }

        buffer.extend_from_slice(&temp[..read]);

        if let Some(pos) = find_subsequence(&buffer, b"\r\n\r\n") {
            header_end = Some(pos + 4);
            break;
        }

        if buffer.len() > 1024 * 1024 {
            return Err("请求头过大".to_string());
        }
    }

    let header_end = header_end.ok_or_else(|| "无效 HTTP 请求：缺少请求头结束标记".to_string())?;
    let header_bytes = &buffer[..header_end];
    let header_text = String::from_utf8(header_bytes.to_vec()).map_err(|_| "请求头不是有效 UTF-8")?;

    let mut lines = header_text.split("\r\n");
    let request_line = lines
        .next()
        .ok_or_else(|| "缺少请求行".to_string())?
        .trim()
        .to_string();

    let mut request_line_parts = request_line.split_whitespace();
    let method = request_line_parts
        .next()
        .ok_or_else(|| "请求行缺少 method".to_string())?
        .to_string();
    let full_path = request_line_parts
        .next()
        .ok_or_else(|| "请求行缺少 path".to_string())?
        .to_string();
    let path = full_path.split('?').next().unwrap_or(&full_path).to_string();

    let mut headers = HashMap::new();
    for line in lines {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Some((key, value)) = trimmed.split_once(':') {
            headers.insert(key.to_ascii_lowercase(), value.trim().to_string());
        }
    }

    let content_length = headers
        .get("content-length")
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(0);

    let mut body = buffer[header_end..].to_vec();
    while body.len() < content_length {
        let read = stream
            .read(&mut temp)
            .await
            .map_err(|e| format!("读取请求体失败: {}", e))?;
        if read == 0 {
            break;
        }
        body.extend_from_slice(&temp[..read]);
    }
    body.truncate(content_length);

    Ok(Some(SimpleRequest {
        method,
        path,
        headers,
        body,
    }))
}

fn find_subsequence(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|window| window == needle)
}

async fn route_request(request: SimpleRequest, state: AppState) -> SimpleResponse {
    if request.method == "OPTIONS" {
        return SimpleResponse {
            status: 204,
            reason: "No Content",
            headers: cors_headers(),
            body: vec![],
        };
    }

    match (request.method.as_str(), request.path.as_str()) {
        ("GET", "/api") | ("GET", "/api/health") => {
            json_response(200, json_success(json!({"status": "ok"})))
        }
        ("GET", "/api/auth/status") => auth_status(request, state).await,
        ("POST", "/api/auth/setup") => auth_setup(request, state).await,
        ("POST", "/api/auth/login") => auth_login(request, state).await,
        ("POST", "/api/auth/logout") => auth_logout(request, state).await,
        ("GET", "/api/auth/me") => auth_me(request, state).await,
        ("POST", "/api/invoke") => api_invoke(request, state).await,

        ("GET", path) if !path.starts_with("/api/") => serve_static_file(path, &state.static_dir),

        _ => json_error(404, "Not Found", "接口不存在"),
    }
}

fn serve_static_file(path: &str, static_dir: &PathBuf) -> SimpleResponse {
    let mut relative = path.trim_start_matches('/').to_string();
    if relative.is_empty() {
        relative = "index.html".to_string();
    }

    if relative.contains("..") {
        return text_response(403, "Forbidden", "非法路径");
    }

    let mut target = static_dir.join(&relative);

    if path.ends_with('/') {
        target = target.join("index.html");
    }

    if !target.exists() || target.is_dir() {
        let index_file = static_dir.join("index.html");
        if index_file.exists() {
            target = index_file;
        }
    }

    if !target.exists() {
        return text_response(404, "Not Found", "页面不存在");
    }

    let body = match std::fs::read(&target) {
        Ok(bytes) => bytes,
        Err(error) => {
            return text_response(500, "Internal Server Error", format!("读取静态文件失败: {}", error));
        }
    };

    let content_type = guess_content_type(target.to_string_lossy().as_ref());
    let mut headers = vec![("Content-Type".to_string(), content_type.to_string())];

    if content_type.starts_with("text/") || content_type.contains("javascript") || content_type.contains("json") {
        headers.push(("Cache-Control".to_string(), "no-cache".to_string()));
    } else {
        headers.push(("Cache-Control".to_string(), "public, max-age=86400".to_string()));
    }

    SimpleResponse {
        status: 200,
        reason: "OK",
        headers,
        body,
    }
}

fn guess_content_type(path: &str) -> &'static str {
    if path.ends_with(".html") {
        "text/html; charset=utf-8"
    } else if path.ends_with(".css") {
        "text/css; charset=utf-8"
    } else if path.ends_with(".js") {
        "application/javascript; charset=utf-8"
    } else if path.ends_with(".json") {
        "application/json; charset=utf-8"
    } else if path.ends_with(".png") {
        "image/png"
    } else if path.ends_with(".jpg") || path.ends_with(".jpeg") {
        "image/jpeg"
    } else if path.ends_with(".svg") {
        "image/svg+xml"
    } else if path.ends_with(".ico") {
        "image/x-icon"
    } else {
        "application/octet-stream"
    }
}
fn parse_json<T: for<'de> Deserialize<'de>>(body: &[u8]) -> Result<T, String> {
    serde_json::from_slice(body).map_err(|e| format!("请求 JSON 无效: {}", e))
}

fn get_cookie(headers: &HashMap<String, String>, key: &str) -> Option<String> {
    let cookie = headers.get("cookie")?;
    cookie.split(';').find_map(|item| {
        let trimmed = item.trim();
        let (k, v) = trimmed.split_once('=')?;
        if k == key {
            Some(v.to_string())
        } else {
            None
        }
    })
}

fn now_ts() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn now_nanos() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos()
}

fn get_auth_config_path() -> PathBuf {
    let mut path = PathBuf::from(utils::platform::get_config_dir());
    path.push("manager-web-auth.json");
    path
}

fn get_static_dir() -> PathBuf {
    if let Ok(value) = std::env::var("OPENCLAW_WEB_STATIC_DIR") {
        let path = PathBuf::from(value);
        if path.exists() {
            return path;
        }
    }

    if let Ok(current_dir) = std::env::current_dir() {
        let candidate = current_dir.join("../dist");
        if candidate.exists() {
            return candidate;
        }
        let current_candidate = current_dir.join("dist");
        if current_candidate.exists() {
            return current_candidate;
        }
    }

    PathBuf::from("../dist")
}

fn get_cookie_secure() -> bool {
    std::env::var("OPENCLAW_WEB_COOKIE_SECURE")
        .ok()
        .map(|value| value == "1" || value.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
}

fn load_auth_config(path: &PathBuf) -> Result<Option<AuthConfig>, String> {
    if !path.exists() {
        return Ok(None);
    }

    let content = utils::file::read_file(
        path.to_str()
            .ok_or_else(|| "认证配置路径无效".to_string())?,
    )
    .map_err(|e| format!("读取认证配置失败: {}", e))?;

    let parsed = serde_json::from_str::<AuthConfig>(&content)
        .map_err(|e| format!("解析认证配置失败: {}", e))?;

    Ok(Some(parsed))
}

fn save_auth_config(path: &PathBuf, config: &AuthConfig) -> Result<(), String> {
    let content = serde_json::to_string_pretty(config)
        .map_err(|e| format!("序列化认证配置失败: {}", e))?;

    utils::file::write_file(
        path.to_str()
            .ok_or_else(|| "认证配置路径无效".to_string())?,
        &content,
    )
    .map_err(|e| format!("写入认证配置失败: {}", e))
}

fn fnv1a_hash(input: &str) -> String {
    let mut hash: u64 = 0xcbf29ce484222325;
    for b in input.as_bytes() {
        hash ^= *b as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{:016x}", hash)
}

fn derive_password_hash(salt: &str, password: &str) -> String {
    let mut value = format!("{}:{}", salt, password);
    for _ in 0..20_000 {
        value = fnv1a_hash(&value);
    }
    value
}

fn new_salt() -> String {
    format!("{:x}", now_nanos())
}

fn new_session_token(counter: &AtomicU64) -> String {
    let next = counter.fetch_add(1, Ordering::SeqCst);
    format!("{:x}{:x}", now_nanos(), next)
}

fn build_set_cookie(token: &str, max_age: u64, secure: bool) -> String {
    let mut cookie = format!(
        "{}={}; Path=/; HttpOnly; SameSite=Lax; Max-Age={}",
        SESSION_COOKIE, token, max_age
    );
    if secure {
        cookie.push_str("; Secure");
    }
    cookie
}

fn json_success<T>(data: T) -> Value
where
    T: Serialize,
{
    serde_json::to_value(ApiSuccess { success: true, data }).unwrap_or_else(|_| {
        json!({
            "success": false,
            "error": "响应序列化失败"
        })
    })
}

fn json_failure(error: impl Into<String>) -> Value {
    json!(ApiError {
        success: false,
        error: error.into(),
    })
}

fn cors_headers() -> Vec<(String, String)> {
    vec![
        ("Access-Control-Allow-Origin".to_string(), "*".to_string()),
        (
            "Access-Control-Allow-Headers".to_string(),
            "Content-Type, Cookie".to_string(),
        ),
        (
            "Access-Control-Allow-Methods".to_string(),
            "GET,POST,OPTIONS".to_string(),
        ),
    ]
}

fn json_response(status: u16, body_value: Value) -> SimpleResponse {
    let mut headers = cors_headers();
    headers.push(("Content-Type".to_string(), "application/json; charset=utf-8".to_string()));
    SimpleResponse {
        status,
        reason: reason_text(status),
        headers,
        body: body_value.to_string().into_bytes(),
    }
}

fn json_error(status: u16, reason: &'static str, message: impl Into<String>) -> SimpleResponse {
    let mut headers = cors_headers();
    headers.push(("Content-Type".to_string(), "application/json; charset=utf-8".to_string()));
    SimpleResponse {
        status,
        reason,
        headers,
        body: json_failure(message).to_string().into_bytes(),
    }
}

fn text_response(status: u16, reason: &'static str, message: impl Into<String>) -> SimpleResponse {
    let mut headers = cors_headers();
    headers.push(("Content-Type".to_string(), "text/plain; charset=utf-8".to_string()));
    SimpleResponse {
        status,
        reason,
        headers,
        body: message.into().into_bytes(),
    }
}

fn reason_text(status: u16) -> &'static str {
    match status {
        200 => "OK",
        204 => "No Content",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        409 => "Conflict",
        412 => "Precondition Failed",
        500 => "Internal Server Error",
        _ => "OK",
    }
}

async fn write_response(stream: &mut TcpStream, response: SimpleResponse) -> Result<(), String> {
    let mut output = format!("HTTP/1.1 {} {}\r\n", response.status, response.reason);

    let mut has_content_length = false;
    for (key, value) in &response.headers {
        if key.eq_ignore_ascii_case("content-length") {
            has_content_length = true;
        }
        output.push_str(&format!("{}: {}\r\n", key, value));
    }

    if !has_content_length {
        output.push_str(&format!("Content-Length: {}\r\n", response.body.len()));
    }

    output.push_str("Connection: close\r\n\r\n");

    stream
        .write_all(output.as_bytes())
        .await
        .map_err(|e| format!("写响应头失败: {}", e))?;

    if !response.body.is_empty() {
        stream
            .write_all(&response.body)
            .await
            .map_err(|e| format!("写响应体失败: {}", e))?;
    }

    Ok(())
}

async fn auth_status(request: SimpleRequest, state: AppState) -> SimpleResponse {
    let auth = match load_auth_config(&state.auth_config_path) {
        Ok(value) => value,
        Err(error) => return json_error(500, "Internal Server Error", error),
    };

    let mut authenticated = false;
    let mut username = None;

    if let Some(token) = get_cookie(&request.headers, SESSION_COOKIE) {
        let sessions = state.sessions.read().await;
        if let Some(session) = sessions.get(&token) {
            if session.expires_at > now_ts() {
                authenticated = true;
                username = Some(session.username.clone());
            }
        }
    }

    json_response(
        200,
        json_success(AuthStatusResponse {
            needs_setup: auth.is_none(),
            authenticated,
            username,
        }),
    )
}

async fn auth_setup(request: SimpleRequest, state: AppState) -> SimpleResponse {
    let payload = match parse_json::<SetupRequest>(&request.body) {
        Ok(value) => value,
        Err(error) => return json_error(400, "Bad Request", error),
    };

    if payload.username.trim().is_empty() {
        return json_error(400, "Bad Request", "用户名不能为空");
    }

    if payload.password.len() < 8 {
        return json_error(400, "Bad Request", "密码至少 8 位");
    }

    match load_auth_config(&state.auth_config_path) {
        Ok(Some(_)) => return json_error(409, "Conflict", "管理员账号已初始化"),
        Ok(None) => {}
        Err(error) => return json_error(500, "Internal Server Error", error),
    }

    let salt = new_salt();
    let config = AuthConfig {
        username: payload.username,
        salt: salt.clone(),
        password_hash: derive_password_hash(&salt, &payload.password),
        created_at: now_ts(),
    };

    if let Err(error) = save_auth_config(&state.auth_config_path, &config) {
        return json_error(500, "Internal Server Error", error);
    }

    json_response(200, json_success(json!({"message": "管理员账号初始化成功"})))
}

async fn auth_login(request: SimpleRequest, state: AppState) -> SimpleResponse {
    let payload = match parse_json::<LoginRequest>(&request.body) {
        Ok(value) => value,
        Err(error) => return json_error(400, "Bad Request", error),
    };

    let auth = match load_auth_config(&state.auth_config_path) {
        Ok(Some(value)) => value,
        Ok(None) => return json_error(412, "Precondition Failed", "请先初始化管理员账号"),
        Err(error) => return json_error(500, "Internal Server Error", error),
    };

    if auth.username != payload.username {
        return json_error(401, "Unauthorized", "用户名或密码错误");
    }

    let expected = derive_password_hash(&auth.salt, &payload.password);
    if expected != auth.password_hash {
        return json_error(401, "Unauthorized", "用户名或密码错误");
    }

    let token = new_session_token(&state.session_counter);
    {
        let mut sessions = state.sessions.write().await;
        sessions.insert(
            token.clone(),
            SessionInfo {
                username: auth.username.clone(),
                expires_at: now_ts() + SESSION_TTL_SECONDS,
            },
        );
    }

    let mut response = json_response(200, json_success(json!({"username": auth.username})));
    response
        .headers
        .push(("Set-Cookie".to_string(), build_set_cookie(&token, SESSION_TTL_SECONDS, state.cookie_secure)));
    response
}

async fn auth_logout(request: SimpleRequest, state: AppState) -> SimpleResponse {
    if let Some(token) = get_cookie(&request.headers, SESSION_COOKIE) {
        let mut sessions = state.sessions.write().await;
        sessions.remove(&token);
    }

    let mut response = json_response(200, json_success(json!({"message": "已退出登录"})));
    response.headers.push((
        "Set-Cookie".to_string(),
        build_set_cookie("deleted", 0, state.cookie_secure),
    ));
    response
}

async fn auth_me(request: SimpleRequest, state: AppState) -> SimpleResponse {
    let token = match get_cookie(&request.headers, SESSION_COOKIE) {
        Some(value) => value,
        None => return json_error(401, "Unauthorized", "未登录或会话已过期"),
    };

    let sessions = state.sessions.read().await;
    if let Some(session) = sessions.get(&token) {
        if session.expires_at > now_ts() {
            return json_response(200, json_success(json!({"username": session.username})));
        }
    }

    json_error(401, "Unauthorized", "未登录或会话已过期")
}

async fn api_invoke(request: SimpleRequest, state: AppState) -> SimpleResponse {
    let session_token = match get_cookie(&request.headers, SESSION_COOKIE) {
        Some(value) => value,
        None => return json_error(401, "Unauthorized", "未登录或会话已过期"),
    };

    {
        let sessions = state.sessions.read().await;
        let valid = sessions
            .get(&session_token)
            .map(|session| session.expires_at > now_ts())
            .unwrap_or(false);
        if !valid {
            return json_error(401, "Unauthorized", "未登录或会话已过期");
        }
    }

    let payload = match parse_json::<InvokeRequest>(&request.body) {
        Ok(value) => value,
        Err(error) => return json_error(400, "Bad Request", error),
    };

    if payload.cmd.trim().is_empty() {
        return json_error(400, "Bad Request", "cmd 不能为空");
    }

    match dispatch_command(payload.cmd.trim(), &payload.args).await {
        Ok(value) => json_response(200, json_success(value)),
        Err(error) => json_error(400, "Bad Request", error),
    }
}

fn read_arg<'a>(args: &'a Value, keys: &[&str]) -> Option<&'a Value> {
    for key in keys {
        if let Some(value) = args.get(*key) {
            return Some(value);
        }
    }
    None
}

fn require_string(args: &Value, keys: &[&str], label: &str) -> Result<String, String> {
    let value = read_arg(args, keys)
        .and_then(|v| v.as_str())
        .map(|v| v.to_string())
        .ok_or_else(|| format!("缺少参数: {}", label))?;

    if value.trim().is_empty() {
        Err(format!("参数不能为空: {}", label))
    } else {
        Ok(value)
    }
}

fn optional_u32(args: &Value, keys: &[&str]) -> Option<u32> {
    read_arg(args, keys)
        .and_then(|v| v.as_u64())
        .map(|v| v as u32)
}

async fn dispatch_command(command: &str, args: &Value) -> Result<Value, String> {
    match command {
        "check_environment" => Ok(json!(installer::check_environment().await?)),
        "install_nodejs" => Ok(json!(installer::install_nodejs().await?)),
        "install_openclaw" => Ok(json!(installer::install_openclaw().await?)),
        "init_openclaw_config" => Ok(json!(installer::init_openclaw_config().await?)),
        "open_install_terminal" => {
            let install_type = require_string(args, &["installType", "install_type"], "installType")?;
            Ok(json!(installer::open_install_terminal(install_type).await?))
        }
        "uninstall_openclaw" => Ok(json!(installer::uninstall_openclaw().await?)),
        "check_openclaw_update" => Ok(json!(installer::check_openclaw_update().await?)),
        "update_openclaw" => Ok(json!(installer::update_openclaw().await?)),

        "get_service_status" => Ok(json!(service::get_service_status().await?)),
        "start_service" => Ok(json!(service::start_service().await?)),
        "stop_service" => Ok(json!(service::stop_service().await?)),
        "restart_service" => Ok(json!(service::restart_service().await?)),
        "get_logs" => {
            let lines = optional_u32(args, &["lines"]);
            Ok(json!(service::get_logs(lines).await?))
        }

        "check_openclaw_installed" => Ok(json!(process::check_openclaw_installed().await?)),
        "get_openclaw_version" => Ok(json!(process::get_openclaw_version().await?)),
        "check_port_in_use" => {
            let port = require_string(args, &["port"], "port")?
                .parse::<u16>()
                .map_err(|_| "port 必须是有效数字".to_string())?;
            Ok(json!(process::check_port_in_use(port).await?))
        }
        "get_node_version" => Ok(json!(process::get_node_version().await?)),

        "get_config" => Ok(config::get_config().await?),
        "save_config" => {
            let cfg = read_arg(args, &["config"])
                .cloned()
                .ok_or_else(|| "缺少参数: config".to_string())?;
            Ok(json!(config::save_config(cfg).await?))
        }
        "preview_config_change" => {
            let input_config = read_arg(args, &["inputConfig", "input_config"])
                .cloned()
                .ok_or_else(|| "缺少参数: inputConfig".to_string())?;
            Ok(json!(config::preview_config_change(input_config).await?))
        }
        "apply_config_change" => {
            let input_config = read_arg(args, &["inputConfig", "input_config"])
                .cloned()
                .ok_or_else(|| "缺少参数: inputConfig".to_string())?;
            Ok(json!(config::apply_config_change(input_config).await?))
        }
        "list_config_backups" => Ok(json!(config::list_config_backups().await?)),
        "rollback_config" => {
            let backup_path = read_arg(args, &["backupPath", "backup_path"])
                .and_then(|v| v.as_str())
                .map(|value| value.to_string());
            Ok(json!(config::rollback_config(backup_path).await?))
        }
        "get_agents_list" => Ok(config::get_agents_list().await?),
        "save_agents_list" => {
            let agents_list = read_arg(args, &["agentsList", "agents_list", "agentsListJson", "agents_list_json"])
                .cloned()
                .ok_or_else(|| "缺少参数: agentsList".to_string())?;
            Ok(json!(config::save_agents_list(agents_list).await?))
        }
        "get_bindings" => Ok(config::get_bindings().await?),
        "save_bindings" => {
            let bindings = read_arg(args, &["bindings"])
                .cloned()
                .ok_or_else(|| "缺少参数: bindings".to_string())?;
            Ok(json!(config::save_bindings(bindings).await?))
        }
        "get_env_value" => {
            let key = require_string(args, &["key"], "key")?;
            Ok(json!(config::get_env_value(key).await?))
        }
        "save_env_value" => {
            let key = require_string(args, &["key"], "key")?;
            let value = require_string(args, &["value"], "value")?;
            Ok(json!(config::save_env_value(key, value).await?))
        }
        "get_or_create_gateway_token" => Ok(json!(config::get_or_create_gateway_token().await?)),
        "get_dashboard_url" => Ok(json!(config::get_dashboard_url().await?)),

        "get_official_providers" => Ok(json!(config::get_official_providers().await?)),

        "get_ai_config" => Ok(json!(config::get_ai_config().await?)),
        "save_provider" => {
            let provider_name = require_string(args, &["providerName", "provider_name"], "providerName")?;
            let base_url = require_string(args, &["baseUrl", "base_url"], "baseUrl")?;
            let api_key = read_arg(args, &["apiKey", "api_key"]).and_then(|v| v.as_str()).map(|v| v.to_string());
            let api_type = require_string(args, &["apiType", "api_type"], "apiType")?;
            let models: Vec<models::ModelConfig> = read_arg(args, &["models"])
                .cloned()
                .map(serde_json::from_value)
                .transpose()
                .map_err(|e| format!("models 参数无效: {}", e))?
                .unwrap_or_default();
            Ok(json!(config::save_provider(provider_name, base_url, api_key, api_type, models).await?))
        }
        "delete_provider" => {
            let provider_name = require_string(args, &["providerName", "provider_name"], "providerName")?;
            Ok(json!(config::delete_provider(provider_name).await?))
        }
        "set_primary_model" => {
            let model_id = require_string(args, &["modelId", "model_id"], "modelId")?;
            Ok(json!(config::set_primary_model(model_id).await?))
        }
        "add_available_model" => {
            let model_id = require_string(args, &["modelId", "model_id"], "modelId")?;
            Ok(json!(config::add_available_model(model_id).await?))
        }
        "remove_available_model" => {
            let model_id = require_string(args, &["modelId", "model_id"], "modelId")?;
            Ok(json!(config::remove_available_model(model_id).await?))
        }
        "get_ai_providers" => Ok(json!(config::get_ai_providers().await?)),
        "get_channels_config" => Ok(json!(config::get_channels_config().await?)),
        "save_channel_config" => {
            let channel: models::ChannelConfig = read_arg(args, &["channel"])
                .cloned()
                .map(serde_json::from_value)
                .transpose()
                .map_err(|e| format!("channel 参数无效: {}", e))?
                .ok_or_else(|| "缺少参数: channel".to_string())?;
            Ok(json!(config::save_channel_config(channel).await?))
        }
        "clear_channel_config" => {
            let channel_id = require_string(args, &["channelId", "channel_id"], "channelId")?;
            Ok(json!(config::clear_channel_config(channel_id).await?))
        }
        // Staging preview/apply 命令
        "preview_save_agents_list" => {
            let agents_list = read_arg(args, &["agentsList", "agents_list", "agentsListJson", "agents_list_json"])
                .cloned()
                .ok_or_else(|| "缺少参数: agentsList".to_string())?;
            Ok(json!(config::preview_save_agents_list(agents_list).await?))
        }
        "preview_save_channel_config" => {
            let channel: models::ChannelConfig = read_arg(args, &["channel"])
                .cloned()
                .map(serde_json::from_value)
                .transpose()
                .map_err(|e| format!("channel 参数无效: {}", e))?
                .ok_or_else(|| "缺少参数: channel".to_string())?;
            Ok(json!(config::preview_save_channel_config(channel).await?))
        }
        "preview_clear_channel_config" => {
            let channel_id = require_string(args, &["channelId", "channel_id"], "channelId")?;
            Ok(json!(config::preview_clear_channel_config(channel_id).await?))
        }
        "preview_save_provider" => {
            let provider_name = require_string(args, &["providerName", "provider_name"], "providerName")?;
            let base_url = require_string(args, &["baseUrl", "base_url"], "baseUrl")?;
            let api_key = read_arg(args, &["apiKey", "api_key"]).and_then(|v| v.as_str()).map(|v| v.to_string());
            let api_type = require_string(args, &["apiType", "api_type"], "apiType")?;
            let models: Vec<models::ModelConfig> = read_arg(args, &["models"])
                .cloned()
                .map(serde_json::from_value)
                .transpose()
                .map_err(|e| format!("models 参数无效: {}", e))?
                .unwrap_or_default();
            Ok(json!(config::preview_save_provider(provider_name, base_url, api_key, api_type, models).await?))
        }
        "preview_delete_provider" => {
            let provider_name = require_string(args, &["providerName", "provider_name"], "providerName")?;
            Ok(json!(config::preview_delete_provider(provider_name).await?))
        }
        "preview_set_primary_model" => {
            let model_id = require_string(args, &["modelId", "model_id"], "modelId")?;
            Ok(json!(config::preview_set_primary_model(model_id).await?))
        }
        "apply_staged_config" => {
            let staging_id = require_string(args, &["stagingId", "staging_id"], "stagingId")?;
            Ok(json!(config::apply_staged_config(staging_id).await?))
        }
        "discard_staged_config" => {
            let staging_id = require_string(args, &["stagingId", "staging_id"], "stagingId")?;
            Ok(json!(config::discard_staged_config(staging_id).await?))
        }

        // Staging session 命令
        "staging_session_status" => Ok(json!(config::staging_session_status().await?)),
        "staging_session_apply_change" => {
            let request: config::StagingChangeRequest = serde_json::from_value(args.clone())
                .map_err(|e| format!("staging_session_apply_change 参数无效: {}", e))?;
            Ok(json!(config::staging_session_apply_change(request).await?))
        }
        "staging_session_preview" => Ok(json!(config::staging_session_preview().await?)),
        "staging_session_apply" => Ok(json!(config::staging_session_apply().await?)),
        "staging_session_discard" => Ok(json!(config::staging_session_discard().await?)),
        "staging_session_get_config" => Ok(json!(config::staging_session_get_config().await?)),

        "check_feishu_plugin" => Ok(json!(config::check_feishu_plugin().await?)),
        "install_feishu_plugin" => Ok(json!(config::install_feishu_plugin().await?)),

        "run_doctor" => Ok(json!(diagnostics::run_doctor().await?)),
        "test_ai_connection" => Ok(json!(diagnostics::test_ai_connection().await?)),
        "test_channel" => {
            let channel_type = require_string(args, &["channelType", "channel_type"], "channelType")?;
            Ok(json!(diagnostics::test_channel(channel_type).await?))
        }
        "send_test_message" => {
            let channel_type = require_string(args, &["channelType", "channel_type"], "channelType")?;
            let target = require_string(args, &["target"], "target")?;
            Ok(json!(diagnostics::send_test_message(channel_type, target).await?))
        }
        "get_system_info" => Ok(json!(diagnostics::get_system_info().await?)),
        "start_channel_login" => {
            let channel_type = require_string(args, &["channelType", "channel_type"], "channelType")?;
            Ok(json!(diagnostics::start_channel_login(channel_type).await?))
        }

        _ => Err(format!("未知命令: {}", command)),
    }
}
