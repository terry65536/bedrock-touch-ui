// Test-only helpers. Never packed into the deliverable: the headless harnesses
// inject this file separately.
(function () {
  "use strict";
  var B = window.__eag;

  B.frameSig = function (w, h) {
    w = w || 40; h = h || 24;
    var c = document.querySelector("#game_frame canvas") || document.querySelector("canvas");
    var cv = B._sigCanvas || (B._sigCanvas = document.createElement("canvas"));
    cv.width = w; cv.height = h;
    var ctx = B._sigCtx || (B._sigCtx = cv.getContext("2d", { willReadFrequently: true }));
    ctx.drawImage(c, 0, 0, w, h);
    var d = ctx.getImageData(0, 0, w, h).data, out = new Array(w * h);
    for (var i = 0, p = 0; i < d.length; i += 4, ++p) {
      out[p] = Math.round(d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114);
    }
    return out;
  };

  B.diff = function (a, b) {
    var s = 0;
    for (var i = 0; i < a.length; ++i) s += Math.abs(a[i] - b[i]);
    return Math.round(s / a.length);
  };

  // locate the grey Minecraft buttons in the current frame so a driver can tap by
  // role instead of by hand-measured pixels
  B.uiProbe = function (w, h) {
    w = w || 288; h = h || 160;
    var c = document.querySelector("#game_frame canvas") || document.querySelector("canvas");
    var r = c.getBoundingClientRect();
    var cv = B._uiCanvas || (B._uiCanvas = document.createElement("canvas"));
    cv.width = w; cv.height = h;
    var ctx = B._uiCtx || (B._uiCtx = cv.getContext("2d", { willReadFrequently: true }));
    ctx.drawImage(c, 0, 0, w, h);
    var d = ctx.getImageData(0, 0, w, h).data;
    var lum = new Float32Array(w * h), blu = new Float32Array(w * h);
    for (var i = 0, p = 0; i < d.length; i += 4, ++p) {
      lum[p] = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
      blu[p] = d[i + 2] - d[i];
    }
    var isbtn = function (x, y) { var q = y * w + x; return lum[q] > 68 && lum[q] < 195 && Math.abs(blu[q]) < 42; };
    var rows = [];
    for (var y = 0; y < h; ++y) { var n = 0; for (var x = 0; x < w; ++x) if (isbtn(x, y)) n++; rows.push(n); }
    var bands = [], inb = false, s0 = 0;
    for (var y2 = 0; y2 < h; ++y2) {
      var on = rows[y2] > w * 0.12;
      if (on && !inb) { s0 = y2; inb = true; }
      else if (!on && inb) { if (y2 - s0 >= 4) bands.push([s0, y2 - 1]); inb = false; }
    }
    if (inb) bands.push([s0, h - 1]);
    var out = [], sx = r.width / w, sy = r.height / h;
    bands.forEach(function (b) {
      var yc = (b[0] + b[1]) >> 1, runs = [], inr = false, rs = 0;
      for (var x3 = 0; x3 <= w; ++x3) {
        var v = x3 < w && isbtn(x3, yc);
        if (v && !inr) { rs = x3; inr = true; }
        else if (!v && inr) { if (x3 - rs > w * 0.06) runs.push([rs, x3 - 1]); inr = false; }
      }
      var merged = [];
      runs.forEach(function (rr) {
        if (merged.length && rr[0] - merged[merged.length - 1][1] < w * 0.03) merged[merged.length - 1][1] = rr[1];
        else merged.push([rr[0], rr[1]]);
      });
      merged.forEach(function (rr) {
        out.push({ y: Math.round((yc + 0.5) * sy), x: Math.round(((rr[0] + rr[1]) / 2 + 0.5) * sx) });
      });
    });
    return out;
  };

  // force the layer into world mode without a live client, for the stub tests
  if (window.__eagBedrock) window.__eagBedrock.forceWorld = function () { window.__eagBedrock.state.world = true; };
})();
