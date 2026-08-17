// Time-based wave spawner. Regular waves spawn on independent per-type
// timers until their duration elapses; the final wave spawns a single boss
// and only advances (finishing the level) when the scene reports the boss
// dead via notifyBossDefeated().
class WaveManager {
  constructor(scene) {
    this.scene = scene;
    this.waveIndex = -1;
    this.currentWave = null;
    this.timers = [];
    this.waveEndAt = 0;
    this.isBossWave = false;
    this.bossSpawned = false;
    this.finished = false;
    this.totalWaves = BALANCE.waves.length;
  }

  start() { this._advanceWave(); }

  _advanceWave() {
    this.waveIndex += 1;
    if (this.waveIndex >= BALANCE.waves.length) {
      this.finished = true;
      this.scene.onAllWavesCleared();
      return;
    }
    const wave = BALANCE.waves[this.waveIndex];
    this.currentWave = wave;
    if (wave.boss) {
      this.isBossWave = true;
      this.bossSpawned = false;
    } else {
      this.isBossWave = false;
      this.waveEndAt = this.scene.time.now + wave.durationMs;
      this.timers = wave.spawns.map((s) => ({ ...s, nextAt: this.scene.time.now + 350 }));
    }
    this.scene.onWaveStart(this.waveIndex, wave);
  }

  update(time) {
    if (this.finished) return;
    if (this.isBossWave) {
      if (!this.bossSpawned) {
        this.bossSpawned = true;
        this.scene.spawnEnemyAroundPlayer(this.currentWave.boss);
      }
      return;
    }
    this.timers.forEach((t) => {
      if (time >= t.nextAt) {
        t.nextAt = time + t.everyMs;
        this.scene.spawnEnemyAroundPlayer(t.type);
      }
    });
    if (time >= this.waveEndAt) this._advanceWave();
  }

  get waveTimeRemainingMs() {
    if (this.isBossWave) return 0;
    return Math.max(0, this.waveEndAt - this.scene.time.now);
  }

  notifyBossDefeated() {
    this._advanceWave();
  }
}

// Spawns power-up chests in the world at a fixed cadence, capped at a max
// alive count, at a random spot in an annulus around the player (never on
// top of them, never off past the world edge).
class ChestSpawner {
  constructor(scene) {
    this.scene = scene;
    this.nextSpawnAt = scene.time.now + BALANCE.chests.firstDelayMs;
  }

  update(time, aliveCount) {
    if (aliveCount >= BALANCE.chests.maxAlive) return;
    if (time < this.nextSpawnAt) return;
    this.nextSpawnAt = time + BALANCE.chests.spawnEveryMs;
    this.scene.spawnChestNearPlayer();
  }
}
