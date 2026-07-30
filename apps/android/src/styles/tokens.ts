/**
 * Podwaffle design tokens for React Native.
 *
 * These mirror the CSS custom properties in apps/web/src/styles/main.css
 * so that web and Android remain recognisably the same product.
 */

export const colors = {
  // Backgrounds
  bgPrimary: "#0D1B2A",
  bgSurface: "#132238",
  bgElevated: "#1A2E45",
  bgOverlay: "rgba(13, 27, 42, 0.85)",

  // Text
  textPrimary: "#F5F0E8",
  textSecondary: "#9BAAB8",
  textMuted: "#5A6A7A",
  textOnAccent: "#FFFFFF",

  // Accent / actions
  accent: "#E91E8C", // pink primary action
  accentDim: "rgba(233, 30, 140, 0.15)",
  skip: "#F59E0B", // amber skip buttons
  skipDim: "rgba(245, 158, 11, 0.15)",

  // Semantic
  success: "#10B981",
  error: "#EF4444",
  warning: "#F59E0B",
  info: "#3B82F6",

  // New episode dot
  newEpisodeDot: "#EF4444",

  // Borders / dividers
  border: "#1E3248",
  borderSubtle: "#162A3E",

  // Player bar
  playerBg: "#0A1520",
  playerBorder: "#1E3248",
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const radii = {
  sm: 6,
  md: 12,
  lg: 16,
  xl: 24,
  full: 9999,
} as const;

export const fontSizes = {
  xs: 11,
  sm: 13,
  md: 15,
  lg: 17,
  xl: 20,
  xxl: 24,
  xxxl: 30,
} as const;

export const fontWeights = {
  normal: "400" as const,
  medium: "500" as const,
  semibold: "600" as const,
  bold: "700" as const,
};

/** Mini-player height used for bottom inset calculations */
export const MINI_PLAYER_HEIGHT = 72;

/** Bottom tab bar height used for layout calculations */
export const TAB_BAR_HEIGHT = 60;
