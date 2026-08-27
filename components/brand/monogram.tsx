"use client";

import { motion } from "framer-motion";

/**
 * The HavenOS mark: a hairline square frame around a sharp serif "H",
 * drawn in on mount. Brass is branding chrome — never used for data.
 */
export function Monogram({ size = 34 }: { size?: number }) {
  const draw = {
    hidden: { pathLength: 0, opacity: 0 },
    visible: (delay: number) => ({
      pathLength: 1,
      opacity: 1,
      transition: {
        pathLength: { delay, duration: 0.9, ease: [0.65, 0, 0.35, 1] as const },
        opacity: { delay, duration: 0.2 },
      },
    }),
  };

  return (
    <motion.svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      initial="hidden"
      animate="visible"
      aria-label="HavenOS"
      role="img"
    >
      <motion.rect
        x="1.5" y="1.5" width="37" height="37"
        stroke="var(--color-brass)" strokeWidth="1.25"
        variants={draw} custom={0}
      />
      {/* serif H: stems with flared feet, high thin crossbar */}
      <motion.path
        d="M11 9 v22 M8.5 9 h5 M8.5 31 h5"
        stroke="var(--color-ink)" strokeWidth="1.6"
        variants={draw} custom={0.35}
      />
      <motion.path
        d="M29 9 v22 M26.5 9 h5 M26.5 31 h5"
        stroke="var(--color-ink)" strokeWidth="1.6"
        variants={draw} custom={0.45}
      />
      <motion.path
        d="M11 18.5 h18"
        stroke="var(--color-brass)" strokeWidth="1.25"
        variants={draw} custom={0.7}
      />
    </motion.svg>
  );
}
