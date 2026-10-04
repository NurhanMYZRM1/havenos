import { Stack } from "expo-router";
import { stackScreenOptions } from "~/native/theme";

export default function Layout() {
  return (
    <Stack screenOptions={stackScreenOptions}>
      <Stack.Screen name="index" options={{ title: "Maintenance" }} />
    </Stack>
  );
}
