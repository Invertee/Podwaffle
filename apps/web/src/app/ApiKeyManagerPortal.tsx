import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  createApiKey,
  listApiKeys,
  revokeApiKey,
  type ManagedApiKey,
} from "../api/api-keys";
import "../styles/api-keys.css";

function findSecurityPanel(): HTMLElement | null {
  const panels = Array.from(
    document.querySelectorAll<HTMLElement>(".profile-page > .panel"),
  );
  return (
    panels.find(
      (panel) =>
        panel.querySelector(".panel-heading h2")?.textContent?.trim() ===
        "Connected devices",
    ) ?? null
  );
}

function useSecurityPanelHost(): HTMLElement | null {
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    let currentHost: HTMLElement | null = null;

    const attach = () => {
      const panel = findSecurityPanel();
      if (!panel) {
        currentHost = null;
        setHost(null);
        return;
      }

      const existing = panel.querySelector<HTMLElement>(
        "[data-api-key-manager-host]",
      );
      if (existing) {
        currentHost = existing;
        setHost((value) => (value === existing ? value : existing));
        return;
      }

      const nextHost = document.createElement("div");
      nextHost.dataset.apiKeyManagerHost = "true";
      const deviceList = panel.querySelector(".device-list");
      if (deviceList) deviceList.insertAdjacentElement("afterend", nextHost);
      else panel.appendChild(nextHost);
      currentHost = nextHost;
      setHost(nextHost);
    };

    attach();
    const observer = new MutationObserver(attach);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      if (currentHost?.isConnected) currentHost.remove();
    };
  }, []);

  return host;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function keyLastUsed(key: ManagedApiKey): string {
  const created = Date.parse(key.createdAt);
  const lastSeen = Date.parse(key.lastSeenAt);
  if (
    Number.isNaN(created) ||
    Number.isNaN(lastSeen) ||
    lastSeen <= created + 1_000
  ) {
    return "Not used yet";
  }
  return `Last used ${formatDate(key.lastSeenAt)}`;
}

function ApiKeyManager() {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const apiKeys = useQuery({
    queryKey: ["api-keys"],
    queryFn: listApiKeys,
  });

  const create = useMutation({
    mutationFn: createApiKey,
    onSuccess: async (result) => {
      setCreatedToken(result.token);
      setCopied(false);
      setName("");
      await queryClient.invalidateQueries({ queryKey: ["api-keys"] });
    },
  });

  const revoke = useMutation({
    mutationFn: revokeApiKey,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["api-keys"] });
    },
  });

  const copyToken = async () => {
    if (!createdToken) return;
    try {
      await navigator.clipboard.writeText(createdToken);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className="api-key-manager" aria-labelledby="api-key-heading">
      <div className="api-key-manager-heading">
        <div>
          <p className="eyebrow">API access</p>
          <h2 id="api-key-heading">API keys</h2>
          <p className="api-key-description">
            Create restricted keys for playback controls and read-only profile
            state. Keys cannot modify the library or create other keys.
          </p>
        </div>
        <form
          className="api-key-create-form"
          onSubmit={(event) => {
            event.preventDefault();
            const trimmed = name.trim();
            if (trimmed) create.mutate(trimmed);
          }}
        >
          <input
            aria-label="API key name"
            maxLength={80}
            placeholder="Key name"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <button disabled={!name.trim() || create.isPending} type="submit">
            {create.isPending ? "Creating…" : "Create key"}
          </button>
        </form>
      </div>

      {create.isError && (
        <p className="api-key-error">{create.error.message}</p>
      )}

      {createdToken && (
        <div className="api-key-secret" role="status">
          <div>
            <strong>API key created</strong>
            <span>Copy this key now. It will not be shown again.</span>
          </div>
          <div className="api-key-secret-value">
            <code>{createdToken}</code>
            <button className="secondary" type="button" onClick={copyToken}>
              {copied ? "Copied" : "Copy"}
            </button>
            <button
              className="secondary"
              type="button"
              onClick={() => {
                setCreatedToken(null);
                setCopied(false);
              }}
            >
              Done
            </button>
          </div>
        </div>
      )}

      <div className="api-key-list">
        {apiKeys.isLoading && <p className="api-key-empty">Loading API keys…</p>}
        {apiKeys.isError && (
          <p className="api-key-error">{apiKeys.error.message}</p>
        )}
        {!apiKeys.isLoading && !apiKeys.isError && apiKeys.data?.length === 0 && (
          <p className="api-key-empty">No API keys have been created.</p>
        )}
        {apiKeys.data?.map((key) => (
          <article className="api-key-row" key={key.id}>
            <div className="api-key-icon">K</div>
            <div className="api-key-copy">
              <h3>{key.name}</h3>
              <p>
                <code>{key.prefix}…</code>
                <span>Created {formatDate(key.createdAt)}</span>
                <span>{keyLastUsed(key)}</span>
              </p>
            </div>
            <button
              className="danger"
              disabled={revoke.isPending}
              onClick={() => {
                if (
                  window.confirm(
                    `Revoke the API key “${key.name}”? Anything using it will stop working immediately.`,
                  )
                ) {
                  revoke.mutate(key.id);
                }
              }}
              type="button"
            >
              Revoke
            </button>
          </article>
        ))}
      </div>
      {revoke.isError && (
        <p className="api-key-error">{revoke.error.message}</p>
      )}
    </section>
  );
}

export function ApiKeyManagerPortal() {
  const host = useSecurityPanelHost();
  return host ? createPortal(<ApiKeyManager />, host) : null;
}
