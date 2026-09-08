/* =============================================================
   rng.js — seedable random numbers.
   -------------------------------------------------------------
   WHY not just Math.random(): you asked to verify the numbers
   behave. That is impossible if every run is different. With a
   seed, the same seed always produces the same 200 stages, so
   when you change one config value you can see exactly what
   that change did instead of guessing at noise.

   This is "mulberry32" — a tiny, well-known 32-bit generator.
   You do not need to understand the bit-twiddling; it just
   turns one number into a repeatable stream of numbers.
   ============================================================= */
(function (root) {
  'use strict';

  var Sylvaine = (root.Sylvaine = root.Sylvaine || {});

  function makeRng(seed) {
    var state = seed >>> 0; // >>> 0 forces a 32-bit unsigned integer

    // Returns a float in [0, 1) — same contract as Math.random().
    function random() {
      state = (state + 0x6D2B79F5) >>> 0;
      var t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    return {
      random: random,
      // true with probability p
      chance: function (p) { return random() < p; },
      // integer in [min, max] inclusive
      int: function (min, max) { return min + Math.floor(random() * (max - min + 1)); },
      // random element of an array
      pick: function (arr) { return arr[Math.floor(random() * arr.length)]; }
    };
  }

  Sylvaine.makeRng = makeRng;
})(typeof globalThis !== 'undefined' ? globalThis : this);
