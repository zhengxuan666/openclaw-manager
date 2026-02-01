use crate::models::{AITestResult, ChannelTestResult, DiagnosticResult, SystemInfo};
use crate::utils::{platform, shell};
use tauri::command;

/// 运行诊断
#[command]
pub async fn run_doctor() -> Result<Vec<DiagnosticResult>, String> {
    let mut results = Vec::new();
    
    // 检查 OpenClaw 是否安装
    let openclaw_installed = shell::get_openclaw_path().is_some();
    results.push(DiagnosticResult {
        name: "OpenClaw 安装".to_string(),
        passed: openclaw_installed,
        message: if openclaw_installed {
            "OpenClaw 已安装".to_string()
        } else {
            "OpenClaw 未安装".to_string()
        },
        suggestion: if openclaw_installed {
            None
        } else {
            Some("运行: npm install -g openclaw".to_string())
        },
    });
    
    // 检查 Node.js
    let node_check = shell::run_command_output("node", &["--version"]);
    results.push(DiagnosticResult {
        name: "Node.js".to_string(),
        passed: node_check.is_ok(),
        message: node_check
            .clone()
            .unwrap_or_else(|_| "未安装".to_string()),
        suggestion: if node_check.is_err() {
            Some("请安装 Node.js 22+".to_string())
        } else {
            None
        },
    });
    
    // 检查配置文件
    let config_path = platform::get_config_file_path();
    let config_exists = std::path::Path::new(&config_path).exists();
    results.push(DiagnosticResult {
        name: "配置文件".to_string(),
        passed: config_exists,
        message: if config_exists {
            format!("配置文件存在: {}", config_path)
        } else {
            "配置文件不存在".to_string()
        },
        suggestion: if config_exists {
            None
        } else {
            Some("运行 openclaw 初始化配置".to_string())
        },
    });
    
    // 检查环境变量文件
    let env_path = platform::get_env_file_path();
    let env_exists = std::path::Path::new(&env_path).exists();
    results.push(DiagnosticResult {
        name: "环境变量".to_string(),
        passed: env_exists,
        message: if env_exists {
            format!("环境变量文件存在: {}", env_path)
        } else {
            "环境变量文件不存在".to_string()
        },
        suggestion: if env_exists {
            None
        } else {
            Some("请配置 AI API Key".to_string())
        },
    });
    
    // 运行 openclaw doctor
    if openclaw_installed {
        let doctor_result = shell::run_openclaw(&["doctor"]);
        results.push(DiagnosticResult {
            name: "OpenClaw Doctor".to_string(),
            passed: doctor_result.is_ok() && !doctor_result.as_ref().unwrap().contains("invalid"),
            message: doctor_result.unwrap_or_else(|e| e),
            suggestion: None,
        });
    }
    
    Ok(results)
}

/// 测试 AI 连接
#[command]
pub async fn test_ai_connection() -> Result<AITestResult, String> {
    // 获取当前配置的 provider
    let start = std::time::Instant::now();
    
    // 使用 openclaw 命令测试连接
    let result = shell::run_openclaw(&["agent", "--local", "--to", "+1234567890", "--message", "回复 OK"]);
    
    let latency = start.elapsed().as_millis() as u64;
    
    match result {
        Ok(output) => {
            // 过滤掉警告信息
            let filtered: String = output
                .lines()
                .filter(|l: &&str| !l.contains("ExperimentalWarning"))
                .collect::<Vec<&str>>()
                .join("\n");
            
            let success = !filtered.to_lowercase().contains("error")
                && !filtered.contains("401")
                && !filtered.contains("403");
            
            Ok(AITestResult {
                success,
                provider: "current".to_string(),
                model: "default".to_string(),
                response: if success { Some(filtered.clone()) } else { None },
                error: if success { None } else { Some(filtered) },
                latency_ms: Some(latency),
            })
        }
        Err(e) => Ok(AITestResult {
            success: false,
            provider: "current".to_string(),
            model: "default".to_string(),
            response: None,
            error: Some(e),
            latency_ms: Some(latency),
        }),
    }
}

/// 测试渠道连接
#[command]
pub async fn test_channel(channel_type: String) -> Result<ChannelTestResult, String> {
    let config_path = platform::get_config_file_path();
    
    // 从 openclaw.json 读取渠道配置
    let config_content = crate::utils::file::read_file(&config_path)
        .unwrap_or_else(|_| "{}".to_string());
    let config: serde_json::Value = serde_json::from_str(&config_content)
        .unwrap_or(serde_json::json!({}));
    
    let channels = config.get("channels").cloned().unwrap_or(serde_json::json!({}));
    let channel_config = channels.get(&channel_type);
    
    // 检查渠道是否已配置
    if channel_config.is_none() {
        return Ok(ChannelTestResult {
            success: false,
            channel: channel_type.clone(),
            message: "渠道未配置".to_string(),
            error: Some(format!("请先在消息渠道页面配置 {}", channel_type)),
        });
    }
    
    let channel_cfg = channel_config.unwrap();
    
    match channel_type.as_str() {
        "telegram" => {
            let token = channel_cfg.get("botToken")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            
            if token.is_empty() {
                return Ok(ChannelTestResult {
                    success: false,
                    channel: channel_type,
                    message: "Bot Token 未配置".to_string(),
                    error: Some("请配置 Telegram Bot Token".to_string()),
                });
            }
            
            // 先验证 Token
            let verify_cmd = format!(
                "curl -s 'https://api.telegram.org/bot{}/getMe'",
                token
            );
            
            let verify_result = shell::run_bash_output(&verify_cmd);
            let token_valid = verify_result.as_ref()
                .map(|o| o.contains("\"ok\":true"))
                .unwrap_or(false);
            
            if !token_valid {
                return Ok(ChannelTestResult {
                    success: false,
                    channel: channel_type,
                    message: "Token 无效".to_string(),
                    error: verify_result.err().or(Some("Bot Token 验证失败".to_string())),
                });
            }
            
            // 获取 bot 用户名
            let bot_name = verify_result.as_ref()
                .ok()
                .and_then(|o| o.split("\"username\":\"").nth(1))
                .and_then(|s| s.split('"').next())
                .map(|s| format!("@{}", s))
                .unwrap_or_else(|| "Bot".to_string());
            
            // 从 env 文件读取 userId (用于测试发送消息)
            let env_path = platform::get_env_file_path();
            let user_id = crate::utils::file::read_env_value(&env_path, "OPENCLAW_TELEGRAM_USERID");
            
            if let Some(chat_id) = user_id {
                // 发送测试消息
                let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
                let message = format!("🤖 OpenClaw 测试消息\\n\\n✅ 连接成功！\\n⏰ {}", timestamp);
                
                let send_cmd = format!(
                    r#"curl -s -X POST 'https://api.telegram.org/bot{}/sendMessage' -H 'Content-Type: application/json' -d '{{"chat_id":"{}","text":"{}","parse_mode":"HTML"}}'"#,
                    token, chat_id, message
                );
                
                let send_result = shell::run_bash_output(&send_cmd);
                match send_result {
                    Ok(output) => {
                        let success = output.contains("\"ok\":true");
                        Ok(ChannelTestResult {
                            success,
                            channel: channel_type,
                            message: if success { 
                                format!("{} 消息已发送", bot_name) 
                            } else { 
                                "消息发送失败".to_string() 
                            },
                            error: if success { None } else { Some(output) },
                        })
                    }
                    Err(e) => Ok(ChannelTestResult {
                        success: false,
                        channel: channel_type,
                        message: "发送失败".to_string(),
                        error: Some(e),
                    }),
                }
            } else {
                // 没有配置 User ID
                Ok(ChannelTestResult {
                    success: false,
                    channel: channel_type,
                    message: format!("{} Token 有效，但未配置 User ID", bot_name),
                    error: Some("请配置 User ID 以发送测试消息".to_string()),
                })
            }
        }
        "discord" => {
            let token = channel_cfg.get("botToken")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            
            if token.is_empty() {
                return Ok(ChannelTestResult {
                    success: false,
                    channel: channel_type,
                    message: "Bot Token 未配置".to_string(),
                    error: Some("请配置 Discord Bot Token".to_string()),
                });
            }
            
            // 先验证 Token
            let verify_cmd = format!(
                "curl -s -H 'Authorization: Bot {}' https://discord.com/api/v10/users/@me",
                token
            );
            
            let verify_result = shell::run_bash_output(&verify_cmd);
            let token_valid = verify_result.as_ref()
                .map(|o| o.contains("\"id\":"))
                .unwrap_or(false);
            
            if !token_valid {
                return Ok(ChannelTestResult {
                    success: false,
                    channel: channel_type,
                    message: "Token 无效".to_string(),
                    error: verify_result.err().or(Some("Bot Token 验证失败".to_string())),
                });
            }
            
            let bot_name = verify_result.as_ref()
                .ok()
                .and_then(|o| o.split("\"username\":\"").nth(1))
                .and_then(|s| s.split('"').next())
                .unwrap_or("Bot")
                .to_string();
            
            // 从 env 文件读取测试 Channel ID
            let env_path = platform::get_env_file_path();
            let test_channel_id = crate::utils::file::read_env_value(&env_path, "OPENCLAW_DISCORD_TESTCHANNELID");
            
            if let Some(channel_id) = test_channel_id {
                // 发送测试消息
                let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
                let message = format!("🤖 OpenClaw 测试消息\\n\\n✅ 连接成功！\\n⏰ {}", timestamp);
                
                let send_cmd = format!(
                    r#"curl -s -X POST 'https://discord.com/api/v10/channels/{}/messages' -H 'Authorization: Bot {}' -H 'Content-Type: application/json' -d '{{"content":"{}"}}'| head -1"#,
                    channel_id, token, message
                );
                
                let send_result = shell::run_bash_output(&send_cmd);
                match send_result {
                    Ok(output) => {
                        let success = output.contains("\"id\":");
                        Ok(ChannelTestResult {
                            success,
                            channel: channel_type,
                            message: if success { 
                                format!("{} 消息已发送", bot_name) 
                            } else { 
                                "消息发送失败".to_string() 
                            },
                            error: if success { None } else { Some(output) },
                        })
                    }
                    Err(e) => Ok(ChannelTestResult {
                        success: false,
                        channel: channel_type,
                        message: "发送失败".to_string(),
                        error: Some(e),
                    }),
                }
            } else {
                Ok(ChannelTestResult {
                    success: true,
                    channel: channel_type,
                    message: format!("{} Token 有效 (未配置测试 Channel ID)", bot_name),
                    error: None,
                })
            }
        }
        "feishu" => {
            let app_id = channel_cfg.get("appId")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let app_secret = channel_cfg.get("appSecret")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let domain = channel_cfg.get("domain")
                .and_then(|v| v.as_str())
                .unwrap_or("feishu");
            
            if app_id.is_empty() || app_secret.is_empty() {
                return Ok(ChannelTestResult {
                    success: false,
                    channel: channel_type,
                    message: "App ID 或 App Secret 未配置".to_string(),
                    error: Some("请配置飞书 App ID 和 App Secret".to_string()),
                });
            }
            
            // 根据 domain 确定 API 地址
            let api_host = if domain == "lark" {
                "open.larksuite.com"
            } else {
                "open.feishu.cn"
            };
            
            // 获取 tenant_access_token
            let token_cmd = format!(
                r#"curl -s -X POST 'https://{}/open-apis/auth/v3/tenant_access_token/internal' -H 'Content-Type: application/json' -d '{{"app_id":"{}","app_secret":"{}"}}'"#,
                api_host, app_id, app_secret
            );
            
            let token_result = shell::run_bash_output(&token_cmd);
            let access_token = match &token_result {
                Ok(output) => {
                    if output.contains("\"code\":0") {
                        output.split("\"tenant_access_token\":\"")
                            .nth(1)
                            .and_then(|s| s.split('"').next())
                            .map(|s| s.to_string())
                    } else {
                        None
                    }
                }
                Err(_) => None,
            };
            
            if access_token.is_none() {
                return Ok(ChannelTestResult {
                    success: false,
                    channel: channel_type,
                    message: "认证失败".to_string(),
                    error: token_result.err().or(Some("无法获取 access_token".to_string())),
                });
            }
            
            let token = access_token.unwrap();
            
            // 从 env 文件读取测试 Chat ID
            let env_path = platform::get_env_file_path();
            let test_chat_id = crate::utils::file::read_env_value(&env_path, "OPENCLAW_FEISHU_TESTCHATID");
            
            if let Some(chat_id) = test_chat_id {
                // 发送测试消息
                let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
                // 飞书 content 字段需要是 JSON 字符串的字符串形式
                let content_json = format!(r#"{{"text":"🤖 OpenClaw 测试消息\n\n✅ 连接成功！\n⏰ {}"}}"#, timestamp);
                // 需要对 content_json 进行转义，使其成为 JSON 字符串中的值
                let escaped_content = content_json.replace('\\', "\\\\").replace('"', "\\\"");
                
                let send_cmd = format!(
                    r#"curl -s -X POST 'https://{}/open-apis/im/v1/messages?receive_id_type=chat_id' -H 'Authorization: Bearer {}' -H 'Content-Type: application/json' -d '{{"receive_id":"{}","msg_type":"text","content":"{}"}}'"#,
                    api_host, token, chat_id, escaped_content
                );
                
                let send_result = shell::run_bash_output(&send_cmd);
                match send_result {
                    Ok(output) => {
                        let success = output.contains("\"code\":0");
                        Ok(ChannelTestResult {
                            success,
                            channel: channel_type,
                            message: if success { 
                                "消息已发送".to_string() 
                            } else { 
                                "消息发送失败".to_string() 
                            },
                            error: if success { None } else { Some(output) },
                        })
                    }
                    Err(e) => Ok(ChannelTestResult {
                        success: false,
                        channel: channel_type,
                        message: "发送失败".to_string(),
                        error: Some(e),
                    }),
                }
            } else {
                // 没有配置 Chat ID，只验证凭证
                Ok(ChannelTestResult {
                    success: true,
                    channel: channel_type,
                    message: "认证成功 (未配置测试 Chat ID)".to_string(),
                    error: None,
                })
            }
        }
        "slack" => {
            let token = channel_cfg.get("botToken")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            
            if token.is_empty() {
                return Ok(ChannelTestResult {
                    success: false,
                    channel: channel_type,
                    message: "Bot Token 未配置".to_string(),
                    error: Some("请配置 Slack Bot Token".to_string()),
                });
            }
            
            // 先验证 Token
            let verify_cmd = format!(
                "curl -s -H 'Authorization: Bearer {}' https://slack.com/api/auth.test",
                token
            );
            
            let verify_result = shell::run_bash_output(&verify_cmd);
            let token_valid = verify_result.as_ref()
                .map(|o| o.contains("\"ok\":true"))
                .unwrap_or(false);
            
            if !token_valid {
                return Ok(ChannelTestResult {
                    success: false,
                    channel: channel_type,
                    message: "Token 无效".to_string(),
                    error: verify_result.err().or(Some("Bot Token 验证失败".to_string())),
                });
            }
            
            let bot_name = verify_result.as_ref()
                .ok()
                .and_then(|o| o.split("\"user\":\"").nth(1))
                .and_then(|s| s.split('"').next())
                .unwrap_or("Bot")
                .to_string();
            
            // 从 env 文件读取测试 Channel ID
            let env_path = platform::get_env_file_path();
            let test_channel_id = crate::utils::file::read_env_value(&env_path, "OPENCLAW_SLACK_TESTCHANNELID");
            
            if let Some(channel_id) = test_channel_id {
                // 发送测试消息
                let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
                let message = format!("🤖 OpenClaw 测试消息\\n\\n✅ 连接成功！\\n⏰ {}", timestamp);
                
                let send_cmd = format!(
                    r#"curl -s -X POST 'https://slack.com/api/chat.postMessage' -H 'Authorization: Bearer {}' -H 'Content-Type: application/json' -d '{{"channel":"{}","text":"{}"}}'"#,
                    token, channel_id, message
                );
                
                let send_result = shell::run_bash_output(&send_cmd);
                match send_result {
                    Ok(output) => {
                        let success = output.contains("\"ok\":true");
                        Ok(ChannelTestResult {
                            success,
                            channel: channel_type,
                            message: if success { 
                                format!("{} 消息已发送", bot_name) 
                            } else { 
                                "消息发送失败".to_string() 
                            },
                            error: if success { None } else { Some(output) },
                        })
                    }
                    Err(e) => Ok(ChannelTestResult {
                        success: false,
                        channel: channel_type,
                        message: "发送失败".to_string(),
                        error: Some(e),
                    }),
                }
            } else {
                Ok(ChannelTestResult {
                    success: true,
                    channel: channel_type,
                    message: format!("{} Token 有效 (未配置测试 Channel ID)", bot_name),
                    error: None,
                })
            }
        }
        "whatsapp" => {
            // WhatsApp 需要通过 openclaw status 检查
            let check_cmd = "openclaw status 2>/dev/null | grep -i whatsapp || echo 'not_configured'";
            let result = shell::run_bash_output(check_cmd);
            
            match result {
                Ok(output) => {
                    let output_lower = output.to_lowercase();
                    // WhatsApp 状态可能显示: connected, online, linked, OK
                    let connected = output_lower.contains("connected") 
                        || output_lower.contains("online")
                        || output_lower.contains("linked")
                        || output.contains("OK");
                    let not_configured = output.contains("not_configured") 
                        || output_lower.contains("未配置")
                        || output_lower.contains("disabled");
                    
                    if not_configured {
                        Ok(ChannelTestResult {
                            success: false,
                            channel: channel_type,
                            message: "未登录".to_string(),
                            error: Some("请运行: openclaw channels login --channel whatsapp".to_string()),
                        })
                    } else {
                        // 提取手机号信息
                        let phone_info = if output.contains("+") {
                            // 尝试提取手机号
                            output.split("·").nth(1).map(|s| s.trim().to_string()).unwrap_or_default()
                        } else {
                            String::new()
                        };
                        
                        let message = if connected {
                            if !phone_info.is_empty() {
                                format!("已连接 ({})", phone_info)
                            } else {
                                "已连接".to_string()
                            }
                        } else {
                            output.clone()
                        };
                        
                        Ok(ChannelTestResult {
                            success: connected,
                            channel: channel_type,
                            message,
                            error: if connected { None } else { Some(output) },
                        })
                    }
                }
                Err(e) => Ok(ChannelTestResult {
                    success: false,
                    channel: channel_type,
                    message: "检查失败".to_string(),
                    error: Some(e),
                }),
            }
        }
        _ => Ok(ChannelTestResult {
            success: false,
            channel: channel_type.clone(),
            message: "不支持的渠道".to_string(),
            error: Some(format!("暂不支持测试 {} 渠道", channel_type)),
        }),
    }
}

/// 获取系统信息
#[command]
pub async fn get_system_info() -> Result<SystemInfo, String> {
    let os = platform::get_os();
    let arch = platform::get_arch();
    
    // 获取 OS 版本
    let os_version = if platform::is_macos() {
        shell::run_command_output("sw_vers", &["-productVersion"])
            .unwrap_or_else(|_| "unknown".to_string())
    } else if platform::is_linux() {
        shell::run_bash_output("cat /etc/os-release | grep VERSION_ID | cut -d'=' -f2 | tr -d '\"'")
            .unwrap_or_else(|_| "unknown".to_string())
    } else {
        "unknown".to_string()
    };
    
    let openclaw_installed = shell::command_exists("openclaw");
    let openclaw_version = if openclaw_installed {
        shell::run_command_output("openclaw", &["--version"]).ok()
    } else {
        None
    };
    
    let node_version = shell::run_command_output("node", &["--version"]).ok();
    
    Ok(SystemInfo {
        os,
        os_version,
        arch,
        openclaw_installed,
        openclaw_version,
        node_version,
        config_dir: platform::get_config_dir(),
    })
}

/// 启动渠道登录（如 WhatsApp 扫码）
#[command]
pub async fn start_channel_login(channel_type: String) -> Result<String, String> {
    match channel_type.as_str() {
        "whatsapp" => {
            // 先在后台启用插件
            let _ = shell::run_openclaw(&["plugins", "enable", "whatsapp"]);
            
            #[cfg(target_os = "macos")]
            {
                let env_path = platform::get_env_file_path();
                // 创建一个临时脚本文件
                // 流程：1. 启用插件 2. 重启 Gateway 3. 登录
                let script_content = format!(
                    r#"#!/bin/bash
source {} 2>/dev/null
clear
echo "╔════════════════════════════════════════════════════════╗"
echo "║           📱 WhatsApp 登录向导                          ║"
echo "╚════════════════════════════════════════════════════════╝"
echo ""

echo "步骤 1/3: 启用 WhatsApp 插件..."
openclaw plugins enable whatsapp 2>/dev/null || true

# 确保 whatsapp 在 plugins.allow 数组中
python3 << 'PYEOF'
import json
import os

config_path = os.path.expanduser("~/.openclaw/openclaw.json")
plugin_id = "whatsapp"

try:
    with open(config_path, 'r') as f:
        config = json.load(f)
    
    # 设置 plugins.allow 和 plugins.entries
    if 'plugins' not in config:
        config['plugins'] = {{'allow': [], 'entries': {{}}}}
    if 'allow' not in config['plugins']:
        config['plugins']['allow'] = []
    if 'entries' not in config['plugins']:
        config['plugins']['entries'] = {{}}
    
    if plugin_id not in config['plugins']['allow']:
        config['plugins']['allow'].append(plugin_id)
    
    config['plugins']['entries'][plugin_id] = {{'enabled': True}}
    
    # 确保 channels.whatsapp 存在（但不设置 enabled，WhatsApp 不支持这个键）
    if 'channels' not in config:
        config['channels'] = {{}}
    if plugin_id not in config['channels']:
        config['channels'][plugin_id] = {{'dmPolicy': 'pairing', 'groupPolicy': 'allowlist'}}
    
    with open(config_path, 'w') as f:
        json.dump(config, f, indent=2, ensure_ascii=False)
    print("配置已更新")
except Exception as e:
    print(f"Warning: {{e}}")
PYEOF

echo "✅ 插件已启用"
echo ""

echo "步骤 2/3: 重启 Gateway 使插件生效..."
# 停止现有 gateway
pkill -f "openclaw.*gateway" 2>/dev/null || true
sleep 2
# 后台启动 gateway
nohup openclaw gateway --port 18789 > /tmp/openclaw-gateway.log 2>&1 &
sleep 3
echo "✅ Gateway 已重启"
echo ""

echo "步骤 3/3: 启动 WhatsApp 登录..."
echo "请使用 WhatsApp 手机 App 扫描下方二维码"
echo ""
openclaw channels login --channel whatsapp --verbose
echo ""
echo "════════════════════════════════════════════════════════"
echo "登录完成！"
echo ""
read -p "按回车键关闭此窗口..."
"#,
                    env_path
                );
                
                let script_path = "/tmp/openclaw_whatsapp_login.command";
                std::fs::write(script_path, script_content)
                    .map_err(|e| format!("创建脚本失败: {}", e))?;
                
                // 设置可执行权限
                std::process::Command::new("chmod")
                    .args(["+x", script_path])
                    .output()
                    .map_err(|e| format!("设置权限失败: {}", e))?;
                
                // 使用 open 命令打开 .command 文件（会自动在新终端窗口中执行）
                std::process::Command::new("open")
                    .arg(script_path)
                    .spawn()
                    .map_err(|e| format!("启动终端失败: {}", e))?;
            }
            
            #[cfg(target_os = "linux")]
            {
                let env_path = platform::get_env_file_path();
                // 创建脚本
                let script_content = format!(
                    r#"#!/bin/bash
source {} 2>/dev/null
clear
echo "📱 WhatsApp 登录向导"
echo ""
openclaw channels login --channel whatsapp --verbose
echo ""
read -p "按回车键关闭..."
"#,
                    env_path
                );
                
                let script_path = "/tmp/openclaw_whatsapp_login.sh";
                std::fs::write(script_path, &script_content)
                    .map_err(|e| format!("创建脚本失败: {}", e))?;
                
                std::process::Command::new("chmod")
                    .args(["+x", script_path])
                    .output()
                    .map_err(|e| format!("设置权限失败: {}", e))?;
                
                // 尝试不同的终端模拟器
                let terminals = ["gnome-terminal", "xfce4-terminal", "konsole", "xterm"];
                let mut launched = false;
                
                for term in terminals {
                    let result = std::process::Command::new(term)
                        .args(["--", script_path])
                        .spawn();
                    
                    if result.is_ok() {
                        launched = true;
                        break;
                    }
                }
                
                if !launched {
                    return Err("无法启动终端，请手动运行: openclaw channels login --channel whatsapp".to_string());
                }
            }
            
            #[cfg(target_os = "windows")]
            {
                return Err("Windows 暂不支持自动启动终端，请手动运行: openclaw channels login --channel whatsapp".to_string());
            }
            
            Ok("已在新终端窗口中启动 WhatsApp 登录，请查看弹出的终端窗口并扫描二维码".to_string())
        }
        _ => Err(format!("不支持 {} 的登录向导", channel_type)),
    }
}
