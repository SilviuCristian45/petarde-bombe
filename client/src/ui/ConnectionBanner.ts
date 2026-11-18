import Phaser from 'phaser';
import type { GameTransport } from '../net/GameTransport';
import { FONT, GAME_W } from '../render/layout';
import type { MenuSceneData } from '../scenes/MenuScene';

/** "Se reconectează..." strip shown by the lobby and game scenes while an online room is down. */
export class ConnectionBanner {
  private readonly text: Phaser.GameObjects.Text;

  constructor(private readonly scene: Phaser.Scene) {
    this.text = scene.add
      .text(GAME_W / 2, 6, '', {
        fontFamily: FONT,
        fontSize: '16px',
        color: '#0b1026',
        backgroundColor: '#ffb347',
        padding: { x: 14, y: 6 },
      })
      .setOrigin(0.5, 0)
      .setDepth(100)
      .setVisible(false);
  }

  /** Returns false once the connection is gone for good; the scene has then switched to the menu. */
  update(transport: GameTransport, time: number): boolean {
    const status = transport.connectionStatus();
    if (status === 'closed') {
      transport.dispose();
      const data: MenuSceneData = { message: transport.closeReason };
      this.scene.scene.start('menu', data);
      return false;
    }
    const dots = '.'.repeat(1 + (Math.floor(time / 400) % 3));
    this.text.setVisible(status === 'reconnecting').setText(`Conexiunea s-a întrerupt. Se reconectează${dots.padEnd(3)}`);
    return true;
  }
}
