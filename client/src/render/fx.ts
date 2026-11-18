import Phaser from 'phaser';
import { onEffectsChange, reducedEffects } from '../settings';
import { GAME_H, GAME_W } from './layout';
import { TEX } from './textures';

// Particle effects with a global cap: bursts (deaths, fireworks) share one budget, so a
// chain of explosions or a long podium never piles up thousands of particles. With
// "Efecte reduse" every burst is smaller, the budget lower and there is no snow.

const MAX_BURST_PARTICLES = 320;
const REDUCED_BURST_PARTICLES = 90;
const REDUCED_FACTOR = 0.35;
const SNOW_FLAKES = 70;

let live = 0;

/** Bursts are only ever this long-lived; their particles return to the budget afterwards. */
export interface BurstOptions {
  count: number;
  lifespanMs: number;
  depth: number;
  config: Phaser.Types.GameObjects.Particles.ParticleEmitterConfig;
  texture?: string;
}

/** A one-shot burst, trimmed to what the budget allows. Returns the emitter, or null if nothing fit. */
export function burst(scene: Phaser.Scene, x: number, y: number, opts: BurstOptions): Phaser.GameObjects.Particles.ParticleEmitter | null {
  const cap = reducedEffects() ? REDUCED_BURST_PARTICLES : MAX_BURST_PARTICLES;
  const wanted = Math.ceil(opts.count * (reducedEffects() ? REDUCED_FACTOR : 1));
  const count = Math.min(wanted, cap - live);
  if (count <= 0) return null;
  live += count;
  const emitter = scene.add
    .particles(x, y, opts.texture ?? TEX.spark, { ...opts.config, lifespan: opts.config.lifespan ?? opts.lifespanMs, emitting: false })
    .setDepth(opts.depth);
  emitter.explode(count);
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    live -= count;
    scene.events.off(Phaser.Scenes.Events.SHUTDOWN, release);
    emitter.destroy();
  };
  scene.time.delayedCall(opts.lifespanMs, release);
  // A scene that stops early must still hand the particles back.
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, release);
  return emitter;
}

/** Firework: a colored burst with a white core, falling under gravity. */
export function firework(scene: Phaser.Scene, x: number, y: number, color: number, depth: number, count = 40): void {
  burst(scene, x, y, {
    count,
    lifespanMs: 1300,
    depth,
    config: {
      speed: { min: 60, max: 220 },
      lifespan: { min: 700, max: 1300 },
      scale: { start: 1, end: 0 },
      gravityY: 140,
      tint: [color, color, color, 0xffffff],
      blendMode: Phaser.BlendModes.ADD,
    },
  });
}

/**
 * Snow falling over the given area (the whole canvas by default), at the given depth.
 * Hidden with "Efecte reduse", and follows the setting while the scene runs.
 */
export function addSnow(scene: Phaser.Scene, depth: number): void {
  const snow = scene.add
    .particles(0, -10, TEX.spark, {
      x: { min: -40, max: GAME_W },
      speedY: { min: 18, max: 45 },
      speedX: { min: 4, max: 22 },
      scale: { min: 0.2, max: 0.55 },
      alpha: { min: 0.35, max: 0.85 },
      lifespan: 16000,
      frequency: 16000 / SNOW_FLAKES,
      maxAliveParticles: SNOW_FLAKES,
      deathZone: { type: 'onLeave', source: new Phaser.Geom.Rectangle(-60, -20, GAME_W + 120, GAME_H + 40) },
    })
    .setDepth(depth);
  // Start with the sky already full instead of the first flakes still on their way down.
  snow.fastForward(14000);
  const apply = (reduced: boolean) => {
    snow.setVisible(!reduced);
    if (reduced) snow.stop(true);
    else snow.start();
  };
  apply(reducedEffects());
  const off = onEffectsChange(apply);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, off);
}
