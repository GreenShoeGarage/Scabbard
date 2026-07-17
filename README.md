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
  embossed lid text, an LED window, and a lid-mounted fan (opening plus mounting holes
  at the standard pitch for the fan size).
- **Wall text**: a raised legend on the outside of any wall.
- **Case mounting**: flange tabs on two opposite walls with a plain hole or a keyhole
  (hang it on two screws), and a printed DIN-rail cradle (TS35) that clips on with a
  slight flex.
- **Gasket groove**: an optional O-ring channel recessed into the base rim, compressed by
  the lid. Needs a thicker wall so solid lips remain either side of the channel.
- **Fit-test coupon**: a small clearance ladder and a self-tap boss so you can dial in
  your printer's real tolerance before committing to the full case.

Export each part as a binary STL, or export the base and lid together as a **3MF** where
each is a separate object the slicer can arrange. Save the whole configuration as a
`.case` project file and re-open it later.

## Boards

Arduino Uno R4 (Minima / WiFi), Arduino Uno Q, the Arduino MKR line, Raspberry Pi 4,
Raspberry Pi 5, ESP32 DevKit (30-pin), Raspberry Pi Zero 2 W, Adafruit Feather, Arduino
Nano, and a fully parametric generic project box.

**Measure your own board.** Pick the generic box, type in your board's width, depth, PCB
thickness, and standoff, then add your own mounting holes and port cutouts. The whole
custom board is saved in the `.case` project so you can reuse it.

Board dimensions and connector positions are typical starting points. Verify against the
official mechanical drawing before your first real print. The connector panel lets you
toggle each port and edit its offset along the wall, height above the PCB, and cutout size,
so you can measure your own board and dial each cutout in exactly; the values save with the
project. If a cutout does not fit the wall, or two cutouts overlap, SCABBARD drops the
offending one and tells you in the warnings strip rather than emitting broken geometry.
This is COOPER's lesson carried over: block, do not corrupt.

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
- **Text is single-stroke.** The legend uses a simple vector stroke font sized for
  legibility at FDM resolution, not a full outline typeface. Keep strings short.
- **Wall text is raised only.** A raised legend sits proud of the wall as its own body.
  Recessed (embossed) wall text needs a true pocket carved into the wall, which requires
  boolean subtraction and is not in this engine. Lid emboss recesses into the solid lid;
  wall emboss does not exist yet.
- **No boolean CSG.** Cutouts are placed by construction, not subtracted. Overlapping or
  ill-fitting cutouts are dropped with a warning rather than merged. If you need two
  cutouts to share an opening, model it as one wider cutout.
- **Vent auto-layout routes around the exit slot, not every connector.** Vents will move
  to the clear side of a GPIO exit slot on the same wall, and the count shrinks to fit.
  A vent that still lands on a connector cutout is dropped with a warning rather than
  merged. Full connector-aware nesting is future work.
- **STL and 3MF, no STEP.** 3MF carries units and separate objects; STL does not, so if
  you export STL confirm your slicer imports in millimetres.
- **Fan fit is enforced.** A wall fan that will not fit a short wall, or a lid fan whose
  mounting pattern would fall off the lid, is left off with a warning. Put a big fan on a
  bigger case.
- **DIN cradle is a fixed clip, not a sprung one.** It grips the rail by a slight flex of
  the printed hooks, so print it in PETG or ABS for give and tune the fit with the coupon.
  A true spring latch is future work.
- **Gasket needs wall to spare.** The O-ring channel is carved from the rim by
  construction, so it needs solid lips either side. On a thin wall it is skipped with a
  warning. There is no matching bead on the lid yet; the lid face compresses the O-ring.
- **Custom board entry is by prompt.** Measure-your-own uses simple prompts for each port
  and hole. It is functional and saves into the project, but there is no drag-on-canvas
  placement yet.
- **Not a slicer.** Wall thickness, bosses, and clearances are print-aware, but supports,
  infill, orientation, and material are your slicer's job.
- **PWA layer deferred.** Disk-first only. A service worker cannot register from
  `file://`, so offline caching is a later, additive concern, never load-bearing.

## Files

- `index.html` : the instrument. This is the release.
- `engine.js` : the geometry engine, embedded into `index.html` at build. Kept separate
  for the Node test harnesses.
- `test.js`, `test-model.js`, `test-v11.js`, `test-v12.js` : Node assertion harnesses.
  Run each with `node <file>`. `test-v11.js` covers wall text, the lid fan, and 3MF;
  `test-v12.js` covers mounting tabs, the DIN cradle, the gasket groove, custom boards,
  and the new board library.

Make. Hack. Learn. Share. Repeat.
