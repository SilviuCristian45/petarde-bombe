import Phaser from 'phaser';
import { DEFAULT_ROUNDS, MAX_PLAYERS, ROUND_OPTIONS } from '@petarde/shared';
import { LocalTransport } from './net/LocalTransport';
import { GAME_H, GAME_W } from './render/layout';
import { GameScene, type GameSceneData } from './scenes/GameScene';

// URL options for the local game: ?debug, ?bots=1..5, ?rounds=3|5|7, ?seed=abc
const params = new URLSearchParams(window.location.search);
const bots = Phaser.Math.Clamp(Number(params.get('bots') ?? 3) || 3, 1, MAX_PLAYERS - 1);
const rounds = Number(params.get('rounds'));
const data: GameSceneData = {
  transport: new LocalTransport({
    name: 'Jucător',
    bots,
    rounds: ROUND_OPTIONS.includes(rounds) ? rounds : DEFAULT_ROUNDS,
    seed: params.get('seed') ?? Math.random().toString(36).slice(2),
  }),
  debug: params.has('debug'),
};

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: GAME_W,
  height: GAME_H,
  backgroundColor: '#0b1026',
  pixelArt: true,
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
});
game.scene.add('game', GameScene, true, data);
