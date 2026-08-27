const secretKeys = new Set([
  "authorization",
  "cookie",
  "joinCode",
  "join_code",
  "token",
  "registrationToken",
]);

type LogLevel = "debug" | "info" | "warn" | "error";

const levelRank: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

let minimumLevel: LogLevel = "info";

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
  level: LogLevel,
  event: string,
  fields: Record<string, unknown> = {},
): void {
  if (levelRank[level] < levelRank[minimumLevel]) return;
  const safeFields = redact(fields) as Record<string, unknown>;
  const suppliedMessage = safeFields.message;
  const message =
    typeof suppliedMessage === "string"
      ? suppliedMessage
      : event
          .split(".")
          .map((part) => part.replaceAll("_", " "))
          .join(" · ");
  const details = Object.entries(safeFields)
    .filter(([key, value]) => key !== "message" && value !== undefined)
    .map(([key, value]) => `${key}=${formatValue(value)}`)
    .join(" · ");
  process.stdout.write(
    `${new Date().toISOString()} [${level.toUpperCase()}] ${message}${details ? ` · ${details}` : ""}\n`,
  );
}

function formatValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value === null) return "none";
  return JSON.stringify(value);
}

export function configureLogging(level: LogLevel): void {
  minimumLevel = level;
}
