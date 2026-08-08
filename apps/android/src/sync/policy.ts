export type ConnectionTransport =
  | "wifi"
  | "cellular"
  | "ethernet"
  | "vpn"
  | "other"
  | "none"
  | "unknown";

const HOME_STATE_REPORT_INTERVAL_MS = 10_000;
const MOBILE_STATE_REPORT_INTERVAL_MS = 30_000;
const HOME_TELEMETRY_INTERVAL_MS = 15_000;
const MOBILE_TELEMETRY_INTERVAL_MS = 60_000;
const HOME_LEASE_RENEWAL_MARGIN_MS = 15_000;
const MOBILE_LEASE_RENEWAL_MARGIN_MS = 5_000;

class PlaybackSyncPolicy {
  private transport: ConnectionTransport = "unknown";

  public setTransport(transport: ConnectionTransport): void {
    this.transport = transport;
  }

  public get currentTransport(): ConnectionTransport {
    return this.transport;
  }

  public get liveSyncEnabled(): boolean {
    return this.transport === "wifi" || this.transport === "ethernet";
  }

  public get stateReportIntervalMs(): number {
    return this.liveSyncEnabled
      ? HOME_STATE_REPORT_INTERVAL_MS
      : MOBILE_STATE_REPORT_INTERVAL_MS;
  }

  public get telemetryIntervalMs(): number {
    return this.liveSyncEnabled
      ? HOME_TELEMETRY_INTERVAL_MS
      : MOBILE_TELEMETRY_INTERVAL_MS;
  }

  public get leaseRenewalMarginMs(): number {
    return this.liveSyncEnabled
      ? HOME_LEASE_RENEWAL_MARGIN_MS
      : MOBILE_LEASE_RENEWAL_MARGIN_MS;
  }
}

export const playbackSyncPolicy = new PlaybackSyncPolicy();
