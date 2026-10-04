import { Buffer } from "buffer";
import "react-native-url-polyfill/auto";

const g = globalThis as unknown as { Buffer?: typeof Buffer };
if (!g.Buffer) g.Buffer = Buffer;
