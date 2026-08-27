import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "co.havenos.operations",
  appName: "HavenOS",
  webDir: "out",
  ios: {
    contentInset: "never",
    backgroundColor: "#09090b",
    // Prevents the webview bouncing past the fixed header/tab bar.
    scrollEnabled: true,
  },
  android: {
    backgroundColor: "#09090b",
    allowMixedContent: false,
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: false, // hidden manually once the first paint lands
      backgroundColor: "#09090b",
      androidScaleType: "CENTER_CROP",
      showSpinner: false,
    },
    StatusBar: {
      style: "DARK", // dark UI → light content
      backgroundColor: "#09090b",
      overlaysWebView: true,
    },
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
    Keyboard: {
      resize: "native",
    },
  },
};

export default config;
