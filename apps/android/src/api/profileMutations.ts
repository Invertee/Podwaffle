import { ApiClientError } from "./client";
import { useAuthStore } from "../stores/auth";

export async function withProfileRevision<T>(
  operation: (revision: number) => Promise<T>,
): Promise<T> {
  const initialRevision = useAuthStore.getState().snapshot?.revision ?? 0;
  try {
    return await operation(initialRevision);
  } catch (error) {
    if (
      !(error instanceof ApiClientError) ||
      error.status !== 409 ||
      error.body?.error.code !== "REVISION_CONFLICT"
    ) {
      throw error;
    }
    await useAuthStore.getState().refresh();
    const refreshedRevision = useAuthStore.getState().snapshot?.revision ?? 0;
    return operation(refreshedRevision);
  }
}

export function authenticatedConnection(): {
  serverUrl: string;
  token: string;
} {
  const credentials = useAuthStore.getState().credentials;
  if (!credentials) throw new Error("This device is not connected to Podwaffle.");
  return credentials;
}

export async function refreshProfile(): Promise<void> {
  await useAuthStore.getState().refresh();
}
