// Native port of components/shell/biometric-lock.tsx: Face ID / Touch ID /
// passcode over the records on cold launch and after 30 s in the background.
// Devices that can't prompt are never locked out.
import * as Device from "expo-device";
import * as Haptics from "expo-haptics";
import * as LocalAuthentication from "expo-local-authentication";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AppState, Image, Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "./theme";

const RELOCK_AFTER_MS = 30_000;

type Phase = "boot" | "locked" | "open";

async function canPrompt(): Promise<boolean> {
  // Simulators report a passcode but nobody sits at them: lock real devices only.
  if (!Device.isDevice) return false;
  const level = await LocalAuthentication.getEnrolledLevelAsync();
  return level !== LocalAuthentication.SecurityLevel.NONE;
}

export function AppLock({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>("boot");
  const [dismissed, setDismissed] = useState(false);
  const armed = useRef(false);
  const prompting = useRef(false);
  const leftAt = useRef<number | null>(null);

  const unlock = useCallback(async () => {
    if (prompting.current) return;
    prompting.current = true;
    const result = await LocalAuthentication.authenticateAsync({ promptMessage: "Unlock HavenOS", fallbackLabel: "Use Passcode" });
    prompting.current = false;
    leftAt.current = null;
    if (result.success) {
      setDismissed(false);
      setPhase("open");
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else if (result.error === "not_enrolled" || result.error === "not_available" || result.error === "passcode_not_set") {
      armed.current = false;
      setPhase("open");
    } else {
      setDismissed(true);
    }
  }, []);

  useEffect(() => {
    void canPrompt().then((ok) => {
      armed.current = ok;
      if (!ok) return setPhase("open");
      setPhase("locked");
      void unlock();
    });
  }, [unlock]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (!armed.current || prompting.current) return;
      if (state === "background") leftAt.current = Date.now();
      if (state === "active" && leftAt.current && Date.now() - leftAt.current > RELOCK_AFTER_MS) {
        setPhase("locked");
        void unlock();
      }
    });
    return () => sub.remove();
  }, [unlock]);

  return (
    <View style={{ flex: 1 }}>
      {phase !== "boot" && children}
      {phase !== "open" && (
        <View style={styles.curtain}>
          <Image source={require("../../assets/icon.png")} style={styles.mark} />
          <Text style={styles.title}>HavenOS is locked</Text>
          {dismissed && (
            <Pressable accessibilityRole="button" onPress={() => void unlock()} style={styles.button}>
              <Text style={styles.buttonText}>Unlock</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  curtain: { ...StyleSheet.absoluteFill, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center", gap: 16 },
  mark: { width: 72, height: 72, borderRadius: 16 },
  title: { color: colors.ink2, fontSize: 15 },
  button: { marginTop: 8, paddingHorizontal: 22, paddingVertical: 12, borderRadius: 12, backgroundColor: colors.surface2, borderCurve: "continuous" },
  buttonText: { color: colors.brassBright, fontSize: 16, fontWeight: "600" },
});
