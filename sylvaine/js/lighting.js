/* =============================================================
   lighting.js — cheap, per-unit "how lit is this character right
   now" calculation for the battle stage. NOT a real lighting
   engine: no per-pixel work, no canvas/WebGL, and it only ever
   considers a small number of lights against a small number of
   units (a battle has at most a couple of combatants), matching
   render.js's own "cheap enough to run every frame" rule.

   This file owns the MATH only — distance, falloff, which lights
   win, what color/direction results. It never touches the DOM;
   render.js reads computeUnitLight()'s result and writes it onto
   the unit wrapper as CSS custom properties, same
   read-state/write-DOM split this project uses everywhere else.

   COORDINATE SPACE: 0-100 over the battle stage (#arena's own
   box), not pixels — see config.js's `lighting.stageLights` comment
   for why. render.js is the one place that converts a unit's real
   getBoundingClientRect() position into this same 0-100 space
   before calling computeUnitLight(), so this file never needs to
   know the arena's actual pixel size.

   ADDING/EDITING LIGHTS: see config.js's `lighting.stageLights` —
   that's the array to hand-edit for a specific stage/arena look.
   To swap the whole set at runtime (e.g. a themed arena), call
   Sylvaine.Lighting.setStageLights([...]) — everything below reads
   from the currently active set, not the config file directly.

   TEMPORARY BATTLE LIGHTS (spawnBattleLight)
   -------------------------------------------------------------
   Stage lights above are permanent fixtures. A bright attack or
   spell instead calls Sylvaine.Lighting.spawnBattleLight({...}) for
   a light that fades in, holds, fades out, then removes itself —
   see render.js's 'heroSpell' and 'heroDamaged' handlers for the two
   live examples. A temp light is just one more entry considered by
   computeUnitLight() below (same falloff/blend math, same
   MAX_CONTRIBUTING_LIGHTS cap — a stage light and a spell flash
   compete on equal footing for a unit's lighting), so units react to
   it exactly like they would a stage light; it can ADDITIONALLY
   paint a decal on the arena floor if `affectGround: true`, which
   render.js's updateLighting() turns into a small pooled DOM overlay
   (see getGroundLights() and the "GROUND LIGHT DOM POOL" comment in
   render.js).

   Cleanup is automatic and leak-free by construction: tickTempLights
   (called once per render frame, like everything else timing-related
   in this file) is the ONLY thing that ever removes an expired light
   from the array, so nothing here uses setTimeout/setInterval to
   "remember" to clean up later — the exact class of bug this
   project already hit once with the hero sprite's old
   setInterval-based animation (see render.js's HERO SPRITE STATE
   MACHINE comment) and deliberately doesn't want to reintroduce.
   clearTempLights() is the one thing that empties it early, on
   demand — main.js's S.reset() calls it so a fresh run never
   inherits another run's in-flight flashes.
   ============================================================= */
(function (root) {
  'use strict';

  var Sylvaine = (root.Sylvaine = root.Sylvaine || {});

  // Only the strongest N lights ever contribute to one unit. Battles
  // have very few units and this project's stages have very few
  // fixtures, so this is a bound on relevance/quality, not a real
  // performance necessity — but it also keeps the result meaningful:
  // summing every configured light unbounded could push intensity
  // (and therefore brightness/saturation) well past what "subtle, do
  // not wash out the art" allows for.
  var MAX_CONTRIBUTING_LIGHTS = 2;

  var activeLights = [];
  var cfg = Sylvaine.CONFIG && Sylvaine.CONFIG.lighting;
  if (cfg && cfg.stageLights) activeLights = cfg.stageLights;

  function setStageLights(lights) {
    activeLights = lights || [];
  }

  function getStageLights() {
    return activeLights;
  }

  /* ---- temporary battle lights (spells, bright attacks) -------- */
  var tempLights = [];
  var nextTempLightId = 1;

  // Default shape for spawnBattleLight's opts — every field the
  // brief asked for, named exactly as given. Anything the caller
  // doesn't pass falls back to these.
  var TEMP_LIGHT_DEFAULTS = {
    radius: 30,
    intensity: 1,
    color: [255, 255, 255],
    duration: 400,   // ms, total lifetime including fade in/out
    fadeIn: 80,      // ms
    fadeOut: 150,    // ms
    affectUnits: true,
    affectGround: false,
    groundStyle: 'pool', // 'pool' | 'beam' | 'burst'
    angle: 0,            // degrees, only meaningful for groundStyle 'beam'
    width: null,          // ground decal override; null = derive from radius
    height: null
  };

  function spawnBattleLight(opts) {
    opts = opts || {};
    var light = {
      id: nextTempLightId++,
      x: opts.x, y: opts.y,
      radius: opts.radius != null ? opts.radius : TEMP_LIGHT_DEFAULTS.radius,
      intensity: opts.intensity != null ? opts.intensity : TEMP_LIGHT_DEFAULTS.intensity,
      color: opts.color || TEMP_LIGHT_DEFAULTS.color,
      duration: opts.duration != null ? opts.duration : TEMP_LIGHT_DEFAULTS.duration,
      fadeIn: opts.fadeIn != null ? opts.fadeIn : TEMP_LIGHT_DEFAULTS.fadeIn,
      fadeOut: opts.fadeOut != null ? opts.fadeOut : TEMP_LIGHT_DEFAULTS.fadeOut,
      affectUnits: opts.affectUnits != null ? opts.affectUnits : TEMP_LIGHT_DEFAULTS.affectUnits,
      affectGround: opts.affectGround != null ? opts.affectGround : TEMP_LIGHT_DEFAULTS.affectGround,
      groundStyle: opts.groundStyle || TEMP_LIGHT_DEFAULTS.groundStyle,
      angle: opts.angle != null ? opts.angle : TEMP_LIGHT_DEFAULTS.angle,
      width: opts.width != null ? opts.width : TEMP_LIGHT_DEFAULTS.width,
      height: opts.height != null ? opts.height : TEMP_LIGHT_DEFAULTS.height,
      elapsed: 0
    };
    // Guard against a misconfigured (fadeIn + fadeOut > duration):
    // scale both down proportionally so the envelope in
    // tempLightEnvelope() below never has to reason about them
    // overlapping. A legitimate quick flash (fadeIn+fadeOut ==
    // duration, no flat "hold" plateau) is unaffected by this.
    var fadeTotal = light.fadeIn + light.fadeOut;
    if (fadeTotal > light.duration && fadeTotal > 0) {
      var scale = light.duration / fadeTotal;
      light.fadeIn *= scale;
      light.fadeOut *= scale;
    }
    tempLights.push(light);
    return light.id;
  }

  function clearTempLights() {
    tempLights = [];
  }

  // dtMs: real milliseconds since the last call (render.js passes
  // the loop's own dt, converted from seconds — same clock every
  // other timed effect in this file's render.js counterpart uses,
  // never a separate setTimeout/setInterval of its own).
  function tickTempLights(dtMs) {
    if (!tempLights.length) return;
    for (var i = tempLights.length - 1; i >= 0; i--) {
      tempLights[i].elapsed += dtMs;
      if (tempLights[i].elapsed >= tempLights[i].duration) tempLights.splice(i, 1);
    }
  }

  // 0-1 fade envelope for a temp light at its current `elapsed` time:
  // ramps up over fadeIn, holds at 1, ramps down over the last
  // fadeOut ms before it expires.
  function tempLightEnvelope(light) {
    var t = light.elapsed;
    if (t <= 0) return 0;
    if (light.fadeIn > 0 && t < light.fadeIn) return t / light.fadeIn;
    var fadeOutStart = light.duration - light.fadeOut;
    if (light.fadeOut > 0 && t > fadeOutStart) {
      return Math.max(0, (light.duration - t) / light.fadeOut);
    }
    return 1;
  }

  // Ground-affecting temp lights, each with its current envelope
  // already folded into `intensity` — this is what render.js's
  // ground-light DOM pool reads every frame. Stage lights never
  // appear here; the brief scopes ground decals to temporary battle
  // lights specifically (a spell/attack lighting up the floor), not
  // permanent fixtures.
  function getGroundLights() {
    var out = [];
    for (var i = 0; i < tempLights.length; i++) {
      var light = tempLights[i];
      if (!light.affectGround) continue;
      var envelope = tempLightEnvelope(light);
      if (envelope <= 0) continue;
      out.push({
        id: light.id,
        x: light.x, y: light.y,
        radius: light.radius,
        color: light.color,
        intensity: light.intensity * envelope,
        groundStyle: light.groundStyle,
        angle: light.angle,
        width: light.width,
        height: light.height
      });
    }
    return out;
  }

  // pos: { x, y } in the same 0-100 stage space as every light.
  // Returns null when no light (stage or temporary) reaches this
  // position at all — callers should treat that as "leave this
  // unit's lighting CSS variables unset", which is what makes a
  // stage with no lights, and no spell currently in flight, behave
  // exactly as if this system didn't exist.
  function computeUnitLight(pos) {
    var candidates = activeLights;
    for (var t = 0; t < tempLights.length; t++) {
      if (tempLights[t].affectUnits) candidates = candidates.concat([tempLights[t]]);
    }
    if (!candidates.length) return null;

    var scored = [];
    for (var i = 0; i < candidates.length; i++) {
      var light = candidates[i];
      var dx = pos.x - light.x;
      var dy = pos.y - light.y;
      var dist = Math.sqrt(dx * dx + dy * dy);

      // The falloff formula the brief specifies, literally:
      // intensity = max(0, 1 - distance / radius).
      var falloff = Math.max(0, 1 - dist / light.radius);
      if (falloff <= 0) continue; // out of this light's reach entirely

      // A temp light's OWN strength is its configured intensity
      // scaled by its current fade envelope; a stage light (no
      // `elapsed`/`duration` fields at all) is always at full
      // strength.
      var lightStrength = light.intensity != null ? light.intensity : 1;
      if (light.duration != null) lightStrength *= tempLightEnvelope(light);
      if (lightStrength <= 0) continue;

      scored.push({ light: light, dx: dx, dy: dy, strength: falloff * lightStrength });
    }
    if (!scored.length) return null;

    scored.sort(function (a, b) { return b.strength - a.strength; });
    scored = scored.slice(0, MAX_CONTRIBUTING_LIGHTS);

    // Intensity is the STRONGEST kept light alone, not a sum of the
    // kept lights — two overlapping lights summing past 1.0 would
    // blow straight through the "do not wash out the sprite" limit.
    // Color, though, blends across whichever lights are kept
    // (strength-weighted), so standing between a red torch and a
    // blue crystal reads as a believable mix rather than snapping to
    // whichever one is marginally stronger.
    var strongest = scored[0];
    var intensity = Math.min(1, strongest.strength);

    var totalStrength = 0, r = 0, g = 0, b = 0;
    for (var j = 0; j < scored.length; j++) {
      var s = scored[j];
      totalStrength += s.strength;
      r += s.light.color[0] * s.strength;
      g += s.light.color[1] * s.strength;
      b += s.light.color[2] * s.strength;
    }
    r = Math.round(r / totalStrength);
    g = Math.round(g / totalStrength);
    b = Math.round(b / totalStrength);

    // Direction FROM the strongest light TO the unit, in degrees:
    // 0 = light is directly to the unit's right, 90 = light is
    // directly above. Only the strongest light decides direction —
    // averaging directions from two lights on opposite sides would
    // point at neither of them, which is worse than picking one.
    var angleRad = Math.atan2(-strongest.dy, -strongest.dx);
    var angleDeg = angleRad * (180 / Math.PI);

    // Where the "lit side" gradient should center itself inside the
    // unit's own sprite box, as a percentage — offset toward the
    // light's direction so the side of the sprite facing the light
    // reads brighter than the far side (the brief's directional
    // lighting requirement). Computed here in JS rather than with
    // CSS trig functions (cos()/sin() in a CSS calc()) so it keeps
    // working in browsers that don't support those yet.
    var originX = 50 + Math.cos(angleRad) * 40;
    var originY = 50 - Math.sin(angleRad) * 40;

    return {
      intensity: intensity,
      r: r, g: g, b: b,
      angle: Math.round(angleDeg),
      originX: originX,
      originY: originY
    };
  }

  Sylvaine.Lighting = {
    setStageLights: setStageLights,
    getStageLights: getStageLights,
    computeUnitLight: computeUnitLight,
    spawnBattleLight: spawnBattleLight,
    clearTempLights: clearTempLights,
    tickTempLights: tickTempLights,
    getGroundLights: getGroundLights
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
