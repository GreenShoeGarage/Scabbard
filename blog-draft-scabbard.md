# The case that fits the board: building SCABBARD

*Draft for Gears of Resistance*

There is a particular indignity in finishing a board project and then having nowhere to
put it. The thing works. It sits on the bench in a tangle, and every time you move it a
jumper pops loose. You go looking for an enclosure and you find one of two things: a
generic project box that fits nothing, or a Thingiverse STL for the exact board you have,
built by someone who put the USB port three millimetres off from where yours actually is.

So I built the tool I wanted. It is called SCABBARD, the newest Field Instrument in the
bench, number 111. You give it a board and it gives you a case fitted to that board:
mounting bosses on the real hole coordinates, cutouts where the ports actually are, a lid
that snaps or screws down, and text on top if you want it. It exports STL. It runs from a
single HTML file you double-click. No server, no account, no upload, no build step. Your
board, your tolerances, your file.

A scabbard is a sheath fitted to a blade. That is the whole idea.

## Owning the geometry

I could have reached for a WebGL library and a CSG engine and had a preview and boolean
cutouts in an afternoon. I did not, and the reason is the same reason all of these
instruments are one file that runs from disk: I want to understand the tools I depend on,
and I want them to still work in ten years when the CDN that hosted the library is a
parked domain. Owning your data and understanding your tools is worth the learning curve.

So the mesh engine is hand-rolled. Boxes, shelled walls, chamfers, bosses with heat-set
bores, extruded text, and the STL writer are all original code. The one piece I did not
reinvent is the polygon triangulation, the step that turns a wall with holes in it into a
list of triangles. That is a genuinely hard problem with a well-known good answer, so I
hand-ported the ear-clipping approach that Mapbox open-sourced, adapted it for watertight
extrusion, and moved on.

And that port is where the interesting bug lived.

## Two vents and a hole in the world

Everything passed. One board, one connector, one vent slot: watertight, closed, correct.
Then I put four vents on the back wall of a Pi case and the mesh sprang leaks. Not
everywhere. Just along the bottom edge of the vent slots, a neat row of open edges where
there should have been solid wall.

Here is the thing that made it maddening: the triangulation was *correct*. I checked the
area. The triangles covered exactly the right region, wall minus the holes, down to the
square millimetre. The holes were the right size and in the right place. But the tunnel
walls that connect the outer face of the case to the inner face, the little collars that
make each vent an actual hole and not just a painted rectangle, no longer lined up with
the face. There was a gap of nothing between them.

The culprit was a detail of ear-clipping I had never had to think about. When you have
several holes in one panel, the algorithm bridges them into the outer boundary one at a
time by cutting a channel to each. When two holes sit at exactly the same height, as vents
do, that bridge runs dead horizontal, straight along the bottom edge of a neighbour. And
the algorithm, being tidy, notices that the bridge and the hole edge are collinear and
quietly deletes the shared corner as redundant. The face triangulation does not need that
corner. But my tunnel walls were built from the original hole, corner and all. The face
had healed over a vertex that the tunnel still expected to be there. A T-junction. A seam.

The area was right because the area does not care about a missing vertex on a straight
line. Watertightness cares very much.

The fix is almost embarrassingly small once you see it. I stagger each cutout on a wall by
twelve microns in height. Twelve thousandths of a millimetre, a fraction of a single print
layer, far below anything a nozzle can resolve. Invisible in the plastic. But it is enough
that no two holes share an exact edge line, so the bridge never runs collinear, so the
corner never gets deleted, so the tunnel and the face stay welded. I also finished porting
the two fallback passes of the algorithm that the reduced version had skipped, which
handle the genuinely gnarly cases the simple pass gives up on.

Then I did the thing you always have to do. I wrote it down, in a comment, in the code,
for the version of me who finds this in a year and wonders why there is a magic 0.012 in
the wall builder and reaches to delete it.

## Block, do not corrupt

The other principle SCABBARD inherited from COOPER, its laser-cutting cousin, is that a
tool should refuse to make a broken thing. If you ask for a 40 mm fan on the side wall of
a case that is 28 mm tall, it cannot fit, and older me would have let the geometry punch
through the floor and hand you a lie. SCABBARD drops it and says so, in plain language, in
a warnings strip. Two cutouts that overlap: it keeps the first and drops the second and
tells you. The interior height quietly grows to clear the tallest connector so your
stacked USB jack is never sheared off by the rim. The tool would rather give you less and
tell you than give you a file that fails on the plate.

There is a self-test button that will, on demand, rebuild every board in every lid style,
confirm each mesh is closed and correctly wound, and round-trip it through the STL writer
and back. Green means the case will not leak. I ship nothing until it is green.

## Try it

It fits the Arduino Uno R4 and Uno Q, the MKR line, the Pi 4 and Pi 5, and a generic box
you can drive by hand. Print the little fit-test coupon first to learn your printer's real
tolerance, then print the case. The board dimensions are good starting numbers, not gospel,
so check them against the mechanical drawing before a long print.

It is one file. It is yours. It works when the internet does not.

Make. Hack. Learn. Share. Repeat.
