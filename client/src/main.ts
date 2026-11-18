import Phaser from 'phaser';
import { DEFAULT_ROUNDS, isValidRoomCode, MAX_PLAYERS, normalizeRoomCode, ROUND_OPTIONS } from '@petarde/shared';
import { initMute } from './audio/sound';
import { LocalTransport } from './net/LocalTransport';
import { hasResumableRoom } from './net/rooms';
import { GAME_H, GAME_W } from './render/layout';
import { GameScene, type GameSceneData } from './scenes/GameScene';
import { IntroScene } from './scenes/IntroScene';
import { LobbyScene } from './scenes/LobbyScene';
import { MenuScene, type MenuSceneData } from './scenes/MenuScene';
import { UiScene } from './scenes/UiScene';

const params = new URLSearchParams(window.location.search);

// Debug URL options skip the intro and menu and start a local match at once:
// ?debug, ?bots=1..5 (default 3), ?rounds=3|5|7, ?seed=abc
const quick = ['debug', 'bots', 'rounds', 'seed'].some((key) => params.has(key));

function quickStart(): GameSceneData {
  const bots = Phaser.Math.Clamp(Number(params.get('bots') ?? 3) || 3, 1, MAX_PLAYERS - 1);
  const rounds = Number(params.get('rounds'));
  return {
    transport: new LocalTransport({
      name: 'Jucător',
      bots,
      rounds: ROUND_OPTIONS.includes(rounds) ? rounds : DEFAULT_ROUNDS,
      seed: params.get('seed') ?? Math.random().toString(36).slice(2),
      autoStart: true,
    }),
    debug: params.has('debug'),
    quick: true,
  };
}

// A reload during an online game skips the intro and reconnects to the same room.
const resume = !quick && hasResumableRoom();

// ?room=COD (invite link): after the intro, the menu only asks for a nickname and joins.
function menuData(): MenuSceneData {
  const room = params.get('room');
  if (room === null) return {};
  const code = normalizeRoomCode(room);
  return isValidRoomCode(code) ? { invite: code } : { message: 'Codul din link nu e valid.' };
}

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: GAME_W,
  height: GAME_H,
  backgroundColor: '#0b1026',
  pixelArt: true,
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  dom: { createContainer: true }, // menu text inputs
});
initMute(game);
game.scene.add('intro', IntroScene, !quick && !resume, menuData());
game.scene.add('menu', MenuScene, resume, { ...menuData(), resume: true } satisfies MenuSceneData);
game.scene.add('lobby', LobbyScene);
game.scene.add('game', GameScene, quick, quick ? quickStart() : undefined);
// Added last so it draws above every other scene; the intro launches it otherwise.
game.scene.add('ui', UiScene, quick || resume);
