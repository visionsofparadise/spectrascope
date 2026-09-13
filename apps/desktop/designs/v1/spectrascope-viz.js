/*
 * spectrascope-viz.js — canvas / WebGL web components that stand in for the
 * real `spectral-display` GPU renderers used by the Spectrascope app. Every
 * visual is drawn from deterministic synthetic data (ported from the demo's
 * `demoAudio.ts` generators) so the layout, colors, and behaviours read as
 * the real app without the audio engine.
 *
 * Registered elements:
 *   <spectro-strip>       lava-colormap mel spectrogram + waveform in the layer's primary color
 *   <wave-mini>           horizontal waveform overview (MinimapDisplay)
 *   <freq-mini>           vertical scrollbar track (viewport bracket, no spectrogram)
 *   <scroll-track>        scrollbar track; axis="x"|"y", vstart/vend viewport fraction
 *   <histogram-canvas>    magnitude histogram bars
 *   <ltas-chart>          per-source long-term-average-spectrum polylines
 *   <loudness-chart>      loudness metric traces / flat scalar lines
 *   <correlation-chart>   inter-channel correlation envelopes
 *   <vectorscope-scope>   (Side, Mid) density clouds, lighten-blended
 *   <terrain-shader>      the Home WebGL terrain background (exact port)
 *
 * Chrome palette (from tokens.css) is read as literals so the canvases match
 * the DOM chrome exactly.
 */
(function () {
  "use strict";

  var VOID = [2, 2, 4];

  function hexToRgb(hex) {
    var c = hex.charAt(0) === "#" ? hex.slice(1) : hex;
    if (c.length === 3) c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
    var v = parseInt(c, 16);
    if (isNaN(v) || c.length !== 6) return [255, 255, 255];
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  // --- Seeded deterministic RNG (mulberry32) ---------------------------------
  function makeRng(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s + 0x6d2b79f5) >>> 0;
      var t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashSeed(str) {
    var h = 5381;
    str = String(str);
    for (var i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
    return h >>> 0;
  }
  function sr(seed) {
    var x = Math.sin(seed * 12.9898 + seed * 78.233) * 43758.5453;
    return x - Math.floor(x);
  }
  function smoothstep(e0, e1, x) {
    var t = clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  }

  // --- Synthetic audio-display data (ported from demoAudio.ts) ---------------
  var TIME_FRAMES = 640;
  var FREQ_BINS = 256;
  var DURATION = 30; // seconds

  var cache = {};

  function voiceActivity(seedBase) {
    var a = new Float32Array(TIME_FRAMES);
    for (var ti = 0; ti < TIME_FRAMES; ti++) {
      var f = ti / TIME_FRAMES;
      var p1 = smoothstep(0.02, 0.08, f) * smoothstep(0.35, 0.28, f);
      var p2 = smoothstep(0.38, 0.42, f) * smoothstep(0.62, 0.58, f);
      var p3 = smoothstep(0.66, 0.70, f) * smoothstep(0.92, 0.88, f);
      var micro = 0.5 + 0.5 * Math.sin(ti * 0.3 + sr(ti * 7 + seedBase) * 2);
      var syll = 0.4 + 0.6 * Math.pow(Math.abs(Math.sin(ti * 0.15 + sr(ti * 3 + seedBase) * 1.5)), 0.5);
      a[ti] = Math.max(p1, p2, p3) * micro * syll;
    }
    return a;
  }

  function buildData(seed) {
    if (cache[seed]) return cache[seed];
    var seedBase = (seed % 97) * 3.13;
    var va = voiceActivity(seedBase);
    var fundamental0 = 110 + (seed % 5) * 18; // per-source pitch

    // Spectrogram [time][freq] 0..1
    var spec = new Array(TIME_FRAMES);
    for (var ti = 0; ti < TIME_FRAMES; ti++) {
      var frame = new Float32Array(FREQ_BINS);
      var v = va[ti];
      for (var fi = 0; fi < FREQ_BINS; fi++) {
        var freqHz = 20 * Math.pow(1000, fi / FREQ_BINS);
        var val = 0.04 + 0.03 * sr(ti * FREQ_BINS + fi + seedBase);
        if (v > 0.1) {
          var fund = fundamental0 + 40 * Math.sin(ti * 0.05);
          for (var hn = 1; hn <= 9; hn++) {
            var hFreq = fund * hn;
            var dist = Math.abs(freqHz - hFreq) / (hFreq * 0.08);
            if (dist < 3) val += v * (1.2 / Math.pow(hn, 0.6)) * Math.exp(-dist * dist * 0.5);
          }
          if (freqHz > 4000 && freqHz < 8500) {
            var sib = v * 0.25 * sr(ti * 17 + fi * 3 + seedBase);
            if (sr(ti * 23 + seedBase) > 0.6) val += sib;
          }
        }
        var plos = [120, 300, 470, 560];
        for (var pi = 0; pi < plos.length; pi++) {
          var d2 = Math.abs(ti - plos[pi]);
          if (d2 < 6) val += 0.5 * Math.exp(-d2 * 0.5) * (0.5 + 0.5 * sr(fi * 11 + plos[pi]));
        }
        frame[fi] = clamp(val, 0, 1);
      }
      spec[ti] = frame;
    }

    // Waveform min/max per frame
    var wave = new Array(TIME_FRAMES);
    for (var t2 = 0; t2 < TIME_FRAMES; t2++) {
      var v2 = va[t2];
      var noise = 0.02 + 0.01 * sr(t2 * 100 + seedBase);
      var amp = v2 * 0.8 + noise;
      var asym = 0.05 * sr(t2 * 200 + seedBase);
      var vr = 0.1 * sr(t2 * 300 + seedBase);
      var plosB = 0;
      var pl = [120, 300, 470, 560];
      for (var q = 0; q < pl.length; q++) { var dd = Math.abs(t2 - pl[q]); if (dd < 4) plosB += 0.3 * Math.exp(-dd * 0.7); }
      var total = Math.min(1, amp + plosB);
      wave[t2] = { min: -(total + asym + vr * sr(t2 * 400 + seedBase)), max: total - asym + vr * sr(t2 * 500 + seedBase) };
    }

    // Loudness series (rms env 0..1, lufs dB, momentary dB, correlation)
    var rmsEnv = new Float32Array(TIME_FRAMES);
    var lufs = new Float32Array(TIME_FRAMES);
    var corr = new Float32Array(TIME_FRAMES);
    for (var t3 = 0; t3 < TIME_FRAMES; t3++) {
      var v3 = va[t3];
      rmsEnv[t3] = clamp(v3 * 0.85 + 0.02, 0, 1);
      corr[t3] = v3 > 0.08 ? clamp(0.55 + 0.4 * Math.sin(t3 * 0.08 + seedBase) - 0.15 * sr(t3 * 5 + seedBase), -1, 1) : (sr(t3 * 9 + seedBase) - 0.5) * 0.4;
    }
    for (var t4 = 0; t4 < TIME_FRAMES; t4++) {
      var sum = 0, cnt = 0;
      for (var k = Math.max(0, t4 - 12); k <= Math.min(TIME_FRAMES - 1, t4 + 12); k++) {
        var wt = 1 - Math.abs(k - t4) / 13;
        sum += (rmsEnv[k] > 0 ? 20 * Math.log10(rmsEnv[k]) : -60) * wt; cnt += wt;
      }
      lufs[t4] = cnt > 0 ? sum / cnt - 2 : -60;
    }
    var integrated = -23 + (seed % 7) - 3; // per source LUFS
    var truePeak = -1.2 - (seed % 4) * 0.6;

    var out = { spec: spec, wave: wave, rmsEnv: rmsEnv, lufs: lufs, corr: corr, integrated: integrated, truePeak: truePeak, va: va };
    cache[seed] = out;
    return out;
  }

  // frequency → canvas Y fraction (0 top = high). log 20..20000.
  var LOG20 = Math.log10(20), LOG20K = Math.log10(20000);
  function yToBin(yfrac) {
    var freqHz = Math.pow(10, LOG20 + (1 - yfrac) * (LOG20K - LOG20));
    var bi = Math.round((Math.log(freqHz / 20) / Math.log(1000)) * FREQ_BINS);
    return clamp(bi, 0, FREQ_BINS - 1);
  }

  function channelFactor(ch) {
    if (ch === "mid") return { amp: 0.92, tilt: 1.0 };
    if (ch === "side") return { amp: 0.45, tilt: 0.55 };
    return { amp: 1.0, tilt: 1.0 };
  }

  // --- Continuous, sample-accurate synthetic waveform ------------------------
  // Evaluates an audio-like signal at an ARBITRARY time (seconds), using the
  // same voice-activity / harmonic model as buildData but continuous — so it
  // can be sampled at (or beyond) one point per output pixel at any zoom
  // instead of reusing the coarse 640-frame min/max envelope.
  function frand(x) { var s = Math.sin(x) * 43758.5453; return s - Math.floor(s); }

  function waveActivity(f) {
    var p1 = smoothstep(0.02, 0.08, f) * smoothstep(0.35, 0.28, f);
    var p2 = smoothstep(0.38, 0.42, f) * smoothstep(0.62, 0.58, f);
    var p3 = smoothstep(0.66, 0.70, f) * smoothstep(0.92, 0.88, f);
    return Math.max(p1, p2, p3);
  }

  function waveSampleAt(seedBase, fundamental0, tSec) {
    var f = clamp(tSec / DURATION, 0, 1);
    var env = waveActivity(f);
    // syllabic + micro amplitude modulation (a few Hz)
    var syll = 0.42 + 0.58 * Math.pow(Math.abs(Math.sin(tSec * 4.1 + seedBase)), 0.6);
    var micro = 0.72 + 0.28 * Math.sin(tSec * 11.0 + seedBase * 2.0);
    env *= syll * micro;
    // harmonic carrier at a slowly-drifting fundamental
    var fund = fundamental0 + 14 * Math.sin(tSec * 0.6 + seedBase);
    var s = 0, norm = 0;
    for (var n = 1; n <= 7; n++) {
      var amp = 1 / Math.pow(n, 0.85);
      s += amp * Math.sin(2 * Math.PI * fund * n * tSec + seedBase * n * 0.7);
      norm += amp;
    }
    var sig = (s / norm) * env * 0.92;
    // breath / sibilance noise
    sig += (frand(tSec * 5300 + seedBase) - 0.5) * (0.04 + 0.18 * env);
    // plosive transients — same 4 events as the framed model
    var plos = [120, 300, 470, 560];
    for (var pi = 0; pi < plos.length; pi++) {
      var pt = (plos[pi] / TIME_FRAMES) * DURATION;
      var dt = tSec - pt;
      var g = Math.exp(-(dt * dt) / 0.0006);
      if (g > 0.001) sig += g * (0.55 + 0.4 * frand(plos[pi] + seedBase)) * Math.sin(2 * Math.PI * 62 * dt);
    }
    return clamp(sig, -1, 1);
  }

  // Reduce the visible window [s0,s1] of the signal to per-pixel min/max
  // columns. Oversamples so the carrier (up to ~1.5 kHz) is always captured,
  // and never drops below ~2 samples per output pixel.
  function waveColumns(seed, w, s0, s1, ampScale) {
    var seedBase = (seed % 97) * 3.13;
    var fundamental0 = 110 + (seed % 5) * 18;
    var t0 = s0 * DURATION, t1 = s1 * DURATION;
    var winSec = Math.max(1e-4, t1 - t0);
    var mn = new Float32Array(w), mx = new Float32Array(w);
    for (var x = 0; x < w; x++) { mn[x] = 2; mx[x] = -2; }
    var total = Math.max(w * 2, Math.ceil(winSec * 6000));
    for (var i = 0; i <= total; i++) {
      var frac = i / total;
      var tSec = t0 + frac * winSec;
      var v = waveSampleAt(seedBase, fundamental0, tSec) * ampScale;
      var xi = Math.floor(frac * w);
      if (xi >= w) xi = w - 1;
      if (v < mn[xi]) mn[xi] = v;
      if (v > mx[xi]) mx[xi] = v;
    }
    return { mn: mn, mx: mx };
  }

  // --- Resizable canvas base --------------------------------------------------
  function ResizableCanvas() {}
  function makeCanvasEl(proto) {
    var El = function () {
      var self = Reflect.construct(HTMLElement, [], El);
      return self;
    };
    return El;
  }

  var BaseProto = {
    setup: function () {
      if (this._canvas) return;
      this.style.display = this.style.display || "block";
      this.style.position = this.style.position || "relative";
      var c = document.createElement("canvas");
      c.style.width = "100%";
      c.style.height = "100%";
      c.style.display = "block";
      this.appendChild(c);
      this._canvas = c;
      var self = this;
      this._ro = new ResizeObserver(function () { self.draw(); });
      this._ro.observe(this);
    },
    dims: function () {
      var c = this._canvas;
      var r = this.getBoundingClientRect();
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var w = Math.max(1, Math.round(r.width * dpr));
      var h = Math.max(1, Math.round(r.height * dpr));
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
      return { w: w, h: h, ctx: c.getContext("2d") };
    },
    disconnectedCallback: function () { if (this._ro) this._ro.disconnect(); }
  };

  function defineCanvas(tag, observed, drawFn) {
    if (customElements.get(tag)) return;
    function El() { return Reflect.construct(HTMLElement, [], El); }
    El.observedAttributes = observed;
    El.prototype = Object.create(HTMLElement.prototype);
    El.prototype.constructor = El;
    El.prototype.connectedCallback = function () { BaseProto.setup.call(this); this.draw(); };
    El.prototype.disconnectedCallback = BaseProto.disconnectedCallback;
    El.prototype.dims = BaseProto.dims;
    El.prototype.attributeChangedCallback = function () { if (this._canvas) this.draw(); };
    El.prototype.draw = function () {
      if (!this._canvas) return;
      var d = this.dims();
      if (!d.ctx) return;
      drawFn.call(this, d.ctx, d.w, d.h);
    };
    // define observedAttributes via getter
    Object.defineProperty(El, "observedAttributes", { get: function () { return observed; } });
    customElements.define(tag, El);
  }

  // Lava colormap (12 stops from spectral-display lava.ts, ~1.2 gain as in app)
  var LAVA = ["#000000","#05051E","#0F1446","#1E0F32","#500A05","#8C1400","#B93700","#D76405","#F09B19","#FCD246","#FFF08C","#FFFFFF"].map(hexToRgb);
  function lavaAt(t) {
    t = clamp(t, 0, 1) * (LAVA.length - 1);
    var i = Math.floor(t), f = t - i, a = LAVA[i], b = LAVA[Math.min(i + 1, LAVA.length - 1)];
    return [lerp(a[0], b[0], f), lerp(a[1], b[1], f), lerp(a[2], b[2], f)];
  }

  // --- <spectro-strip> --------------------------------------------------------
  defineCanvas("spectro-strip",
    ["primary", "secondary", "seed", "channel", "startfrac", "endfrac", "wave-op", "spec-op", "clip"],
    function (ctx, w, h) {
      var primary = this.getAttribute("primary") || "#B8B8C0";
      var secondary = this.getAttribute("secondary") || "#44444C";
      var seed = hashSeed(this.getAttribute("seed") || "0");
      var ch = this.getAttribute("channel") || "mono";
      var s0 = parseFloat(this.getAttribute("startfrac") || "0");
      var s1 = parseFloat(this.getAttribute("endfrac") || "1");
      var waveOp = parseFloat(this.getAttribute("wave-op"));
      waveOp = isNaN(waveOp) ? 1 : waveOp;
      var specOp = parseFloat(this.getAttribute("spec-op"));
      specOp = isNaN(specOp) ? 1 : specOp;
      var clip = this.getAttribute("clip");
      this.style.clipPath = clip ? ("inset(0 " + ((1 - parseFloat(clip)) * 100) + "% 0 0)") : "";

      var data = buildData(seed);
      var sec = hexToRgb(secondary);
      var cf = channelFactor(ch);

      ctx.clearRect(0, 0, w, h);
      // spectrogram
      var img = ctx.createImageData(w, h);
      var px = img.data;
      var f0 = Math.floor(s0 * TIME_FRAMES), f1 = Math.floor(s1 * TIME_FRAMES);
      var span = Math.max(1, f1 - f0);
      for (var y = 0; y < h; y++) {
        var yf = y / h;
        var bi = yToBin(yf);
        var tilt = cf.tilt + (1 - cf.tilt) * (1 - yf); // side reduces lows
        for (var x = 0; x < w; x++) {
          var fr = f0 + Math.floor((x / w) * span);
          if (fr < 0) fr = 0; if (fr >= TIME_FRAMES) fr = TIME_FRAMES - 1;
          var mag = data.spec[fr][bi] * cf.amp * tilt;
          var t = Math.pow(clamp(mag, 0, 1), 0.58);
          var c = lavaAt(t);
          var idx = (y * w + x) * 4;
          px[idx] = lerp(VOID[0], c[0], specOp);
          px[idx + 1] = lerp(VOID[1], c[1], specOp);
          px[idx + 2] = lerp(VOID[2], c[2], specOp);
          px[idx + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);

      // waveform overlay in primary
      if (waveOp > 0.01) {
        var pr = hexToRgb(primary);
        ctx.globalAlpha = 0.72 * waveOp;
        ctx.fillStyle = "rgb(" + pr[0] + "," + pr[1] + "," + pr[2] + ")";
        var cy = h / 2;
        var half = h * 0.4;
        var cols = waveColumns(seed, w, s0, s1, cf.amp);
        for (var xx = 0; xx < w; xx++) {
          if (cols.mx[xx] < cols.mn[xx]) continue;
          var top = cy - cols.mx[xx] * half;
          var bot = cy - cols.mn[xx] * half;
          ctx.fillRect(xx, top, 1, Math.max(1, bot - top));
        }
        ctx.globalAlpha = 1;
      }
    });

  // --- <wave-mini> (MinimapDisplay) ------------------------------------------
  defineCanvas("wave-mini", ["primary", "seed", "vstart", "vend"], function (ctx, w, h) {
    var primary = this.getAttribute("primary") || "#B8B8C0";
    var seed = hashSeed(this.getAttribute("seed") || "0");
    var vs = parseFloat(this.getAttribute("vstart") || "0");
    var ve = parseFloat(this.getAttribute("vend") || "1");
    var pr = hexToRgb(primary);
    ctx.clearRect(0, 0, w, h);
    // void bg
    ctx.fillStyle = "rgb(2,2,4)"; ctx.fillRect(0, 0, w, h);
    var cy = h / 2;
    ctx.fillStyle = "rgb(" + pr[0] + "," + pr[1] + "," + pr[2] + ")";
    var cols = waveColumns(seed, w, 0, 1, 1);
    for (var x = 0; x < w; x++) {
      if (cols.mx[x] < cols.mn[x]) continue;
      var top = cy - cols.mx[x] * cy * 0.85;
      var bot = cy - cols.mn[x] * cy * 0.85;
      ctx.fillRect(x, top, 1, Math.max(1, bot - top));
    }
    // dim outside viewport
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(0, 0, vs * w, h);
    ctx.fillRect(ve * w, 0, w - ve * w, h);
    // selection highlight: composites to #28282E over the #020204 ground (matches chip/scrollbar grey)
    ctx.fillStyle = "rgba(224,224,232,0.17)";
    ctx.fillRect(vs * w, 0, (ve - vs) * w, h);
  });

  // --- <freq-mini> (vertical FrequencyMinimap) -------------------------------
  function drawTrack(ctx, w, h, axis, a, b) {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#020204";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#28282E";
    if (axis === "x") ctx.fillRect(a * w, 0, (b - a) * w, h);
    else ctx.fillRect(0, a * h, w, (b - a) * h);
  }
  defineCanvas("freq-mini", ["vstart", "vend"], function (ctx, w, h) {
    drawTrack(ctx, w, h, "y", parseFloat(this.getAttribute("vstart") || "0.18"), parseFloat(this.getAttribute("vend") || "0.78"));
  });
  defineCanvas("scroll-track", ["axis", "vstart", "vend"], function (ctx, w, h) {
    drawTrack(ctx, w, h, this.getAttribute("axis") || "y", parseFloat(this.getAttribute("vstart") || "0"), parseFloat(this.getAttribute("vend") || "1"));
  });

  // --- <histogram-canvas> -----------------------------------------------------
  defineCanvas("histogram-canvas", ["primary", "seed", "center", "width-db"], function (ctx, w, h) {
    var primary = this.getAttribute("primary") || "#A3E635";
    var seed = hashSeed(this.getAttribute("seed") || "hist");
    var center = parseFloat(this.getAttribute("center") || "-20");
    var widthDb = parseFloat(this.getAttribute("width-db") || "8");
    var pr = hexToRgb(primary);
    var binCount = 60, lo = -60, hi = 0;
    var counts = new Uint32Array(binCount);
    var rng = makeRng(seed);
    for (var i = 0; i < 4096; i++) {
      var u1 = Math.max(1e-9, rng()), u2 = rng();
      var z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      var db = center + z * widthDb;
      var raw = Math.floor(((db - lo) / (hi - lo)) * binCount);
      if (raw >= 0 && raw < binCount) counts[raw]++;
    }
    var peak = 0; for (var b = 0; b < binCount; b++) if (counts[b] > peak) peak = counts[b];
    ctx.clearRect(0, 0, w, h);
    if (peak === 0) return;
    ctx.fillStyle = "rgb(" + pr[0] + "," + pr[1] + "," + pr[2] + ")";
    var cw = w / binCount;
    for (var p = 0; p < binCount; p++) {
      if (!counts[p]) continue;
      var bh = (counts[p] / peak) * h;
      ctx.fillRect(Math.floor(p * cw) + 0.5, h - bh, Math.max(1, Math.floor(cw) - 1), bh);
    }
  });

  // --- polyline chart helper --------------------------------------------------
  function drawPolyline(ctx, pts, color, w, h, lw) {
    ctx.strokeStyle = color; ctx.lineWidth = lw || 1.5; ctx.lineJoin = "round"; ctx.lineCap = "round";
    ctx.beginPath();
    for (var i = 0; i < pts.length; i++) {
      var x = pts[i][0] * w, y = pts[i][1] * h;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // --- <ltas-chart> -----------------------------------------------------------
  // seeds attr: comma-separated "seed:primary" pairs
  defineCanvas("ltas-chart", ["sources"], function (ctx, w, h) {
    var raw = this.getAttribute("sources") || "";
    ctx.clearRect(0, 0, w, h);
    var entries = raw.split(";").filter(Boolean);
    var FMIN = 20, FMAX = 20000, DBMIN = -90, DBMAX = 0, N = 220;
    var logMin = Math.log10(FMIN), logMax = Math.log10(FMAX);
    entries.forEach(function (e) {
      var parts = e.split(":"); var seed = hashSeed(parts[0]); var color = parts[1] || "#B8B8C0";
      var rng = makeRng(seed);
      var pts = [];
      for (var i = 0; i < N; i++) {
        var f = i / (N - 1);
        var logHz = logMin + (logMax - logMin) * f;
        var freqHz = Math.pow(10, logHz);
        var base = -10 * Math.log10(freqHz / 1000) - 30;
        var jit = (rng() - 0.5) * 12;
        var db = clamp(base + jit, DBMIN, DBMAX);
        pts.push([f, (DBMAX - db) / (DBMAX - DBMIN)]);
      }
      drawPolyline(ctx, pts, color, w, h, 1.5);
    });
  });

  // --- <loudness-chart> -------------------------------------------------------
  // sources attr pairs "seed:primary"; metric attr
  defineCanvas("loudness-chart", ["sources", "metric", "axismin"], function (ctx, w, h) {
    var raw = this.getAttribute("sources") || "";
    var metric = this.getAttribute("metric") || "integrated";
    var axisMin = parseFloat(this.getAttribute("axismin") || "-40");
    ctx.clearRect(0, 0, w, h);
    var scalar = metric === "integrated" || metric === "truePeak" || metric === "samplePeak";
    var entries = raw.split(";").filter(Boolean);
    entries.forEach(function (e) {
      var parts = e.split(":"); var seed = hashSeed(parts[0]); var color = parts[1] || "#B8B8C0";
      var data = buildData(seed);
      if (scalar) {
        var val = metric === "integrated" ? data.integrated : data.truePeak;
        var y = (0 - clamp(val, axisMin, 0)) / (0 - axisMin);
        drawPolyline(ctx, [[0, y], [1, y]], color, w, h, 1.5);
      } else {
        var series = metric === "rms" ? data.rmsEnv : data.lufs;
        var pts = [];
        for (var i = 0; i < TIME_FRAMES; i++) {
          var db = metric === "rms" ? (series[i] > 0 ? 20 * Math.log10(series[i]) : axisMin) : series[i];
          var y = (0 - clamp(db, axisMin, 0)) / (0 - axisMin);
          pts.push([i / (TIME_FRAMES - 1), y]);
        }
        drawPolyline(ctx, pts, color, w, h, 1.5);
      }
    });
  });

  // --- <correlation-chart> ----------------------------------------------------
  defineCanvas("correlation-chart", ["sources"], function (ctx, w, h) {
    var raw = this.getAttribute("sources") || "";
    ctx.clearRect(0, 0, w, h);
    var entries = raw.split(";").filter(Boolean);
    entries.forEach(function (e) {
      var parts = e.split(":"); var seed = hashSeed(parts[0]); var color = parts[1] || "#B8B8C0";
      var data = buildData(seed);
      var pts = [];
      for (var i = 0; i < TIME_FRAMES; i++) {
        var c = data.corr[i]; // -1..1
        pts.push([i / (TIME_FRAMES - 1), (1 - c) / 2]);
      }
      drawPolyline(ctx, pts, color, w, h, 1.5);
    });
  });

  // --- <vectorscope-scope> ----------------------------------------------------
  defineCanvas("vectorscope-scope", ["sources"], function (ctx, w, h) {
    var raw = this.getAttribute("sources") || "";
    ctx.clearRect(0, 0, w, h);
    var entries = raw.split(";").filter(Boolean);
    var cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2;
    ctx.globalCompositeOperation = "lighten";
    entries.forEach(function (e) {
      var parts = e.split(":"); var seed = hashSeed(parts[0]); var color = parts[1] || "#B8B8C0";
      var pr = hexToRgb(color);
      var rng = makeRng(seed);
      var data = buildData(seed);
      // points: mostly-mono cloud along vertical (Mid) axis with some spread
      for (var i = 0; i < 2600; i++) {
        var fr = Math.floor(rng() * TIME_FRAMES);
        var energy = data.rmsEnv[fr];
        if (energy < 0.03) continue;
        var mid = (rng() - 0.5) * 0.5 + energy * (rng() - 0.5) * 0.4;
        var side = (rng() - 0.5) * 0.28 * (0.4 + data.corr[fr] * 0.0 + 0.6 * (1 - Math.abs(data.corr[fr])));
        var r = energy * R * 0.92;
        var x = cx + side * r * 2.0;
        var y = cy - mid * r * 2.0;
        var a = 0.08 + energy * 0.12;
        ctx.fillStyle = "rgba(" + pr[0] + "," + pr[1] + "," + pr[2] + "," + a + ")";
        ctx.fillRect(x, y, 1.6, 1.6);
      }
    });
    ctx.globalCompositeOperation = "source-over";
  });

  // --- <terrain-shader> (exact WebGL port) -----------------------------------
  var VERT = "#version 300 es\nin vec2 a_position;\nvoid main(){gl_Position=vec4(a_position,0.0,1.0);}\n";
  var FRAG = "#version 300 es\nprecision mediump float;\nuniform vec2 u_resolution;uniform float u_time;uniform float u_gscale;uniform float u_gwell;uniform float u_gwellw;uniform float u_gthin;uniform float u_gint;uniform vec2 u_gcenter;uniform float u_gpar;uniform float u_gtilt;uniform vec3 u_stops[16];uniform int u_nstops;uniform vec3 u_sky;out vec4 fragColor;\nconst float SPEED=5.8;const float CAM_HEIGHT=14.5;const float LOOK_DOWN=-1.1;const float FOV=0.5;const float FOG_DENSITY=0.055;const float FOG_START=30.0;const float TERRAIN_SCALE=0.05;const float TERRAIN_AMP=4.1;const float ROTATION=radians(-29.0);const float COLOR_MIN=1.1;const float COLOR_MAX=8.0;const float SWAY_AMT=3.0;const float SWAY_SPEED=0.5;const float TROUGH=0.004;const vec3 GRID_COL=vec3(184.0,184.0,192.0)/255.0;const float COS_ROT=cos(ROTATION);const float SIN_ROT=sin(ROTATION);\nvec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}vec2 mod289v2(vec2 x){return x-floor(x*(1.0/289.0))*289.0;}vec3 permute(vec3 x){return mod289(((x*34.0)+10.0)*x);}\nfloat snoise(vec2 v){const vec4 C=vec4(0.211324865405187,0.366025403784439,-0.577350269189626,0.024390243902439);vec2 i=floor(v+dot(v,C.yy));vec2 x0=v-i+dot(i,C.xx);vec2 i1=(x0.x>x0.y)?vec2(1.0,0.0):vec2(0.0,1.0);vec4 x12=x0.xyxy+C.xxzz;x12.xy-=i1;i=mod289v2(i);vec3 p=permute(permute(i.y+vec3(0.0,i1.y,1.0))+i.x+vec3(0.0,i1.x,1.0));vec3 m=max(0.5-vec3(dot(x0,x0),dot(x12.xy,x12.xy),dot(x12.zw,x12.zw)),0.0);m=m*m;m=m*m;vec3 x=2.0*fract(p*C.www)-1.0;vec3 h=abs(x)-0.5;vec3 ox=floor(x+0.5);vec3 a0=x-ox;m*=1.79284291400159-0.85373472095314*(a0*a0+h*h);vec3 g;g.x=a0.x*x0.x+h.x*x0.y;g.yz=a0.yz*x12.xz+h.yz*x12.yw;return 130.0*dot(m,g);}\nfloat ridgedFbm(vec2 p){float n0=1.0-abs(snoise(p));float n1=1.0-abs(snoise(p*2.0));float n2=1.0-abs(snoise(p*4.0));return n0*n0*0.5+n1*n1*0.25+n2*n2*0.125;}\nfloat terrainBase(vec2 p){vec2 sp=p*TERRAIN_SCALE;return (ridgedFbm(sp*0.3)*2.0+ridgedFbm(sp*0.7+3.7)*0.8)*TERRAIN_AMP;}\nfloat terrain(vec2 p,float camX){float dx=p.x-camX;return terrainBase(p)+dx*dx*TROUGH;}\nvec3 colormapFn(float t){float f=clamp(t,0.0,1.0)*float(u_nstops-1);int i=int(floor(f));i=clamp(i,0,u_nstops-2);float k=f-float(i);return mix(u_stops[i],u_stops[i+1],k);}\nvoid main(){vec2 uv=gl_FragCoord.xy/u_resolution;float aspect=u_resolution.x/u_resolution.y;float t=u_time*SPEED;float swayX=sin(u_time*SWAY_SPEED)*SWAY_AMT;float swayY=cos(u_time*SWAY_SPEED*0.7)*SWAY_AMT*0.3;vec3 camPos=vec3(swayX,CAM_HEIGHT+swayY,t);vec3 camTarget=vec3(swayX*0.5,CAM_HEIGHT-LOOK_DOWN,t+5.0);vec3 camUp=vec3(0.0,1.0,0.0);vec3 cw=normalize(camTarget-camPos);vec3 cu=normalize(cross(cw,camUp));vec3 cv=cross(cu,cw);vec2 screen=(uv-0.5)*vec2(aspect,1.0)*2.0;screen=vec2(screen.x*COS_ROT-screen.y*SIN_ROT,screen.x*SIN_ROT+screen.y*COS_ROT);vec3 rd=normalize(screen.x*cu+screen.y*cv+FOV*cw);vec3 voidColor=vec3(2.0/255.0,2.0/255.0,4.0/255.0);float tRay=0.0;bool hit=false;vec3 hitPos;for(int i=0;i<64;i++){hitPos=camPos+rd*tRay;float hh=terrain(hitPos.xz,camPos.x);float dist=hitPos.y-hh;if(dist<0.1){hit=true;break;}tRay+=max(dist*0.6,0.16);if(tRay>60.0)break;}vec3 col=voidColor;float alpha=0.0;if(hit){float hh=terrainBase(hitPos.xz);float nh=clamp((hh-COLOR_MIN)/(COLOR_MAX-COLOR_MIN),0.0,1.0);col=colormapFn(nh);float fogDist=max(tRay-FOG_START,0.0);float fogFactor=1.0-exp(-fogDist*FOG_DENSITY);col=mix(col,voidColor,fogFactor);alpha=1.0;}else{vec3 skyBase=u_sky;float skyGrad=smoothstep(-0.2,0.5,rd.y);col=mix(skyBase,voidColor,skyGrad);alpha=1.0-skyGrad;vec3 cw0=normalize(vec3(0.0,-LOOK_DOWN,5.0));vec3 cu0=normalize(cross(cw0,camUp));vec3 cv0=cross(cu0,cw0);float dz=max(dot(rd,cw0),0.05);vec2 gsFixed=vec2(dot(rd,cu0),dot(rd,cv0))/dz*FOV;vec2 gs=mix(screen,gsFixed,u_gtilt)-u_gcenter;float r2=dot(gs,gs);gs*=1.0+u_gwell*exp(-sqrt(r2)*u_gwellw);gs+=u_gcenter;vec2 g=gs*u_gscale+vec2(swayX,swayY)*u_gpar;vec2 fw=fwidth(g);vec2 d=abs(fract(g)-0.5);vec2 lw=1.0-smoothstep(vec2(0.0),fw*u_gthin,vec2(0.5)-d);float line=max(lw.x,lw.y);float gi=line*u_gint;col=col*alpha+GRID_COL*gi;alpha=min(alpha+gi,1.0);fragColor=vec4(col,alpha);return;}fragColor=vec4(col*alpha,alpha);}\n";

  function compileShader(gl, type, src) {
    var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.error(gl.getShaderInfoLog(s)); gl.deleteShader(s); return null; }
    return s;
  }

  function TerrainEl() { return Reflect.construct(HTMLElement, [], TerrainEl); }
  TerrainEl.prototype = Object.create(HTMLElement.prototype);
  TerrainEl.prototype.constructor = TerrainEl;
  TerrainEl.prototype.connectedCallback = function () {
    if (this._canvas) return;
    var self = this;
    this.style.display = "block";
    var canvas = document.createElement("canvas");
    canvas.style.width = "100%"; canvas.style.height = "100%"; canvas.style.display = "block";
    this.appendChild(canvas);
    this._canvas = canvas;
    var gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false, preserveDrawingBuffer: true });
    if (!gl) { this.style.background = "#020204"; this._diag = "no-webgl2"; return; }
    var vert = compileShader(gl, gl.VERTEX_SHADER, VERT);
    var frag = compileShader(gl, gl.FRAGMENT_SHADER, FRAG);
    if (!vert) { this._diag = "vert-fail"; return; }
    if (!frag) { this._diag = "frag-fail"; return; }
    var prog = gl.createProgram(); gl.attachShader(prog, vert); gl.attachShader(prog, frag); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { this._diag = "link-fail:" + gl.getProgramInfoLog(prog); return; }
    this._diag = "ok";
    var posAttr = gl.getAttribLocation(prog, "a_position");
    var uRes = gl.getUniformLocation(prog, "u_resolution");
    var uTime = gl.getUniformLocation(prog, "u_time");
    var uG = ["gscale","gwell","gwellw","gthin","gint"].map(function (n) { return gl.getUniformLocation(prog, "u_" + n); });
    var gDef = [6.5, 2.2, 2.4, 0.45, 0.22];
    var gAttr = ["grid-scale","grid-well","grid-well-width","grid-thin","grid-intensity"];
    var uGC = gl.getUniformLocation(prog, "u_gcenter");
    var uGP = gl.getUniformLocation(prog, "u_gpar");
    var uGT = gl.getUniformLocation(prog, "u_gtilt");
    var uStops = gl.getUniformLocation(prog, "u_stops"), uN = gl.getUniformLocation(prog, "u_nstops"), uSky = gl.getUniformLocation(prog, "u_sky");
    var rampDef = "#000000,#440154,#A3E635";
    function hex3(hx) { var m = /^#?([0-9a-f]{6})$/i.exec(hx || ""); if (!m) return null; var v = parseInt(m[1], 16); return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255]; }
    var buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    function resize() {
      var dpr = Math.min(window.devicePixelRatio || 1, 0.75);
      var r = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, r.width * dpr); canvas.height = Math.max(1, r.height * dpr);
      gl.viewport(0, 0, canvas.width, canvas.height);
    }
    resize();
    this._ro = new ResizeObserver(resize); this._ro.observe(canvas);
    var start = performance.now();
    function render() {
      var elapsed = (performance.now() - start) / 1000;
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(prog);
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, reduced ? 0 : elapsed);
      for (var k = 0; k < 5; k++) { var av = parseFloat(self.getAttribute(gAttr[k])); gl.uniform1f(uG[k], isNaN(av) ? gDef[k] : av); }
      var cx = parseFloat(self.getAttribute("grid-cx")), cy = parseFloat(self.getAttribute("grid-cy")); gl.uniform2f(uGC, isNaN(cx) ? 0 : cx, isNaN(cy) ? 0 : cy);
      var gp = parseFloat(self.getAttribute("grid-parallax")); gl.uniform1f(uGP, isNaN(gp) ? 0.04 : gp);
      var gt = parseFloat(self.getAttribute("grid-tilt")); gl.uniform1f(uGT, isNaN(gt) ? 0.5 : gt);
      var stops = (self.getAttribute("theme-ramp") || rampDef).split(",").map(hex3).filter(Boolean).slice(0, 16); if (stops.length < 2) stops = rampDef.split(",").map(hex3);
      var flat = new Float32Array(48); stops.forEach(function (c, i) { flat[i*3] = c[0]; flat[i*3+1] = c[1]; flat[i*3+2] = c[2]; }); gl.uniform3fv(uStops, flat); gl.uniform1i(uN, stops.length);
      var sk = hex3(self.getAttribute("theme-sky")) || hex3("#1E0024"); gl.uniform3f(uSky, sk[0], sk[1], sk[2]);
      gl.enableVertexAttribArray(posAttr);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.vertexAttribPointer(posAttr, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    self._render = render;
    render(); // guaranteed first frame (rAF may be throttled when backgrounded)
    function loop() { render(); self._raf = requestAnimationFrame(loop); }
    self._raf = requestAnimationFrame(loop);
  };
  TerrainEl.prototype.disconnectedCallback = function () {
    if (this._raf) cancelAnimationFrame(this._raf);
    if (this._ro) this._ro.disconnect();
  };
  if (!customElements.get("terrain-shader")) customElements.define("terrain-shader", TerrainEl);

  // --- <knob-dial> ------------------------------------------------------------
  defineCanvas("knob-dial", ["value", "size"], function (ctx, w, h) {
    var value = clamp(parseFloat(this.getAttribute("value") || "0"), 0, 1);
    ctx.clearRect(0, 0, w, h);
    var cx = w / 2, cy = h / 2;
    var radius = Math.min(w, h) / 2 - 3;
    if (radius <= 0) return;
    var start = (135 * Math.PI) / 180;
    var sweep = (270 * Math.PI) / 180;
    ctx.lineCap = "round";
    ctx.lineWidth = Math.max(2, Math.round(Math.min(w, h) / 14));
    ctx.strokeStyle = "#28282E";
    ctx.beginPath(); ctx.arc(cx, cy, radius, start, start + sweep); ctx.stroke();
    if (value > 0) {
      ctx.strokeStyle = "#B8B8C0";
      ctx.beginPath(); ctx.arc(cx, cy, radius, start, start + sweep * value); ctx.stroke();
    }
  });

  // --- <meter-bar> ------------------------------------------------------------
  defineCanvas("meter-bar", ["level", "secondary", "animated"], function (ctx, w, h) {
    var self = this;
    var secondary = this.getAttribute("secondary") || "#7C2D12";
    var base = clamp(parseFloat(this.getAttribute("level") || "0"), 0, 1);
    var sec = hexToRgb(secondary);
    function paint(level) {
      ctx.clearRect(0, 0, w, h);
      var grad = ctx.createLinearGradient(0, h, 0, 0);
      grad.addColorStop(0, "rgb(2,2,4)");
      grad.addColorStop(1, "rgb(" + sec[0] + "," + sec[1] + "," + sec[2] + ")");
      ctx.fillStyle = grad; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "rgb(2,2,4)"; ctx.fillRect(0, 0, w, (1 - level) * h);
    }
    paint(base);
    if (this.getAttribute("animated") !== null && !this._anim) {
      var lvl = base, last = 0;
      var tick = function (time) {
        if (time - last >= 60) { last = time; lvl = clamp(lvl + (Math.random() - 0.5) * 0.15, 0, 1); paint(lvl); }
        self._anim = requestAnimationFrame(tick);
      };
      self._anim = requestAnimationFrame(tick);
    }
  });
})();
