import React from "react";
import Svg, {
  Circle,
  Line,
  Path,
  Polyline,
  Rect,
  type SvgProps,
} from "react-native-svg";

export type IconName =
  | "back"
  | "cast"
  | "check"
  | "close"
  | "discover"
  | "device"
  | "download"
  | "downloads"
  | "forward"
  | "history"
  | "info"
  | "list"
  | "next"
  | "pause"
  | "play"
  | "podcasts"
  | "previous"
  | "profile"
  | "progress"
  | "queue"
  | "queueNext"
  | "rewind"
  | "stop"
  | "tiles"
  | "trash";

export function Icon({
  name,
  size = 24,
  color = "currentColor",
  strokeWidth = 1.8,
  ...props
}: {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
} & Omit<SvgProps, "width" | "height">) {
  const common = {
    fill: "none",
    stroke: color,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth,
  };

  const body = (() => {
    switch (name) {
      case "back":
        return <Path d="m15 18-6-6 6-6" {...common} />;
      case "cast":
        return (
          <>
            <Circle cx="4" cy="20" r="1.5" {...common} />
            <Path d="M2.5 14.5a7 7 0 0 1 7 7M2.5 9.5a12 12 0 0 1 12 12M9 4h8a3 3 0 0 1 3 3v10" {...common} />
          </>
        );
      case "check":
        return (
          <>
            <Circle cx="12" cy="12" r="9" {...common} />
            <Polyline points="8,12 10.7,14.7 16.5,9" {...common} />
          </>
        );
      case "close":
        return <Path d="m6 6 12 12M18 6 6 18" {...common} />;
      case "discover":
        return (
          <>
            <Circle cx="12" cy="12" r="9" {...common} />
            <Path d="m15.5 8.5-2.1 4.9-4.9 2.1 2.1-4.9 4.9-2.1Z" {...common} />
          </>
        );
      case "device":
        return (
          <>
            <Rect x="4" y="3.5" width="16" height="11" rx="2" {...common} />
            <Path d="M9 20h6M12 14.5V20" {...common} />
            <Path d="m8 9 2.2 2.2L16 5.8" {...common} />
          </>
        );
      case "download":
      case "downloads":
        return (
          <>
            <Path d="M12 3v12" {...common} />
            <Path d="m7.5 10.5 4.5 4.5 4.5-4.5" {...common} />
            <Path d="M5 20h14" {...common} />
          </>
        );
      case "forward":
        return (
          <>
            <Path d="M5 8V4l4 4-4 4V8a7 7 0 1 0 2.1-5" {...common} />
            <Path d="M11 10.2h1.7c1 0 1.8.8 1.8 1.8v0c0 1-.8 1.8-1.8 1.8H11v-3.6Zm0 3.6v2M17 10.2v5.6" {...common} />
          </>
        );
      case "history":
        return (
          <>
            <Path d="M4.8 7.5H2v-3M4.2 17.8A9 9 0 1 0 4.8 7.5M12 7v5l3.5 2" {...common} />
          </>
        );
      case "info":
        return (
          <>
            <Circle cx="12" cy="12" r="9" {...common} />
            <Path d="M12 11v6M12 7.5v.1" {...common} />
          </>
        );
      case "list":
        return <Path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" {...common} />;
      case "next":
        return (
          <>
            <Path d="m7 5 8 7-8 7V5Z" {...common} />
            <Line x1="18" y1="5" x2="18" y2="19" {...common} />
          </>
        );
      case "pause":
        return (
          <>
            <Rect x="7" y="5" width="3.5" height="14" rx="1" fill={color} />
            <Rect x="13.5" y="5" width="3.5" height="14" rx="1" fill={color} />
          </>
        );
      case "play":
        return <Path d="m9 7 8 5-8 5V7Z" fill={color} stroke="none" />;
      case "podcasts":
      case "tiles":
        return (
          <>
            <Rect x="4" y="4" width="6" height="6" rx="1" {...common} />
            <Rect x="14" y="4" width="6" height="6" rx="1" {...common} />
            <Rect x="4" y="14" width="6" height="6" rx="1" {...common} />
            <Rect x="14" y="14" width="6" height="6" rx="1" {...common} />
          </>
        );
      case "previous":
        return (
          <>
            <Path d="m17 5-8 7 8 7V5Z" {...common} />
            <Line x1="6" y1="5" x2="6" y2="19" {...common} />
          </>
        );
      case "profile":
        return (
          <>
            <Circle cx="12" cy="8" r="3.5" {...common} />
            <Path d="M5 20a7 7 0 0 1 14 0" {...common} />
          </>
        );
      case "progress":
        return (
          <>
            <Circle cx="12" cy="12" r="9" {...common} />
            <Path d="m10.5 8.5 5 3.5-5 3.5v-7Z" {...common} />
          </>
        );
      case "queue":
        return <Path d="M4 6h11M4 12h11M4 18h8M18 15v6M15 18h6" {...common} />;
      case "queueNext":
        return (
          <>
            <Path d="M5 7h12M5 12h8M5 17h6" {...common} />
            <Path d="m16 14 3 3-3 3" {...common} />
          </>
        );
      case "rewind":
        return (
          <>
            <Path d="M19 8V4l-4 4 4 4V8a7 7 0 1 1-2.1-5" {...common} />
            <Path d="M7 10.2h1.7c1 0 1.8.8 1.8 1.8v0c0 1-.8 1.8-1.8 1.8H7v-3.6Zm0 3.6v2M13 10.2v5.6" {...common} />
          </>
        );
      case "stop":
        return <Rect x="7" y="7" width="10" height="10" rx="1" fill={color} />;
      case "trash":
        return <Path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5" {...common} />;
      default:
        return null;
    }
  })();

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" {...props}>
      {body}
    </Svg>
  );
}
