// Player mecha: movement, auto-targeting weapon, HP/XP/leveling state, buffs.
class Player {
  constructor(scene, x, y) {
    this.scene = scene;
    this.sprite = scene.physics.add.sprite(x, y, 'player_mecha');
    this.sprite.setDepth(10);
    this.sprite.body.setSize(56, 70).setOffset(36, 46);
    this.sprite.owner = this;

    this.stats = {
      maxHp: BALANCE.player.startHp,
      speedMult: 1,
      damageMult: 1,
      fireRateMult: 1,
      rangeMult: 1,
      pickupRadiusMult: 1,
      projectileCount: 1,
      regen: 0,
    };
    this._buffs = []; // { stat, factorApplied, expiresAt }

    this.hp = this.stats.maxHp;
    this.level = 1;
    this.xp = 0;
    this.xpToNext = BALANCE.player.xpToLevel(this.level);
    this.kills = 0;

    this.invulnUntil = 0;
    this.lastShotAt = 0;
    this.dead = false;

    this._regenAccum = 0;
  }

  get moveSpeed() { return BALANCE.player.speed * this.stats.speedMult; }
  get damage() { return BALANCE.player.baseDamage * this.stats.damageMult; }
  get fireRateMs() { return Math.max(80, BALANCE.player.baseFireRateMs * this.stats.fireRateMult); }
  get range() { return BALANCE.player.baseRangePx * this.stats.rangeMult; }
  get pickupRadius() { return BALANCE.player.pickupRadius * this.stats.pickupRadiusMult; }
  get isInvulnerable() { return this.scene.time.now < this.invulnUntil; }

  setInvulnFor(ms) {
    this.invulnUntil = Math.max(this.invulnUntil, this.scene.time.now + ms);
  }

  addTimedBuff(stat, factor, durationMs) {
    this.stats[stat] *= factor;
    this._buffs.push({ stat, factor, expiresAt: this.scene.time.now + durationMs });
  }

  handleMovement(cursors, wasd) {
    if (this.dead) return;
    const body = this.sprite.body;
    let vx = 0, vy = 0;
    if (cursors.left.isDown || wasd.left.isDown) vx -= 1;
    if (cursors.right.isDown || wasd.right.isDown) vx += 1;
    if (cursors.up.isDown || wasd.up.isDown) vy -= 1;
    if (cursors.down.isDown || wasd.down.isDown) vy += 1;

    if (vx !== 0 || vy !== 0) {
      const len = Math.hypot(vx, vy);
      vx = (vx / len) * this.moveSpeed;
      vy = (vy / len) * this.moveSpeed;
      if (vx !== 0) this.sprite.setFlipX(vx < 0);
    }
    body.setVelocity(vx, vy);
  }

  findNearestEnemy(enemies) {
    let best = null;
    let bestDist = this.range;
    enemies.getChildren().forEach((s) => {
      if (!s.active || !s.owner || s.owner.dead) return;
      const d = Phaser.Math.Distance.Between(this.sprite.x, this.sprite.y, s.x, s.y);
      if (d <= bestDist) { bestDist = d; best = s; }
    });
    return best;
  }

  tryFire(time, enemies) {
    if (this.dead) return;
    if (time - this.lastShotAt < this.fireRateMs) return;
    const target = this.findNearestEnemy(enemies);
    if (!target) return;
    this.lastShotAt = time;

    const baseAngle = Phaser.Math.Angle.Between(this.sprite.x, this.sprite.y, target.x, target.y);
    const count = this.stats.projectileCount;
    const spread = Phaser.Math.DegToRad(12);
    for (let i = 0; i < count; i++) {
      const offset = count === 1 ? 0 : (i - (count - 1) / 2) * spread;
      this.scene.spawnPlayerProjectile(this.sprite.x, this.sprite.y, baseAngle + offset, this.damage);
    }
  }

  takeDamage(amount) {
    if (this.dead || this.isInvulnerable) return;
    this.hp -= amount;
    this.setInvulnFor(BALANCE.player.invulnMs);
    this.sprite.setTintFill(0xffffff);
    this.scene.time.delayedCall(80, () => { if (this.sprite.active) this.sprite.clearTint(); });
    if (this.hp <= 0) {
      this.hp = 0;
      this.dead = true;
      this.scene.onPlayerDeath();
    }
  }

  gainXp(amount) {
    if (this.dead) return;
    this.xp += amount;
    while (this.xp >= this.xpToNext) {
      this.xp -= this.xpToNext;
      this.level += 1;
      this.xpToNext = BALANCE.player.xpToLevel(this.level);
      this.scene.onLevelUp();
    }
  }

  update(time, delta) {
    if (this.dead) return;

    if (this._buffs.length) {
      this._buffs = this._buffs.filter((b) => {
        if (time >= b.expiresAt) { this.stats[b.stat] /= b.factor; return false; }
        return true;
      });
    }

    if (this.stats.regen > 0 && this.hp < this.stats.maxHp) {
      this._regenAccum += this.stats.regen * (delta / 1000);
      if (this._regenAccum >= 1) {
        const whole = Math.floor(this._regenAccum);
        this.hp = Math.min(this.stats.maxHp, this.hp + whole);
        this._regenAccum -= whole;
      }
    }

    this.sprite.setAlpha(this.isInvulnerable ? (Math.floor(time / 80) % 2 === 0 ? 0.4 : 0.85) : 1);
  }
}
