import { invoke as tauriInvoke } from '@tauri-apps/api/core';

interface ApiErrorResponse {
  success: false;
  error: string;
}

interface ApiSuccessResponse<T> {
  success: true;
  data: T;
}

type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

function inTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export async function invokeCommand<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (inTauri()) {
    return tauriInvoke<T>(cmd, args);
  }

  const response = await fetch('/api/invoke', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify({
      cmd,
      args: args ?? {},
    }),
  });

  let payload: ApiResponse<T> | null = null;
  try {
    payload = (await response.json()) as ApiResponse<T>;
  } catch {
    // Ignore parse errors and fall back to HTTP status.
  }

  if (!response.ok) {
    if (payload && !payload.success) {
      throw new Error(payload.error);
    }
    throw new Error(`请求失败: HTTP ${response.status}`);
  }

  if (!payload) {
    throw new Error('响应数据为空');
  }

  if (!payload.success) {
    throw new Error(payload.error);
  }

  return payload.data;
}

export interface WebAuthStatus {
  needs_setup: boolean;
  authenticated: boolean;
  username?: string;
}

export async function getWebAuthStatus(): Promise<WebAuthStatus> {
  const response = await fetch('/api/auth/status', {
    credentials: 'include',
  });
  const payload = (await response.json()) as ApiResponse<WebAuthStatus>;
  if (!payload.success) {
    throw new Error(payload.error);
  }
  return payload.data;
}

export async function setupWebAdmin(username: string, password: string): Promise<void> {
  const response = await fetch('/api/auth/setup', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify({ username, password }),
  });

  const payload = (await response.json()) as ApiResponse<unknown>;
  if (!response.ok || !payload.success) {
    throw new Error(payload.success ? `请求失败: HTTP ${response.status}` : payload.error);
  }
}

export async function loginWebAdmin(username: string, password: string): Promise<void> {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify({ username, password }),
  });

  const payload = (await response.json()) as ApiResponse<unknown>;
  if (!response.ok || !payload.success) {
    throw new Error(payload.success ? `请求失败: HTTP ${response.status}` : payload.error);
  }
}

export async function logoutWebAdmin(): Promise<void> {
  const response = await fetch('/api/auth/logout', {
    method: 'POST',
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error(`退出登录失败: HTTP ${response.status}`);
  }
}
