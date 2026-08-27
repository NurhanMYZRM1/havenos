"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { initNativeShell, isNative, watchNetwork } from "@/lib/native";

/**
 * Boots native chrome (status bar, splash dismissal) and shows a persistent
 * offline banner. Renders nothing on the web beyond the banner.
 */
export function NativeShell() {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    if (isNative()) {
      document.documentElement.classList.add("native-shell");
      void initNativeShell();
    }
    let dispose: (() => void) | undefined;
    void watchNetwork(setOnline).then((fn) => {
      dispose = fn;
    });
    return () => dispose?.();
  }, []);

  return (
    <AnimatePresence>
      {!online && (
        <motion.div
          initial={{ y: -40 }}
          animate={{ y: 0 }}
          exit={{ y: -40 }}
          role="status"
          className="fixed inset-x-0 top-0 z-[60] bg-warn/95 py-1.5 text-center text-[12px] font-semibold text-bg"
          style={{ paddingTop: "calc(6px + var(--safe-top))" }}
        >
          Offline — showing last synced data
        </motion.div>
      )}
    </AnimatePresence>
  );
}
