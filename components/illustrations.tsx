/**
 * Static illustrations drawn in the HavenOS palette. They replace the old
 * streamed onboarding videos: bundled with the app, crisp at any size, no
 * network needed, and they double as the fallback cover for properties
 * without photos.
 */

import type { PropertyType, RentalMode } from "@/lib/domain/enums";

const INK = "#f5f4f0";
const BRASS = "#c9a96a";
const BRASS_BRIGHT = "#e8cb90";

/** Deterministic pseudo-random so windows light the same way every render. */
function lit(seed: number, i: number, ratio = 0.35): boolean {
  const x = Math.sin(seed * 9301 + i * 49297) * 233280;
  return x - Math.floor(x) < ratio;
}

function Windows({ x, y, cols, rows, w, h, gapX, gapY, seed, ratio = 0.35, opacity = 0.75 }: { x: number; y: number; cols: number; rows: number; w: number; h: number; gapX: number; gapY: number; seed: number; ratio?: number; opacity?: number }) {
  const out = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const on = lit(seed, r * cols + c, ratio);
      out.push(
        <rect key={`${r}-${c}`} x={x + c * (w + gapX)} y={y + r * (h + gapY)} width={w} height={h} rx={0.8} fill={on ? BRASS_BRIGHT : INK} opacity={on ? opacity : 0.06} />,
      );
    }
  }
  return <g>{out}</g>;
}

function Palm({ x, y, s = 1, fill = "#0e0e12" }: { x: number; y: number; s?: number; fill?: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`} fill={fill}>
      <path d="M-2 0 C 0 -30, 2 -55, 6 -80 L 9 -80 C 5 -55, 4 -30, 3 0 Z" />
      <path d="M7 -80 c-18 -8 -34 -2 -42 10 c14 -10 28 -9 42 -8Z" />
      <path d="M7 -80 c16 -10 34 -6 42 6 c-14 -8 -28 -8 -42 -4Z" />
      <path d="M7 -80 c-6 -14 -20 -22 -34 -20 c14 4 24 10 32 22Z" />
      <path d="M7 -80 c6 -16 20 -24 34 -22 c-14 4 -24 12 -32 24Z" />
      <path d="M7 -80 c-2 14 -12 26 -24 32 c8 -10 14 -20 22 -34Z" />
    </g>
  );
}

function Sky({ id, from = "#17171d", to = "#2b2219" }: { id: string; from?: string; to?: string }) {
  return (
    <defs>
      <linearGradient id={`${id}-sky`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={from} />
        <stop offset="1" stopColor={to} />
      </linearGradient>
      <radialGradient id={`${id}-sun`} cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stopColor={BRASS_BRIGHT} stopOpacity="0.55" />
        <stop offset="0.55" stopColor={BRASS} stopOpacity="0.18" />
        <stop offset="1" stopColor={BRASS} stopOpacity="0" />
      </radialGradient>
    </defs>
  );
}

/** Wide dusk skyline for the "Add a property" hero. */
export function SkylineIllustration({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 1200 460" className={className} role="img" aria-label="Illustration of a Malaysian city skyline at dusk with condominiums and terrace houses" preserveAspectRatio="xMidYMid slice">
      <Sky id="hero" />
      <rect width="1200" height="460" fill="url(#hero-sky)" />
      <circle cx="905" cy="250" r="190" fill="url(#hero-sun)" />
      <circle cx="905" cy="250" r="46" fill={BRASS} opacity="0.35" />
      {/* far skyline */}
      <g fill="#1c1c23">
        <rect x="40" y="210" width="70" height="250" />
        <rect x="120" y="170" width="54" height="290" />
        <rect x="186" y="230" width="90" height="230" />
        <path d="M300 460V150l28-24 28 24v310Z" />
        <rect x="372" y="200" width="64" height="260" />
        <rect x="540" y="120" width="44" height="340" />
        <rect x="598" y="120" width="44" height="340" />
        <rect x="578" y="200" width="24" height="10" />
        <path d="M562 120l0-40 6 0 0 40Z M620 120l0-40 6 0 0 40Z" />
        <rect x="700" y="190" width="80" height="270" />
        <rect x="1000" y="160" width="60" height="300" />
        <rect x="1070" y="220" width="110" height="240" />
      </g>
      <Windows x={130} y={186} cols={4} rows={16} w={6} h={8} gapX={6} gapY={8} seed={3} ratio={0.2} opacity={0.35} />
      <Windows x={548} y={136} cols={3} rows={20} w={6} h={8} gapX={6} gapY={6} seed={5} ratio={0.25} opacity={0.4} />
      <Windows x={606} y={136} cols={3} rows={20} w={6} h={8} gapX={6} gapY={6} seed={6} ratio={0.25} opacity={0.4} />
      {/* mid: condo towers with balconies */}
      <g>
        <rect x="430" y="170" width="120" height="290" fill="#24242c" />
        <Windows x={444} y={186} cols={6} rows={17} w={10} h={9} gapX={7} gapY={7} seed={11} />
        <rect x="790" y="140" width="140" height="320" fill="#26262e" />
        {Array.from({ length: 18 }, (_, i) => (
          <rect key={i} x="786" y={156 + i * 17} width="148" height="2" fill={BRASS} opacity="0.25" />
        ))}
        <Windows x={804} y={146} cols={7} rows={18} w={11} h={9} gapX={7} gapY={8} seed={17} ratio={0.4} />
      </g>
      {/* near: terrace row and shophouses */}
      <g>
        {Array.from({ length: 6 }, (_, i) => {
          const x = 30 + i * 70;
          return (
            <g key={i}>
              <path d={`M${x} 460V380l35-28 35 28v80Z`} fill="#16161b" />
              <rect x={x + 12} y={396} width="16" height="18" fill={lit(23, i, 0.6) ? BRASS_BRIGHT : INK} opacity={lit(23, i, 0.6) ? 0.7 : 0.07} />
              <rect x={x + 42} y={396} width="16" height="18" fill={lit(29, i, 0.5) ? BRASS_BRIGHT : INK} opacity={lit(29, i, 0.5) ? 0.7 : 0.07} />
              <rect x={x + 28} y={430} width="14" height="30" fill="#0f0f13" />
            </g>
          );
        })}
        {Array.from({ length: 4 }, (_, i) => {
          const x = 960 + i * 58;
          return (
            <g key={`s${i}`}>
              <rect x={x} y={370} width="56" height="90" fill="#18181e" />
              <rect x={x} y={366} width="56" height="6" fill={BRASS} opacity="0.35" />
              <path d={`M${x + 8} 388h40v22h-40Z`} fill={lit(41, i, 0.7) ? BRASS_BRIGHT : INK} opacity={lit(41, i, 0.7) ? 0.6 : 0.07} />
              <path d={`M${x} 426h56v8h-56Z`} fill="#0f0f13" />
            </g>
          );
        })}
      </g>
      <Palm x={470} y={460} s={1.25} />
      <Palm x={520} y={460} s={0.95} />
      <Palm x={930} y={460} s={1.1} />
      <rect x="0" y="458" width="1200" height="2" fill={BRASS} opacity="0.5" />
    </svg>
  );
}

function TypeScene({ type }: { type: PropertyType }) {
  switch (type) {
    case "condominium":
    case "apartment":
      return (
        <g>
          <rect x="130" y="40" width="110" height="190" fill="#26262e" />
          {type === "condominium" &&
            Array.from({ length: 11 }, (_, i) => <rect key={i} x="126" y={56 + i * 16} width="118" height="2" fill={BRASS} opacity="0.3" />)}
          <Windows x={142} y={48} cols={5} rows={11} w={11} h={8} gapX={9} gapY={8} seed={type === "condominium" ? 7 : 8} ratio={0.42} />
          <rect x="250" y="95" width="70" height="135" fill="#202027" />
          <Windows x={260} y={104} cols={3} rows={7} w={10} h={8} gapX={9} gapY={9} seed={9} ratio={0.3} />
          <rect x="60" y="120" width="60" height="110" fill="#1d1d24" />
          <Windows x={70} y={130} cols={3} rows={5} w={8} h={8} gapX={9} gapY={10} seed={10} ratio={0.3} />
          <Palm x={342} y={230} s={0.85} />
        </g>
      );
    case "terrace":
    case "townhouse":
      return (
        <g>
          {Array.from({ length: 4 }, (_, i) => {
            const x = 40 + i * 82;
            const tall = type === "townhouse";
            return (
              <g key={i}>
                <path d={`M${x} 230V${tall ? 110 : 140}l41-${tall ? 34 : 30} 41 ${tall ? 34 : 30}V230Z`} fill={i % 2 ? "#23232a" : "#1e1e25"} />
                <rect x={x + 12} y={tall ? 124 : 154} width="22" height="22" fill={lit(13, i) ? BRASS_BRIGHT : INK} opacity={lit(13, i) ? 0.7 : 0.08} />
                <rect x={x + 48} y={tall ? 124 : 154} width="22" height="22" fill={lit(14, i, 0.5) ? BRASS_BRIGHT : INK} opacity={lit(14, i, 0.5) ? 0.7 : 0.08} />
                {tall && <rect x={x + 30} y="160" width="22" height="18" fill={lit(15, i) ? BRASS_BRIGHT : INK} opacity={lit(15, i) ? 0.7 : 0.08} />}
                <rect x={x + 30} y="196" width="22" height="34" fill="#111116" />
                <rect x={x} y="224" width="82" height="6" fill="#17171c" />
              </g>
            );
          })}
          <Palm x={370} y={232} s={0.7} />
        </g>
      );
    case "shophouse":
      return (
        <g>
          {Array.from({ length: 4 }, (_, i) => {
            const x = 30 + i * 88;
            return (
              <g key={i}>
                <rect x={x} y="90" width="86" height="140" fill={i % 2 ? "#24242b" : "#1f1f26"} />
                <rect x={x - 2} y="86" width="90" height="8" fill={BRASS} opacity="0.4" />
                <path d={`M${x + 10} 106h30v36h-30Z M${x + 46} 106h30v36h-30Z`} fill={lit(31, i, 0.6) ? BRASS_BRIGHT : INK} opacity={lit(31, i, 0.6) ? 0.65 : 0.08} />
                <rect x={x} y="160" width="86" height="8" fill="#15151a" />
                <rect x={x + 8} y="176" width="70" height="54" fill={lit(37, i, 0.7) ? BRASS : "#121217"} opacity={lit(37, i, 0.7) ? 0.35 : 1} />
              </g>
            );
          })}
        </g>
      );
    case "semi_d":
    case "bungalow":
      return (
        <g>
          <path d="M70 230V140l110-62 110 62V230Z" fill="#23232a" />
          {type === "semi_d" && <rect x="178" y="80" width="4" height="150" fill="#15151a" />}
          <path d="M60 144 180 74l120 70" fill="none" stroke={BRASS} strokeOpacity="0.45" strokeWidth="3" />
          <rect x="95" y="152" width="40" height="30" fill={BRASS_BRIGHT} opacity="0.65" />
          <rect x="225" y="152" width="40" height="30" fill={INK} opacity="0.08" />
          <rect x="160" y="178" width="40" height="52" fill="#111116" />
          <Palm x={330} y={232} s={1} />
          <Palm x={40} y={232} s={0.8} />
        </g>
      );
    default:
      return (
        <g>
          <rect x="110" y="100" width="180" height="130" fill="#23232a" />
          <Windows x={128} y={116} cols={5} rows={4} w={18} h={14} gapX={14} gapY={14} seed={42} ratio={0.4} />
          <Palm x={330} y={232} s={0.9} />
        </g>
      );
  }
}

/** Cover art for a property without photos. */
export function PropertyIllustration({ type, className = "", label }: { type: PropertyType; className?: string; label?: string }) {
  const id = `p-${type}`;
  return (
    <svg viewBox="0 0 400 250" className={className} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} preserveAspectRatio="xMidYMid slice">
      <Sky id={id} />
      <rect width="400" height="250" fill={`url(#${id}-sky)`} />
      <circle cx="318" cy="70" r="80" fill={`url(#${id}-sun)`} />
      <TypeScene type={type} />
      <rect x="0" y="230" width="400" height="20" fill="#101014" />
      <rect x="0" y="229" width="400" height="1.5" fill={BRASS} opacity="0.5" />
    </svg>
  );
}

/** Small diagrams for the three rental arrangements. */
export function ArrangementIllustration({ mode, className = "" }: { mode: RentalMode; className?: string }) {
  const wall = "#3a3a44";
  const on = BRASS;
  return (
    <svg viewBox="0 0 160 100" className={className} aria-hidden>
      <rect x="10" y="10" width="140" height="80" rx="6" fill="#1b1b21" stroke={wall} strokeWidth="2" />
      {mode === "whole_unit" && <rect x="16" y="16" width="128" height="68" rx="3" fill={on} opacity="0.28" stroke={on} strokeOpacity="0.8" />}
      <path d="M60 10v42M100 10v42M10 52h54M96 52h54" stroke={wall} strokeWidth="2" />
      {mode === "by_room" && (
        <>
          <rect x="15" y="15" width="41" height="33" rx="2" fill={on} opacity="0.32" />
          <rect x="65" y="15" width="31" height="33" rx="2" fill={on} opacity="0.18" />
          <rect x="105" y="15" width="40" height="33" rx="2" fill={on} opacity="0.32" />
        </>
      )}
      {mode === "by_bed" &&
        [18, 32, 108, 124].map((x, i) => <rect key={x} x={x} y="20" width="10" height="22" rx="2" fill={on} opacity={i % 2 ? 0.35 : 0.8} />)}
      {mode === "by_bed" && [70, 84].map((x) => <rect key={x} x={x} y="20" width="10" height="22" rx="2" fill={on} opacity="0.5" />)}
      <rect x="66" y="84" width="28" height="6" fill="#1b1b21" />
    </svg>
  );
}

/** Generic empty-state art: keys and a door (tenancies), toolbox (maintenance), receipt (rent). */
export function EmptyIllustration({ kind }: { kind: "keys" | "tools" | "receipt" | "home" }) {
  return (
    <svg viewBox="0 0 240 120" className="h-auto w-full" aria-hidden>
      <rect x="0" y="100" width="240" height="1.5" fill={BRASS} opacity="0.45" />
      {kind === "keys" && (
        <g>
          <rect x="60" y="20" width="56" height="80" rx="3" fill="#1f1f26" stroke="#34343d" />
          <circle cx="106" cy="62" r="3" fill={BRASS_BRIGHT} />
          <g stroke={BRASS} strokeWidth="3" fill="none" strokeLinecap="round">
            <circle cx="150" cy="58" r="12" />
            <path d="M162 58h34M184 58v10M192 58v7" />
          </g>
        </g>
      )}
      {kind === "tools" && (
        <g>
          <rect x="70" y="52" width="100" height="48" rx="4" fill="#1f1f26" stroke="#34343d" />
          <path d="M100 52v-10a6 6 0 0 1 6-6h28a6 6 0 0 1 6 6v10" fill="none" stroke="#34343d" strokeWidth="3" />
          <rect x="70" y="68" width="100" height="6" fill={BRASS} opacity="0.5" />
          <path d="M178 30l-22 22" stroke={BRASS_BRIGHT} strokeWidth="4" strokeLinecap="round" />
        </g>
      )}
      {kind === "receipt" && (
        <g>
          <path d="M90 14h60v86l-10-6-10 6-10-6-10 6-10-6-10 6Z" fill="#1f1f26" stroke="#34343d" />
          <path d="M102 34h36M102 48h36M102 62h22" stroke="#4a4a55" strokeWidth="3" strokeLinecap="round" />
          <circle cx="160" cy="78" r="14" fill={BRASS} opacity="0.85" />
          <text x="160" y="83" textAnchor="middle" fontSize="12" fontWeight="700" fill="#0b0b0d">RM</text>
        </g>
      )}
      {kind === "home" && (
        <g>
          <path d="M80 100V58l40-30 40 30v42Z" fill="#1f1f26" stroke="#34343d" />
          <rect x="110" y="72" width="20" height="28" fill="#111116" />
          <rect x="92" y="62" width="14" height="12" fill={BRASS_BRIGHT} opacity="0.7" />
          <path d="M72 62l48-38 48 38" fill="none" stroke={BRASS} strokeWidth="3" strokeLinecap="round" />
        </g>
      )}
    </svg>
  );
}
