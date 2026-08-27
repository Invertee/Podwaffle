import type { IncomingMessage, Server as HttpServer } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import {
  clientMessageSchema,
  type ServerMessage,
  type SyncEvent,
} from "@podwaffle/contracts";
import type { PodwaffleDatabase } from "../db/connection.js";
import {
  authenticateToken,
  parseCookies,
  DEVICE_COOKIE,
} from "../auth/middleware.js";
import {
  deviceHasScope,
  deviceIsPlaybackTarget,
} from "../db/repositories/devices.js";
import type { SyncService } from "../sync/service.js";
import { log } from "../logging.js";
import { applyCastCommandResult } from "../api/playback.js";
import {
  expireIdleCast,
  idleCastProfiles,
  playbackState,
  type StoredPlaybackCommand,
} from "../playback/service.js";
import { setEpisodeProgress } from "../podcasts/service.js";

interface Client {
  socket: WebSocket;
  profileId: string;
  deviceId: string;
  playbackTarget: boolean;
}

export class PodwaffleWebSocketServer {
  private readonly webSocketServer = new WebSocketServer({ noServer: true });
  private readonly clients = new Set<Client>();
  private unsubscribe: (() => void) | undefined;
  private castIdleTimer: NodeJS.Timeout | undefined;
  private connectionObserver: (() => void) | undefined;

  public constructor(
    private readonly database: PodwaffleDatabase,
    private readonly sync: SyncService,
    private readonly push?: {
      wakePlaybackDevice: (
        deviceId: string,
        commandId: string,
      ) => Promise<boolean>;
    },
  ) {}

  public attach(server: HttpServer): void {
    this.unsubscribe = this.sync.subscribe((profileId, event) =>
      this.broadcast(profileId, event),
    );
    this.castIdleTimer = setInterval(() => this.sweepIdleCasts(), 60_000);
    server.on("upgrade", (request, socket, head) => {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (url.pathname !== "/ws") {
        socket.destroy();
        return;
      }
      const auth = this.authenticateUpgrade(request, url);
      if (!auth) {
        socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
      this.webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
        const client: Client = {
          socket: webSocket,
          profileId: auth.profile.id,
          deviceId: auth.device.id,
          playbackTarget: deviceIsPlaybackTarget(auth.device),
        };
        this.clients.add(client);
        this.connectionObserver?.();
        webSocket.on("close", () => {
          this.clients.delete(client);
          this.connectionObserver?.();
        });
        webSocket.on("error", (error) =>
          log("warn", "websocket.error", {
            deviceId: client.deviceId,
            error: error.message,
          }),
        );
        webSocket.on("message", (data) => {
          const message =
            typeof data === "string"
              ? data
              : Buffer.isBuffer(data)
                ? data.toString("utf8")
                : data instanceof ArrayBuffer
                  ? Buffer.from(data).toString("utf8")
                  : Buffer.concat(data).toString("utf8");
          const parsed = clientMessageSchema.safeParse(
            JSON.parse(message) as unknown,
          );
          if (!parsed.success) {
            webSocket.close(1008, "Invalid message");
          } else {
            if (parsed.data.type === "client.heartbeat") webSocket.pong();
            if (parsed.data.type === "playback.command.result") {
              if (!client.playbackTarget) {
                this.sendNotice(
                  webSocket,
                  "PLAYBACK_TARGET_REQUIRED",
                  "Controller devices cannot submit playback results",
                );
                return;
              }
              try {
                applyCastCommandResult(
                  this.database,
                  this.sync,
                  client.profileId,
                  client.deviceId,
                  parsed.data,
                );
              } catch (error) {
                this.sendNotice(
                  webSocket,
                  "CAST_RESULT_REJECTED",
                  error instanceof Error
                    ? error.message
                    : "Cast result was rejected",
                );
              }
            }
          }
        });
        const afterRevision = Number.parseInt(
          url.searchParams.get("afterRevision") ?? "0",
          10,
        );
        if (
          !Number.isSafeInteger(afterRevision) ||
          afterRevision < 0 ||
          this.sync.requiresSnapshot(client.profileId, afterRevision)
        ) {
          this.sendNotice(
            webSocket,
            "SNAPSHOT_REQUIRED",
            "A fresh snapshot is required",
          );
        } else {
          for (const event of this.sync.eventsAfter(
            client.profileId,
            afterRevision,
          )) {
            this.sendEvent(webSocket, event);
          }
        }
      });
    });
  }

  private authenticateUpgrade(request: IncomingMessage, url: URL) {
    const bearer = url.searchParams.get("token") ?? undefined;
    const cookie = parseCookies(request.headers.cookie)[DEVICE_COOKIE];
    const auth = authenticateToken(this.database, bearer ?? cookie);
    if (!auth || !deviceHasScope(auth.device, "sync:read")) return undefined;

    // Reverse proxies commonly omit the external port from X-Forwarded-Host.
    // Compare hostnames rather than complete host:port values so a public URL
    // such as https://example:8443 can upgrade through an internal :3000
    // upstream without weakening the cross-origin check.
    const forwardedHost = request.headers["x-forwarded-host"];
    const publicHost =
      (Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost) ??
      request.headers.host;
    const origin = request.headers.origin;
    if (origin && publicHost) {
      try {
        const originHostname = new URL(origin).hostname.toLowerCase();
        const forwardedValue = publicHost.split(",")[0]?.trim() ?? "";
        const publicHostname = new URL(
          `http://${forwardedValue}`,
        ).hostname.toLowerCase();
        if (originHostname !== publicHostname) return undefined;
      } catch {
        return undefined;
      }
    }
    return auth;
  }

  private sendEvent(socket: WebSocket, event: SyncEvent): void {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "sync.event", event }));
    }
  }

  private sendMessage(socket: WebSocket, message: ServerMessage): void {
    if (socket.readyState === WebSocket.OPEN)
      socket.send(JSON.stringify(message));
  }

  private sendNotice(socket: WebSocket, code: string, message: string): void {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "server.notice", code, message }));
    }
  }

  private broadcast(profileId: string, event: SyncEvent): void {
    for (const client of this.clients) {
      if (client.profileId === profileId) this.sendEvent(client.socket, event);
    }
  }

  public async sendPlaybackCommand(
    profileId: string,
    ownerDeviceId: string,
    command: StoredPlaybackCommand["command"],
  ): Promise<boolean> {
    let delivered = false;
    for (const client of this.clients) {
      if (
        client.profileId === profileId &&
        client.deviceId === ownerDeviceId &&
        client.playbackTarget &&
        client.socket.readyState === WebSocket.OPEN
      ) {
        this.sendMessage(client.socket, {
          type: "playback.command",
          command,
        });
        delivered = true;
      }
    }
    // Race the live channel with an idempotent, high-priority FCM wake-up. An
    // open socket does not prove Android is still executing, while FCM
    // acceptance does not prove immediate device delivery. Whichever arrives
    // first causes the target to claim the same durable pending command.
    const wake = this.push?.wakePlaybackDevice(
      ownerDeviceId,
      command.commandId,
    );
    if (delivered) {
      void wake?.catch(() => undefined);
      return true;
    }
    return (await wake?.catch(() => false)) ?? false;
  }

  public sweepIdleCasts(now = new Date()): number {
    let expired = 0;
    for (const profileId of idleCastProfiles(this.database.db, now)) {
      const applied = this.sync.mutate(
        profileId,
        "playback.cast.updated",
        (db) => {
          // Cast position is kept in playback_state while the receiver owns
          // playback. Persist its last confirmed value before clearing the
          // session so the episode does not reopen from stale (often zero)
          // progress after the idle timeout.
          const current = playbackState(db, profileId, "");
          if (!expireIdleCast(db, profileId, now))
            return { result: false, payload: {} };
          const episode = current.episode
            ? setEpisodeProgress(
                db,
                profileId,
                current.episode.id,
                current.positionMs,
                current.durationMs,
              )
            : null;
          db.prepare(
            `UPDATE playback_commands SET status = 'cancelled', completed_at = ?
             WHERE profile_id = ? AND status = 'pending'`,
          ).run(now.toISOString(), profileId);
          return {
            result: true,
            payload: {
              reason: "cast_idle_timeout",
              playback: playbackState(db, profileId, ""),
              episode,
            },
          };
        },
      );
      if (applied.result) {
        expired += 1;
        for (const client of this.clients) {
          if (client.profileId === profileId)
            this.sendMessage(client.socket, {
              type: "playback.command.cancelled",
              reason: "Cast returned to local mode after 30 minutes idle",
            });
        }
      }
    }
    return expired;
  }

  public revokeDevice(deviceId: string): void {
    for (const client of this.clients) {
      if (client.deviceId === deviceId) {
        this.sendNotice(
          client.socket,
          "DEVICE_REVOKED",
          "This device was revoked",
        );
        client.socket.close(4001, "Device revoked");
      }
    }
  }

  public shutdown(): void {
    this.connectionObserver = undefined;
    this.unsubscribe?.();
    if (this.castIdleTimer) clearInterval(this.castIdleTimer);
    for (const client of this.clients) {
      this.sendNotice(
        client.socket,
        "SERVER_SHUTDOWN",
        "Server is shutting down",
      );
      client.socket.close(1001, "Server shutdown");
    }
    this.webSocketServer.close();
  }

  public get connectionCount(): number {
    return this.clients.size;
  }

  public connectedDeviceIds(): string[] {
    return [...new Set([...this.clients].map((client) => client.deviceId))];
  }

  public setConnectionObserver(observer: () => void): void {
    this.connectionObserver = observer;
  }
}
