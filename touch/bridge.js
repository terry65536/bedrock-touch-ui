// Input bridge: the only thing this project needs from the game is the four
// seams TouchControls26/MouseHandler already expose to DOM events.
(function () {
  "use strict";

  var nextSyntheticId = 4096;
  var active = Object.create(null);

  function canvasEl() {
    return document.querySelector("#game_frame canvas") || document.querySelector("canvas");
  }

  function rect() {
    var c = canvasEl();
    if (!c) throw new Error("game canvas not created yet");
    var r = c.getBoundingClientRect();
    return { c: c, r: r, sx: r.width > 0 ? c.width / r.width : 1, sy: r.height > 0 ? c.height / r.height : 1 };
  }

  // CSS px (top-left origin) -> the game's own backing-store coordinates
  function toBacking(cssX, cssY) {
    var m = rect();
    return { x: (cssX - m.r.left) * m.sx, y: (cssY - m.r.top) * m.sy, w: m.c.width, h: m.c.height };
  }

  function touchHandle(id, cssX, cssY) {
    var m = rect();
    return new Touch({
      identifier: id, target: m.c,
      clientX: cssX, clientY: cssY,
      screenX: cssX, screenY: cssY, pageX: cssX, pageY: cssY,
      radiusX: 6, radiusY: 6, force: 1,
    });
  }

  function fireTouch(type, id, cssX, cssY, released) {
    var m = rect();
    var t = touchHandle(id, cssX, cssY);
    var held = [];
    for (var k in active) {
      if (k === String(id)) continue;
      if (!active[k].released) held.push(touchHandle(Number(k), active[k].x, active[k].y));
    }
    var init = { bubbles: true, cancelable: true, view: window };
    if (type === "touchend" || type === "touchcancel") {
      init.touches = held;
      init.targetTouches = held;
      init.changedTouches = [t];
    } else if (type === "touchmove") {
      init.touches = held.concat([t]);
      init.targetTouches = held.concat([t]);
      init.changedTouches = [t];
    } else {
      init.touches = held.concat([t]);
      init.targetTouches = held.concat([t]);
      init.changedTouches = [t];
    }
    active[id] = { x: cssX, y: cssY, released: !!released };
    m.c.dispatchEvent(new TouchEvent(type, init));
  }

  var bridge = {
    toBacking: toBacking,
    canvasSize: function () { var m = rect(); return [m.c.width, m.c.height]; },

    // ---- touch stream (LOOK / SCREEN paths inside the game) ----
    touchStart: function (cssX, cssY) {
      var id = nextSyntheticId++;
      fireTouch("touchstart", id, cssX, cssY, false);
      return id;
    },
    touchMove: function (id, cssX, cssY) { fireTouch("touchmove", id, cssX, cssY, false); },
    touchEnd: function (id, cssX, cssY) {
      fireTouch("touchend", id, cssX, cssY, true);
      delete active[id];
    },
    tap: function (cssX, cssY) {
      var id = bridge.touchStart(cssX, cssY);
      bridge.touchMove(id, cssX, cssY);
      bridge.touchEnd(id, cssX, cssY);
      return id;
    },

    // ---- keyboard (movement / jump / sneak / sprint / inventory / esc) ----
    key: function (code, keyCode, down, mods) {
      var key = code.indexOf("Key") === 0 ? code.slice(4) : code.replace(/^Digit/, "").replace(/^Arrow/, "Arrow");
      var init = {
        bubbles: true, cancelable: true, view: window,
        key: key, code: code, keyCode: keyCode, which: keyCode,
        repeat: false, shiftKey: !!(mods && mods.shift), ctrlKey: !!(mods && mods.ctrl),
        altKey: !!(mods && mods.alt), metaKey: false,
      };
      var type = down ? "keydown" : "keyup";
      window.dispatchEvent(new KeyboardEvent(type, init));
      document.dispatchEvent(new KeyboardEvent(type, init));
      var c = canvasEl();
      if (c) c.dispatchEvent(new KeyboardEvent(type, init));
    },

    // ---- mouse buttons (attack / use / place, plus wheel for the hotbar) ----
    mouse: function (button, down, cssX, cssY) {
      var m = rect();
      if (cssX == null) { cssX = m.r.left + m.r.width / 2; cssY = m.r.top + m.r.height / 2; }
      var init = {
        bubbles: true, cancelable: true, view: window,
        clientX: cssX, clientY: cssY, screenX: cssX, screenY: cssY, pageX: cssX, pageY: cssY,
        button: button, buttons: down ? (button === 2 ? 2 : 1) : 0,
        relatedNode: null, detail: down ? 1 : 0,
      };
      m.c.dispatchEvent(new MouseEvent(down ? "mousedown" : "mouseup", init));
    },
    // look in remote desktop mouse mode: the client derives the delta from the
    // absolute cursor it sees, so feed it a virtual cursor it can difference
    mouseMove: function (cssX, cssY) {
      var m = rect();
      m.c.dispatchEvent(new MouseEvent("mousemove", {
        bubbles: true, cancelable: true, view: window,
        clientX: cssX, clientY: cssY, screenX: cssX, screenY: cssY, pageX: cssX, pageY: cssY,
        buttons: 0, movementX: 0, movementY: 0,
      }));
    },
    wheel: function (deltaY, cssX, cssY) {
      var m = rect();
      if (cssX == null) { cssX = m.r.left + m.r.width / 2; cssY = m.r.top + m.r.height / 2; }
      m.c.dispatchEvent(new WheelEvent("wheel", {
        bubbles: true, cancelable: true, view: window,
        clientX: cssX, clientY: cssY, deltaY: deltaY, deltaMode: 0,
      }));
    },

    // ---- where the game's own touch HUD would hit-test, in CSS px ----
    // mirrors TouchControls26.hitTestWorld/hitTestToolbar + Window.calculateScale
    layout: function () {
      var m = rect();
      var fbW = m.c.width, fbH = m.c.height;
      var scale = 1;
      while (scale < fbW && scale < fbH && fbW / (scale + 1) >= 320 && fbH / (scale + 1) >= 240) scale++;
      var guiW = Math.floor(fbW / scale), guiH = Math.floor(fbH / scale);
      var px = function (v) { return v * m.r.width / fbW; };
      var cssX = function (guiX) { return px(guiX * fbW / guiW); };
      var cssY = function (guiY) { return px(guiY * fbH / guiH); };
      var r = function (gx, gy, gw, gh) {
        return { x: cssX(gx), y: cssY(gy), w: px(gw * fbW / guiW), h: px(gh * fbH / guiH) };
      };
      return {
        scale: scale, guiW: guiW, guiH: guiH, cssW: m.r.width, cssH: m.r.height,
        // anchor for look gestures: dead centre is free of every built-in zone
        anchor: { x: m.r.width / 2, y: m.r.height / 2 },
        zones: {
          up: r(42, guiH - 88, 32, 32), down: r(42, guiH - 38, 32, 32),
          left: r(14, guiH - 63, 32, 32), right: r(70, guiH - 63, 32, 32),
          jump: r(guiW - 52, guiH - 66, 38, 38), sneak: r(guiW - 98, guiH - 42, 32, 32),
          sprint: r(108, guiH - 43, 34, 30), attack: r(guiW - 52, guiH - 116, 38, 38),
          use: r(guiW - 103, guiH - 96, 38, 38), pause: r(guiW / 2 - 16, 8, 32, 26),
          hotbar: r(guiW / 2 - 92, guiH - 25, 184, 25),
          inv: r(guiW - 134, 4, 34, 24), chat: r(guiW - 96, 4, 28, 24),
          f3: r(guiW - 64, 4, 28, 24), fs: r(guiW - 32, 4, 28, 24),
        },
      };
    },
  };

  window.__eag = bridge;
})();
