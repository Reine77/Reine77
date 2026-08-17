// Shared wrapper for all enemy types (fodder / mid-tier / boss). Type-specific
// behavior branches off `def` flags (ranged, isBoss) rather than subclassing,
// since the POC only has three types and they share most of the plumbing.
class Enemy {
  constructor(scene, type, x, y) {
    this.scene = scene;
    this.type = type;
    this.def = BALANCE.enemyDefs[type];

    this.sprite = scene.physics.add.sprite(x, y, this.def.texture);
    this.sprite.setDisplaySize(this.def.width, this.def.height);
    // setCircle's radius/offset are in the texture's native (pre-scale) pixel
    // space, not display size — Arcade Physics applies the sprite's scale to
    // the body automatically. Using sprite.width/height (native frame size,
    // unaffected by setDisplaySize) here keeps the hitbox aligned visually.
    const nativeW = this.sprite.width, nativeH = this.sprite.height;
    this.sprite.body.setCircle(nativeW * 0.38, nativeW * 0.12, nativeH * 0.12);
    this.sprite.setDepth(this.def.isBoss ? 9 : 4);
    this.sprite.owner = this;

    this.hp = this.def.hp;
    this.maxHp = this.def.hp;
    this.dead = false;

    this.lastContactAt = -Infinity;
    this.lastFireAt = -Infinity;
    this.lastSlamAt = -Infinity;
    this.slamState = 'idle'; // idle | telegraph
    this.slamTelegraphEndsAt = 0;
    this.slamTargetX = 0;
    this.slamTargetY = 0;

    if (this.def.isBoss) {
      this.sprite.setFlipX(false);
      scene.onBossSpawned(this);
    }
  }

  get x() { return this.sprite.x; }
  get y() { return this.sprite.y; }

  takeDamage(amount) {
    if (this.dead) return;
    this.hp -= amount;
    this.sprite.setTintFill(0xffffff);
    this.scene.time.delayedCall(60, () => { if (this.sprite.active) this.sprite.clearTint(); });
    if (this.hp <= 0) this.die();
  }

  die() {
    if (this.dead) return;
    this.dead = true;
    this.scene.onEnemyKilled(this);
    const spr = this.sprite;
    spr.body.enable = false;
    this.scene.tweens.add({
      targets: spr, alpha: 0, scale: spr.scale * 0.7, duration: 180,
      onComplete: () => spr.destroy(),
    });
  }

  tryContactDamage(player, time) {
    if (this.dead) return;
    if (time - this.lastContactAt < this.def.contactCooldownMs) return;
    const d = Phaser.Math.Distance.Between(this.x, this.y, player.sprite.x, player.sprite.y);
    if (d < (this.def.width * 0.5 + 26)) {
      this.lastContactAt = time;
      player.takeDamage(this.def.contactDamage);
    }
  }

  update(time, delta, player) {
    if (this.dead || player.dead) return;
    const def = this.def;
    const dist = Phaser.Math.Distance.Between(this.x, this.y, player.sprite.x, player.sprite.y);
    const angleToPlayer = Phaser.Math.Angle.Between(this.x, this.y, player.sprite.x, player.sprite.y);

    if (def.isBoss) {
      this._updateBoss(time, player, dist, angleToPlayer);
      return;
    }

    if (def.ranged) {
      this._updateKiter(time, player, dist, angleToPlayer);
    } else {
      this.sprite.setVelocity(Math.cos(angleToPlayer) * def.speed, Math.sin(angleToPlayer) * def.speed);
      this.sprite.setFlipX(Math.cos(angleToPlayer) < 0);
    }
  }

  _updateKiter(time, player, dist, angleToPlayer) {
    const def = this.def;
    let vx = 0, vy = 0;
    if (dist > def.preferredRange) {
      vx = Math.cos(angleToPlayer) * def.speed;
      vy = Math.sin(angleToPlayer) * def.speed;
    } else if (dist < def.preferredRange * 0.7) {
      vx = -Math.cos(angleToPlayer) * def.speed * 0.6;
      vy = -Math.sin(angleToPlayer) * def.speed * 0.6;
    }
    this.sprite.setVelocity(vx, vy);
    this.sprite.setFlipX(Math.cos(angleToPlayer) < 0);

    if (dist <= def.preferredRange * 1.4 && time - this.lastFireAt >= def.fireRateMs) {
      this.lastFireAt = time;
      this.scene.spawnEnemyProjectile(this.x, this.y, angleToPlayer, def.projectileDamage, def.projectileSpeed);
    }
  }

  _updateBoss(time, player, dist, angleToPlayer) {
    const def = this.def;

    if (this.slamState === 'telegraph') {
      this.sprite.setVelocity(0, 0);
      if (time >= this.slamTelegraphEndsAt) {
        this.slamState = 'idle';
        const d = Phaser.Math.Distance.Between(this.x, this.y, player.sprite.x, player.sprite.y);
        if (d <= def.slamRadiusPx) player.takeDamage(def.slamDamage);
        this.scene.spawnSlamShockwave(this.x, this.y, def.slamRadiusPx);
      }
      return;
    }

    let vx = 0, vy = 0;
    if (dist > def.preferredRange) {
      vx = Math.cos(angleToPlayer) * def.speed;
      vy = Math.sin(angleToPlayer) * def.speed;
    }
    this.sprite.setVelocity(vx, vy);
    this.sprite.setFlipX(Math.cos(angleToPlayer) < 0);

    if (dist <= def.slamRadiusPx * 0.9 && time - this.lastSlamAt >= def.slamCooldownMs) {
      this.lastSlamAt = time;
      this.slamState = 'telegraph';
      this.slamTelegraphEndsAt = time + def.slamTelegraphMs;
      this.scene.spawnSlamTelegraph(this.x, this.y, def.slamRadiusPx, def.slamTelegraphMs);
      return;
    }

    if (dist <= def.preferredRange * 1.3 && time - this.lastFireAt >= def.fireRateMs) {
      this.lastFireAt = time;
      this.scene.spawnEnemyProjectile(this.x, this.y, angleToPlayer, def.projectileDamage, def.projectileSpeed);
    }
  }
}
