import { BOT_EASY, BOT_HARD, BOT_LEVELS, BOT_MEDIUM } from '@petarde/shared';

/** Lobby labels, and the values of the ?botlevel= test option. */
export const BOT_LEVEL_LABELS: Readonly<Record<number, string>> = {
  [BOT_EASY]: 'Ușor',
  [BOT_MEDIUM]: 'Mediu',
  [BOT_HARD]: 'Greu',
};

const URL_VALUES: Readonly<Record<string, number>> = { usor: BOT_EASY, mediu: BOT_MEDIUM, greu: BOT_HARD };

/** "usor" | "mediu" | "greu" (diacritics and case ignored) -> level, otherwise undefined. */
export function parseBotLevel(value: string | null): number | undefined {
  if (!value) return undefined;
  const level = URL_VALUES[value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()];
  return level !== undefined && BOT_LEVELS.includes(level) ? level : undefined;
}
