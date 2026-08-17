class BootScene extends Phaser.Scene {
  constructor() { super('BootScene'); }

  preload() {
    const cam = this.cameras.main;
    const cx = cam.width / 2, cy = cam.height / 2;
    const box = this.add.rectangle(cx, cy, 320, 28, 0x222222).setStrokeStyle(2, 0xffffff);
    const bar = this.add.rectangle(cx - 156, cy, 4, 20, 0x8fd0ff).setOrigin(0, 0.5);
    const label = this.add.text(cx, cy - 30, 'Loading...', { fontFamily: 'monospace', fontSize: '16px', color: '#ffffff' }).setOrigin(0.5);

    this.load.on('progress', (value) => { bar.width = 312 * value; });
    this.load.on('complete', () => { box.destroy(); bar.destroy(); label.destroy(); });

    const s = 'assets/sprites/';
    this.load.image('player_mecha', s + 'player_mecha.png');
    this.load.image('enemy_mutant_crawler', s + 'enemy_mutant_crawler.png');
    this.load.image('enemy_scavenger', s + 'enemy_scavenger.png');
    this.load.image('boss_rogue_robot', s + 'boss_rogue_robot.png');
    this.load.image('projectile_player', s + 'projectile_player.png');
    this.load.image('projectile_enemy', s + 'projectile_enemy.png');
    this.load.image('pickup_xp_gem', s + 'pickup_xp_gem.png');
    this.load.image('chest_closed', s + 'chest_closed.png');
    this.load.image('chest_open', s + 'chest_open.png');
    this.load.image('tile_ground', s + 'tile_ground.png');
  }

  create() {
    this.scene.start('GameScene');
  }
}
