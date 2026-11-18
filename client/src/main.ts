import Phaser from 'phaser';
import './style.css';
import { DEFAULT_ROUNDS, isValidRoomCode, MAX_PLAYERS, normalizeRoomCode, ROUND_OPTIONS } from '@petarde/shared';
import { initSfx } from './audio/sfx';
import { initMute } from './audio/sound';
import { isTouch } from './device';
import { parseBotLevel } from './botLevels';
import { LocalTransport } from './net/LocalTransport';
import { resumableRoomCode } from './net/rooms';
import { GAME_H, GAME_W } from './render/layout';
import { GameScene, type GameSceneData } from './scenes/GameScene';
import { IntroScene } from './scenes/IntroScene';
import { LeaderboardScene } from './scenes/LeaderboardScene';
import { LobbyScene } from './scenes/LobbyScene';
import { MenuScene, type MenuSceneData } from './scenes/MenuScene';
import { NameScene } from './scenes/NameScene';
import { initChrome } from './ui/chrome';
import { trackVisualViewport } from './ui/dom';
import { initRotatePrompt } from './ui/orientation';

const params = new URLSearchParams(window.location.search);

// Debug URL options skip the intro and menu and start a local match at once:
// ?debug, ?bots=1..5 (default 3), ?rounds=3|5|7, ?seed=abc, ?botlevel=usor|mediu|greu
const quick = ['debug', 'bots', 'rounds', 'seed', 'botlevel'].some((key) => params.has(key));

function quickStart(): GameSceneData {
  const bots = Phaser.Math.Clamp(Number(params.get('bots') ?? 3) || 3, 1, MAX_PLAYERS - 1);
  const rounds = Number(params.get('rounds'));
  return {
    transport: new LocalTransport({
      name: 'Jucător',
      bots,
      botLevel: parseBotLevel(params.get('botlevel')),
      rounds: ROUND_OPTIONS.includes(rounds) ? rounds : DEFAULT_ROUNDS,
      seed: params.get('seed') ?? Math.random().toString(36).slice(2),
      autoStart: true,
    }),
    debug: params.has('debug'),
    quick: true,
  };
}

// ?room=COD (invite link): after the intro and the nickname, the menu joins that room.
function menuData(): MenuSceneData {
  const room = params.get('room');
  if (room === null) return {};
  const code = normalizeRoomCode(room);
  return isValidRoomCode(code) ? { invite: code } : { message: 'Codul din link nu e valid.' };
}

// A reload during an online game skips the intro and reconnects to the same room; a link to
// another room skips it too, and the menu asks whether to leave the current game for it.
const current = quick ? null : resumableRoomCode();
const invite = menuData().invite;
const switching = current !== null && invite !== undefined && invite !== current;
const resume = current !== null;
const resumeData: MenuSceneData = switching ? { invite, switchFrom: current } : { resume: true };

// Phones: no long-press menu (the CSS already stops selection and the callout); text fields keep theirs.
if (isTouch) {
  document.body.classList.add('touch');
  document.addEventListener('contextmenu', (e) => {
    if (!(e.target instanceof HTMLInputElement)) e.preventDefault();
  });
}

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'stage',
  width: GAME_W,
  height: GAME_H,
  backgroundColor: '#0b1026',
  pixelArt: true,
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  // The canvas only sees one finger at a time (HUD buttons); the HTML touch controls track their own.
  input: { activePointers: 1 },
});
initMute(game);
initSfx(game);
// HTML layers over the canvas: mute/fullscreen icons and the rotate prompt (toasts and dialogs come and go).
initChrome(game);
initRotatePrompt();
trackVisualViewport();
game.scene.add('intro', IntroScene, !quick && !resume, menuData());
game.scene.add('name', NameScene);
game.scene.add('menu', MenuScene, resume, resumeData);
game.scene.add('leaderboard', LeaderboardScene);
game.scene.add('lobby', LobbyScene);
game.scene.add('game', GameScene, quick, quick ? quickStart() : undefined);
