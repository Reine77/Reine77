class GameScene extends Phaser.Scene {
  constructor() { super('GameScene'); }

  create() {
    const W = BALANCE.world.width, H = BALANCE.world.height;
    this.physics.world.setBounds(0, 0, W, H);
    this.add.tileSprite(0, 0, W, H, 'tile_ground').setOrigin(0, 0).setDepth(-10);

    this.paused = false;
    this.gameOver = false;
    this.victory = false;
    this.startedAt = this.time.now;

    this.player = new Player(this, W / 2, H / 2);

    this.enemies = this.physics.add.group();
    this.playerProjectiles = this.physics.add.group();
    this.enemyProjectiles = this.physics.add.group();
    this.pickups = this.physics.add.group();
    this.chests = this.physics.add.group();

    this.cameras.main.setBounds(0, 0, W, H);
    this.cameras.main.startFollow(this.player.sprite, true, 0.12, 0.12);

    this.cursors = this.input.keyboard.createCursorKeys();
    this.wasd = this.input.keyboard.addKeys({ up: 'W', down: 'S', left: 'A', right: 'D' });

    this.physics.add.overlap(this.playerProjectiles, this.enemies, (proj, enemySprite) => {
      if (!proj.active || !enemySprite.active) return;
      enemySprite.owner.takeDamage(proj.getData('damage'));
      proj.destroy();
    });

    // NOTE: when one side of an overlap is a lone GameObject (player.sprite)
    // and the other is a Group (enemyProjectiles), Phaser's Arcade Physics
    // always calls back as (loneSprite, groupMember) — i.e. (playerSprite,
    // proj) — regardless of the order they're passed to .overlap() above.
    this.physics.add.overlap(this.enemyProjectiles, this.player.sprite, (playerSprite, proj) => {
      if (!proj.active) return;
      this.player.takeDamage(proj.getData('damage'));
      proj.destroy();
    });

    this.physics.add.overlap(this.player.sprite, this.chests, (_p, chest) => this.openChest(chest));

    this.waveManager = new WaveManager(this);
    this.chestSpawner = new ChestSpawner(this);
    this.boss = null;
    this.pendingLevelUps = 0;

    this.buildHud();
    this.waveManager.start();
  }

  // ---------------------------------------------------------------- spawning

  getRingSpawnPosition() {
    const view = this.cameras.main.worldView;
    const dist = Math.hypot(view.width, view.height) / 2 + 140;
    const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
    const x = Phaser.Math.Clamp(this.player.sprite.x + Math.cos(angle) * dist, 20, BALANCE.world.width - 20);
    const y = Phaser.Math.Clamp(this.player.sprite.y + Math.sin(angle) * dist, 20, BALANCE.world.height - 20);
    return { x, y };
  }

  spawnEnemyAroundPlayer(type) {
    const { x, y } = this.getRingSpawnPosition();
    const enemy = new Enemy(this, type, x, y);
    this.enemies.add(enemy.sprite);
  }

  spawnPlayerProjectile(x, y, angle, damage) {
    const proj = this.playerProjectiles.create(x, y, 'projectile_player');
    proj.setRotation(angle);
    proj.setData('damage', damage);
    this.physics.velocityFromRotation(angle, BALANCE.player.projectileSpeed, proj.body.velocity);
    this.time.delayedCall(1200, () => { if (proj.active) proj.destroy(); });
  }

  spawnEnemyProjectile(x, y, angle, damage, speed) {
    const proj = this.enemyProjectiles.create(x, y, 'projectile_enemy');
    proj.setRotation(angle);
    proj.setData('damage', damage);
    this.physics.velocityFromRotation(angle, speed, proj.body.velocity);
    this.time.delayedCall(3000, () => { if (proj.active) proj.destroy(); });
  }

  spawnXpGem(x, y, value) {
    const gem = this.pickups.create(x, y, 'pickup_xp_gem');
    gem.setData('value', value);
  }

  spawnChestNearPlayer() {
    const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
    const dist = Phaser.Math.FloatBetween(260, 460);
    const x = Phaser.Math.Clamp(this.player.sprite.x + Math.cos(angle) * dist, 40, BALANCE.world.width - 40);
    const y = Phaser.Math.Clamp(this.player.sprite.y + Math.sin(angle) * dist, 40, BALANCE.world.height - 40);
    const chest = this.chests.create(x, y, 'chest_closed');
    chest.body.setImmovable(true);
    chest.setData('opening', false);
  }

  openChest(chest) {
    if (chest.getData('opening')) return;
    chest.setData('opening', true);
    chest.body.enable = false;
    chest.setTexture('chest_open');

    const pickup = UpgradeSystem.pickChestPickup();
    pickup.apply(this.player, this);
    this.showFloatingText(chest.x, chest.y - 30, pickup.label, '#ffe08a');

    this.tweens.add({
      targets: chest, y: chest.y - 10, alpha: 0, duration: 500, delay: 300,
      onComplete: () => chest.destroy(),
    });
  }

  spawnSlamTelegraph(x, y, radius, ms) {
    const g = this.add.graphics({ x, y }).setDepth(6);
    g.lineStyle(4, 0xff4444, 0.85);
    g.strokeCircle(0, 0, radius);
    this.tweens.add({ targets: g, alpha: 0.15, duration: ms, onUpdate: () => { g.clear(); g.lineStyle(4, 0xff4444, g.alpha); g.strokeCircle(0, 0, radius); } });
    this.time.delayedCall(ms, () => g.destroy());
  }

  spawnSlamShockwave(x, y, radius) {
    const g = this.add.graphics({ x, y }).setDepth(6);
    g.lineStyle(6, 0xffffff, 1);
    g.strokeCircle(0, 0, radius);
    this.tweens.add({ targets: g, alpha: 0, duration: 300, onComplete: () => g.destroy() });
    this.cameras.main.shake(150, 0.006);
  }

  damageAllVisibleEnemies(amount) {
    const view = this.cameras.main.worldView;
    this.enemies.getChildren().forEach((s) => {
      if (s.active && Phaser.Geom.Rectangle.Contains(view, s.x, s.y)) s.owner.takeDamage(amount);
    });
  }

  // ------------------------------------------------------------- callbacks

  onWaveStart(index, wave) {
    if (wave.boss) {
      this.showFloatingText(this.player.sprite.x, this.player.sprite.y - 120, 'WARNING: ROGUE ROBOT INBOUND', '#ff6666', 26);
    } else {
      this.showFloatingText(this.player.sprite.x, this.player.sprite.y - 120, `WAVE ${index + 1}`, '#9fdcff', 26);
    }
  }

  onAllWavesCleared() {
    // Reached when waveManager advances past the boss wave (i.e. boss died).
  }

  onBossSpawned(enemy) {
    this.boss = enemy;
  }

  onEnemyKilled(enemy) {
    this.player.kills += 1;
    this.spawnXpGem(enemy.x, enemy.y, enemy.def.xp);
    if (enemy.def.isBoss) {
      this.boss = null;
      this.waveManager.notifyBossDefeated();
      this.showVictory();
    }
  }

  onPlayerDeath() {
    this.showGameOver();
  }

  onLevelUp() {
    // A single big XP pickup can cross more than one level threshold in the
    // same synchronous call (see Player.gainXp's while loop) — queue extra
    // level-ups instead of stacking overlapping overlays.
    if (this.paused) { this.pendingLevelUps += 1; return; }
    this.showLevelUpOverlay();
  }

  // ------------------------------------------------------------------ HUD

  buildHud() {
    const cam = this.cameras.main;
    const pad = 16;

    this.hud = this.add.container(0, 0).setScrollFactor(0).setDepth(100);

    this.hpBarBg = this.add.rectangle(pad, pad, 240, 22, 0x1a1a1a, 0.7).setOrigin(0, 0).setStrokeStyle(2, 0x000000);
    this.hpBarFill = this.add.rectangle(pad + 2, pad + 2, 236, 18, 0xe0503c).setOrigin(0, 0);
    this.hpText = this.add.text(pad + 8, pad + 3, '', { fontFamily: 'monospace', fontSize: '14px', color: '#ffffff' });
    this.hud.add([this.hpBarBg, this.hpBarFill, this.hpText]);

    this.waveText = this.add.text(cam.width / 2, pad, '', { fontFamily: 'monospace', fontSize: '18px', color: '#bfe6ff' }).setOrigin(0.5, 0);
    this.hud.add(this.waveText);

    this.killsText = this.add.text(cam.width - pad, pad, '', { fontFamily: 'monospace', fontSize: '14px', color: '#ffffff' }).setOrigin(1, 0);
    this.hud.add(this.killsText);

    const xpY = cam.height - pad - 10;
    this.xpBarBg = this.add.rectangle(pad, xpY, cam.width - pad * 2, 10, 0x1a1a1a, 0.7).setOrigin(0, 0).setStrokeStyle(2, 0x000000);
    this.xpBarFill = this.add.rectangle(pad + 2, xpY + 2, cam.width - pad * 2 - 4, 6, 0x7fd858).setOrigin(0, 0);
    this.lvlText = this.add.text(pad, xpY - 20, '', { fontFamily: 'monospace', fontSize: '14px', color: '#d8ffb0' });
    this.hud.add([this.xpBarBg, this.xpBarFill, this.lvlText]);

    this.bossBarBg = this.add.rectangle(cam.width / 2, 40, 420, 18, 0x1a1a1a, 0.8).setOrigin(0.5, 0).setStrokeStyle(2, 0x000000).setVisible(false);
    this.bossBarFill = this.add.rectangle(cam.width / 2 - 208, 42, 416, 14, 0xff5555).setOrigin(0, 0).setVisible(false);
    this.bossNameText = this.add.text(cam.width / 2, 60, 'ROGUE ROBOT', { fontFamily: 'monospace', fontSize: '13px', color: '#ffbbbb' }).setOrigin(0.5, 0).setVisible(false);
    this.hud.add([this.bossBarBg, this.bossBarFill, this.bossNameText]);

    this.scale.on('resize', () => this.layoutHud());
  }

  layoutHud() {
    const cam = this.cameras.main;
    this.waveText.setX(cam.width / 2);
    this.killsText.setX(cam.width - 16);
    this.xpBarBg.setSize(cam.width - 32, 10).setPosition(16, cam.height - 26);
    this.xpBarFill.setPosition(18, cam.height - 24);
    this.lvlText.setPosition(16, cam.height - 46);
    this.bossBarBg.setX(cam.width / 2);
    this.bossNameText.setX(cam.width / 2);
  }

  updateHud() {
    const p = this.player;
    this.hpBarFill.width = 236 * Phaser.Math.Clamp(p.hp / p.stats.maxHp, 0, 1);
    this.hpText.setText(`HP ${Math.ceil(p.hp)}/${Math.ceil(p.stats.maxHp)}`);

    this.xpBarFill.width = (this.xpBarBg.width - 4) * Phaser.Math.Clamp(p.xp / p.xpToNext, 0, 1);
    this.lvlText.setText(`Lv ${p.level}`);
    this.killsText.setText(`Kills ${p.kills}`);

    if (this.boss) {
      this.bossBarBg.setVisible(true); this.bossBarFill.setVisible(true); this.bossNameText.setVisible(true);
      this.waveText.setVisible(false);
      this.bossBarFill.width = 416 * Phaser.Math.Clamp(this.boss.hp / this.boss.maxHp, 0, 1);
    } else {
      this.bossBarBg.setVisible(false); this.bossBarFill.setVisible(false); this.bossNameText.setVisible(false);
      this.waveText.setVisible(true);
      const wm = this.waveManager;
      if (!wm.finished) {
        const secs = Math.ceil(wm.waveTimeRemainingMs / 1000);
        this.waveText.setText(`WAVE ${wm.waveIndex + 1}/${wm.totalWaves}   ${secs}s`);
      }
    }
  }

  showFloatingText(x, y, msg, color, size = 20) {
    const t = this.add.text(x, y, msg, { fontFamily: 'monospace', fontSize: `${size}px`, color, stroke: '#000000', strokeThickness: 4 })
      .setOrigin(0.5).setDepth(200);
    this.tweens.add({ targets: t, y: y - 40, alpha: 0, duration: 1400, onComplete: () => t.destroy() });
  }

  // ------------------------------------------------------------- overlays

  showLevelUpOverlay() {
    this.paused = true;
    this.physics.world.pause();
    const cam = this.cameras.main;
    const cx = cam.width / 2, cy = cam.height / 2;
    // Every element gets its own setScrollFactor(0), not just the container:
    // Phaser's input hit-testing reads scrollFactor off the object being
    // tested, not an inherited container value, so an interactive child
    // without it is hit-tested against world coordinates instead of screen
    // coordinates and becomes unclickable as soon as the camera scrolls.
    const group = this.add.container(0, 0).setScrollFactor(0).setDepth(300);
    const dim = this.add.rectangle(0, 0, cam.width, cam.height, 0x000000, 0.65).setOrigin(0, 0).setScrollFactor(0);
    const title = this.add.text(cx, cy - 150, `LEVEL ${this.player.level}`, { fontFamily: 'monospace', fontSize: '30px', color: '#ffffff' }).setOrigin(0.5).setScrollFactor(0);
    group.add([dim, title]);

    const choices = UpgradeSystem.pickChoices(3);
    const cardW = 220, cardH = 220, gap = 24;
    const totalW = cardW * 3 + gap * 2;
    const startX = cx - totalW / 2 + cardW / 2;

    const cleanupKeys = [];
    const finish = (choice) => {
      choice.apply(this.player);
      cleanupKeys.forEach((k) => this.input.keyboard.off(k));
      group.destroy();
      if (this.pendingLevelUps > 0) {
        this.pendingLevelUps -= 1;
        this.showLevelUpOverlay();
      } else {
        this.paused = false;
        this.physics.world.resume();
      }
    };

    choices.forEach((choice, i) => {
      const x = startX + i * (cardW + gap);
      const card = this.add.rectangle(x, cy, cardW, cardH, 0x22262e, 0.95).setStrokeStyle(2, 0x8fd0ff).setScrollFactor(0).setInteractive({ useHandCursor: true });
      const num = this.add.text(x, cy - cardH / 2 + 18, `${i + 1}`, { fontFamily: 'monospace', fontSize: '16px', color: '#8fd0ff' }).setOrigin(0.5).setScrollFactor(0);
      const label = this.add.text(x, cy - 20, choice.label, { fontFamily: 'monospace', fontSize: '16px', color: '#ffffff', align: 'center', wordWrap: { width: cardW - 24 } }).setOrigin(0.5).setScrollFactor(0);
      const desc = this.add.text(x, cy + 50, choice.desc, { fontFamily: 'monospace', fontSize: '13px', color: '#bcd', align: 'center', wordWrap: { width: cardW - 24 } }).setOrigin(0.5).setScrollFactor(0);
      card.on('pointerdown', () => finish(choice));
      card.on('pointerover', () => card.setStrokeStyle(3, 0xffffff));
      card.on('pointerout', () => card.setStrokeStyle(2, 0x8fd0ff));
      group.add([card, num, label, desc]);

      const keyName = ['ONE', 'TWO', 'THREE'][i];
      this.input.keyboard.once(`keydown-${keyName}`, () => finish(choice));
      cleanupKeys.push(`keydown-${keyName}`);
    });
  }

  showEndOverlay(titleStr, titleColor) {
    this.paused = true;
    this.physics.world.pause();
    const cam = this.cameras.main;
    const cx = cam.width / 2, cy = cam.height / 2;
    const group = this.add.container(0, 0).setScrollFactor(0).setDepth(300);
    const dim = this.add.rectangle(0, 0, cam.width, cam.height, 0x000000, 0.75).setOrigin(0, 0).setScrollFactor(0);
    const title = this.add.text(cx, cy - 90, titleStr, { fontFamily: 'monospace', fontSize: '34px', color: titleColor }).setOrigin(0.5).setScrollFactor(0);

    const elapsedSec = Math.floor((this.time.now - this.startedAt) / 1000);
    const wave = Math.min(this.waveManager.waveIndex + 1, this.waveManager.totalWaves);
    const stats = [
      `Wave reached: ${wave}/${this.waveManager.totalWaves}`,
      `Level: ${this.player.level}`,
      `Kills: ${this.player.kills}`,
      `Time survived: ${elapsedSec}s`,
    ].join('\n');
    const statsText = this.add.text(cx, cy - 10, stats, { fontFamily: 'monospace', fontSize: '16px', color: '#ffffff', align: 'center' }).setOrigin(0.5).setScrollFactor(0);

    const btn = this.add.rectangle(cx, cy + 90, 200, 48, 0x2f6f3f, 1).setStrokeStyle(2, 0xffffff).setScrollFactor(0).setInteractive({ useHandCursor: true });
    const btnText = this.add.text(cx, cy + 90, 'RESTART', { fontFamily: 'monospace', fontSize: '18px', color: '#ffffff' }).setOrigin(0.5).setScrollFactor(0);
    btn.on('pointerdown', () => this.scene.restart());
    btn.on('pointerover', () => btn.setFillStyle(0x3d8f52));
    btn.on('pointerout', () => btn.setFillStyle(0x2f6f3f));

    group.add([dim, title, statsText, btn, btnText]);
    this.input.keyboard.once('keydown-R', () => this.scene.restart());
  }

  showGameOver() {
    if (this.gameOver || this.victory) return;
    this.gameOver = true;
    this.showEndOverlay('SYSTEM DOWN', '#ff6b6b');
  }

  showVictory() {
    if (this.victory || this.gameOver) return;
    this.victory = true;
    this.showEndOverlay('EXTRACTION SUCCESSFUL', '#8fffb0');
  }

  // ---------------------------------------------------------------- update

  updatePickups(time) {
    this.pickups.getChildren().forEach((gem) => {
      if (!gem.active) return;
      const d = Phaser.Math.Distance.Between(gem.x, gem.y, this.player.sprite.x, this.player.sprite.y);
      if (d < 16) {
        this.player.gainXp(gem.getData('value'));
        gem.destroy();
        return;
      }
      if (d < this.player.pickupRadius) {
        const angle = Phaser.Math.Angle.Between(gem.x, gem.y, this.player.sprite.x, this.player.sprite.y);
        const speed = Phaser.Math.Linear(120, 640, 1 - d / this.player.pickupRadius);
        gem.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);
      } else {
        gem.setVelocity(0, 0);
      }
    });
  }

  update(time, delta) {
    if (this.paused || this.gameOver || this.victory) return;

    this.player.handleMovement(this.cursors, this.wasd);
    this.player.tryFire(time, this.enemies);
    this.player.update(time, delta);

    this.enemies.getChildren().forEach((s) => {
      if (!s.active || !s.owner) return;
      s.owner.update(time, delta, this.player);
      s.owner.tryContactDamage(this.player, time);
    });

    this.waveManager.update(time);
    this.chestSpawner.update(time, this.chests.countActive(true));
    this.updatePickups(time);
    this.updateHud();
  }
}
