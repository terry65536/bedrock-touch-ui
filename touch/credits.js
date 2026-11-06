// The only authorship surface: two lines on the client's own loading screen,
// removed as soon as the client takes over. Attribution itself lives in
// README.md and NOTICE.
(function () {
  "use strict";

  var AUTHOR = "terry65536";
  var REPO = "github.com/terry65536/bedrock-touch-ui";
  var MONO = "font-family:ui-monospace,'Cascadia Mono','DejaVu Sans Mono',monospace;";
  // the client hides #loading_screen rather than removing it, so test the
  // rendered style instead of the inline one, and drop off the moment the
  // player is actually inside a world
  function bootOver() {
    var ls = document.getElementById("loading_screen");
    if (!ls) return true;
    var cs = window.getComputedStyle ? getComputedStyle(ls) : ls.currentStyle;
    if (!cs) return false;
    if (cs.display === "none" || cs.visibility === "hidden") return true;
    return parseFloat(cs.opacity) === 0;
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
      "font-size:clamp(22px,5.6vmin,34px);line-height:1.5;color:#bcd4f0;" +
      "text-shadow:0 1px 3px rgba(0,0,0,.85);pointer-events:none;");
    d.textContent = "Touch UI by " + AUTHOR + "\n" + REPO;
    document.body.appendChild(d);
    var iv = setInterval(function () {
      if (bootOver() || inWorld()) {
        if (d.parentNode) d.parentNode.removeChild(d);
        clearInterval(iv);
      }
    }, 200);
    setTimeout(function () {
      if (d.parentNode) d.parentNode.removeChild(d);
      clearInterval(iv);
    }, 20000);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", splash);
  else splash();
})();
