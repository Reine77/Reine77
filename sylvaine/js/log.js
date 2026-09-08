/* =============================================================
   log.js — the combat log.
   -------------------------------------------------------------
   WHY a module instead of calling console.log from the combat
   code: in Phase 1 the log IS the user interface, but in Phase 4
   the same lines have to appear in a DOM panel. Routing every
   message through one function means Phase 4 changes this file
   only, and combat.js never learns that a screen exists.

   The log keeps the last N entries in memory (state.log) AND
   mirrors to the console while `echo` is true.

   `totalPushed` (Phase 4) is a counter that only ever goes up,
   even once `entries` is full and old lines start getting
   shifted out. render.js needs to know "has anything new been
   added since I last drew the log panel?" every frame, and
   `entries.length` can't answer that once it's pinned at
   MAX_ENTRIES — the array stops growing while lines keep coming
   in. Comparing `totalPushed` against a locally remembered
   number is a cheap, exact answer, so the log panel only
   rebuilds on an actual new line instead of on every frame.
   ============================================================= */
(function (root) {
  'use strict';

  var Sylvaine = (root.Sylvaine = root.Sylvaine || {});

  var MAX_ENTRIES = 200;

  function makeLog(options) {
    options = options || {};
    var echo = options.echo !== false; // default: mirror to console
    var entries = [];

    var log = {
      entries: entries,
      totalPushed: 0,
      push: push,
      setEcho: function (v) { echo = !!v; }
    };

    function push(kind, text, time) {
      var entry = { kind: kind, text: text, time: time || 0 };
      entries.push(entry);
      if (entries.length > MAX_ENTRIES) entries.shift();
      log.totalPushed++;

      if (echo) {
        // Pad the timestamp so the console output lines up in columns.
        var stamp = entry.time.toFixed(1);
        while (stamp.length < 6) stamp = ' ' + stamp;
        console.log('[' + stamp + 's] ' + text);
      }
      return entry;
    }

    return log;
  }

  Sylvaine.makeLog = makeLog;
})(typeof globalThis !== 'undefined' ? globalThis : this);
