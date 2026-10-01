"""Fail if #game ever centres the canvas itself.

The canvas must be positioned by Phaser alone. ScaleManager centres the canvas by
setting marginLeft/marginTop, then copies those SAME margins onto the DOM
container it builds for add.dom() elements:

    domStyle.transform = 'scale(' + displaySize.width  / baseSize.width  + ','
                                  + displaySize.height / baseSize.height + ')';
    domStyle.marginLeft = canvasStyle.marginLeft;
    domStyle.marginTop  = canvasStyle.marginTop;

Canvas and DOM overlay therefore share ONE centring mechanism. If the CSS also
centres the canvas with flex, the canvas moves a second time and the overlay --
absolutely positioned, out of flow, so flex never touches it -- stays behind,
offset by exactly the centring margin.

Observed as the name field rendering ABOVE its own callsign plate and over the
subtitle, rather than inside the plate.
"""
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).resolve().parent
html = (HERE / "index.html").read_text(encoding="utf-8")
css = html[html.index("<style>"): html.index("</style>")]

checks = []


def ok(cond, msg):
    checks.append((bool(cond), msg))


game = re.search(r"#game\s*\{([^}]*)\}", css)
ok(game, "#game rule is present")
body = game.group(1) if game else ""

# --- the bug -------------------------------------------------------------
ok("display: flex" not in body, "#game does not use flex -- that centred the canvas a second time")
ok("align-items: center" not in body, "no vertical centring on #game (Phaser owns it)")
ok("justify-content: center" not in body, "no horizontal centring on #game either")
ok("margin: auto" not in body, "no auto margins on #game")
ok(not re.search(r"#game canvas\s*\{[^}]*margin:\s*auto", css), "the canvas is not given auto margins")

# --- what #game must still do --------------------------------------------
ok("width: 100%" in body, "#game still has a width, so FIT has a real box to fit into")
ok("height: 100%" in body, "and a height")
ok("overflow: hidden" in body, "and overflow:hidden, to avoid a 1px scrollbar")

# --- the canvas must still be centred BY PHASER --------------------------
main = (HERE / "src" / "main.ts").read_text(encoding="utf-8")
ok("Phaser.Scale.CENTER_BOTH" in main, "autoCenter is still CENTER_BOTH, so Phaser sets the margins")
ok("Phaser.Scale.FIT" in main, "and the mode is still FIT")
ok("parent: 'game'" in main, "the parent is still #game")
ok("dom: { createContainer: true }" in main,
  "the DOM container is still created -- it is what Phaser aligns via margins")

# --- the reason is recorded where the bug would return ------------------
flat = " ".join(css.split())
ok("copies those" in flat, "index.html explains that Phaser copies its margins to the DOM container")
ok("domStyle" in flat, "and quotes the DOM container lines")
ok("place-content: center" not in css, "no place-content centring anywhere")

bad = 0
print("CHECKS")
for cond, msg in checks:
    print(f"  {'PASS' if cond else 'FAIL'}  {msg}")
    if not cond:
        bad += 1

print()
print(f"RESULT: {len(checks)} passed, {bad} failed" if bad
      else f"RESULT: {len(checks)} passed, 0 failed -- the canvas is centred by Phaser alone")
sys.exit(1 if bad else 0)