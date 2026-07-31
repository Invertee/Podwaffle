import type {
  PlaybackCommand,
  ServerMessage,
  SyncEvent,
} from "@podwaffle/contracts";

import { api } from "../api/client";
import { playbackController } from "../playback/controller";
import type { Credentials } from "../stores/auth";
import { useAuthStore } from "../stores/auth";

const HEARTBEAT_MS = 25_000;
const MAX_RECONNECT_MS = 30_000;

function websocketUrl(
  credentials: Credentials,
  afterRevision: number,
): string {
  const url = new URL(credentials.serverUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws";
  url.search = "";
  url.searchParams.set("afterRevision", String(Math.max(0, afterRevision)));
  url.searchParams.set("token", credentials.token);
  return url.toString();
}

class AndroidSyncRuntime {
  private socket: WebSocket | null = null;
  private credentials: Credentials | null = null;
  private active = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private afterRevision = 0;

  public start(credentials: Credentials, afterRevision: number): void {
    const changed =
      this.credentials?.serverUrl !== credentials.serverUrl ||
      this.credentials?.token !== credentials.token;
    this.credentials = credentials;
    this.afterRevision = changed
      ? Math.max(0, afterRevision)
      : Math.max(this.afterRevision, afterRevision);
    this.active = true;
    if (changed) this.disconnect();
    if (!this.socket) this.connect();
  }

  public stop(): void {
    this.active = false;
    this.credentials = null;
    this.afterRevision = 0;
    this.disconnect();
  }

  public updateRevision(revision: number): void {
    this.afterRevision = Math.max(this.afterRevision, Math.max(0, revision));
  }

  public reconnect(): void {
    if (!this.active || !this.credentials) return;
    this.updateRevision(useAuthStore.getState().snapshot?.revision ?? 0);
    this.disconnect();
    this.connect();
  }

  private connect(): void {
    if (!this.active || !this.credentials || this.socket) return;
    const socket = new WebSocket(
      websocketUrl(this.credentials, this.afterRevision),
    );
    this.socket = socket;

    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.reconnectAttempt = 0;
      useAuthStore.getState().setLiveSyncConnected(true);
      this.heartbeatTimer = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "client.heartbeat" }));
        }
      }, HEARTBEAT_MS);
    };

    socket.onmessage = (event) => {
      if (typeof event.data !== "string") return;
      try {
        void this.handleMessage(JSON.parse(event.data) as ServerMessage);
      } catch {
        // Ignore malformed server messages; REST catch-up remains authoritative.
      }
    };

    socket.onerror = () => {
      useAuthStore.getState().setLiveSyncConnected(false);
    };

    socket.onclose = () => {
      if (this.socket === socket) this.socket = null;
      this.stopHeartbeat();
      useAuthStore.getState().setLiveSyncConnected(false);
      this.scheduleReconnect();
    };
  }

  private async handleMessage(message: ServerMessage): Promise<void> {
    if (message.type === "sync.event") {
      this.handleEvent(message.event);
      return;
    }
    if (message.type === "playback.command") {
      await this.handlePlaybackCommand(message.command);
      return;
    }
    if (message.type === "playback.command.cancelled") {
      await playbackController.handleCastCancellation(message.reason);
      this.scheduleRefresh(0);
      return;
    }
    if (message.type === "server.notice") {
      if (message.code === "DEVICE_REVOKED") {
        await useAuthStore.getState().logout();
        this.stop();
        return;
      }
      if (message.code === "SNAPSHOT_REQUIRED") {
        this.afterRevision = 0;
        this.scheduleRefresh(0);
      }
    }
  }

  private handleEvent(event: SyncEvent): void {
    if (event.revision <= this.afterRevision) return;
    this.afterRevision = event.revision;
    this.scheduleRefresh(120);
  }

  private async handlePlaybackCommand(
    command: PlaybackCommand & { requestedByDeviceId: string },
  ): Promise<void> {
    const result = await playbackController.handleRemoteCastCommand(command);
    const credentials = this.credentials;
    if (!credentials) return;
    try {
      await api.playbackCommandResult(
        credentials.serverUrl,
        credentials.token,
        { commandId: command.commandId, ...result },
      );
    } catch {
      // Preserve compatibility with a temporarily unavailable REST path. The
      // backend accepts the same result over the authenticated WebSocket.
      this.send({
        type: "playback.command.result",
        commandId: command.commandId,
        ...result,
      });
    }
  }

  private send(message: Record<string, unknown>): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    }
  }

  private scheduleRefresh(delayMs: number): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      void useAuthStore
        .getState()
        .refresh()
        .then(() => {
          const revision = useAuthStore.getState().snapshot?.revision ?? 0;
          this.afterRevision = Math.max(this.afterRevision, revision);
        });
    }, delayMs);
  }

  private scheduleReconnect(): void {
    if (!this.active || !this.credentials || this.reconnectTimer) return;
    const base = Math.min(
      MAX_RECONNECT_MS,
      1_000 * 2 ** Math.min(this.reconnectAttempt++, 5),
    );
    const delay = Math.round(base * (0.8 + Math.random() * 0.4));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private disconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.reconnectTimer = null;
    this.refreshTimer = null;
    this.stopHeartbeat();
    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close();
    useAuthStore.getState().setLiveSyncConnected(false);
  }
}

export const syncRuntime = new AndroidSyncRuntime();
