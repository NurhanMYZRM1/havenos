import { Stack, ThemeProvider } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { core, dataRoot } from "~/core/host";
import { AppLock } from "~/native/app-lock";
import { colors, navTheme, stackScreenOptions } from "~/native/theme";

void SplashScreen.preventAutoHideAsync();

function useCore(): Error | null | "ready" {
  const [state, setState] = useState<Error | null | "ready">(null);
  useEffect(() => {
    try {
      core();
      setState("ready");
    } catch (err) {
      setState(err instanceof Error ? err : new Error(String(err)));
    } finally {
      void SplashScreen.hideAsync();
    }
  }, []);
  return state;
}

function StartupError({ error }: { error: Error }) {
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 24, paddingTop: 96, gap: 12 }}>
      <Text style={{ color: colors.ink, fontSize: 24, fontWeight: "600" }}>HavenOS can’t open your records</Text>
      <Text selectable style={{ color: colors.ink2, fontSize: 15 }}>
        {error.message}
      </Text>
      <Text selectable style={{ color: colors.ink3, fontSize: 13 }}>
        Data folder: {dataRoot()}
      </Text>
    </ScrollView>
  );
}

export default function RootLayout() {
  const state = useCore();
  return (
    <ThemeProvider value={navTheme}>
      <StatusBar style="light" />
      {state === null ? (
        <View style={{ flex: 1, backgroundColor: colors.bg }} />
      ) : state instanceof Error ? (
        <StartupError error={state} />
      ) : (
        <AppLock>
          <Stack screenOptions={stackScreenOptions}>
            <Stack.Screen name="index" options={{ headerShown: false }} />
            <Stack.Screen name="(tabs)" options={{ headerShown: false, title: "Home" }} />
            <Stack.Screen name="properties/index" options={{ title: "Properties" }} />
            <Stack.Screen name="properties/view" options={{ title: "Property" }} />
            <Stack.Screen name="tenants/index" options={{ title: "Tenants" }} />
            <Stack.Screen name="tenants/view" options={{ title: "Tenant" }} />
            <Stack.Screen name="tenancies/view" options={{ title: "Tenancy" }} />
            <Stack.Screen name="tenancies/new" options={{ title: "New tenancy", presentation: "modal" }} />
            <Stack.Screen name="onboarding" options={{ title: "Add property", presentation: "modal" }} />
            <Stack.Screen name="maintenance/view" options={{ title: "Maintenance" }} />
            <Stack.Screen name="stays/reservation" options={{ title: "Reservation" }} />
            <Stack.Screen name="stays/turnover" options={{ title: "Turnover" }} />
            <Stack.Screen name="settings/index" options={{ title: "Settings" }} />
            <Stack.Screen name="settings/channels" options={{ title: "Calendar connections" }} />
            <Stack.Screen name="receipt" options={{ title: "Receipt", presentation: "modal" }} />
            <Stack.Screen name="rent/record" options={{ headerShown: false, presentation: "modal" }} />
            <Stack.Screen name="maintenance/new" options={{ headerShown: false, presentation: "modal" }} />
            <Stack.Screen name="tenants/new" options={{ headerShown: false, presentation: "modal" }} />
          </Stack>
        </AppLock>
      )}
    </ThemeProvider>
  );
}
