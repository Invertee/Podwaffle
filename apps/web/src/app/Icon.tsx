import type { ReactNode, SVGProps } from "react";

export type IconName =
  | "cast"
  | "check"
  | "close"
  | "device"
  | "discover"
  | "history"
  | "info"
  | "list"
  | "mute"
  | "next"
  | "play"
  | "playSimple"
  | "podcasts"
  | "previous"
  | "profile"
  | "progress"
  | "queue"
  | "queueNext"
  | "stop"
  | "tiles"
  | "volume";

export function Icon({
  name,
  ...props
}: { name: IconName } & SVGProps<SVGSVGElement>) {
  const paths: Record<IconName, ReactNode> = {
    cast: (
      <path
        d="M1 18v3h3a3 3 0 0 0-3-3Zm0-4v2a5 5 0 0 1 5 5h2a7 7 0 0 0-7-7Zm2-11a2 2 0 0 0-2 2v7h2V5h18v14h-9v2h9a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2H3Zm-2 7v2a9 9 0 0 1 9 9h2c0-6.08-4.92-11-11-11Z"
        fill="currentColor"
        stroke="none"
      />
    ),
    check: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="m8 12 2.7 2.7L16.5 9" />
      </>
    ),
    close: <path d="m6 6 12 12M18 6 6 18" />,
    device: (
      <>
        <rect x="6" y="3" width="12" height="18" rx="2" />
        <path d="M10 17h4M12 7v6M9.5 10.5 12 13l2.5-2.5" />
      </>
    ),
    discover: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="m15.5 8.5-2.1 4.9-4.9 2.1 2.1-4.9 4.9-2.1Z" />
      </>
    ),
    history: (
      <>
        <path d="M4.8 7.5H2v-3" />
        <path d="M4.2 17.8A9 9 0 1 0 4.8 7.5" />
        <path d="M12 7v5l3.5 2" />
      </>
    ),
    info: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v6M12 7.5v.1" />
      </>
    ),
    list: <path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" />,
    mute: (
      <>
        <path d="M11 5 6.5 9H3v6h3.5L11 19V5Z" />
        <path d="m16 9 5 5M21 9l-5 5" />
      </>
    ),
    next: (
      <>
        <path d="m7 5 8 7-8 7V5Z" />
        <path d="M18 5v14" />
      </>
    ),
    play: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="m10 8 6 4-6 4V8Z" />
      </>
    ),
    playSimple: <path d="m9 7 8 5-8 5V7Z" fill="currentColor" stroke="none" />,
    podcasts: (
      <>
        <rect x="4" y="4" width="6" height="6" rx="1" />
        <rect x="14" y="4" width="6" height="6" rx="1" />
        <rect x="4" y="14" width="6" height="6" rx="1" />
        <rect x="14" y="14" width="6" height="6" rx="1" />
      </>
    ),
    previous: (
      <>
        <path d="m17 5-8 7 8 7V5Z" />
        <path d="M6 5v14" />
      </>
    ),
    profile: (
      <>
        <circle cx="12" cy="8" r="3.5" />
        <path d="M5 20a7 7 0 0 1 14 0" />
      </>
    ),
    progress: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="m10.5 8.5 5 3.5-5 3.5v-7Z" />
      </>
    ),
    queue: <path d="M4 6h11M4 12h11M4 18h8M18 15v6M15 18h6" />,
    queueNext: (
      <>
        <path d="M5 7h12M5 12h8M5 17h6" />
        <path d="m16 14 3 3-3 3" />
      </>
    ),
    stop: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M9 9h6v6H9z" />
      </>
    ),
    tiles: (
      <>
        <rect x="4" y="4" width="6" height="6" rx="1" />
        <rect x="14" y="4" width="6" height="6" rx="1" />
        <rect x="4" y="14" width="6" height="6" rx="1" />
        <rect x="14" y="14" width="6" height="6" rx="1" />
      </>
    ),
    volume: (
      <>
        <path d="M11 5 6.5 9H3v6h3.5L11 19V5Z" />
        <path d="M15 9a4 4 0 0 1 0 6M18 6a8 8 0 0 1 0 12" />
      </>
    ),
  };

  return (
    <svg
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
      {...props}
    >
      {paths[name]}
    </svg>
  );
}
