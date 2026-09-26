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

  // pos: { x, y } in the same 0-100 stage space as every light.
  // Returns null when no configured light reaches this position at
  // all — callers should treat that as "leave this unit's lighting
  // CSS variables unset", which is what makes a stage with an empty
  // stageLights array behave exactly as if this system didn't exist.
  function computeUnitLight(pos) {
    if (!activeLights.length) return null;

    var scored = [];
    for (var i = 0; i < activeLights.length; i++) {
      var light = activeLights[i];
      var dx = pos.x - light.x;
      var dy = pos.y - light.y;
      var dist = Math.sqrt(dx * dx + dy * dy);

      // The falloff formula the brief specifies, literally:
      // intensity = max(0, 1 - distance / radius).
      var falloff = Math.max(0, 1 - dist / light.radius);
      if (falloff <= 0) continue; // out of this light's reach entirely

      var lightStrength = light.intensity != null ? light.intensity : 1;
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
    computeUnitLight: computeUnitLight
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
