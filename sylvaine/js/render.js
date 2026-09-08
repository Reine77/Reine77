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
   ============================================================= */
(function (root) {
  'use strict';

  var Sylvaine = (root.Sylvaine = root.Sylvaine || {});

  function makeRenderer(state) {
    var Stats = Sylvaine.Stats;
    var Runes = Sylvaine.Runes;
    var Items = Sylvaine.Items;

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
