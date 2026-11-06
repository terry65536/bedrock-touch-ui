// Force two client options before the game reads them, so the built-in touch HUD
// never draws and look can be driven from absolute cursor deltas without Pointer
// Lock. Options live in localStorage as base64 gzip of the options.txt text
// (PlatformApplication.getLocalStorage -> "<namespace>.g", EagRuntime.getStorage).
(function () {
  "use strict";

  var KEY = "_eaglercraftX.g";
  var FORCED = { eaglerTouchControls: "false", eaglerRdpMouse: "true" };

  // Seed on touch devices, or when the user turned the layer on by hand (F9), so a
  // desktop can be used to test the same build. RDP mouse mode replaces Pointer Lock
  // with absolute cursor deltas, which is what a finger needs and a mouse does not.
  var forced = false;
  try { forced = localStorage.getItem("_eaglerBedrock") === "1"; } catch (e) {}
  var isTouch = (navigator.maxTouchPoints || 0) > 0 &&
    (!window.matchMedia || window.matchMedia("(pointer: coarse)").matches);
  if (!isTouch && !forced) { window.__eagOptsSeeded = "not-touch"; return; }

  function b64ToBytes(s) {
    var bin = atob(s.replace(/\s+/g, ""));
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; ++i) out[i] = bin.charCodeAt(i);
    return out;
  }
  function bytesToB64(b) {
    var s = "";
    for (var i = 0; i < b.length; ++i) s += String.fromCharCode(b[i]);
    return btoa(s);
  }
  function gunzip(b) {
    var ds = new DecompressionStream("gzip");
    return new Response(new Blob([b]).stream().pipeThrough(ds)).arrayBuffer()
      .then(function (ab) { return new TextDecoder().decode(new Uint8Array(ab)); });
  }
  function gzip(text) {
    var cs = new CompressionStream("gzip");
    var stream = new Blob([new TextEncoder().encode(text)]).stream().pipeThrough(cs);
    return new Response(stream).arrayBuffer().then(function (ab) { return new Uint8Array(ab); });
  }

  function apply(text) {
    var lines = text.split(/[\r\n]+/).filter(function (l) { return l.length > 0; });
    var seen = {};
    var out = lines.map(function (l) {
      var i = l.indexOf(":");
      if (i < 0) return l;
      var k = l.slice(0, i);
      if (Object.prototype.hasOwnProperty.call(FORCED, k)) { seen[k] = 1; return k + ":" + FORCED[k]; }
      return l;
    });
    for (var k in FORCED) if (!seen[k]) out.push(k + ":" + FORCED[k]);
    return out.join("\n") + "\n";
  }

  var seed = "version:0\neaglerTouchControls:false\neaglerRdpMouse:true\n";

  function ready(v) { window.__eagOptsSeeded = v; }

  try {
    var existing = localStorage.getItem(KEY);
    if (existing == null) {
      // synchronous fast path for a first run, no streams needed
      gzip(seed).then(function (b) {
        try { localStorage.setItem(KEY, bytesToB64(b)); ready("fresh"); } catch (e) { ready("blocked"); }
      }, function () { ready("no-streams"); });
    } else if (typeof DecompressionStream === "function" && typeof CompressionStream === "function") {
      gunzip(b64ToBytes(existing)).then(function (text) {
        var next = apply(text);
        if (next === text) { ready("already"); return; }
        return gzip(next).then(function (b) {
          localStorage.setItem(KEY, bytesToB64(b));
          ready("merged");
        });
      }, function () { ready("corrupt"); }).catch(function () { ready("failed"); });
    } else {
      ready("no-streams");
    }
  } catch (e) {
    ready("error");
  }
})();
