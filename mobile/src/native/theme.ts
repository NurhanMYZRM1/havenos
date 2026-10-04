import { DarkTheme, type Theme } from "expo-router";

// The desktop app's tokens (app/globals.css), for native screens.
export const colors = {
  bg: "#0b0b0d",
  surface: "#141418",
  surface2: "#1b1b21",
  surface3: "#23232a",
  ink: "#f5f4f0",
  ink2: "#b9b6ae",
  ink3: "#8f8c84",
  brass: "#c9a96a",
  brassBright: "#e8cb90",
  gold: "#c99a2e",
  good: "#3fb96b",
  info: "#74a9e8",
  warn: "#f2b33d",
  serious: "#ec835a",
  critical: "#e5534b",
  hairline: "rgba(245,244,240,0.09)",
} as const;

export const navTheme: Theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: colors.brassBright,
    background: colors.bg,
    card: colors.bg,
    text: colors.ink,
    border: colors.hairline,
  },
};

export const stackScreenOptions = {
  headerTintColor: colors.brassBright,
  headerTitleStyle: { color: colors.ink },
  headerLargeTitleStyle: { color: colors.ink },
  headerBackButtonDisplayMode: "minimal" as const,
  headerTransparent: false,
  headerStyle: { backgroundColor: colors.bg },
  headerShadowVisible: false,
  contentStyle: { backgroundColor: colors.bg },
};
