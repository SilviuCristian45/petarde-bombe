import Phaser from 'phaser';
import type { GameTransport } from '../net/GameTransport';
import type { MenuSceneData } from '../scenes/MenuScene';
import { el, setText, show } from './dom';

/** "Se reconectează..." strip shown by the lobby and game scenes while an online room is down. */
export class ConnectionBanner {
  private readonly node = el('div', { class: 'conn-banner', attrs: { role: 'status' } });

  constructor(private readonly scene: Phaser.Scene) {
    show(this.node, false);
    document.body.append(this.node);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.node.remove());
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
    show(this.node, status === 'reconnecting');
    if (status === 'reconnecting') {
      const dots = '.'.repeat(1 + (Math.floor(time / 400) % 3));
      setText(this.node, `Conexiunea s-a întrerupt. Se reconectează${dots.padEnd(3)}`);
    }
    return true;
  }
}
