const secretKeys = new Set([
  "authorization",
  "cookie",
  "joinCode",
  "join_code",
  "token",
  "registrationToken",
]);

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        secretKeys.has(key) ? "[REDACTED]" : redact(child),
      ]),
    );
  }
  return value;
}

export function log(
  level: "debug" | "info" | "warn" | "error",
  event: string,
  fields: Record<string, unknown> = {},
): void {
  const safeFields = redact(fields) as Record<string, unknown>;
  process.stdout.write(
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      event,
      ...safeFields,
    })}\n`,
  );
}
