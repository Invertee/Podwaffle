import { requireNativeModule } from "expo-modules-core";

export interface NativeCacheSummary {
  completedCount: number;
  completedBytes: number;
}

export interface NativeCacheMaintenanceResult {
  removedCount: number;
  freedBytes: number;
  errors: string[];
}

interface PodwaffleCacheNativeModule {
  getSummary(): Promise<NativeCacheSummary>;
  clearCompleted(): Promise<NativeCacheMaintenanceResult>;
  runMaintenance(): Promise<NativeCacheMaintenanceResult>;
}

const nativeModule =
  requireNativeModule<PodwaffleCacheNativeModule>("PodwaffleCache");

export const PodwaffleCacheModule = {
  getSummary(): Promise<NativeCacheSummary> {
    return nativeModule.getSummary();
  },
  clearCompleted(): Promise<NativeCacheMaintenanceResult> {
    return nativeModule.clearCompleted();
  },
  runMaintenance(): Promise<NativeCacheMaintenanceResult> {
    return nativeModule.runMaintenance();
  },
};
