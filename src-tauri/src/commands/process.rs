use crate::utils::{shell, platform};
use tauri::command;

/// 检查 OpenClaw 是否已安装
#[command]
pub async fn check_openclaw_installed() -> Result<bool, String> {
    // 使用 get_openclaw_path 来检查，因为在 Windows 上 command_exists 可能不可靠
    Ok(shell::get_openclaw_path().is_some())
}

/// 获取 OpenClaw 版本
#[command]
pub async fn get_openclaw_version() -> Result<Option<String>, String> {
    // 使用 run_openclaw 来获取版本
    match shell::run_openclaw(&["--version"]) {
        Ok(version) => Ok(Some(version.trim().to_string())),
        Err(_) => Ok(None),
    }
}

/// 检查端口是否被占用
#[command]
pub async fn check_port_in_use(port: u16) -> Result<bool, String> {
    if platform::is_windows() {
        // Windows: 使用 netstat
        let result = shell::run_powershell_output(&format!(
            "netstat -ano | Select-String ':{}\\s'",
            port
        ));
        Ok(result.is_ok() && !result.unwrap().is_empty())
    } else {
        // Unix: 使用 lsof
        let result = shell::run_bash_output(&format!("lsof -ti :{}", port));
        Ok(result.is_ok() && !result.unwrap().is_empty())
    }
}

/// 获取 Node.js 版本
#[command]
pub async fn get_node_version() -> Result<Option<String>, String> {
    if !shell::command_exists("node") {
        return Ok(None);
    }
    
    match shell::run_command_output("node", &["--version"]) {
        Ok(version) => Ok(Some(version)),
        Err(_) => Ok(None),
    }
}
