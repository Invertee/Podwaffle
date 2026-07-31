import type {
  ApiErrorBody,
  PublicProfile,
  Session,
  Snapshot,
  SyncEvent,
  SystemInfo,
} from "@podwaffle/contracts";

const REQUEST_TIMEOUT_MS = 12_000;

export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly body?: ApiErrorBody,
  ) {
    super(body?.error.message ?? `Request failed (${status})`);
    this.name = "ApiClientError";
  }
}

export function normalizeServerUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) throw new Error("Enter your Podwaffle server URL.");
  const withProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  const parsed = new URL(withProtocol);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("The server URL must use HTTP or HTTPS.");
  }
  return parsed.toString().replace(/\/+$/, "");
}

async function request<T>(
  serverUrl: string,
  path: string,
  token?: string,
  init?: RequestInit,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${serverUrl}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        accept: "application/json",
        ...(init?.body ? { "content-type": "application/json" } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...init?.headers,
      },
    });
    if (!response.ok) {
      let body: ApiErrorBody | undefined;
      try {
        body = (await response.json()) as ApiErrorBody;
      } catch {
        body = undefined;
      }
      throw new ApiClientError(response.status, body);
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("The server did not respond in time.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export const api = {
  system: (serverUrl: string) =>
    request<SystemInfo>(serverUrl, "/version.json"),
  profiles: (serverUrl: string) =>
    request<{ profiles: PublicProfile[] }>(
      serverUrl,
      "/api/v1/join/profiles",
    ).then((result) => result.profiles),
  join: (
    serverUrl: string,
    body: {
      profileId: string;
      joinCode: string;
      deviceName: string;
      platform: "android";
      appVersion?: string;
      runtimeVersion?: string;
    },
  ) =>
    request<{ session: Session; token: string }>(
      serverUrl,
      "/api/v1/join",
      undefined,
      { method: "POST", body: JSON.stringify(body) },
    ),
  me: (serverUrl: string, token: string) =>
    request<{ session: Session }>(serverUrl, "/api/v1/me", token).then(
      (result) => result?.session,
    ),
  snapshot: (serverUrl: string, token: string) =>
    request<Snapshot>(serverUrl, "/api/v1/snapshot", token),
  sync: (serverUrl: string, token: string, afterRevision: number) =>
    request<{
      events: SyncEvent[];
      currentRevision: number;
      snapshotRequired?: boolean;
    }>(serverUrl, `/api/v1/sync?afterRevision=${afterRevision}`, token),
};
