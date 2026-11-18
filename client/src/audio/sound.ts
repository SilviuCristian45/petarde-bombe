import Phaser from 'phaser';
import { load, save } from '../storage';

// Audio files are optional: a missing or undecodable file just means silence. The files
// are fetched and decoded here instead of through the Phaser loader, which logs errors.

// Kept here because WebAudio's `sound.mute` getter reads the gain node, which only
// changes once the audio context renders, so it lags right after being set.
let muted = false;

export function initMute(game: Phaser.Game): void {
  muted = load('muted') === '1';
  game.sound.mute = muted;
}

export function isMuted(): boolean {
  return muted;
}

export function toggleMute(game: Phaser.Game): boolean {
  muted = !muted;
  game.sound.mute = muted;
  save('muted', muted ? '1' : '0');
  return muted;
}

/** Plays the first of `urls` that loads and decodes (e.g. .ogg, then .mp3). Resolves to whether one played. */
export async function playOptional(game: Phaser.Game, key: string, urls: string[]): Promise<boolean> {
  const sound = game.sound;
  if (!(sound instanceof Phaser.Sound.WebAudioSoundManager)) return false;
  if (!game.cache.audio.exists(key)) {
    const buffer = await fetchFirst(sound.context, urls);
    if (!buffer) return false;
    game.cache.audio.add(key, buffer);
  }
  return sound.play(key);
}

/** The first of `urls` that loads and decodes, or null (missing files are normal: they are optional). */
export async function fetchFirst(context: AudioContext, urls: string[]): Promise<AudioBuffer | null> {
  for (const url of urls) {
    try {
      const res = await fetch(url);
      // Dev servers answer unknown paths with index.html.
      if (!res.ok || (res.headers.get('content-type') ?? '').includes('text/html')) continue;
      return await context.decodeAudioData(await res.arrayBuffer());
    } catch {
      // unsupported format or broken file: try the next one
    }
  }
  return null;
}
