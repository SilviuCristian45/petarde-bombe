// Draws the link preview (og.png) and the favicons from code, in the game's style, and writes
// them to client/public. Run with `npm run og` (from the repo root or client/).
//
// Everything is plain SVG rendered by resvg; text uses the system's bold sans-serif fonts.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

// Same palette as the game (shared/src/constants.ts PLAYER_COLORS, render/textures.ts).
const NIGHT = '#0b1026';
const NIGHT_HIGH = '#1d2d5c';
const SNOW = '#eaf2ff';
const TITLE = '#ffe066';
const TITLE_STROKE = '#7a1f2b';
const COLORS = ['#e63946', '#4cc9f0', '#ffd60a', '#52b788', '#c77dff', '#ff8c42'];
const FONT = "'Arial Black', 'Segoe UI Black', 'Helvetica Neue', Arial, sans-serif";

/** Seeded so the picture is the same every time it is regenerated. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A player as drawn in the game (40x40 texture), at (x, y) center, scaled. */
function player(x, y, scale, color) {
  return `<g transform="translate(${x} ${y}) scale(${scale}) translate(-20 -20)">
    <ellipse cx="20" cy="35" rx="13" ry="4" fill="#000" opacity="0.3"/>
    <circle cx="20" cy="20" r="14" fill="${color}"/>
    <circle cx="15" cy="14" r="5" fill="#fff" opacity="0.25"/>
    <circle cx="15" cy="19" r="4" fill="#fff"/><circle cx="25" cy="19" r="4" fill="#fff"/>
    <circle cx="16" cy="19" r="2" fill="#111"/><circle cx="26" cy="19" r="2" fill="#111"/>
    <polygon points="9,11 31,11 24,-2" fill="#e63946"/>
    <rect x="8" y="9" width="24" height="4" fill="#fff"/><circle cx="24" cy="-2" r="3" fill="#fff"/>
  </g>`;
}

/** The game's firecracker: black ball, red band, fuse and spark. */
function petard(x, y, scale, angle = 0) {
  return `<g transform="translate(${x} ${y}) rotate(${angle}) scale(${scale}) translate(-20 -20)">
    <circle cx="20" cy="23" r="13" fill="#111"/>
    <circle cx="15" cy="18" r="4" fill="#fff" opacity="0.18"/>
    <rect x="11" y="17" width="18" height="6" fill="#e63946"/>
    <path d="M20 10 Q22 6 26 4" stroke="#8d6e63" stroke-width="3" fill="none" stroke-linecap="round"/>
    ${spark(27, 3, 1)}
  </g>`;
}

function spark(x, y, s) {
  const rays = [0, 45, 90, 135, 180, 225, 270, 315]
    .map((a, i) => {
      const len = (i % 2 ? 5 : 8) * s;
      const r = (a * Math.PI) / 180;
      return `<line x1="${x}" y1="${y}" x2="${(x + Math.cos(r) * len).toFixed(1)}" y2="${(y + Math.sin(r) * len).toFixed(1)}"/>`;
    })
    .join('');
  return `<g stroke="#ffb703" stroke-width="${1.6 * s}" stroke-linecap="round">${rays}</g>
    <circle cx="${x}" cy="${y}" r="${3 * s}" fill="#ffe066"/>`;
}

/** Gift box, like the game's bricks. */
function gift(x, y, size, color = '#b5223a') {
  const s = size / 40;
  return `<g transform="translate(${x} ${y}) scale(${s})">
    <rect x="3" y="5" width="34" height="32" fill="${color}"/>
    <rect x="3" y="5" width="34" height="6" fill="#d63650"/>
    <rect x="17" y="5" width="6" height="32" fill="#ffd166"/><rect x="3" y="19" width="34" height="6" fill="#ffd166"/>
    <circle cx="14" cy="5" r="5" fill="#ffd166"/><circle cx="26" cy="5" r="5" fill="#ffd166"/>
  </g>`;
}

/** Firework burst: rays and dots in one color. */
function firework(x, y, radius, color, rays = 14) {
  let out = '';
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * Math.PI * 2;
    const x1 = x + Math.cos(a) * radius * 0.35;
    const y1 = y + Math.sin(a) * radius * 0.35;
    const x2 = x + Math.cos(a) * radius;
    const y2 = y + Math.sin(a) * radius;
    out += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`;
    out += `<circle cx="${(x + Math.cos(a) * radius * 1.12).toFixed(1)}" cy="${(y + Math.sin(a) * radius * 1.12).toFixed(1)}" r="${(radius / 26).toFixed(1)}"/>`;
  }
  return `<g stroke="${color}" fill="${color}" stroke-width="${(radius / 18).toFixed(1)}" stroke-linecap="round" opacity="0.95">${out}</g>
    <circle cx="${x}" cy="${y}" r="${(radius / 10).toFixed(1)}" fill="#fff" opacity="0.9"/>`;
}

function ogSvg() {
  const W = 1200;
  const H = 630;
  const rand = rng(2026);
  let stars = '';
  for (let i = 0; i < 70; i++) {
    stars += `<circle cx="${(rand() * W).toFixed(0)}" cy="${(rand() * 360).toFixed(0)}" r="${(0.8 + rand() * 1.6).toFixed(1)}" fill="${SNOW}" opacity="${(0.35 + rand() * 0.6).toFixed(2)}"/>`;
  }
  let flakes = '';
  for (let i = 0; i < 90; i++) {
    flakes += `<circle cx="${(rand() * W).toFixed(0)}" cy="${(rand() * H).toFixed(0)}" r="${(1.8 + rand() * 3.4).toFixed(1)}" fill="#fff" opacity="${(0.45 + rand() * 0.5).toFixed(2)}"/>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${NIGHT}"/><stop offset="1" stop-color="${NIGHT_HIGH}"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#sky)"/>
  ${stars}
  <circle cx="1080" cy="96" r="44" fill="#fff6d5"/><circle cx="1100" cy="84" r="40" fill="#0e1532"/>
  ${firework(150, 120, 92, COLORS[0])}
  ${firework(330, 70, 52, COLORS[2], 12)}
  ${firework(900, 110, 78, COLORS[1])}
  ${firework(1040, 250, 48, COLORS[4], 12)}
  ${firework(70, 300, 44, COLORS[3], 12)}
  ${flakes}

  <text x="${W / 2}" y="262" text-anchor="middle" font-family="${FONT}" font-weight="900" font-size="112"
    fill="${TITLE}" stroke="${TITLE_STROKE}" stroke-width="16" stroke-linejoin="round" paint-order="stroke">Bombe și Petarde</text>
  <text x="${W / 2}" y="336" text-anchor="middle" font-family="${FONT}" font-weight="700" font-size="40"
    fill="${SNOW}" stroke="${NIGHT}" stroke-width="6" paint-order="stroke">Joc multiplayer · până la 6 prieteni</text>

  <path d="M0 500 Q200 452 420 492 T820 486 T1200 470 L1200 630 L0 630 Z" fill="${SNOW}"/>
  <path d="M0 540 Q260 506 560 532 T1200 520 L1200 630 L0 630 Z" fill="#cfdcf2"/>

  ${gift(90, 430, 80)}
  ${gift(160, 456, 58, '#2a7f62')}
  ${gift(1010, 424, 82, '#3a5bbf')}
  ${gift(1090, 452, 60)}
  ${player(400, 470, 3.6, COLORS[0])}
  ${player(600, 480, 3.9, COLORS[1])}
  ${player(800, 468, 3.6, COLORS[3])}
  ${petard(500, 528, 2.4, -12)}
  ${petard(705, 534, 2.2, 10)}
  ${petard(280, 530, 1.9, 0)}
  ${petard(925, 528, 2, -8)}
</svg>`;
}

/**
 * The favicon: the game's firecracker, simplified so it still reads at 16x16 — a red ball
 * with a black band, a short fuse and a yellow spark, on the game's night blue.
 */
function faviconSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="${NIGHT}"/>
  <circle cx="28" cy="38" r="20" fill="#e63946"/>
  <rect x="9" y="32" width="38" height="10" fill="#111"/>
  <circle cx="21" cy="29" r="5" fill="#fff" opacity="0.35"/>
  <path d="M33 19 Q37 11 45 10" stroke="#c9a27a" stroke-width="5" fill="none" stroke-linecap="round"/>
  <g stroke="#ffb703" stroke-width="4" stroke-linecap="round">
    <line x1="47" y1="9" x2="58" y2="4"/><line x1="47" y1="9" x2="60" y2="13"/><line x1="47" y1="9" x2="50" y2="0"/>
  </g>
  <circle cx="47" cy="9" r="6" fill="${TITLE}"/>
</svg>`;
}

function png(svg, width) {
  return new Resvg(svg, { fitTo: { mode: 'width', value: width }, font: { loadSystemFonts: true } }).render().asPng();
}

mkdirSync(OUT, { recursive: true });
const write = (name, data) => {
  writeFileSync(join(OUT, name), data);
  console.log(`${name.padEnd(22)} ${(data.length / 1024).toFixed(1)} KB`);
};
const og = ogSvg();
const favicon = faviconSvg();
write('og.png', png(og, 1200));
write('favicon.svg', favicon);
write('favicon-32.png', png(favicon, 32));
write('apple-touch-icon.png', png(favicon.replace('rx="14"', 'rx="0"'), 180)); // iOS rounds the corners itself
write('icon-512.png', png(favicon, 512));
