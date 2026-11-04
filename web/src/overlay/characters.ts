/**
 * Original chibi-style anime characters drawn as inline SVG so they stay crisp at any
 * resolution and cost nothing to download. Limbs and eyes are separate groups so CSS
 * can animate them with GPU-friendly transforms only.
 */
export type Look = { hair: string; hairShade: string; outfit: string; outfitShade: string; eyes: string; ribbon?: string };

export const LOOKS: Record<'miko' | 'ren', Look> = {
  // Lilac-haired girl with a ribbon
  miko: { hair: '#c084fc', hairShade: '#9333ea', outfit: '#f472b6', outfitShade: '#db2777', eyes: '#7c3aed', ribbon: '#fde047' },
  // Blue-haired boy in a hoodie
  ren: { hair: '#60a5fa', hairShade: '#2563eb', outfit: '#818cf8', outfitShade: '#4f46e5', eyes: '#0ea5e9' },
};

let uid = 0;
const SKIN = '#ffe6d8';
const SKIN_SHADE = '#f8cbb5';
const INK = '#2a1a3a';

function eye(cx: number, id: string) {
  return `
    <g class="lm-eye" style="transform-origin:${cx}px 122px">
      <ellipse cx="${cx}" cy="122" rx="13.5" ry="17" fill="#fff"/>
      <ellipse cx="${cx}" cy="124" rx="11" ry="14.5" fill="url(#iris-${id})"/>
      <ellipse cx="${cx}" cy="127" rx="5" ry="7" fill="#140a24"/>
      <circle cx="${cx - 4}" cy="117" r="4.2" fill="#fff"/>
      <circle cx="${cx + 4.5}" cy="131" r="2" fill="#fff" opacity=".9"/>
      <path d="M${cx - 15} 110 Q${cx} 100 ${cx + 15} 108" stroke="${INK}" stroke-width="4.5" fill="none" stroke-linecap="round"/>
    </g>`;
}

export function chibi(look: Look, extraClass = '') {
  const id = `c${++uid}`;
  const ribbon = look.ribbon
    ? `<g class="lm-ribbon"><path d="M128 52 L150 38 L152 64 Z" fill="${look.ribbon}"/><path d="M128 52 L110 34 L106 60 Z" fill="${look.ribbon}"/><circle cx="129" cy="51" r="6" fill="${look.ribbon}" stroke="#eab308" stroke-width="2"/></g>`
    : '';
  return `
  <svg class="lm-chibi ${extraClass}" viewBox="0 0 200 300" aria-hidden="true">
    <defs>
      <linearGradient id="iris-${id}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#1b1030"/><stop offset=".55" stop-color="${look.eyes}"/><stop offset="1" stop-color="#e9d5ff"/>
      </linearGradient>
      <linearGradient id="cloth-${id}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${look.outfit}"/><stop offset="1" stop-color="${look.outfitShade}"/>
      </linearGradient>
    </defs>
    <path class="lm-hair-back" d="M34 110 Q30 38 100 30 Q170 38 166 110 L170 196 Q150 206 142 172 L58 172 Q50 206 30 196 Z" fill="${look.hairShade}"/>
    <g class="lm-legs">
      <rect x="80" y="244" width="17" height="40" rx="8.5" fill="${SKIN}"/>
      <rect x="103" y="244" width="17" height="40" rx="8.5" fill="${SKIN}"/>
      <ellipse cx="88" cy="286" rx="13" ry="7" fill="#3b2a55"/>
      <ellipse cx="112" cy="286" rx="13" ry="7" fill="#3b2a55"/>
    </g>
    <g class="lm-arm lm-arm-l" style="transform-origin:72px 190px">
      <rect x="62" y="182" width="19" height="54" rx="9.5" fill="${look.outfitShade}"/>
      <circle cx="71.5" cy="238" r="9.5" fill="${SKIN}"/>
    </g>
    <path class="lm-body" d="M58 252 Q60 186 100 176 Q140 186 142 252 Q100 262 58 252 Z" fill="url(#cloth-${id})"/>
    <path d="M86 180 L100 200 L114 180" fill="none" stroke="#fff" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/>
    <g class="lm-head">
      <rect x="90" y="160" width="20" height="22" rx="6" fill="${SKIN_SHADE}"/>
      <ellipse cx="100" cy="110" rx="64" ry="60" fill="${SKIN}"/>
      <g class="lm-eyes-open">${eye(74, id)}${eye(126, id)}</g>
      <g class="lm-eyes-happy" opacity="0">
        <path d="M60 126 Q74 108 88 126" stroke="${INK}" stroke-width="5" fill="none" stroke-linecap="round"/>
        <path d="M112 126 Q126 108 140 126" stroke="${INK}" stroke-width="5" fill="none" stroke-linecap="round"/>
      </g>
      <ellipse class="lm-blush" cx="60" cy="144" rx="11" ry="5.5" fill="#ff8fb1" opacity=".6"/>
      <ellipse class="lm-blush" cx="140" cy="144" rx="11" ry="5.5" fill="#ff8fb1" opacity=".6"/>
      <path class="lm-mouth" d="M93 146 Q100 154 107 146" stroke="#8a2f45" stroke-width="3.2" fill="none" stroke-linecap="round"/>
      <path d="M36 112 Q34 46 100 40 Q166 46 164 112 Q152 82 134 74 Q130 98 112 102 Q112 82 100 76 Q92 98 70 102 Q74 84 66 76 Q50 86 36 112 Z" fill="${look.hair}"/>
      <path d="M100 42 Q94 16 118 10 Q104 24 108 42" fill="${look.hair}"/>
      <path d="M58 70 Q76 54 96 56" stroke="#fff" stroke-opacity=".45" stroke-width="5" fill="none" stroke-linecap="round"/>
      ${ribbon}
    </g>
    <g class="lm-arm lm-arm-r" style="transform-origin:128px 190px">
      <rect x="119" y="182" width="19" height="54" rx="9.5" fill="${look.outfit}"/>
      <circle cx="128.5" cy="238" r="9.5" fill="${SKIN}"/>
    </g>
  </svg>`;
}

export const HEART_PATH = 'M12 21s-7.5-4.6-10-9.3C.3 8.3 2.3 4 6.3 4c2.3 0 3.9 1.3 5.7 3.4C13.8 5.3 15.4 4 17.7 4c4 0 6 4.3 4.3 7.7C19.5 16.4 12 21 12 21z';
export const STAR_PATH = 'M12 2l2.9 6.6 7.1.6-5.4 4.7 1.6 7L12 17.3 5.8 21l1.6-7L2 9.2l7.1-.6z';
export const SPARKLE_PATH = 'M12 0C12.8 7 17 11.2 24 12 17 12.8 12.8 17 12 24 11.2 17 7 12.8 0 12 7 11.2 11.2 7 12 0z';

export const shape = (path: string, color: string, cls = '') =>
  `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${path}" fill="${color}"/></svg>`;
