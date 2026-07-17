# SCABBARD

**FI-111 :: board-fitted enclosure generator**

A sheath fitted to a blade. Point SCABBARD at a board and it generates a printable
3D enclosure sized to that board, with mounting bosses, auto-placed connector cutouts,
a choice of lid, cooling, and text. One HTML file, runs from disk, no server.

License: GPL-3.0

SCABBARD is the STL-out, 3D-printed sibling of COOPER (FI-093, laser-cut finger-joint
boxes). COOPER cuts flat sheet into a box. SCABBARD prints a solid case wrapped around
a named board.

---

## Run it

Double-click `index.html`. That is the whole install. It works offline straight from
`file://`, no build step, no localhost, no dependencies. Everything (geometry, STL
export, the isometric preview) is hand-rolled in the one file.

## What it makes

- **Base**: a shelled box sized from the board's footprint and stack height, with
  mounting bosses on the real hole coordinates, chamfered bottom, recessed feet for
  stick-on bumpers, and connector cutouts on the walls.
- **Lid**: snap-fit tongue, friction tongue, or screw-down corners. Screw-down adds
  matching corner posts in the base with self-tap pilot bores. Optional raised or
  embossed text.
- **Fit-test coupon**: a small clearance ladder and a self-tap boss so you can dial in
  your printer's real tolerance before committing to the full case.

Export each as a binary STL. Save the whole configuration as a `.case` project file and
re-open it later.

## Boards

Arduino Uno R4 (Minima / WiFi), Arduino Uno Q, the Arduino MKR line, Raspberry Pi 4,
Raspberry Pi 5, and a fully parametric generic project box.

Board dimensions are typical starting points. Verify against the official mechanical
drawing before your first real print. The connector panel lets you toggle each port and
shows its size. If a cutout does not fit the wall, or two cutouts overlap, SCABBARD drops
the offending one and tells you in the warnings strip rather than emitting broken
geometry. This is COOPER's lesson carried over: block, do not corrupt.

## Height and fit

The interior height is sized from the board's standoff, PCB, and header stack, and is
raised automatically to clear the tallest connector so a stacked USB or Ethernet jack is
never guillotined by the rim. Use **Headroom** for a shield, HAT, or a tall cooler, and
**Extra stack** for anything the board data does not already know about.

## Self-test

The **Self-test** button in the header runs the core geometry assertions on demand:
every board, both lid styles, per-body manifold and watertightness, and an STL binary
round-trip. Green means the meshes are closed, consistently wound, and positive volume.
The same assertions run headless in the Node harnesses (`test.js`, `test-model.js`).

## Themes and access

Night (default), Light, and High Contrast, all aiming at WCAG AA for body text. Fully
keyboard operable with visible focus outlines, ~44px touch targets, and reduced-motion
honored. The preview rotates by drag and zooms by wheel.

## Conventions

Single file, no build step, disk-runnable. Version marker after the DOCTYPE. In-app
About panel with license, credits, and feedback. Debug log behind an in-app toggle.
Each release saved as its own file. GPL-3.0.

## Known Limitations

- **Board data is nominal.** Dimensions and connector positions are typical values, not
  measured from every revision. Print the fit-test coupon and check a dry fit before a
  full run. Verify against the mechanical drawing.
- **Text is single-stroke.** The lid legend uses a simple vector stroke font sized for
  legibility at FDM resolution, not a full outline typeface. Keep strings short.
- **No boolean CSG.** Cutouts are placed by construction, not subtracted. Overlapping or
  ill-fitting cutouts are dropped with a warning rather than merged. If you need two
  cutouts to share an opening, model it as one wider cutout.
- **STL only.** No 3MF or STEP yet. STL carries no units label, so confirm your slicer
  imports in millimetres.
- **Fan on a wall, not the lid.** The fan mount lands on a side wall. On a short case a
  40 mm fan will not fit a side wall and is dropped. Lid-mounted fans are not in v1.0.
- **Not a slicer.** Wall thickness, bosses, and clearances are print-aware, but supports,
  infill, orientation, and material are your slicer's job.
- **PWA layer deferred.** v1.0 is disk-first only. A service worker cannot register from
  `file://`, so offline caching is a later, additive concern, never load-bearing.

## Files

- `index.html` : the instrument. This is the release.
- `engine.js` : the geometry engine, embedded into `index.html` at build. Kept separate
  for the Node test harnesses.
- `test.js`, `test-model.js` : Node assertion harnesses. Run `node test.js` and
  `node test-model.js`.

Make. Hack. Learn. Share. Repeat.
