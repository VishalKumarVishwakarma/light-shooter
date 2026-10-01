"""Reproduce the browser's flex layout and Phaser's FIT maths in Node.

Two things have to be true for the game to fit a Windows window without
scrolling, and neither can be checked by reading CSS:

  1. the flex column resolves to exactly one viewport tall (chrome + #frame)
  2. Scale.FIT picks a scale that fits, and the resulting canvas is inside the
     viewport

Phaser's own maths, from ScaleManager:
  - FIT scales the CANVAS CSS size to fit the parent's bounding box, preserving
    the base aspect ratio: scale = min(parentW/baseW, parentH/baseH)
  - the parent bounds come from getBoundingClientRect(), which for a flex item
    reflects the RESOLVED layout, not the declared flex values

So this models: fixed chrome height, #frame = remaining space, #game = #frame
minus padding, then FIT against that.
"""
import re
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
html = (HERE / "index.html").read_text(encoding="utf-8")

# --- read the declared values out of the CSS, so the test cannot drift ---------
css = html[html.index("<style>"): html.index("</style>")]


def has(pat, label):
    return bool(re.search(pat, css))


checks = []


def ok(cond, msg):
    checks.append((bool(cond), msg))


# --- structural: the properties that make FIT work ---------------------------
ok(re.search(r"html,\s*body\s*\{[^}]*height:\s*100%", css), "html/body are height:100% (a real viewport, not min-height)")
ok("overflow: hidden" in css, "body cannot scroll")
ok(re.search(r"#frame\s*\{[^}]*flex:\s*1 1 auto", css), "#frame is flex:1 1 auto (absorbs leftover space)")
ok(re.search(r"#frame\s*\{[^}]*min-height:\s*0", css),
   "#frame has min-height:0 (without it a flex item refuses to shrink and overflows)")
ok(re.search(r"#game\s*\{[^}]*height:\s*100%", css),
   "#game has a height of its own -- this is the box Scale.FIT measures")
ok(re.search(r"#game\s*\{[^}]*width:\s*100%", css), "#game has a width of its own too")
# #game must NOT centre the canvas: Phaser sets the canvas margins and copies
# them onto the DOM container, so flex-centring on top double-centres the canvas
# and the DOM overlay (out of flow) drifts away from it. See test-dom-align.py.
ok("align-items: center" not in re.search(r"#game\s*\{([^}]*)\}", css).group(1),
   "#game does not centre the canvas (Phaser owns that, and copies its margins to the DOM overlay)")
ok(re.search(r"header\s*\{[^}]*flex:\s*0 0 auto", css), "header is flex:0 0 auto (never squashed)")
ok(re.search(r"#hud\s*\{[^}]*flex:\s*0 0 auto", css), "#hud is flex:0 0 auto")
ok(re.search(r"footer\s*\{[^}]*flex:\s*0 0 auto", css), "footer is flex:0 0 auto")
ok(not re.search(r"#game\s*\{\s*\}", css), "#game is not an empty rule")

# the old bug: #game had NO sizing at all
old = re.search(r"#game\s*\{([^}]*)\}", css)
ok(old and ("height" in old.group(1) or "flex" in old.group(1)),
   "the #game rule is not padding-free/empty (the original bug)")

# FIT config still intact
main = (HERE / "src" / "main.ts").read_text(encoding="utf-8")
ok("Phaser.Scale.FIT" in main, "the game is still in Scale.FIT (aspect preserved)")
ok("CENTER_BOTH" in main, "and still auto-centred")
ok("width: 960" in main and "height: 600" in main, "base size is still 960x600")

# --- the arithmetic, for real viewport sizes ---------------------------------
BASE_W, BASE_H = 960, 600
# chrome measured off the real CSS: header padding+content, #hud, footer, gaps,
# plus #frame's 10px padding top and bottom and its 1px borders
CHROME_FULL = 62 + 8 + 26 + 8 + 10 + 22 + 20 + 2   # header,hud,footer,gaps
CHROME_SHORT = 40 + 0 + 0 + 4 + 10 + 0 + 20 + 2  # tag+footer hidden by the query
FRAME_PAD = 22  # 10px padding * 2 + 1px border * 2

print("FIT ARITHMETIC  (base 960x600, aspect preserved)")
print(f"  {'viewport':<14} {'chrome':>7} {'parent':>13} {'scale':>7} {'canvas':>13}  fits")
rows = []
for label, vw, vh, chrome in [
    ("1920x1080 desk", 1920, 1080, CHROME_FULL),
    ("1536x864  laptop", 1536, 864, CHROME_FULL),
    ("1366x768  laptop", 1366, 768, CHROME_FULL),
    ("1280x720  window", 1280, 720, CHROME_FULL),
    ("1366x728  short", 1366, 728, CHROME_SHORT),
    ("1024x600  tiny", 1024, 600, CHROME_SHORT),
]:
    frame_h = vh - chrome
    # #frame is width:100% of the body, which is the full viewport width
    parent_w = vw
    parent_h = frame_h - FRAME_PAD
    scale = min(parent_w / BASE_W, parent_h / BASE_H)
    cw, ch = BASE_W * scale, BASE_H * scale
    total_h = chrome + ch + FRAME_PAD
    fits = total_h <= vh and cw <= vw
    rows.append((label, vw, vh, scale, cw, ch, total_h, fits))
    print(f"  {label:<14} {chrome:>7} {parent_w:>5}x{parent_h:<7} {scale:>7.3f} "
          f"{cw:>5.0f}x{ch:<7.0f}  {'YES' if fits else 'NO'}")

bad = 0
for label, vw, vh, scale, cw, ch, total_h, fits in rows:
    if not fits:
        bad += 1
        print(f"  OVERFLOW at {label}: needs {total_h:.0f}px of {vh}px")
    # a scale below 0.5 would make the playfield unreadable
    if scale < 0.5:
        print(f"  WARNING {label}: scale {scale:.2f} is very small")

print()
print("CHECKS")
for cond, msg in checks:
    print(f"  {'PASS' if cond else 'FAIL'}  {msg}")
    if not cond:
        bad += 1

print()
print(f"RESULT: {len(checks)} passed, {bad} failed" if bad else
      f"RESULT: {len(checks)} passed, 0 failed -- fits every tested viewport, no scroll")
sys.exit(1 if bad else 0)
