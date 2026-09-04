export interface ManagedApiKey {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  createdAt: string;
  lastSeenAt: string;
}

interface ErrorBody {
  error?: {
    message?: string;
  };
}

async function request<T>(path = "", init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/v1/api-keys${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
    credentials: "same-origin",
  });
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = (await response.json()) as ErrorBody;
      if (body.error?.message) message = body.error.message;
    } catch {
      // Keep the status-based message when the response is not JSON.
    }
    throw new Error(message);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function listApiKeys(): Promise<ManagedApiKey[]> {
  return request<{ apiKeys: ManagedApiKey[] }>().then((result) => result.apiKeys);
}

export function createApiKey(
  name: string,
): Promise<{ apiKey: ManagedApiKey; token: string }> {
  return request("", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export function revokeApiKey(apiKeyId: string): Promise<void> {
  return request<void>(`/${encodeURIComponent(apiKeyId)}`, {
    method: "DELETE",
  });
}
