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

  // How long a SINGLE-FRAME hero state (still attack/spell — see
  // HERO_ANIM's comment) holds before reverting to idle. Matches the
  // spec's original "~200ms" pattern.
  var HERO_STATE_MS = 200;
  var HIT_FLASH_MS = 80;   // enemy brightness spike duration
  var LUNGE_MS = 90;       // enemy attack-tell hold time

  // Build ['prefix_1.png', 'prefix_2.png', ...] — the naming
  // convention every multi-frame hero sheet uses once sliced.
  function frameSet(prefix, count) {
    var out = [];
    for (var i = 1; i <= count; i++) out.push(SPRITE_PATH + prefix + '_' + i + '.png');
    return out;
  }

  // Every hero state is a LIST OF VARIANTS (usually one), each
  // variant a list of one-or-more frames. One shape covers both
  // "4-frame animation" and "single static image" — a single-frame
  // variant just has nothing to step through, so the exact same
  // player code (playHeroFrames, below) handles both without a
  // special case. `attack` having 3 variants is what "rng whichever
  // attack1/2/3" turns into: setHeroSprite picks one at random each
  // time, per the same "render code must never touch state.rng"
  // rule the boss-token/canWin probes already established — this is
  // pure presentation, not anything that should perturb a seeded run.
  //
  // attack/spell are still single-frame, not the 4-frame sheets they
  // could be: those source sheets came back as flat RGB with no
  // alpha channel at all (a near-white, not-quite-uniform background
  // baked into the pixels), unlike idle/hurt which had real
  // transparency. Shipping them as-is would flash a visible pale box
  // behind her on every attack/cast — worse than today's single
  // clean image — so they stay on the old files until re-exported
  // with real alpha. See assets/sprites/README.md.
  var HERO_ANIM = {
    idle: { variants: [frameSet('sylvaine_idle', 4)], loop: true, frameMs: 260 },
    hurt: { variants: [frameSet('sylvaine_hurt', 4)], loop: false, frameMs: 70 },
    attack: {
      variants: [[SPRITE_PATH + 'sylvaine_attack.png']],
      loop: false, frameMs: HERO_STATE_MS
    },
    spell: {
      variants: [[SPRITE_PATH + 'sylvaine_spell.png']],
      loop: false, frameMs: HERO_STATE_MS
    }
  };

  function makeRenderer(state) {
    var CONFIG = Sylvaine.CONFIG;
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
      enemyTags:     document.getElementById('enemyTags'),

      statDamage:  document.getElementById('statDamage'),
      statAttackAttr: document.getElementById('statAttackAttr'),
      statSpeed:   document.getElementById('statSpeed'),
      statCrit:    document.getElementById('statCrit'),
      statDps:     document.getElementById('statDps'),
      statSpell:   document.getElementById('statSpell'),
      statEvade:   document.getElementById('statEvade'),
      statReduc:   document.getElementById('statReduc'),
      statHeal:    document.getElementById('statHeal'),

      farmStatus:  document.getElementById('farmStatus'),
      farmInput:   document.getElementById('farmInput'),
      farmSet:     document.getElementById('farmSet'),
      farmClear:   document.getElementById('farmClear'),
      farmHint:    document.getElementById('farmHint'),

      tokenLine:   document.getElementById('tokenLine'),
      bossSelect:  document.getElementById('bossSelect'),
      bossGo:      document.getElementById('bossGo'),
      bossHint:    document.getElementById('bossHint'),

      runeTree:      document.getElementById('runeTree'),
      runeTreeLines: document.getElementById('runeTreeLines'),
      logList:     document.getElementById('logList'),

      equippedList:    document.getElementById('equippedList'),
      autoSellCommon:  document.getElementById('autoSellCommon'),
      autoSellRare:    document.getElementById('autoSellRare'),
      autoSellEpic:    document.getElementById('autoSellEpic'),
      inventoryCount:  document.getElementById('inventoryCount'),
      inventoryList:   document.getElementById('inventoryList')
    };

    var lastPushCount = -1; // -1 forces an initial render even if the log is empty
    var runeRows = {};      // id -> { row, button, status } built once, updated in place
    var runeLines = [];     // { fromId, toId, el } built once, colored in place
    var lastInventorySig = null; // forces an initial inventory render

    /* ---- The tree's actual shape ------------------------------
       (x, y) in a 0-100 coordinate space, matching the SVG overlay's
       viewBox exactly — so a node's CSS `left/top` percentage and
       its prerequisite lines' endpoints are always the same numbers,
       no unit conversion needed anywhere.

       Physical (left) and magic (right) are each drawn as a small
       diamond: one trunk node forks into two, which reconverge at
       an elemental capstone — literally the branch/reconverge shape
       runes.js's own comment describes. Hybrid sits in the middle,
       bridging the two branches at the tiers its `requires` actually
       reference, so its position tells the truth about what it needs.
       This is hand-authored, not computed from `requires` — a real
       force-directed layout would be overkill for a fixed 14-node
       tree that only changes when someone edits runes.js by hand.

       Declared HERE (before buildRuneTree() is called below), not
       next to the function that reads it — a `var` at that point in
       the file would be hoisted-but-still-undefined at call time,
       since assignment happens in source order regardless of hoisting.
       Caught this exact bug once already: moving it up here is the
       fix, not a stylistic preference. */
    var RUNE_LAYOUT = {
      phys_1: { x: 20, y: 8 },
      phys_2: { x: 8,  y: 34 },
      phys_3: { x: 32, y: 34 },
      phys_4: { x: 8,  y: 60 },
      phys_5: { x: 32, y: 60 },
      phys_6: { x: 20, y: 86 },

      magic_1: { x: 80, y: 8 },
      magic_2: { x: 68, y: 34 },
      magic_3: { x: 92, y: 34 },
      magic_4: { x: 68, y: 60 },
      magic_5: { x: 92, y: 60 },
      magic_6: { x: 80, y: 86 },

      hybrid_1: { x: 50, y: 34 },
      hybrid_2: { x: 50, y: 68 }
    };

    buildRuneTree();
    wireFarmControls();
    wireBossControls();
    wireAutoSellControls();
    wireWindows();
    setupImageFallback(el.heroSprite, el.heroPortrait);
    setupImageFallback(el.enemySprite, el.enemyPortrait);
    setupImageFallback(el.swordTrail, null); // trail has no fallback text to reveal
    // flashSwordTrail() (below) has to know whether there's actually
    // anything to flash — without this, it would flip the trail's
    // opacity to 1 on every single attack even with no file loaded,
    // briefly showing the browser's broken-image glyph instead of a
    // trail effect. Starts false; a real file existing is what turns
    // it on, same "art enables the effect, its absence just does
    // nothing" rule this whole sprite system already follows.
    var trailReady = false;
    el.swordTrail.addEventListener('load', function () { trailReady = true; });
    el.swordTrail.addEventListener('error', function () { trailReady = false; });

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
       POPUP WINDOWS (nav buttons -> Map/Quest/Inventory/Runes/Log)
       -------------------------------------------------------
       Each window is toggled open/closed by its nav button and can
       be dragged by its header. All five share the same wiring —
       there's no per-window special case here, which is what keeps
       adding a 6th window later a one-line addition (one more
       `.window`/`.nav-btn` pair in the HTML, nothing new in JS).

       "Bring to front" is a single shared counter rather than a
       real window-manager stacking model: every focus (open, drag
       start, or a click anywhere on the window) bumps it to a new
       highest z-index. That's the entire ordering rule, and it's
       enough — this is 5 fixed popups, not an OS.               */
    function wireWindows() {
      var topZ = 100;
      function bringToFront(win) {
        topZ += 1;
        win.style.zIndex = topZ;
      }

      document.querySelectorAll('.nav-btn').forEach(function (btn) {
        var win = document.getElementById(btn.dataset.window);
        btn.addEventListener('click', function () {
          var opening = !win.classList.contains('open');
          win.classList.toggle('open', opening);
          btn.classList.toggle('active', opening);
          if (opening) bringToFront(win);
        });
      });

      document.querySelectorAll('.window-close').forEach(function (closeBtn) {
        closeBtn.addEventListener('click', function () {
          var win = document.getElementById(closeBtn.dataset.close);
          win.classList.remove('open');
          var navBtn = document.querySelector('.nav-btn[data-window="' + win.id + '"]');
          if (navBtn) navBtn.classList.remove('active');
        });
      });

      document.querySelectorAll('.window').forEach(function (win) {
        // Any click on the window (not just the header) brings it
        // forward — the header is still the only DRAG handle, this
        // is purely about stacking order.
        win.addEventListener('mousedown', function () { bringToFront(win); });
        makeWindowDraggable(win, win.querySelector('.window-header'));
      });
    }

    // Plain mouse-event dragging — no library, matching this
    // project's "vanilla, no dependencies" rule. Switches the
    // window from its CSS-authored `top/right` default to explicit
    // `top/left` pixel coordinates the moment a drag starts, and
    // clamps to the viewport so a window can never be dragged
    // somewhere the player can't get back to (there's no "reset
    // window positions" button, so losing one off-screen would be
    // a real dead end, not just a visual glitch).
    function makeWindowDraggable(win, handle) {
      var dragging = false;
      var offsetX = 0;
      var offsetY = 0;

      handle.addEventListener('mousedown', function (e) {
        dragging = true;
        var rect = win.getBoundingClientRect();
        offsetX = e.clientX - rect.left;
        offsetY = e.clientY - rect.top;
        // Hand off from the CSS default (top/right) to an explicit
        // pixel position pinned to where it visually already is,
        // so the first drag frame doesn't jump.
        win.style.left = rect.left + 'px';
        win.style.top = rect.top + 'px';
        win.style.right = 'auto';
        e.preventDefault();
      });

      window.addEventListener('mousemove', function (e) {
        if (!dragging) return;
        var maxLeft = window.innerWidth - win.offsetWidth;
        var maxTop = window.innerHeight - win.offsetHeight;
        var left = Math.min(Math.max(0, e.clientX - offsetX), Math.max(0, maxLeft));
        var top = Math.min(Math.max(0, e.clientY - offsetY), Math.max(0, maxTop));
        win.style.left = left + 'px';
        win.style.top = top + 'px';
      });

      window.addEventListener('mouseup', function () { dragging = false; });
    }

    /* =========================================================
       HERO SPRITE STATE MACHINE
       -------------------------------------------------------
       Two timers, same "a newer event always wins" rule the old
       single-image version had, extended to frame stepping:
         - heroFrameTimer: setInterval that steps through the
           CURRENTLY PLAYING variant's frames (idle loops forever;
           attack/hurt/spell play once and stop).
         - heroRevertTimer: setTimeout that fires once a non-looping
           animation's last frame has held for its frameMs, and
           returns to idle. (A single-frame variant — today's
           attack/spell — has no interval at all; this timer alone
           is what "holds HERO_STATE_MS then reverts" for those.)
       Both are real wall-clock timers, independent of game.step's
       dt, matching every other visual-only timer in this file
       (flashSwordTrail, hitFlashEnemy, lungeEnemy).
       ========================================================= */
    var heroState = 'idle';
    var heroFrameTimer = null;
    var heroRevertTimer = null;

    function stopHeroTimers() {
      if (heroFrameTimer) { clearInterval(heroFrameTimer); heroFrameTimer = null; }
      if (heroRevertTimer) { clearTimeout(heroRevertTimer); heroRevertTimer = null; }
    }

    function setHeroSprite(nextState) {
      stopHeroTimers();
      heroState = nextState;

      var anim = HERO_ANIM[nextState];
      // rng, not state.rng — this is presentation only (which of 3
      // near-identical attack flourishes plays), never anything a
      // seeded run's outcome should depend on.
      var frames = anim.variants.length > 1
        ? anim.variants[Math.floor(Math.random() * anim.variants.length)]
        : anim.variants[0];

      var frameIdx = 0;
      el.heroSprite.src = frames[frameIdx];

      if (frames.length > 1) {
        heroFrameTimer = setInterval(function () {
          frameIdx++;
          if (frameIdx >= frames.length) {
            if (anim.loop) {
              frameIdx = 0;
            } else {
              stopHeroTimers();
              setHeroSprite('idle'); // non-looping animation finished -> back to idle
              return;
            }
          }
          el.heroSprite.src = frames[frameIdx];
        }, anim.frameMs);
      } else if (!anim.loop) {
        // Single-frame, non-looping (today's attack/spell): hold for
        // frameMs then revert, same as the original implementation.
        heroRevertTimer = setTimeout(function () {
          setHeroSprite('idle');
        }, anim.frameMs);
      }
    }

    // Starts the idle breathing loop immediately, not just on the
    // first combat event. Deliberately placed HERE, after
    // heroFrameTimer/heroRevertTimer's own `var` declarations above
    // — not up with the other init calls near the top of
    // makeRenderer. Learned this one the hard way once already (see
    // RUNE_LAYOUT's comment elsewhere in this file): a `var` is
    // hoisted but NOT yet assigned until execution actually reaches
    // its declaration line, so calling setHeroSprite('idle') earlier
    // in the function would store its interval id into
    // heroFrameTimer, and then the `var heroFrameTimer = null;`
    // above — executing normally moments later, in the same
    // synchronous pass through makeRenderer — would silently wipe
    // that id back to null. The interval itself keeps running,
    // forever, orphaned: every later setHeroSprite call clears its
    // OWN timer just fine, but never that first one, and you end up
    // with two independent idle loops ticking out of phase forever.
    // Caught by measuring actual setInterval ids over real wall-clock
    // time, not by reading the code and assuming it was fine.
    setHeroSprite('idle');

    function flashSwordTrail() {
      // No trail file loaded yet -> nothing to flash. Without this
      // guard, every attack would flip the <img>'s opacity to 1
      // regardless of whether it ever successfully loaded, briefly
      // showing the browser's broken-image icon instead of quietly
      // doing nothing.
      if (!trailReady) return;

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

    function buildRuneTree() {
      // Guards against S.reset(): makeRenderer() runs again with a
      // fresh state, and without this the old run's nodes/lines
      // would still be sitting in the DOM when the new ones get
      // appended. The <svg> itself is a static child of #runeTree
      // in the HTML, so clearing innerHTML would also wipe it —
      // remove only what THIS function added instead.
      el.runeTree.querySelectorAll('.rune-node').forEach(function (n) { n.remove(); });
      el.runeTreeLines.innerHTML = '';
      runeRows = {};
      runeLines = [];

      var svgNS = 'http://www.w3.org/2000/svg';

      // Lines first, so nodes render visually on top of them.
      Runes.NODES.forEach(function (node) {
        var to = RUNE_LAYOUT[node.id];
        node.requires.forEach(function (reqId) {
          var from = RUNE_LAYOUT[reqId];
          var line = document.createElementNS(svgNS, 'line');
          line.setAttribute('x1', from.x);
          line.setAttribute('y1', from.y);
          line.setAttribute('x2', to.x);
          line.setAttribute('y2', to.y);
          el.runeTreeLines.appendChild(line);
          runeLines.push({ fromId: reqId, toId: node.id, el: line });
        });
      });

      Runes.NODES.forEach(function (node) {
        var pos = RUNE_LAYOUT[node.id];
        var box = document.createElement('div');
        box.className = 'rune-node branch-' + node.branch;
        box.style.left = pos.x + '%';
        box.style.top = pos.y + '%';

        var name = document.createElement('div');
        name.className = 'rune-name';
        name.textContent = node.name;

        var rank = document.createElement('div');
        rank.className = 'rune-rank';

        // Cost is filled in by updateRuneTree, not here: it changes
        // every time a rank is bought, so it can't be baked in once.
        var cost = document.createElement('div');
        cost.className = 'rune-cost';

        var status = document.createElement('div');
        status.className = 'rune-status';

        var button = document.createElement('button');
        button.textContent = 'Buy';
        button.addEventListener('click', function () {
          // The click's whole job is to forward to the same public
          // action a console command already uses. Every rule about
          // whether this is ALLOWED lives in runes.js, not here.
          Runes.purchase(state, node.id);
          // Re-render now, not on the next frame — buying a rune
          // changes what else is affordable, and this has to stay
          // correct even while the loop is paused. Same reasoning as
          // wireFarmControls above.
          update();
        });

        box.appendChild(name);
        box.appendChild(rank);
        box.appendChild(cost);
        box.appendChild(status);
        box.appendChild(button);
        el.runeTree.appendChild(box);

        runeRows[node.id] = {
          row: box, button: button, status: status, cost: cost, rank: rank
        };
      });
    }

    /* =========================================================
       HUNTING GROUND CONTROLS
       Same division of labour as the rune buttons: the click just
       forwards to Game's public action, and every rule about
       whether it's allowed (boss stage? not cleared yet?) lives in
       game.js's canFarmStage, not here.
       ========================================================= */
    function wireFarmControls() {
      // Each handler re-renders immediately rather than waiting for
      // the next animation frame. Two reasons: the button that was
      // just clicked should reflect its new enabled/disabled state
      // right away, and — the real bug this prevents — if the loop
      // is paused (S.pause()) no frames are running at all, so
      // without this the panel would freeze in a stale state and the
      // buttons would stop matching reality.
      el.farmSet.addEventListener('click', function () {
        Game.setFarmTarget(state, parseInt(el.farmInput.value, 10));
        update();
      });
      el.farmClear.addEventListener('click', function () {
        Game.clearFarmTarget(state);
        update();
      });
      // Live feedback while typing, so the XP cost of a choice is
      // visible BEFORE committing to it rather than after.
      el.farmInput.addEventListener('input', updateFarmPanel);
    }

    // Cached last-written strings. This runs every frame like the
    // rest of update(), but the panel's contents only change on a
    // stage change or a keystroke — writing innerHTML 60x/second for
    // an unchanged string is exactly the waste this file's header
    // says it avoids, so compare first and write only on a real change.
    var lastEnemyTags = null;
    var lastFarmStatus = null;
    var lastFarmHint = null;

    function updateFarmPanel() {
      var frontier = state.highestNormalCleared;

      var statusHtml;
      if (state.farmTarget !== null) {
        statusHtml = '<span class="locked">Hunting stage ' + state.farmTarget +
          '</span> — not advancing.';
      } else if (state.farming && state.blockedStage !== null) {
        statusHtml = '<span class="climbing">Auto-farming stage ' + state.stage +
          '</span> — blocked at stage ' + state.blockedStage + '.';
      } else {
        statusHtml = '<span class="climbing">Climbing</span> — stage ' + state.stage + '.';
      }
      if (statusHtml !== lastFarmStatus) {
        el.farmStatus.innerHTML = statusHtml;
        lastFarmStatus = statusHtml;
      }

      el.farmClear.disabled = state.farmTarget === null;

      var hint, hintClass = '';
      if (frontier < 1) {
        el.farmSet.disabled = true;
        hint = 'Clear a stage first — you can only hunt ground you have already taken.';
      } else {
        var wanted = parseInt(el.farmInput.value, 10);
        var check = Game.canFarmStage(state, wanted);
        el.farmSet.disabled = !check.ok;

        if (!check.ok) {
          hintClass = 'warn';
          hint = check.reason + '. Cleared: stages 1-' + frontier +
            ' (excluding boss stages).';
        } else {
          var pct = Math.round(Game.xpRelevance(state, wanted) * 100);
          hint = pct > 0
            ? 'Stage ' + wanted + ' pays ' + pct + '% XP and gold. Drops and kill counts are unaffected.'
            : 'Stage ' + wanted + ' is far enough behind you to pay NO XP or gold — ' +
              'drops and kill counts only. Levelling stops while you hunt here.';
        }
      }
      if (hint !== lastFarmHint) {
        el.farmHint.textContent = hint;
        el.farmHint.className = hintClass;
        lastFarmHint = hint;
      }
    }

    /* =========================================================
       BOSS CHALLENGE PANEL
       ========================================================= */
    function wireBossControls() {
      el.bossGo.addEventListener('click', function () {
        Game.startBossChallenge(state, parseInt(el.bossSelect.value, 10));
        update();
      });
      el.bossSelect.addEventListener('change', updateBossPanel);
    }

    var lastBossOptions = '';
    var lastTokenLine = null;
    var lastBossHint = null;

    function updateBossPanel() {
      var hero = state.hero;

      var tokenHtml = '<span class="tokens">' + hero.bossTokens + '</span> boss token' +
        (hero.bossTokens === 1 ? '' : 's') +
        (state.bossChallenge
          ? ' — <strong>challenge in progress</strong> (stage ' + state.bossChallenge.stage + ')'
          : '');
      if (tokenHtml !== lastTokenLine) {
        el.tokenLine.innerHTML = tokenHtml;
        lastTokenLine = tokenHtml;
      }

      // Rebuild the option list only when the set of beaten bosses
      // actually changes — otherwise a rebuild every frame would
      // reset the player's selection while they're looking at it.
      var stages = Object.keys(state.clearedBossStages).map(Number).sort(function (a, b) {
        return a - b;
      });
      var signature = stages.join(',');
      if (signature !== lastBossOptions) {
        var keep = el.bossSelect.value;
        el.bossSelect.innerHTML = '';
        stages.forEach(function (st) {
          var boss = Sylvaine.Enemies.bossAtStage(st);
          var opt = document.createElement('option');
          opt.value = st;
          opt.textContent = 'Stage ' + st + ' — ' + (boss ? boss.name : 'boss');
          el.bossSelect.appendChild(opt);
        });
        if (keep && stages.indexOf(Number(keep)) !== -1) el.bossSelect.value = keep;
        lastBossOptions = signature;
      }

      var hint, hintClass = '';
      if (!stages.length) {
        el.bossGo.disabled = true;
        hint = 'Beat a boss first — you can only re-challenge bosses you have already cleared.';
      } else {
        var wanted = parseInt(el.bossSelect.value, 10);
        var check = Game.canChallengeBoss(state, wanted);
        el.bossGo.disabled = !check.ok;
        if (!check.ok) {
          hintClass = 'warn';
          hint = check.reason + '.';
        } else {
          hint = 'One fight, then straight back to where you were. ' +
            'Loot rolls at stage ' + wanted + " — so it is only worth it on the " +
            'highest boss you can actually beat.';
        }
      }
      if (hint !== lastBossHint) {
        el.bossHint.textContent = hint;
        el.bossHint.className = hintClass;
        lastBossHint = hint;
      }
    }

    function updateRuneTree(hero) {
      Runes.NODES.forEach(function (node) {
        var refs = runeRows[node.id];
        var rank = Runes.rankOf(hero, node.id);
        var maxed = Runes.isMaxed(hero, node.id);

        // 'owned' only dims the box once it's MAXED (nothing left to
        // do here) — a partially-ranked node still has an active
        // "Rank up" button and shouldn't look faded while it does.
        // Partial ownership is conveyed by rune-rank's own color
        // instead (see the CSS: .rune-node.owned .rune-rank).
        refs.row.classList.toggle('owned', maxed);
        refs.rank.classList.toggle('owned', rank > 0);
        refs.rank.textContent = rank + '/' + Runes.MAX_RANK;

        if (maxed) {
          refs.cost.textContent = '—';
          refs.status.textContent = 'maxed';
          refs.button.disabled = true;
          refs.button.textContent = 'Maxed';
          return;
        }

        // Cost shown is always the price of the NEXT rank, so the
        // number on screen is the number that will be charged.
        refs.cost.textContent = Runes.nextRankCost(hero, node.id) + 'g';
        var check = Runes.canPurchase(hero, node.id);
        refs.status.textContent = check.ok ? 'ready' : check.reason;
        refs.button.disabled = !check.ok;
        refs.button.textContent = rank === 0 ? 'Learn' : 'Rank up';
      });

      // Color each prerequisite edge by what's actually true of its
      // two ends: 'taken' once the node it points TO is owned (she
      // walked this exact path), 'available' once only the node it
      // comes FROM is owned (the path exists but she hasn't taken
      // it), otherwise left at the default dim border color.
      runeLines.forEach(function (edge) {
        var toOwned = Runes.isOwned(hero, edge.toId);
        var fromOwned = Runes.isOwned(hero, edge.fromId);
        edge.el.classList.toggle('taken', toOwned);
        edge.el.classList.toggle('available', !toOwned && fromOwned);
      });
    }

    /* =========================================================
       GEAR PANEL (step 4: real inventory, manual equip)
       -------------------------------------------------------
       Every item row — equipped or in the bag — gets the same
       small icon reservation, built by makeItemIcon below. No art
       exists yet, so the <img> degrades to the text fallback via
       the same load/error listener pattern setupImageFallback
       already established for the hero/enemy portraits; the point
       is that the LAYOUT is real now, so dropping in a real icon
       sheet later is a asset-only change, not a markup change.
       ========================================================= */
    function makeItemIcon(item) {
      var box = document.createElement('div');
      box.className = 'item-icon rarity-' + item.rarity;

      var img = document.createElement('img');
      img.alt = '';
      img.src = 'assets/icons/' + item.slot + '.png';

      var fallback = document.createElement('span');
      fallback.className = 'icon-fallback';
      fallback.textContent = item.slot === 'weapon' ? 'WPN' : 'ARM';

      img.addEventListener('load', function () {
        img.classList.add('loaded');
        box.classList.add('has-icon');
      });
      img.addEventListener('error', function () {
        img.classList.remove('loaded');
        box.classList.remove('has-icon');
      });

      box.appendChild(img);
      box.appendChild(fallback);
      return box;
    }

    function wireAutoSellControls() {
      var boxes = { common: el.autoSellCommon, rare: el.autoSellRare, epic: el.autoSellEpic };
      Object.keys(boxes).forEach(function (rarity) {
        boxes[rarity].addEventListener('change', function () {
          Items.setAutoSell(state, rarity, boxes[rarity].checked);
          update(); // same reasoning as the rune/farm buttons — reflect it now
        });
      });
    }

    function updateEquippedList() {
      el.equippedList.innerHTML = '';
      ['weapon', 'armor'].forEach(function (slot) {
        var item = state.hero.equipped[slot];
        var row = document.createElement('div');
        row.className = 'equipped-row';

        if (item) {
          row.appendChild(makeItemIcon(item));
          var name = document.createElement('span');
          name.className = 'item-name';
          name.textContent = item.name;
          var mods = document.createElement('span');
          mods.className = 'item-mods';
          mods.textContent = '(' + Items.describeMods(item.mods) + ')';
          row.appendChild(name);
          row.appendChild(mods);
        } else {
          var iconStub = document.createElement('div');
          iconStub.className = 'item-icon';
          row.appendChild(iconStub);
          var empty = document.createElement('span');
          empty.className = 'item-empty';
          empty.textContent = slot + ': (none)';
          row.appendChild(empty);
        }
        el.equippedList.appendChild(row);
      });
    }

    function updateAutoSellControls() {
      var policy = state.hero.autoSellRarities;
      el.autoSellCommon.checked = !!policy.common;
      el.autoSellRare.checked   = !!policy.rare;
      el.autoSellEpic.checked   = !!policy.epic;
    }

    function updateInventoryList() {
      var bag = state.hero.inventory;
      el.inventoryCount.textContent = '(' + bag.length + '/' + CONFIG.items.inventoryCap + ')';

      // Rebuild only when the CONTENTS actually changed — a cheap
      // signature (ids in order) rather than a deep diff, same
      // "guard the expensive part with a change check" shape as
      // updateLog's totalPushed comparison above.
      var sig = bag.map(function (it) { return it.id; }).join(',');
      if (sig === lastInventorySig) return;
      lastInventorySig = sig;

      el.inventoryList.innerHTML = '';
      if (!bag.length) {
        var hint = document.createElement('div');
        hint.className = 'item-empty-hint';
        hint.textContent = 'Nothing in the bag yet.';
        el.inventoryList.appendChild(hint);
        return;
      }

      bag.forEach(function (item) {
        var row = document.createElement('div');
        row.className = 'item-row rarity-' + item.rarity;

        row.appendChild(makeItemIcon(item));

        var name = document.createElement('span');
        name.className = 'item-name';
        name.textContent = item.name;
        var mods = document.createElement('span');
        mods.className = 'item-mods';
        mods.textContent = Items.describeMods(item.mods);
        var nameWrap = document.createElement('span');
        nameWrap.appendChild(name);
        nameWrap.appendChild(document.createTextNode(' '));
        nameWrap.appendChild(mods);
        row.appendChild(nameWrap);

        var rarity = document.createElement('span');
        rarity.className = 'item-rarity';
        rarity.textContent = item.rarity;
        row.appendChild(rarity);

        var power = document.createElement('span');
        power.className = 'item-power';
        power.textContent = Items.sellValueOf(item) + 'g';
        row.appendChild(power);

        var actions = document.createElement('span');
        actions.className = 'item-actions';

        var equipBtn = document.createElement('button');
        equipBtn.textContent = 'Equip';
        equipBtn.addEventListener('click', function () {
          Items.equipItem(state, item.id);
          update();
        });

        var sellBtn = document.createElement('button');
        sellBtn.textContent = 'Sell';
        sellBtn.addEventListener('click', function () {
          Items.sellItem(state, item.id);
          update();
        });

        actions.appendChild(equipBtn);
        actions.appendChild(sellBtn);
        row.appendChild(actions);

        el.inventoryList.appendChild(row);
      });
    }

    function updateGearPanel() {
      updateEquippedList();
      updateAutoSellControls();
      updateInventoryList();
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
      // #logList no longer scrolls itself — its enclosing window's
      // .window-body does (see style.css's popup-window rules), so
      // "stay pinned to the newest entry" has to scroll THAT element.
      var scrollBox = el.logList.parentElement;
      scrollBox.scrollTop = scrollBox.scrollHeight;
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

        // Elemental tags shown explicitly. An unseen damage
        // multiplier is just an invisible wall — if the player is
        // meant to build around these, they have to be readable.
        var tagHtml = '';
        if (enemy.weakTo && enemy.weakTo.length) {
          tagHtml += '<span class="tag weak">weak: ' + enemy.weakTo.join(', ') + '</span>';
        }
        if (enemy.resists && enemy.resists.length) {
          tagHtml += '<span class="tag resist">resists: ' + enemy.resists.join(', ') + '</span>';
        }
        if (tagHtml !== lastEnemyTags) {
          el.enemyTags.innerHTML = tagHtml;
          lastEnemyTags = tagHtml;
        }
      } else {
        el.enemyName.textContent = state.phase === 'retreating' ? 'Retreating…' : '…';
        el.enemyBoss.classList.remove('visible');
        el.enemyHpFill.style.width = '0%';
        el.enemyHpText.textContent = '';
        el.enemySubstats.textContent = '';
        if (lastEnemyTags !== '') { el.enemyTags.innerHTML = ''; lastEnemyTags = ''; }
      }

      // ---- hero stats ----
      el.statDamage.textContent = s.damage.toFixed(1);
      el.statAttackAttr.textContent = hero.attackAttribute;
      el.statSpeed.textContent = s.attackSpeed.toFixed(2) + '/s';
      el.statCrit.textContent = (s.critChance * 100).toFixed(1) + '% x' + s.critMult.toFixed(2);
      el.statDps.textContent = Math.round(Sylvaine.Game.heroDps(state));
      el.statSpell.textContent = hero.spellUnlocked
        ? s.spellPower.toFixed(1) + ' pwr / ' + s.spellCooldown.toFixed(1) + 's cd (' +
          hero.spellAttribute + ')'
        : 'locked';
      el.statEvade.textContent = (s.evadeChance * 100).toFixed(1) + '%';
      el.statReduc.textContent = (s.damageReduction * 100).toFixed(1) + '%';
      el.statHeal.textContent = hero.healUnlocked
        ? s.healPower.toFixed(1) + ' / ' + s.healCooldown.toFixed(1) + 's'
        : 'locked';

      updateFarmPanel();
      updateBossPanel();
      updateRuneTree(hero);
      updateGearPanel();
      updateLog();
    }

    return { update: update };
  }

  Sylvaine.makeRenderer = makeRenderer;
})(typeof globalThis !== 'undefined' ? globalThis : this);
