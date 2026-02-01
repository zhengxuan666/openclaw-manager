use crate::models::ServiceStatus;
use crate::utils::{file, platform, shell};
use tauri::command;

/// 获取服务状态
#[command]
pub async fn get_service_status() -> Result<ServiceStatus, String> {
    // 尝试使用 openclaw gateway status 获取状态
    let status_result = shell::run_openclaw(&["gateway", "status"]);
    
    let (running, pid) = match &status_result {
        Ok(output) => {
            // 解析输出判断是否运行
            let is_running = output.contains("running") || output.contains("listening");
            // 尝试从输出中提取 PID
            let pid = extract_pid_from_status(output);
            (is_running, pid)
        }
        Err(_) => {
            // 如果 openclaw 命令失败，回退到进程检测
            detect_gateway_process()
        }
    };
    
    // 获取内存使用（仅在运行时）
    let memory_mb = if let Some(p) = pid {
        get_process_memory(p)
    } else {
        None
    };
    
    Ok(ServiceStatus {
        running,
        pid,
        port: 18789,
        uptime_seconds: None,
        memory_mb,
        cpu_percent: None,
    })
}

/// 从状态输出中提取 PID
fn extract_pid_from_status(output: &str) -> Option<u32> {
    // 尝试匹配 "pid: 12345" 或 "PID: 12345" 格式
    for line in output.lines() {
        let lower = line.to_lowercase();
        if lower.contains("pid") {
            if let Some(num) = line.split_whitespace()
                .filter_map(|s| s.trim_matches(|c: char| !c.is_numeric()).parse::<u32>().ok())
                .next() 
            {
                return Some(num);
            }
        }
    }
    None
}

/// 通过进程检测 gateway 是否运行
fn detect_gateway_process() -> (bool, Option<u32>) {
    if platform::is_windows() {
        let result = shell::run_powershell_output(
            "Get-CimInstance Win32_Process | Where-Object { $_.Name -like '*node*' -and $_.CommandLine -like '*gateway*' } | Select-Object -First 1 -ExpandProperty ProcessId"
        );
        match result {
            Ok(ref output) if !output.is_empty() => {
                let pid = output.trim().parse::<u32>().ok();
                (pid.is_some(), pid)
            }
            _ => (false, None),
        }
    } else {
        let result = shell::run_command_output("pgrep", &["-f", "openclaw.*gateway"]);
        match result {
            Ok(ref output) if !output.is_empty() => {
                let pid = output.lines().next().and_then(|s| s.parse::<u32>().ok());
                (pid.is_some(), pid)
            }
            _ => (false, None),
        }
    }
}

/// 获取进程内存使用量
fn get_process_memory(pid: u32) -> Option<f64> {
    if platform::is_windows() {
        shell::run_powershell_output(&format!(
            "(Get-Process -Id {} -ErrorAction SilentlyContinue).WorkingSet64 / 1MB",
            pid
        ))
        .ok()
        .and_then(|s| s.trim().parse::<f64>().ok())
    } else {
        shell::run_bash_output(&format!("ps -o rss= -p {}", pid))
            .ok()
            .and_then(|s| s.trim().parse::<f64>().ok())
            .map(|kb| kb / 1024.0)
    }
}

/// 启动服务
#[command]
pub async fn start_service() -> Result<String, String> {
    // 检查是否已经运行
    let status = get_service_status().await?;
    if status.running {
        return Err("服务已在运行中".to_string());
    }
    
    // 检查 openclaw 命令是否存在
    if shell::get_openclaw_path().is_none() {
        return Err("找不到 openclaw 命令，请先通过 npm install -g openclaw 安装".to_string());
    }
    
    // 使用 openclaw 自己的命令启动 gateway
    shell::spawn_openclaw_gateway()
        .map_err(|e| format!("启动服务失败: {}", e))?;
    
    // 等待启动
    std::thread::sleep(std::time::Duration::from_secs(2));
    
    // 检查状态
    let new_status = get_service_status().await?;
    if new_status.running {
        Ok(format!("服务已启动，PID: {:?}", new_status.pid))
    } else {
        // 尝试获取更多信息
        let log_file = platform::get_log_file_path();
        let log_content = file::read_last_lines(&log_file, 10).unwrap_or_default();
        if log_content.is_empty() {
            Err("服务启动失败，请检查 openclaw 是否正确安装".to_string())
        } else {
            Err(format!("服务启动失败:\n{}", log_content.join("\n")))
        }
    }
}

/// 停止服务
#[command]
pub async fn stop_service() -> Result<String, String> {
    // 使用 openclaw 命令停止
    let _ = shell::run_openclaw(&["gateway", "stop"]);
    
    // 等待
    std::thread::sleep(std::time::Duration::from_millis(500));
    
    // 检查是否停止
    let status = get_service_status().await?;
    if !status.running {
        return Ok("服务已停止".to_string());
    }
    
    // 如果还在运行，强制杀死进程
    if let Some(pid) = status.pid {
        if platform::is_windows() {
            let _ = shell::run_powershell_output(&format!("Stop-Process -Id {} -Force", pid));
        } else {
            let _ = shell::run_command("kill", &["-9", &pid.to_string()]);
        }
    } else {
        // 没有 PID，尝试通过进程名杀死
        if platform::is_windows() {
            let _ = shell::run_powershell_output(
                "Get-CimInstance Win32_Process | Where-Object { $_.Name -like '*node*' -and $_.CommandLine -like '*gateway*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
            );
        } else {
            let _ = shell::run_command("pkill", &["-9", "-f", "openclaw.*gateway"]);
        }
    }
    
    std::thread::sleep(std::time::Duration::from_millis(500));
    
    let status = get_service_status().await?;
    if status.running {
        Err("无法停止服务，请手动处理".to_string())
    } else {
        Ok("服务已停止".to_string())
    }
}

/// 重启服务
#[command]
pub async fn restart_service() -> Result<String, String> {
    // 先停止
    let _ = stop_service().await;
    
    // 等待端口释放
    std::thread::sleep(std::time::Duration::from_secs(2));
    
    // 再启动
    start_service().await
}

/// 获取日志
#[command]
pub async fn get_logs(lines: Option<u32>) -> Result<Vec<String>, String> {
    let log_file = platform::get_log_file_path();
    let n = lines.unwrap_or(100) as usize;
    
    file::read_last_lines(&log_file, n)
        .map_err(|e| format!("读取日志失败: {}", e))
}
