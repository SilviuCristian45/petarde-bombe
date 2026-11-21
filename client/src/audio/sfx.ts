import Phaser from 'phaser';
import { fetchFirst } from './sound';

// Sound effects. Each one is generated with Web Audio unless a file with its name exists in
// client/public/audio/ (<name>.ogg, else <name>.mp3): then the file plays instead.
// Everything goes through Phaser's master gain, so the mute toggle applies.

export const SFX_NAMES = [
  'petarda', // a firecracker is put down
  'fitil', // its fuse starts hissing
  'explozie',
  'powerup',
  'mahmureala', // the curse is picked up
  'sut', // a petard is kicked
  'scut', // a shield takes a blast
  'moarte',
  'numaratoare', // 3, 2, 1
  'foc', // FOC!
  'runda', // someone wins a round
  'la-multi-ani', // the match is won (fallback: a short fanfare)
] as const;
export type SfxName = (typeof SFX_NAMES)[number];

/** The same effect more often than this (a chain of explosions) plays once. */
const MIN_GAP_MS = 45;

const files = new Map<SfxName, AudioBuffer>();
const lastPlayed = new Map<SfxName, number>();
let manager: Phaser.Sound.WebAudioSoundManager | null = null;
let noiseBuffer: AudioBuffer | null = null;

/** Looks for replacement files once, at boot; a missing file simply keeps the generated sound. */
export function initSfx(game: Phaser.Game): void {
  if (!(game.sound instanceof Phaser.Sound.WebAudioSoundManager)) return;
  manager = game.sound;
  const context = manager.context;
  for (const name of SFX_NAMES) {
    void fetchFirst(context, [`audio/${name}.ogg`, `audio/${name}.mp3`]).then((buffer) => {
      if (buffer) files.set(name, buffer);
    });
  }
}

export function playSfx(name: SfxName): void {
  if (!manager?.destination) return;
  const ctx = manager.context;
  // Before the first click the context is suspended: sounds would all burst out at once later.
  if (ctx.state !== 'running') return;
  const now = performance.now();
  if (now - (lastPlayed.get(name) ?? -Infinity) < MIN_GAP_MS) return;
  lastPlayed.set(name, now);

  const out = manager.destination;
  const file = files.get(name);
  if (file) {
    const src = ctx.createBufferSource();
    src.buffer = file;
    src.connect(out);
    src.start();
    return;
  }
  SYNTH[name](ctx, out, ctx.currentTime);
}

type Synth = (ctx: AudioContext, out: AudioNode, t: number) => void;

const SYNTH: Record<SfxName, Synth> = {
  petarda: (ctx, out, t) => tone(ctx, out, t, { type: 'sine', from: 180, to: 60, dur: 0.14, vol: 0.5 }),
  fitil: (ctx, out, t) => {
    // Crackling hiss: band-passed noise with a jittery level.
    const gain = noise(ctx, out, t, { dur: 0.7, vol: 0.09, filter: 'bandpass', from: 5000, to: 3500 });
    for (let i = 0; i < 14; i++) gain.gain.setValueAtTime(0.04 + ((i * 37) % 10) / 100, t + i * 0.045);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
  },
  explozie: (ctx, out, t) => {
    noise(ctx, out, t, { dur: 0.6, vol: 0.55, filter: 'lowpass', from: 2400, to: 160 });
    tone(ctx, out, t, { type: 'sine', from: 110, to: 32, dur: 0.45, vol: 0.6 });
  },
  powerup: (ctx, out, t) => {
    [660, 880, 1320].forEach((f, i) => tone(ctx, out, t + i * 0.06, { type: 'square', from: f, dur: 0.09, vol: 0.12 }));
  },
  mahmureala: (ctx, out, t) => {
    [440, 370, 311].forEach((f, i) => tone(ctx, out, t + i * 0.1, { type: 'triangle', from: f, to: f * 0.94, dur: 0.14, vol: 0.2 }));
  },
  sut: (ctx, out, t) => {
    tone(ctx, out, t, { type: 'sine', from: 240, to: 90, dur: 0.1, vol: 0.45 });
    noise(ctx, out, t, { dur: 0.08, vol: 0.25, filter: 'lowpass', from: 1800, to: 400 });
  },
  scut: (ctx, out, t) => {
    tone(ctx, out, t, { type: 'square', from: 1200, to: 600, dur: 0.25, vol: 0.12 });
    tone(ctx, out, t, { type: 'sine', from: 1800, to: 1500, dur: 0.35, vol: 0.15 });
  },
  moarte: (ctx, out, t) => tone(ctx, out, t, { type: 'sawtooth', from: 520, to: 90, dur: 0.6, vol: 0.2 }),
  numaratoare: (ctx, out, t) => tone(ctx, out, t, { type: 'sine', from: 660, dur: 0.14, vol: 0.3 }),
  foc: (ctx, out, t) => {
    tone(ctx, out, t, { type: 'square', from: 990, dur: 0.32, vol: 0.16 });
    tone(ctx, out, t, { type: 'sine', from: 1320, dur: 0.32, vol: 0.18 });
  },
  runda: (ctx, out, t) => {
    [523, 659, 784, 1047].forEach((f, i) => tone(ctx, out, t + i * 0.09, { type: 'triangle', from: f, dur: i === 3 ? 0.35 : 0.12, vol: 0.28 }));
  },
  'la-multi-ani': (ctx, out, t) => {
    // A short brass-ish fanfare: G G G C ... E G C'.
    const notes: [number, number, number][] = [
      [392, 0, 0.12],
      [392, 0.14, 0.12],
      [392, 0.28, 0.12],
      [523, 0.42, 0.45],
      [659, 0.92, 0.18],
      [784, 1.12, 0.18],
      [1047, 1.32, 0.8],
    ];
    for (const [f, at, dur] of notes) {
      tone(ctx, out, t + at, { type: 'sawtooth', from: f, dur, vol: 0.1 });
      tone(ctx, out, t + at, { type: 'triangle', from: f / 2, dur, vol: 0.18 });
    }
  },
};

interface ToneOptions {
  type: OscillatorType;
  from: number;
  to?: number;
  dur: number;
  vol: number;
}

function tone(ctx: AudioContext, out: AudioNode, t: number, o: ToneOptions): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = o.type;
  osc.frequency.setValueAtTime(o.from, t);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + o.dur);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(o.vol, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
  osc.connect(gain).connect(out);
  osc.start(t);
  osc.stop(t + o.dur + 0.02);
}

interface NoiseOptions {
  dur: number;
  vol: number;
  filter: BiquadFilterType;
  from: number;
  to: number;
}

/** Filtered white noise; returns its gain node so callers can shape the level. */
function noise(ctx: AudioContext, out: AudioNode, t: number, o: NoiseOptions): GainNode {
  if (!noiseBuffer || noiseBuffer.sampleRate !== ctx.sampleRate) {
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  const filter = ctx.createBiquadFilter();
  filter.type = o.filter;
  filter.frequency.setValueAtTime(o.from, t);
  filter.frequency.exponentialRampToValueAtTime(o.to, t + o.dur);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(o.vol, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + o.dur);
  src.connect(filter).connect(gain).connect(out);
  src.start(t);
  src.stop(t + o.dur);
  return gain;
}
