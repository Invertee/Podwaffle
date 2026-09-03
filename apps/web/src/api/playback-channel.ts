import type { CastConfirmedState, PlaybackCommand } from "@podwaffle/contracts";

type OwnerCommand = PlaybackCommand & { requestedByDeviceId: string };
type CommandHandler = (command: OwnerCommand) => Promise<void>;

let socket: WebSocket | undefined;
let handler: CommandHandler | undefined;

export function bindPlaybackSocket(next: WebSocket | undefined): void {
  socket = next;
}

export function registerPlaybackCommandHandler(
  next: CommandHandler,
): () => void {
  handler = next;
  return () => {
    if (handler === next) handler = undefined;
  };
}

export async function dispatchPlaybackCommand(
  command: OwnerCommand,
): Promise<void> {
  await handler?.(command);
}

export function sendPlaybackCommandResult(input: {
  commandId: string;
  status: "accepted" | "rejected";
  confirmed?: CastConfirmedState;
  message?: string;
}): boolean {
  if (!socket || socket.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify({ type: "playback.command.result", ...input }));
  return true;
}
