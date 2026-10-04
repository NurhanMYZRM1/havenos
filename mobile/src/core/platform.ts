// The phone's answers to what Electron does on the desktop: pickers, the
// share sheet instead of "save as" / "show in folder", and the OS browser.
import * as DocumentPicker from "expo-document-picker";
import { Directory, File, Paths } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import * as Linking from "expo-linking";
import * as SecureStore from "expo-secure-store";
import * as Sharing from "expo-sharing";
import { ActionSheetIOS, Alert, Platform as RNPlatform } from "react-native";
import type { Platform } from "@/desktop/core/handlers";
import type { ChannelSecretStore } from "@/desktop/core/integrations/channels";
import { emitCoreEvent } from "./events";
import { preparePhoto } from "./photos";

export const toPath = (uri: string) => decodeURI(uri.replace(/^file:\/\//, ""));
const toUri = (path: string) => (path.startsWith("file://") ? path : `file://${encodeURI(path)}`);

function scratchDir(): Directory {
  const dir = new Directory(Paths.cache, "havenos-files", String(Date.now()) + Math.random().toString(36).slice(2, 8));
  dir.create({ intermediates: true, idempotent: true });
  return dir;
}

/** Copy a picked file under its original name so the record keeps a readable file name. */
function named(uri: string, name: string | null | undefined, fallbackExt: string): string {
  const safe = (name ?? "").replace(/[/\\]/g, "_").trim() || `photo-${Date.now()}.${fallbackExt}`;
  const target = new File(scratchDir(), safe);
  new File(uri).copySync(target, { overwrite: true });
  return toPath(target.uri);
}

function chooseSource(): Promise<"camera" | "library" | null> {
  return new Promise((resolve) => {
    if (RNPlatform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: ["Take Photo", "Choose from Library", "Cancel"], cancelButtonIndex: 2 },
        (i) => resolve(i === 0 ? "camera" : i === 1 ? "library" : null),
      );
    } else {
      Alert.alert("Add photos", undefined, [
        { text: "Take Photo", onPress: () => resolve("camera") },
        { text: "Choose from Library", onPress: () => resolve("library") },
        { text: "Cancel", style: "cancel", onPress: () => resolve(null) },
      ]);
    }
  });
}

async function pickPhotos(): Promise<string[] | null> {
  const source = await chooseSource();
  if (!source) return null;
  if (source === "camera") {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return null;
  }
  const result =
    source === "camera"
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 1 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsMultipleSelection: true, selectionLimit: 20, quality: 1 });
  if (result.canceled) return null;
  const out: string[] = [];
  for (const asset of result.assets) {
    const base = (asset.fileName ?? `photo-${Date.now()}`).replace(/\.[^.]+$/, "");
    out.push(named(await preparePhoto(asset.uri), `${base}.jpg`, "jpg"));
  }
  return out;
}

async function pickDocuments(): Promise<string[] | null> {
  const r = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
  if (r.canceled) return null;
  const out: string[] = [];
  for (const asset of r.assets) {
    const isPhoto = /^image\/(jpeg|png|webp|heic|heif)$/.test(asset.mimeType ?? "");
    const base = asset.name.replace(/\.[^.]+$/, "");
    out.push(isPhoto ? named(await preparePhoto(asset.uri), `${base}.jpg`, "jpg") : named(asset.uri, asset.name, "bin"));
  }
  return out;
}

/** Files written by "save as" handlers; shared once the handler has written them. */
const pendingShares: string[] = [];

export async function flushPendingShares() {
  while (pendingShares.length) {
    const path = pendingShares.shift()!;
    if (new File(toUri(path)).exists && (await Sharing.isAvailableAsync())) await Sharing.shareAsync(toUri(path));
  }
}

async function share(path: string) {
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(toUri(path));
}

export function createMobilePlatform(): Platform {
  return {
    name: RNPlatform.OS,
    isPackaged: !__DEV__,
    pickFiles: (purpose) => (purpose === "photo" ? pickPhotos() : pickDocuments()),
    async pickImportFile() {
      const r = await DocumentPicker.getDocumentAsync({ type: ["text/csv", "text/comma-separated-values", "public.comma-separated-values-text"], copyToCacheDirectory: true });
      return r.canceled ? null : named(r.assets[0].uri, r.assets[0].name, "csv");
    },
    async saveFile(defaultName) {
      const target = toPath(new File(scratchDir(), defaultName).uri);
      pendingShares.push(target);
      return target;
    },
    // A folder of exports and file backups need the desktop app for now.
    pickFolder: async () => null,
    pickBackup: async () => null,
    openPath: (target) => share(target),
    showInFolder: (target) => void share(target),
    async openExternal(url) {
      await Linking.openURL(url);
    },
    receiptPdf: async () => {
      throw new Error("Receipts are shared from the receipt screen on mobile.");
    },
    emit: emitCoreEvent,
  };
}

/** Calendar feed links grant read access to a landlord's calendars: keep them in the Keychain / Keystore. */
export class SecureStoreChannelSecrets implements ChannelSecretStore {
  readonly available = true;
  private key = (id: string) => `havenos.channel-feed.${id}`;
  get(connectionId: string): string | null {
    return SecureStore.getItem(this.key(connectionId));
  }
  set(connectionId: string, value: string) {
    SecureStore.setItem(this.key(connectionId), value);
  }
  delete(connectionId: string) {
    void SecureStore.deleteItemAsync(this.key(connectionId));
  }
}
