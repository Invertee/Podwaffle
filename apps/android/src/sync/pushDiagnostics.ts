import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "podwaffle.push-diagnostics.v1";
const MAX_ENTRIES = 100;
const MAX_DETAIL_LENGTH = 1_500;

export type PushDiagnosticLevel = "info" | "warning" | "error";

export interface PushDiagnosticEntry {
  id: string;
  timestamp: string;
  level: PushDiagnosticLevel;
  event: string;
  detail: string | null;
}

type Listener = (entries: PushDiagnosticEntry[]) => void;

const listeners = new Set<Listener>();
let pendingMutation: Promise<unknown> = Promise.resolve();
let sequence = 0;

function isEntry(value: unknown): value is PushDiagnosticEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entry = value as Partial<PushDiagnosticEntry>;
  return (
    typeof entry.id === "string" &&
    typeof entry.timestamp === "string" &&
    (entry.level === "info" ||
      entry.level === "warning" ||
      entry.level === "error") &&
    typeof entry.event === "string" &&
    (entry.detail === null || typeof entry.detail === "string")
  );
}

function formatDetail(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  let text: string;
  if (typeof value === "string") {
    text = value;
  } else {
    try {
      text = JSON.stringify(value);
    } catch {
      text = String(value);
    }
  }
  return text.length > MAX_DETAIL_LENGTH
    ? `${text.slice(0, MAX_DETAIL_LENGTH)}…`
    : text;
}

async function readStored(): Promise<PushDiagnosticEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isEntry).slice(0, MAX_ENTRIES);
  } catch {
    return [];
  }
}

function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const run = pendingMutation.then(operation, operation);
  pendingMutation = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function publish(entries: PushDiagnosticEntry[]): void {
  for (const listener of listeners) listener(entries);
}

export function pushErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.name && error.name !== "Error"
      ? `${error.name}: ${error.message}`
      : error.message;
  }
  return typeof error === "string" ? error : "Unknown push error";
}

export async function recordPushDiagnostic(
  event: string,
  detail?: unknown,
  level: PushDiagnosticLevel = "info",
): Promise<PushDiagnosticEntry> {
  return serialize(async () => {
    const timestamp = new Date().toISOString();
    const entry: PushDiagnosticEntry = {
      id: `${Date.now()}-${sequence++}`,
      timestamp,
      level,
      event,
      detail: formatDetail(detail),
    };
    const entries = [entry, ...(await readStored())].slice(0, MAX_ENTRIES);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    publish(entries);
    return entry;
  });
}

export async function readPushDiagnostics(): Promise<PushDiagnosticEntry[]> {
  return serialize(readStored);
}

export async function clearPushDiagnostics(): Promise<void> {
  await serialize(async () => {
    await AsyncStorage.removeItem(STORAGE_KEY);
    publish([]);
  });
}

export function subscribePushDiagnostics(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
