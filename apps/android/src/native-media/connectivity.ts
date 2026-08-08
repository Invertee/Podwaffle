import { requireNativeModule } from "expo-modules-core";

import type { ConnectionTransport } from "../sync/policy";

export interface NativeConnectionState {
  connected: boolean;
  transport: ConnectionTransport;
  metered: boolean;
}

interface PodwaffleConnectivityNativeModule {
  getState(): Promise<NativeConnectionState>;
  addListener(
    event: "connection.changed",
    handler: (state: NativeConnectionState) => void,
  ): { remove(): void };
}

const nativeModule =
  requireNativeModule<PodwaffleConnectivityNativeModule>(
    "PodwaffleConnectivity",
  );

export const PodwaffleConnectivityModule = {
  getState(): Promise<NativeConnectionState> {
    return nativeModule.getState();
  },
  addListener(
    handler: (state: NativeConnectionState) => void,
  ): { remove(): void } {
    return nativeModule.addListener("connection.changed", handler);
  },
};
