/* =============================================================
   render.js — reads game state, writes DOM. Never the reverse.
   -------------------------------------------------------------
   This is the "rendering" half of "game state/logic separate
   from rendering." The rule this file follows everywhere:

     - it may READ anything on `state`
     - it may CALL a module's public action function in response
       to a click (Runes.purchase) — that's the same action a
       console command already triggers, just wired to a button
       instead of a devtools call. The RULES for that action
       (cost, prereqs, mods) still live entirely in runes.js.
     - it never reaches into `state` and mutates a field directly

   loop.js calls update(state, dt) once per frame (see main.js
   wiring it in as the loop's onFrame callback). Everything here
   is written to be cheap enough to run 60-144 times a second:
   text/width updates on elements built ONCE at init, not
   innerHTML rebuilds — except the combat log, which only
   rebuilds when state.log.totalPushed says a new line actually
   arrived (see log.js's comment on why that field exists).

   COMPANION / PET SLOTS
     Those two boxes in #supportRow are visual placeholders only
     — reserved layout, no data behind them. They're not part of
     the current spec; see the README's roadmap for where they're
     planned as their own future phases.

  SPRITES (Phase 5)
     Two different mechanisms, because the two kinds of "art" work
     completely differently:

     - The HERO is a state machine over four fixed files
       (idle/attack/hurt/spell), driven by game.js's EVENTS
       (heroAttack, heroSpell, heroDamaged, retreat). Swap the
       image, start a revert timer back to idle (~200ms per the
       spec), and a newer event always wins over a pending revert.

     - ENEMIES are one static file per current enemy, chosen once
       per 'spawn' event (not every frame — the enemy doesn't
       change sprite between spawns). Higher tiers are the SAME
       file with a CSS hue-rotate filter applied via inline style
       (see enemies.js's `treatments`), so 20+ variants reuse 6
       base images with zero extra art. All enemy feedback (hit,
       death, attack-tell) is CSS on that one image, never a
       second sprite — exactly per the spec.

     GRACEFUL DEGRADATION: most of the roster won't have a real
     PNG for a while (this project's art gets added by hand over
     time). Every <img> here defaults to invisible and only gets
     the `.loaded` class on a real `load` event; an `error` event
     (missing file) reveals the pre-Phase-5 placeholder text
     instead of a broken-image icon. The whole animation system
     above still runs identically either way — it just has nothing
     visible to swap between until a file exists.
   ============================================================= */
(function (root) {
  'use strict';

  var Sylvaine = (root.Sylvaine = root.Sylvaine || {});

  var SPRITE_PATH = 'assets/sprites/';

  // How long a non-idle hero sprite (attack/hurt/spell) holds
  // before reverting to idle. Matches the spec's "~200ms" pattern.
  var HERO_STATE_MS = 200;
  var HIT_FLASH_MS = 80;   // enemy brightness spike duration
  var LUNGE_MS = 90;       // enemy attack-tell hold time

  var HERO_SPRITES = {
    idle:   SPRITE_PATH + 'sylvaine_idle.png',
    attack: SPRITE_PATH + 'sylvaine_attack.png',
    hurt:   SPRITE_PATH + 'sylvaine_hurt.png',
    spell:  SPRITE_PATH + 'sylvaine_spell.png'
  };

  function makeRenderer(state) {
    var Stats = Sylvaine.Stats;
    var Runes = Sylvaine.Runes;
    var Items = Sylvaine.Items;
    var Game  = Sylvaine.Game;

    // ---- grab every element we'll touch, once ----
    var el = {
      statusLine:  document.getElementById('statusLine'),
      stage:       document.getElementById('stageValue'),
      gold:        document.getElementById('goldValue'),
      level:       document.getElementById('levelValue'),
      xpFill:      document.getElementById('xpFill'),
      xpText:      document.getElementById('xpText'),

      heroHpFill:  document.getElementById('heroHpFill'),
      heroHpText:  document.getElementById('heroHpText'),

      heroPortrait: document.getElementById('heroPortrait'),
      heroSprite:   document.getElementById('heroSprite'),
      swordTrail:   document.getElementById('swordTrail'),

      enemyPortrait: document.getElementById('enemyPortrait'),
      enemySprite:   document.getElementById('enemySprite'),
      enemyName:     document.getElementById('enemyName'),
      enemyBoss:     document.getElementById('enemyBoss'),
      enemyHpFill:   document.getElementById('enemyHpFill'),
      enemyHpText:   document.getElementById('enemyHpText'),
      enemySubstats: document.getElementById('enemySubstats'),

      statDamage:  document.getElementById('statDamage'),
      statSpeed:   document.getElementById('statSpeed'),
      statCrit:    document.getElementById('statCrit'),
      statDps:     document.getElementById('statDps'),
      statSpell:   document.getElementById('statSpell'),
      gearLine:    document.getElementById('gearLine'),

      runeList:    document.getElementById('runeList'),
      logList:     document.getElementById('logList')
    };

    var lastPushCount = -1; // -1 forces an initial render even if the log is empty
    var runeRows = {};      // id -> { row, button, status } built once, updated in place

    buildRuneList();
    setupImageFallback(el.heroSprite, el.heroPortrait);
    setupImageFallback(el.enemySprite, el.enemyPortrait);
    setupImageFallback(el.swordTrail, null); // trail has no fallback text to reveal

    // ---- graceful degradation: missing file -> old placeholder --
    // `parentPortrait` is null for the sword trail, which has no
    // fallback text of its own to show/hide — a missing trail file
    // just means no trail effect, not a broken layout.
    function setupImageFallback(img, parentPortrait) {
      img.addEventListener('load', function () {
        img.classList.add('loaded');
        if (parentPortrait) parentPortrait.classList.add('has-sprite');
      });
      img.addEventListener('error', function () {
        img.classList.remove('loaded');
        if (parentPortrait) parentPortrait.classList.remove('has-sprite');
      });
    }

    /* =========================================================
       HERO SPRITE STATE MACHINE
       ========================================================= */
    var heroState = 'idle';
    var heroRevertTimer = null;

    function setHeroSprite(nextState) {
      if (heroRevertTimer) { clearTimeout(heroRevertTimer); heroRevertTimer = null; }

      if (nextState !== heroState) {
        heroState = nextState;
        el.heroSprite.src = HERO_SPRITES[nextState];
      }

      if (nextState !== 'idle') {
        heroRevertTimer = setTimeout(function () {
          heroState = 'idle';
          el.heroSprite.src = HERO_SPRITES.idle;
          heroRevertTimer = null;
        }, HERO_STATE_MS);
      }
    }

    function flashSwordTrail() {
      // Snap to visible immediately (no fade-in — the swing itself
      // is the "in"), then let the CSS `transition: opacity` on
      // .sword-trail carry it back down to 0 once we flip the
      // style a tick later. Two separate style writes across a
      // frame boundary is what makes a CSS transition actually
      // animate instead of jumping straight to the end value.
      el.swordTrail.style.transition = 'none';
      el.swordTrail.style.opacity = '1';
      // Force layout so the browser commits opacity:1 before we
      // re-enable the transition and drop back to 0 — otherwise
      // both style changes can get batched into one paint and the
      // trail never visibly appears.
      void el.swordTrail.offsetWidth;
      el.swordTrail.style.transition = '';
      el.swordTrail.style.opacity = '0';
    }

    /* =========================================================
       ENEMY SPRITE: one static file, chosen on spawn; hit/death/
       attack-tell are all CSS on that same image, per the spec.
       ========================================================= */
    var enemyBaseFilter = 'none';
    var enemyHitFlashTimer = null;
    var enemyLungeTimer = null;

    function onEnemySpawn(enemy) {
      // A fresh enemy cancels any leftover animation from the
      // previous one — without this, a death-fade timer from the
      // enemy that just died could fire AFTER the next enemy has
      // already spawned and hide it too.
      if (enemyHitFlashTimer) { clearTimeout(enemyHitFlashTimer); enemyHitFlashTimer = null; }
      if (enemyLungeTimer) { clearTimeout(enemyLungeTimer); enemyLungeTimer = null; }
      el.enemyPortrait.classList.remove('dying', 'lunge');
      el.enemyPortrait.style.transform = '';

      enemyBaseFilter = enemy.art.filter || 'none';
      el.enemySprite.style.filter = enemyBaseFilter;
      el.enemySprite.style.transform = 'scale(' + enemy.art.scale + ')';
      el.enemySprite.classList.remove('loaded'); // re-arm the fallback until THIS file loads
      el.enemySprite.src = SPRITE_PATH + enemy.art.sprite;
    }

    function hitFlashEnemy() {
      if (enemyHitFlashTimer) clearTimeout(enemyHitFlashTimer);
      el.enemySprite.style.filter =
        (enemyBaseFilter === 'none' ? '' : enemyBaseFilter + ' ') + 'brightness(3)';
      enemyHitFlashTimer = setTimeout(function () {
        el.enemySprite.style.filter = enemyBaseFilter;
        enemyHitFlashTimer = null;
      }, HIT_FLASH_MS);
    }

    function lungeEnemy() {
      if (enemyLungeTimer) clearTimeout(enemyLungeTimer);
      el.enemyPortrait.classList.add('lunge');
      enemyLungeTimer = setTimeout(function () {
        el.enemyPortrait.classList.remove('lunge');
        enemyLungeTimer = null;
      }, LUNGE_MS);
    }

    function playEnemyDeath() {
      el.enemyPortrait.classList.add('dying');
    }

    /* =========================================================
       Wire it all to the game's own events (planted in Phase 1's
       game.js specifically so later phases could hook them without
       touching combat code — see game.js's `emit` calls).
       ========================================================= */
    Game.on(state, 'heroAttack', function () {
      setHeroSprite('attack');
      flashSwordTrail();
    });
    Game.on(state, 'heroSpell', function () {
      setHeroSprite('spell');
    });
    Game.on(state, 'heroDamaged', function () {
      // Same moment, two effects: she flinches AND the enemy that
      // just hit her gets the attack-tell lunge. There's no
      // separate 'enemyAttack' event — heroDamaged only fires as a
      // direct result of one, so it's the correct single hook for
      // both sides of that exchange.
      setHeroSprite('hurt');
      lungeEnemy();
    });
    Game.on(state, 'retreat', function () {
      // Per the spec: reuse the hurt sprite plus a brief fade/dim
      // rather than a separate "defeated" sprite. She's falling
      // back to farm, not dying — there is no death art and no
      // game-over state.
      setHeroSprite('hurt');
      el.heroPortrait.classList.add('dimmed');
    });
    Game.on(state, 'spawn', function (enemy) {
      onEnemySpawn(enemy);
      el.heroPortrait.classList.remove('dimmed'); // the retreat pause is over; fighting resumes
    });
    Game.on(state, 'enemyDamaged', function () {
      hitFlashEnemy();
    });
    Game.on(state, 'enemyKilled', function () {
      playEnemyDeath();
    });

    function buildRuneList() {
      // Guards against S.reset(): makeRenderer() runs again with a
      // fresh state, and without this the old run's 10 rows would
      // still be sitting in the DOM when the new 10 get appended.
      el.runeList.innerHTML = '';
      runeRows = {};

      Runes.NODES.forEach(function (node) {
        var row = document.createElement('div');
        row.className = 'rune-row branch-' + node.branch;

        var branch = document.createElement('span');
        branch.className = 'rune-branch';
        branch.textContent = node.branch;

        var name = document.createElement('span');
        name.className = 'rune-name';
        name.textContent = node.name +
          (node.requires.length ? ' (needs ' + node.requires.join(', ') + ')' : '');

        var cost = document.createElement('span');
        cost.className = 'rune-cost';
        cost.textContent = node.cost + 'g';

        var status = document.createElement('span');
        status.className = 'rune-status';

        var button = document.createElement('button');
        button.textContent = 'Buy';
        button.addEventListener('click', function () {
          // The click's whole job is to forward to the same public
          // action a console command already uses. Every rule about
          // whether this is ALLOWED lives in runes.js, not here.
          Runes.purchase(state, node.id);
        });

        row.appendChild(branch);
        row.appendChild(name);
        row.appendChild(cost);
        row.appendChild(status);
        row.appendChild(button);
        el.runeList.appendChild(row);

        runeRows[node.id] = { row: row, button: button, status: status };
      });
    }

    function updateRuneList(hero) {
      Runes.NODES.forEach(function (node) {
        var refs = runeRows[node.id];
        var owned = Runes.isOwned(hero, node.id);

        refs.row.classList.toggle('owned', owned);

        if (owned) {
          refs.status.textContent = 'owned';
          refs.button.disabled = true;
          refs.button.textContent = 'Owned';
        } else {
          var check = Runes.canPurchase(hero, node.id);
          refs.status.textContent = check.ok ? 'ready' : check.reason;
          refs.button.disabled = !check.ok;
          refs.button.textContent = 'Buy';
        }
      });
    }

    // Only rebuilds when state.log.totalPushed has actually moved —
    // see log.js's header comment for why that's the right signal
    // instead of entries.length (which stops growing once capped).
    function updateLog() {
      if (state.log.totalPushed === lastPushCount) return;
      lastPushCount = state.log.totalPushed;

      var entries = state.log.entries;
      var start = Math.max(0, entries.length - 100); // show at most the newest 100
      var frag = document.createDocumentFragment();

      for (var i = start; i < entries.length; i++) {
        var entry = entries[i];
        var line = document.createElement('div');
        line.className = 'log-line kind-' + entry.kind;
        var stamp = entry.time.toFixed(1);
        line.textContent = '[' + stamp + 's] ' + entry.text;
        frag.appendChild(line);
      }

      el.logList.innerHTML = '';
      el.logList.appendChild(frag);
      el.logList.scrollTop = el.logList.scrollHeight;
    }

    function update() {
      var hero = state.hero;
      var s = Stats.computeStats(hero);

      // ---- top bar ----
      el.stage.textContent = state.stage;
      el.gold.textContent = Math.round(hero.gold);
      el.level.textContent = hero.level;
      var xpPct = Math.min(100, (hero.xp / hero.xpToNext) * 100);
      el.xpFill.style.width = xpPct + '%';
      el.xpText.textContent = Math.floor(hero.xp) + ' / ' + hero.xpToNext + ' XP';

      if (state.farming) {
        el.statusLine.textContent = 'Farming stage ' + state.stage +
          ' — blocked at stage ' + state.blockedStage;
        el.statusLine.classList.add('farming');
      } else {
        el.statusLine.textContent = 'Climbing — stage ' + state.stage;
        el.statusLine.classList.remove('farming');
      }

      // ---- hero panel ----
      var heroHpPct = Math.max(0, Math.min(100, (hero.hp / s.maxHp) * 100));
      el.heroHpFill.style.width = heroHpPct + '%';
      el.heroHpText.textContent = Math.max(0, Math.round(hero.hp)) + ' / ' + Math.round(s.maxHp);

      // ---- enemy panel ----
      // Note: the boss badge toggles via a CSS CLASS (.visible),
      // not the `hidden` attribute — see style.css's comment. Using
      // `hidden` here would collapse the badge's row to zero height
      // whenever the enemy isn't a boss (i.e. almost always), which
      // is exactly the misalignment this whole structure exists to
      // prevent.
      var enemy = state.enemy;
      if (enemy) {
        el.enemyName.textContent = enemy.name;
        el.enemyBoss.classList.toggle('visible', enemy.isBoss);
        var enemyHpPct = Math.max(0, Math.min(100, (enemy.hp / enemy.maxHp) * 100));
        el.enemyHpFill.style.width = enemyHpPct + '%';
        el.enemyHpText.textContent = Math.max(0, Math.round(enemy.hp)) + ' / ' + enemy.maxHp;
        el.enemySubstats.textContent = 'dmg ' + enemy.damage.toFixed(1) +
          ' · spd ' + enemy.attackSpeed.toFixed(2) + '/s';
      } else {
        el.enemyName.textContent = state.phase === 'retreating' ? 'Retreating…' : '…';
        el.enemyBoss.classList.remove('visible');
        el.enemyHpFill.style.width = '0%';
        el.enemyHpText.textContent = '';
        el.enemySubstats.textContent = '';
      }

      // ---- hero stats ----
      el.statDamage.textContent = s.damage.toFixed(1);
      el.statSpeed.textContent = s.attackSpeed.toFixed(2) + '/s';
      el.statCrit.textContent = (s.critChance * 100).toFixed(1) + '% x' + s.critMult.toFixed(2);
      el.statDps.textContent = Math.round(Sylvaine.Game.heroDps(state));
      el.statSpell.textContent = hero.spellUnlocked
        ? s.spellPower.toFixed(1) + ' pwr / ' + s.spellCooldown.toFixed(1) + 's cd'
        : 'locked';

      var eq = hero.equipped;
      el.gearLine.innerHTML = 'Weapon: <span class="item-name">' +
        (eq.weapon ? eq.weapon.name : 'none') + '</span> &nbsp; Armor: <span class="item-name">' +
        (eq.armor ? eq.armor.name : 'none') + '</span>';

      updateRuneList(hero);
      updateLog();
    }

    return { update: update };
  }

  Sylvaine.makeRenderer = makeRenderer;
})(typeof globalThis !== 'undefined' ? globalThis : this);
