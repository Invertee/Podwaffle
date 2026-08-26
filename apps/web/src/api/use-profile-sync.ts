import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { serverMessageSchema } from "@podwaffle/contracts";
import { ApiClientError, api } from "./client";
import { useSyncStore } from "../stores/sync";
import {
  bindPlaybackSocket,
  dispatchPlaybackCommand,
} from "./playback-channel";

const MAX_RECONNECT_MS = 30_000;

export function useProfileSync(authenticated: boolean): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!authenticated) return;
    let socket: WebSocket | undefined;
    let stopped = false;
    let attempts = 0;
    let reconnectTimer: number | undefined;
    let lastRecoveryAt = 0;

    const refreshSnapshot = async () => {
      const snapshot = await api.snapshot();
      useSyncStore.getState().setSnapshot(snapshot);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["devices"] }),
        queryClient.invalidateQueries({ queryKey: ["episodes"] }),
        queryClient.invalidateQueries({ queryKey: ["in-progress"] }),
        queryClient.invalidateQueries({ queryKey: ["history"] }),
        queryClient.invalidateQueries({ queryKey: ["queue"] }),
      ]);
    };

    const recoverGap = async (afterRevision: number) => {
      try {
        const result = await api.sync(afterRevision);
        let expected = afterRevision + 1;
        for (const event of result.events) {
          if (event.revision !== expected) {
            await refreshSnapshot();
            return;
          }
          expected += 1;
        }
        await refreshSnapshot();
      } catch (error) {
        if (error instanceof ApiClientError && error.status === 409) {
          await refreshSnapshot();
          return;
        }
        throw error;
      }
    };

    const connect = () => {
      if (
        stopped ||
        (socket !== undefined && socket.readyState < WebSocket.CLOSING)
      )
        return;
      const revision = useSyncStore.getState().revision;
      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      const nextSocket = new WebSocket(
        `${protocol}//${location.host}/ws?afterRevision=${revision}`,
      );
      socket = nextSocket;
      nextSocket.addEventListener("open", () => {
        if (socket !== nextSocket) return;
        attempts = 0;
        useSyncStore.getState().setConnected(true);
        bindPlaybackSocket(nextSocket);
      });
      nextSocket.addEventListener("message", (message) => {
        if (socket !== nextSocket) return;
        void (async () => {
          const parsed = serverMessageSchema.safeParse(
            JSON.parse(String(message.data)) as unknown,
          );
          if (!parsed.success) return;
          if (parsed.data.type === "playback.command") {
            await dispatchPlaybackCommand(parsed.data.command);
            return;
          }
          if (parsed.data.type === "playback.command.cancelled") return;
          if (parsed.data.type === "server.notice") {
            if (parsed.data.code === "SNAPSHOT_REQUIRED")
              await refreshSnapshot();
            if (parsed.data.code === "DEVICE_REVOKED") {
              await queryClient.invalidateQueries({ queryKey: ["session"] });
            }
            return;
          }
          const current = useSyncStore.getState().revision;
          if (parsed.data.event.revision !== current + 1) {
            await recoverGap(current);
            return;
          }
          await refreshSnapshot();
        })();
      });
      nextSocket.addEventListener("close", () => {
        if (socket !== nextSocket) return;
        socket = undefined;
        bindPlaybackSocket(undefined);
        useSyncStore.getState().setConnected(false);
        if (!stopped) {
          const base = Math.min(1000 * 2 ** attempts++, MAX_RECONNECT_MS);
          const delay = base * (0.75 + Math.random() * 0.5);
          reconnectTimer = window.setTimeout(connect, delay);
        }
      });
    };

    const reconnect = () => {
      if (stopped) return;
      if (reconnectTimer !== undefined) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
      }
      const previous = socket;
      socket = undefined;
      bindPlaybackSocket(undefined);
      useSyncStore.getState().setConnected(false);
      previous?.close();
      connect();
    };

    const recoverForegroundState = () => {
      if (stopped || document.visibilityState === "hidden") return;
      const now = Date.now();
      if (now - lastRecoveryAt < 1_000) return;
      lastRecoveryAt = now;
      reconnect();
      void refreshSnapshot().catch(() => undefined);
    };

    document.addEventListener("visibilitychange", recoverForegroundState);
    window.addEventListener("focus", recoverForegroundState);
    window.addEventListener("pageshow", recoverForegroundState);
    window.addEventListener("online", recoverForegroundState);

    void refreshSnapshot()
      .catch(() => undefined)
      .finally(connect);
    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", recoverForegroundState);
      window.removeEventListener("focus", recoverForegroundState);
      window.removeEventListener("pageshow", recoverForegroundState);
      window.removeEventListener("online", recoverForegroundState);
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      socket?.close();
      bindPlaybackSocket(undefined);
      useSyncStore.getState().setConnected(false);
    };
  }, [authenticated, queryClient]);
}
