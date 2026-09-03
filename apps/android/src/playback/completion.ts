const END_POSITION_TOLERANCE_MS = 2_000;

/**
 * Media3 may expose a transient STATE_ENDED while replacing the local player
 * with CastPlayer. Only use state-based completion as a fallback when the
 * reported position also confirms that the episode reached its end. The native
 * media.item.ended event remains authoritative for unknown-duration media.
 */
export function isConfirmedPlaybackEnd(
  positionMs: number,
  durationMs: number | null,
): boolean {
  return Boolean(
    durationMs &&
    durationMs > 0 &&
    positionMs >= Math.max(0, durationMs - END_POSITION_TOLERANCE_MS),
  );
}
