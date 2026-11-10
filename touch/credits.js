// The only authorship surface: two small English lines that flash on the client's
// loading screen for two seconds. The shell hides that screen by adding the
// is-ready class and then setting display:none inline (or removing the element on a
// crash), so this also watches those exact changes: a boot faster than the flash
// must not leave the text sitting over the game.
(function () {
  "use strict";
  var MONO = "font-family:ui-monospace,'Cascadia Mono','DejaVu Sans Mono',monospace;";

  function bootOver() {
    var ls = document.getElementById("loading_screen");
    if (!ls) return true;
    return ls.classList.contains("is-ready") || ls.style.display === "none";
  }

  function inWorld() {
    var b = window.__eagBedrock;
    return !!(b && b.info && b.info().world === true);
  }

  function splash() {
    var d = document.createElement("div");
    d.id = "bedrockCreditSplash";
    d.setAttribute("style",
      "position:fixed;left:0;right:0;bottom:calc(max(20px, 5vh) + 26px);z-index:2147483647;" +
      "text-align:center;white-space:pre-line;" + MONO +
      "font-size:clamp(15px,3.4vmin,20px);line-height:1.45;color:#bcd4f0;" +
      "text-shadow:0 1px 3px rgba(0,0,0,.85);pointer-events:none;");
    d.textContent = "Touch UI by terry65536\ngithub.com/terry65536/bedrock-touch-ui";
    document.body.appendChild(d);

    var mo = null, iv = 0;
    function drop() {
      if (!d.parentNode) return;
      d.parentNode.removeChild(d);
      if (mo) { mo.disconnect(); mo = null; }
      if (iv) { clearInterval(iv); iv = 0; }
    }
    function check() { if (bootOver() || inWorld()) drop(); }

    var ls = document.getElementById("loading_screen");
    if (window.MutationObserver) {
      mo = new MutationObserver(check);
      mo.observe(document.body, { childList: true });
      if (ls) mo.observe(ls, { attributes: true, attributeFilter: ["class", "style"] });
    }
    // the observer covers the real transition; this only catches a page where the
    // element was already gone before this script ran
    iv = setInterval(check, 1000);
    check();
    // a two second flash, fading the last 250 ms the way the loading screen does
    setTimeout(function () {
      d.style.transition = "opacity 250ms linear";
      d.style.opacity = "0";
      setTimeout(drop, 280);
    }, 2000);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", splash);
  else splash();
})();
