// Picks N distinct random upgrades from the pool for a level-up choice.
const UpgradeSystem = {
  pickChoices(count) {
    const pool = [...BALANCE.upgrades];
    Phaser.Utils.Array.Shuffle(pool);
    return pool.slice(0, count);
  },

  pickChestPickup() {
    const pool = BALANCE.chestPickups;
    return pool[Phaser.Math.Between(0, pool.length - 1)];
  },
};
