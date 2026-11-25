import { RelayConnectionError, RelayHTTPError } from "./errors.js";
import type { DeviceInfo, PushInfo, RegisterResult, RelayState } from "./types.js";

export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ status: number; ok: boolean; text(): Promise<string>; headers: { get(name: string): string | null } }>;

export interface HttpOptions {
  fetch?: FetchLike;
}

function doFetch(options?: HttpOptions): FetchLike {
  const impl = options?.fetch ?? (globalThis as { fetch?: FetchLike }).fetch;
  if (!impl) throw new RelayConnectionError("no fetch available in this runtime");
  return impl;
}

/** Trims trailing slashes so paths join cleanly. */
export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}

async function request(
  baseUrl: string,
  method: string,
  path: string,
  options: HttpOptions | undefined,
  token?: string,
  body?: unknown,
): Promise<string> {
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const init: { method: string; headers: Record<string, string>; body?: string } = { method, headers };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  let response;
  try {
    response = await doFetch(options)(`${normalizeBaseUrl(baseUrl)}${path}`, init);
  } catch (error) {
    if (error instanceof RelayConnectionError) throw error;
    throw new RelayConnectionError("could not reach the relay (is Tailscale on, on both devices?)");
  }
  const text = await response.text();
  if (!response.ok) {
    const retry = Number(response.headers.get("Retry-After"));
    throw new RelayHTTPError(response.status, text, Number.isFinite(retry) && retry > 0 ? retry : undefined);
  }
  return text;
}

/** True when the relay answers `/v1/health`. */
export async function health(baseUrl: string, options?: HttpOptions): Promise<boolean> {
  try {
    const text = await request(baseUrl, "GET", "/v1/health", options);
    return (JSON.parse(text) as { ok?: boolean }).ok === true;
  } catch {
    return false;
  }
}

/**
 * Pairs this phone. `code` is the one-time code printed by `brb-relay pair` on the Mac.
 * Returns the device id and the bearer token. Keep the token in secure storage.
 */
export async function register(
  baseUrl: string,
  code: string,
  options?: HttpOptions,
): Promise<RegisterResult> {
  const text = await request(baseUrl, "POST", "/v1/devices/me/register", options, undefined, {
    code: code.trim(),
  });
  const parsed = JSON.parse(text) as { device_id?: string; token?: string };
  if (!parsed.device_id || !parsed.token) throw new RelayHTTPError(200, "unexpected register answer");
  return { deviceId: parsed.device_id, token: parsed.token };
}

export async function getState(baseUrl: string, token: string, options?: HttpOptions): Promise<RelayState> {
  const text = await request(baseUrl, "GET", "/v1/state", options, token);
  const parsed = JSON.parse(text) as { snippets?: RelayState["snippets"]; default_fps?: number };
  return { snippets: parsed.snippets ?? [], defaultFps: parsed.default_fps ?? 15 };
}

/** Checks the stored token still works. Resolves false if the Mac revoked this phone. */
export async function tokenIsValid(baseUrl: string, token: string, options?: HttpOptions): Promise<boolean> {
  try {
    await request(baseUrl, "GET", "/v1/devices/me", options, token);
    return true;
  } catch (error) {
    if (error instanceof RelayHTTPError && (error.status === 401 || error.status === 403)) return false;
    throw error;
  }
}

/** Removes this phone from the Mac. */
export async function unpair(baseUrl: string, token: string, options?: HttpOptions): Promise<void> {
  await request(baseUrl, "DELETE", "/v1/devices/me", options, token);
}

/** Who this phone is and what it may do (`read` or `control`). */
export async function getMe(baseUrl: string, token: string, options?: HttpOptions): Promise<DeviceInfo> {
  const text = await request(baseUrl, "GET", "/v1/devices/me", options, token);
  const parsed = JSON.parse(text) as { device_id?: string; scope?: string };
  return { deviceId: parsed.device_id ?? "", scope: parsed.scope === "control" ? "control" : "read" };
}

/** How to subscribe to phone notifications through ntfy, if the Mac has them on. */
export async function getPush(baseUrl: string, token: string, options?: HttpOptions): Promise<PushInfo> {
  const text = await request(baseUrl, "GET", "/v1/push", options, token);
  const parsed = JSON.parse(text) as { enabled?: boolean; subscribe_url?: string; include_text?: boolean };
  const info: PushInfo = { enabled: parsed.enabled === true, includeText: parsed.include_text === true };
  if (parsed.subscribe_url) info.subscribeUrl = parsed.subscribe_url;
  return info;
}
