// Bedrock-style touch layer, v2.
//
// The client's own touch HUD is switched off (touch/options.js seeds
// eaglerTouchControls:false) and look is driven through the client's remote
// desktop mouse path (eaglerRdpMouse:true), which feeds absolute cursor deltas
// without needing Pointer Lock. Everything here is drawn on one canvas with
// Mojang's Bedrock control sprites at integer scale, so the pixels stay square
// and match the game's own art.
//
// Screen vs world is read from canvas.style.cursor: in remote desktop mode the
// client sets it to "none" when it grabs the mouse and "default" when a screen
// releases it. No pixel probing.
(function () {
  "use strict";

  var B = window.__eag;
  var SPR = window.__eagSprites || {};

  var CFG = {
    lookSensitivity: 0.85,
    invertLookY: false,      // the rdp path uses the same sign as a real mouse
    tapMs: 230,
    holdMs: 240,
    dragPx: 10,
    stickDeadZone: 0.24,
    stickSprint: 0.92,
    doubleTapMs: 520,
    modePollMs: 120,
  };

  var KEYS = {
    up: ["KeyW", 87], down: ["KeyS", 83], left: ["KeyA", 65], right: ["KeyD", 68],
    jump: ["Space", 32], sneak: ["ShiftLeft", 16], sprint: ["ControlLeft", 17],
    inventory: ["KeyE", 69], chat: ["KeyT", 84], esc: ["Escape", 27],
  };

  var st = {
    on: false, world: null, layout: null, dirty: true,
    move: { up: 0, down: 0, left: 0, right: 0 },
    sprintSticky: false, sneakSticky: false, sneakHeld: false,
    sprintDown: false, sneakDown: false,
    pressed: {},                  // sprite id -> pressed look
    stick: null, look: null, jump: null, sneak: null, hotbar: null,
    vx: 0, vy: 0, inGameOnce: false, backLock: 0,
  };

  function press(n) { B.key(KEYS[n][0], KEYS[n][1], true); }
  function release(n) { B.key(KEYS[n][0], KEYS[n][1], false); }
  function tapKey(n) { press(n); setTimeout(function () { release(n); }, 45); }

  // ---------- canvas ----------
  var cv = null, ctx = null, imgs = {}, loaded = 0, total = 0;

  function makeCanvas() {
    cv = document.createElement("canvas");
    cv.id = "bedrockTouchLayer";
    cv.setAttribute("style",
      "position:fixed;left:0;top:0;width:100%;height:100%;z-index:2147483645;" +
      "touch-action:none;image-rendering:pixelated;image-rendering:crisp-edges;" +
      "-webkit-user-select:none;user-select:none;");
    document.body.appendChild(cv);
    ctx = cv.getContext("2d");
    ctx.imageSmoothingEnabled = false;
  }

  // With the client's own touch HUD switched off, a container screen (inventory,
  // crafting table, furnace, chest) has no way back on a phone: Java closes those
  // with E or Escape, and tapping the empty space around the slots does nothing.
  // This plate sits exactly where the pause chip is in world, so it is the only
  // thing the layer leaves on top of a menu.
  var backBtn = null;
  function makeBackBtn() {
    var b = document.createElement("div");
    b.id = "bedrockBackBtn";
    b.setAttribute("style",
      "position:fixed;z-index:2147483646;display:none;background-size:100% 100%;" +
      "image-rendering:pixelated;-webkit-user-select:none;user-select:none;" +
      "touch-action:manipulation;");
    b.style.backgroundImage = "url(" + SPR.large_button.url + ")";
    var ic = document.createElement("img");
    ic.setAttribute("style",
      "position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);" +
      "image-rendering:pixelated;pointer-events:none;");
    ic.src = SPR.pause_icon.url;
    b.appendChild(ic);
    b.addEventListener("pointerdown", function (e) { e.preventDefault(); }, { passive: false });
    b.addEventListener("pointerup", function (e) {
      e.preventDefault(); e.stopPropagation();
      // one Escape per tap, and the plate disappears at once: a second tap while
      // the screen is already gone would open the pause menu instead
      st.backLock = Date.now() + 700;
      showBackBtn(false);
      tapKey("esc");
    }, { passive: false });
    document.body.appendChild(b);
    backBtn = b;
    sizeBackBtn();
  }

  function sizeBackBtn() {
    if (!backBtn || !st.layout || !st.layout.chips.length) return;
    var L = st.layout, right = L.chips[L.chips.length - 1];
    backBtn.style.width = right.w + "px";
    backBtn.style.height = right.h + "px";
    backBtn.style.right = Math.max(0, Math.round(L.W - (right.x + right.w))) + "px";
    backBtn.style.top = right.y + "px";
    backBtn.firstChild.style.height = Math.max(9, Math.round(right.h * 0.72)) + "px";
  }

  var backBtnOn = false;
  function showBackBtn(on) {
    // written only when it changes: readMode polls eight times a second and an
    // unconditional style write dirties the page all the way through
    if (!backBtn || backBtnOn === !!on) return;
    backBtnOn = !!on;
    backBtn.style.display = on ? "block" : "none";
  }

  function loadSprites() {
    var names = Object.keys(SPR);
    total = names.length;
    names.forEach(function (n) {
      var im = new Image();
      im.onload = function () {
        im._w = im.naturalWidth; im._h = im.naturalHeight;
        loaded++; invalidate();
      };
      im.src = SPR[n].url;
      imgs[n] = im;
    });
  }

  // ---------- layout ----------
  function layout() {
    var W = window.innerWidth, H = window.innerHeight;
    var dpr = Math.max(1, window.devicePixelRatio || 1);
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;

    var kb = Math.max(1, Math.min(4, Math.round(H * 0.125 / 22)));   // 22px control sprites
    var kj = Math.max(1, Math.min(4, Math.round(H * 0.30 / 64)));    // joystick frame/knob
    var kt = Math.max(1, Math.min(3, Math.round(H * 0.052 / 22)));   // top chips (large_button 70x22)
    var bs = 22 * kb, js = 64 * kj, chipW = 70 * kt, chipH = 22 * kt;

    var L = {
      W: W, H: H, dpr: dpr, kb: kb, kj: kj, kt: kt, bs: bs, js: js,
      chipW: chipW, chipH: chipH,
      stick: { cx: js * 0.58, cy: H - js * 0.58, r: js * 0.5 },
      jump: { cx: W - bs * 0.95, cy: H - bs * 1.05, r: bs * 0.62 },
      sneak: { cx: W - bs * 2.9, cy: H - bs * 0.95, r: bs * 0.62 },
      chips: [],
      hotbar: null,
    };
    // top-right: inventory, chat, pause, about - right aligned like Bedrock's HUD
    var order = [["inventory_icon", "inventory"], ["chat_keyboard", "chat"],
                 ["pause_icon", "esc"]];
    var x = W - chipW * 0.5 - 6;
    order.forEach(function (o) {
      L.chips.push({ sprite: o[0], action: o[1], x: x - chipW, y: 6, w: chipW, h: chipH });
      x -= chipW + 4;
    });

    // the client draws its own hotbar at gui centre-bottom; reuse its geometry so a
    // tap lands on the slot the player actually sees
    try {
      var g = B.layout();
      L.hotbar = { x: g.zones.hotbar.x, y: g.zones.hotbar.y, w: g.zones.hotbar.w, h: g.zones.hotbar.h };
    } catch (e) {}

    // the look band is measured once per layout: pointermove fires dozens of
    // times a second and getBoundingClientRect forces a layout
    try { L.band = bandOf(B.mouseBand()); } catch (e) { L.band = { x0: LOOK_MARGIN, y0: LOOK_MARGIN, x1: W - LOOK_MARGIN, y1: H - LOOK_MARGIN }; }

    // Nothing is ever painted outside these three boxes, so a repaint clears them
    // instead of the whole device-resolution canvas: at 1080x2400 that is the
    // difference between ~1 GB/s and ~0.2 GB/s of memory traffic while the stick
    // is held down.
    var sr = Math.max(L.stick.r * 1.06, L.stick.r * 0.78 + L.bs * 0.62);
    var bx0 = Math.max(0, L.sneak.cx - L.bs * 0.72), bx1 = Math.min(W, L.jump.cx + L.bs * 0.72);
    var by0 = Math.max(0, Math.min(L.jump.cy, L.sneak.cy) - L.bs * 0.72);
    var by1 = Math.min(H, Math.max(L.jump.cy, L.sneak.cy) + L.bs * 0.72);
    L.damage = [
      { x: Math.max(0, L.stick.cx - sr), y: Math.max(0, L.stick.cy - sr),
        w: Math.min(W, sr * 2), h: Math.min(H, sr * 2) },
      { x: bx0, y: by0, w: bx1 - bx0, h: by1 - by0 },
      { x: 0, y: 0, w: W, h: 6 + L.chipH + 2 },
    ];

    st.layout = L;
    invalidate();
  }

  // ---------- drawing ----------
  function sprite(name, cx, cy, scale, alpha) {
    var im = imgs[name];
    if (!im || !im._w) return;
    var w = im._w * scale, h = im._h * scale;
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    ctx.drawImage(im, Math.round(cx - w / 2), Math.round(cy - h / 2), Math.round(w), Math.round(h));
    ctx.globalAlpha = 1;
  }

  function draw() {
    if (!st.on || !st.world || !st.layout) return;
    var L = st.layout;
    for (var d = 0; d < L.damage.length; ++d) {
      var r = L.damage[d];
      ctx.clearRect(r.x, r.y, r.w, r.h);
    }

    // joystick: Bedrock's ring and knob; the direction arrows only appear for the
    // way the stick is actually pushed, so an idle stick stays clean
    sprite("joystick_frame", L.stick.cx, L.stick.cy, L.kj, 0.85);
    var dirs = [
      ["up", 0, -1], ["down", 0, 1], ["left", -1, 0], ["right", 1, 0],
      ["up_left", -0.72, -0.72], ["up_right", 0.72, -0.72],
      ["down_left", -0.72, 0.72], ["down_right", 0.72, 0.72],
    ];
    var off = L.stick.r * 0.78;
    dirs.forEach(function (d) {
      if (!st.move[d[0]]) return;
      sprite(d[0] + "_pressed", L.stick.cx + d[1] * off, L.stick.cy + d[2] * off, L.kb, 0.95);
    });
    var kx = L.stick.cx, ky = L.stick.cy;
    if (st.stick && st.stick.dx != null) {
      var m = Math.min(1, Math.hypot(st.stick.dx, st.stick.dy));
      var a = Math.atan2(st.stick.dy, st.stick.dx);
      kx += Math.cos(a) * L.stick.r * 0.42 * m;
      ky += Math.sin(a) * L.stick.r * 0.42 * m;
    }
    sprite("joystick_knob", kx, ky, L.kj, 0.95);

    // action buttons
    sprite(st.pressed.jump ? "jump_pressed" : "jump", L.jump.cx, L.jump.cy, L.kb, 0.95);
    var sneakOn = st.sneakSticky || st.sneakHeld || st.pressed.sneak;
    sprite(sneakOn ? "sneak_pressed" : "sneak", L.sneak.cx, L.sneak.cy, L.kb, 0.95);

    // top chips
    L.chips.forEach(function (c) {
      var hit = st.pressed[c.action];
      var s = L.kt, iw = 70 * s, ih = 22 * s;
      var im = imgs["large_button"];
      if (im && im._w) {
        ctx.drawImage(imgs[hit ? "large_button_pressed" : "large_button"],
          Math.round(c.x), Math.round(c.y), Math.round(iw), Math.round(ih));
      }
      sprite(c.sprite, c.x + iw / 2, c.y + ih / 2, Math.max(1, s), 0.95);
    });
  }

  // One frame callback serves both jobs: repaints, and the look deltas queued by
  // pointermove. A modern phone samples the finger at 120 Hz, and every synthetic
  // mousemove costs the client two getBoundingClientRect calls plus a style write,
  // so finger samples are coalesced into one look event per frame. Nothing runs at
  // all while the screen is idle: the callback is scheduled, not chained.
  var queued = false;

  function queue() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(tick);
  }

  function tick() {
    queued = false;
    flushLook();
    if (!st.dirty || !st.on || !st.world || !st.layout) return;   // flag stays until drawn
    st.dirty = false;
    draw();
  }

  function invalidate() { st.dirty = true; queue(); }

  // ---------- mode ----------
  function gameCanvas() { return document.querySelector("#game_frame canvas"); }

  function readMode() {
    var c = gameCanvas();
    if (!c || !st.on) return;
    // PlatformInput.mouseSetGrabbed writes this only in remote desktop mouse mode:
    // "none" in world, "default" on a screen. An empty value means the option seed
    // did not take and the client's own touch HUD is still running - stay hidden and
    // let it handle the device rather than reading pixels back from the GPU.
    var style = c.style && c.style.cursor;
    var grabbed = style === "none";
    // the plate is re-evaluated on every poll: it has to come back after the
    // cooldown if the screen is still open, and never appears over the title
    // screen, where Escape would do nothing at all
    if (st.world !== null) {
      showBackBtn(st.on && grabbed === false && st.inGameOnce === true && Date.now() >= st.backLock);
    }
    if (grabbed === st.world) return;
    st.world = grabbed;
    invalidate();
    cv.style.display = grabbed ? "" : "none";
    if (grabbed) st.inGameOnce = true;
    if (!grabbed) {
      // release everything so a menu never leaves the player walking or mining
      setMove("up", 0); setMove("down", 0); setMove("left", 0); setMove("right", 0);
      syncSprint(false); st.sneakHeld = false; syncSneak();
      if (st.look && st.look.mining) { B.mouse(0, false); }
      st.look = null; st.stick = null; st.jump = null; st.sneak = null; st.pressed = {};
    }
  }

  // ---------- boot badge + manual switch ----------
  function toast(text, ms) {
    var t = document.getElementById("bedrockTouchBadge");
    if (!t) {
      t = document.createElement("div");
      t.id = "bedrockTouchBadge";
      t.setAttribute("style", "position:fixed;left:8px;top:8px;z-index:2147483646;" +
        "font:12px/1.4 monospace;color:#fff;background:rgba(0,0,0,.72);" +
        "border:1px solid rgba(255,255,255,.5);padding:5px 8px;white-space:pre;");
      document.body.appendChild(t);
    }
    t.textContent = text;
    t.style.display = "";
    clearTimeout(t._hide);
    if (ms) t._hide = setTimeout(function () { t.style.display = "none"; }, ms);
    return t;
  }

  function wantLayer() {
    var forced = false;
    try { forced = localStorage.getItem("_eaglerBedrock") === "1"; } catch (e) {}
    return isTouchClient() || forced;
  }

  function toggleLayer() {
    var on = wantLayer() ? "0" : "1";
    try { localStorage.setItem("_eaglerBedrock", on); } catch (e) {}
    toast(on === "1" ? "Touch controls: enabling\u2026" : "Touch controls: disabling\u2026");
    setTimeout(function () { location.reload(); }, 700);
  }

  // ---------- movement ----------
  function setMove(name, on) {
    on = on ? 1 : 0;
    if (st.move[name] === on) return;
    st.move[name] = on;
    if (on) press(name); else release(name);
    invalidate();
  }

  var SECTORS = [["right"], ["right", "down"], ["down"], ["left", "down"],
                 ["left"], ["left", "up"], ["up"], ["right", "up"]];

  function applyStick(dx, dy, fromRelease) {
    var mag = Math.hypot(dx, dy);
    if (mag > 1) { dx /= mag; dy /= mag; mag = 1; }
    st.stick = st.stick || {};
    st.stick.dx = dx; st.stick.dy = dy;
    invalidate();
    if (mag < CFG.stickDeadZone) {
      setMove("up", 0); setMove("down", 0); setMove("left", 0); setMove("right", 0);
      syncSprint(false);
      return;
    }
    var sec = ((Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) % 8) + 8) % 8;
    var dirs = SECTORS[sec];
    setMove("up", dirs.indexOf("up") >= 0);
    setMove("down", dirs.indexOf("down") >= 0);
    setMove("left", dirs.indexOf("left") >= 0);
    setMove("right", dirs.indexOf("right") >= 0);
    var hold = mag >= CFG.stickSprint && (sec >= 5 && sec <= 7);
    syncSprint(hold);
    if (!fromRelease && dy < -0.55 && Math.abs(dx) < 0.55) {
      var now = Date.now();
      if (now - (st.stick.lastTap || 0) < CFG.doubleTapMs) {
        st.sprintSticky = !st.sprintSticky;
        syncSprint(hold);
      }
      st.stick.lastTap = now;
    }
  }

  function syncSprint(hold) {
    var want = !!hold || st.sprintSticky;
    if (want === st.sprintDown) return;
    st.sprintDown = want;
    if (want) press("sprint"); else release("sprint");
  }

  function syncSneak() {
    var want = st.sneakSticky || st.sneakHeld;
    if (want !== st.sneakDown) {
      st.sneakDown = want;
      if (want) press("sneak"); else release("sneak");
    }
    invalidate();
  }

  // ---------- look ----------
  // The client derives look from the difference between two absolute cursor
  // positions, clamps those positions into the canvas, and rejects a step larger
  // than max(48, size/3) - so a virtual cursor that drifts off the canvas simply
  // stops turning. Holding Alt makes the client re-track the cursor without
  // looking, which is the supported way to re-centre it: the cursor is folded to
  // the opposite edge with look suspended, then this step is spent from there, so
  // no finger movement is lost and a full circle returns to the same heading.
  var LOOK_MARGIN = 24;
  function bandOf(b) {
    return {
      x0: b.x0 + LOOK_MARGIN, x1: b.x1 - LOOK_MARGIN,
      y0: b.y0 + LOOK_MARGIN, y1: b.y1 - LOOK_MARGIN,
    };
  }

  function moveLook(dx, dy) {
    lookQ.dx += dx; lookQ.dy += dy; lookQ.active = true;
    queue();
  }

  var lookQ = { dx: 0, dy: 0, active: false };

  function flushLook() {
    if (!lookQ.active) return;
    var dx = lookQ.dx, dy = lookQ.dy;
    lookQ.dx = 0; lookQ.dy = 0; lookQ.active = false;
    var s = CFG.lookSensitivity;
    var adx = dx * s, ady = dy * s * (CFG.invertLookY ? -1 : 1);
    var L = st.layout ? st.layout.band : bandOf(B.mouseBand());
    var nx = st.vx + adx, ny = st.vy + ady;
    if (nx < L.x0 || nx > L.x1 || ny < L.y0 || ny > L.y1) {
      var ax = nx < L.x0 ? L.x1 : (nx > L.x1 ? L.x0 : nx);
      var ay = ny < L.y0 ? L.y1 : (ny > L.y1 ? L.y0 : ny);
      B.mouseMove(ax, ay, true);                 // re-centre, look suspended
      nx = Math.min(L.x1, Math.max(L.x0, ax + adx));
      ny = Math.min(L.y1, Math.max(L.y0, ay + ady));
    }
    st.vx = nx; st.vy = ny;
    B.mouseMove(st.vx, st.vy);
  }

  // ---------- gestures ----------
  function hit(px, py) {
    var L = st.layout;
    if (!L) return null;
    for (var i = 0; i < L.chips.length; ++i) {
      var c = L.chips[i];
      if (px >= c.x && px <= c.x + c.w && py >= c.y && py <= c.y + c.h) return { kind: "chip", chip: c };
    }
    if (Math.hypot(px - L.jump.cx, py - L.jump.cy) <= L.jump.r) return { kind: "jump" };
    if (Math.hypot(px - L.sneak.cx, py - L.sneak.cy) <= L.sneak.r) return { kind: "sneak" };
    if (Math.hypot(px - L.stick.cx, py - L.stick.cy) <= L.stick.r * 1.18) return { kind: "stick" };
    if (L.hotbar && px >= L.hotbar.x && px <= L.hotbar.x + L.hotbar.w &&
        py >= L.hotbar.y - 6 && py <= L.hotbar.y + L.hotbar.h) {
      var slot = Math.max(0, Math.min(8, Math.floor((px - L.hotbar.x) / (L.hotbar.w / 9))));
      return { kind: "slot", slot: slot };
    }
    return { kind: "free" };
  }

  function selectSlot(i) {
    var code = "Digit" + (i + 1);
    B.key(code, 48 + i + 1, true);
    setTimeout(function () { B.key(code, 48 + i + 1, false); }, 45);
    st.selectedSlot = i;
  }

  function onDown(e) {
    if (!st.on || !st.world) return;
    e.preventDefault();
    var L = st.layout, h = hit(e.clientX, e.clientY);
    if (!h) return;
    if (h.kind === "chip") {
      st.pressed[h.chip.action] = true; invalidate();
      setTimeout(function () { st.pressed[h.chip.action] = false; invalidate(); }, 140);
      tapKey(h.chip.action);
      return;
    }
    if (h.kind === "slot") { selectSlot(h.slot); return; }
    if (h.kind === "jump") {
      st.jump = { pointer: e.pointerId, t0: Date.now() };
      st.pressed.jump = true; press("jump"); invalidate(); return;
    }
    if (h.kind === "sneak") {
      st.sneak = { pointer: e.pointerId, t0: Date.now() };
      st.pressed.sneak = true; st.sneakHeld = true; syncSneak(); return;
    }
    if (h.kind === "stick") {
      st.stick = st.stick || { lastTap: 0 };
      st.stick.pointer = e.pointerId;
      stickFrom(e.clientX, e.clientY);
      return;
    }
    // free area: look drag, or tap = use, hold = break
    // start from the finger, inside the band, and sync the client's base cursor
    // first (Alt suspends look) so no rotation is charged to a stale position
    var b0 = (st.layout && st.layout.band) || bandOf(B.mouseBand());
    st.vx = Math.min(b0.x1, Math.max(b0.x0, e.clientX));
    st.vy = Math.min(b0.y1, Math.max(b0.y0, e.clientY));
    B.mouseMove(st.vx, st.vy, true);
    B.mouseMove(st.vx, st.vy);
    var g = {
      pointer: e.pointerId, x: e.clientX, y: e.clientY, t0: Date.now(),
      moved: false, mining: false,
    };
    g.timer = setTimeout(function () {
      if (st.look === g && !g.moved && !g.mining) { g.mining = true; st.pressed.mine = true; B.mouse(0, true); invalidate(); }
    }, CFG.holdMs);
    st.look = g;
  }

  function stickFrom(px, py) {
    var L = st.layout;
    applyStick((px - L.stick.cx) / L.stick.r, (py - L.stick.cy) / L.stick.r, false);
  }

  function onMove(e) {
    if (!st.on || !st.world) return;
    if (st.stick && e.pointerId === st.stick.pointer) { stickFrom(e.clientX, e.clientY); return; }
    var g = st.look;
    if (!g || e.pointerId !== g.pointer) return;
    var dx = e.clientX - g.x, dy = e.clientY - g.y;
    if (!g.moved && Math.abs(dx) + Math.abs(dy) > CFG.dragPx) {
      g.moved = true;
      if (g.mining) { g.mining = false; st.pressed.mine = false; clearTimeout(g.timer); B.mouse(0, false); invalidate(); }
    }
    if (g.moved) {
      moveLook(dx, dy);
      g.x = e.clientX; g.y = e.clientY;
    }
  }

  function onUp(e) {
    if (!st.on) return;
    if (st.jump && e.pointerId === st.jump.pointer) {
      st.pressed.jump = false; release("jump"); st.jump = null; invalidate(); return;
    }
    if (st.sneak && e.pointerId === st.sneak.pointer) {
      if (Date.now() - st.sneak.t0 >= 260) st.sneakSticky = !st.sneakSticky;
      st.pressed.sneak = false; st.sneakHeld = false; st.sneak = null; syncSneak(); return;
    }
    if (st.stick && e.pointerId === st.stick.pointer) {
      st.stick.pointer = null;
      applyStick(0, 0, true);
      return;
    }
    var g = st.look;
    if (!g || e.pointerId !== g.pointer) return;
    st.look = null;
    clearTimeout(g.timer);
    flushLook();   // spend the last sampled delta instead of dropping it
    if (g.mining) { st.pressed.mine = false; B.mouse(0, false); }
    else if (!g.moved && Date.now() - g.t0 <= CFG.tapMs) {
      B.mouse(2, true);
      setTimeout(function () { B.mouse(2, false); }, 35);
    }
    invalidate();
  }

  function isTouchClient() {
    return (navigator.maxTouchPoints || 0) > 0 && window.matchMedia("(pointer: coarse)").matches;
  }

  function boot() {
    var tries = 0;
    (function wait() {
      if (!gameCanvas()) { if (++tries < 1500) return setTimeout(wait, 100); return; }
      makeCanvas();
      loadSprites();
      layout();
      makeBackBtn();
      window.addEventListener("resize", function () { layout(); sizeBackBtn(); }, true);
      window.addEventListener("orientationchange", function () { setTimeout(function () { layout(); sizeBackBtn(); }, 350); }, true);
      cv.addEventListener("pointerdown", onDown, { passive: false });
      window.addEventListener("pointermove", onMove, { passive: true });
      window.addEventListener("pointerup", onUp, { passive: true });
      window.addEventListener("pointercancel", onUp, { passive: true });
      window.addEventListener("keydown", function (e) {
        if (e.code === "F9" && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
          e.preventDefault(); e.stopPropagation();
          toggleLayer();
        }
      }, true);
      setInterval(readMode, CFG.modePollMs);
      readMode();
      api.set(wantLayer());
    })();
  }

  var api = {
    cfg: CFG, state: st, layout: function () { return st.layout; },
    set: function (v) { st.on = !!v; if (!v) { cv && (cv.style.display = "none"); showBackBtn(false); } readMode(); },
    relayout: layout,
    info: function () { return { seeded: window.__eagOptsSeeded, world: st.world, on: st.on, sprites: loaded + "/" + total }; },
  };
  window.__eagBedrock = api;

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
