# Which way is out? SCABBARD learns to mount itself

*Draft for Gears of Resistance*

A case that just sits on the bench is only half a case. The other half is how it attaches
to the world: screwed to a panel, hung on a wall, clipped to a DIN rail in an electrical
enclosure. So v1.2 of SCABBARD, the board-fitted enclosure generator, grew mounting
hardware. Flange tabs with plain holes or keyholes. A printed DIN-rail cradle. An optional
gasket channel in the rim for an O-ring. And a way to type in a board it has never heard
of and get a fitted case anyway.

Most of that is geometry I have written before in other shapes: extrude a profile, punch a
hole, weld it watertight. What made this release worth writing about is that nearly every
new piece failed the same way at first, and the failure has a single name that runs
underneath all of computer graphics: orientation. Which way is out?

## The surface that knows its own inside

Every triangle in a 3D model has a front and a back. By convention the front faces out,
away from the solid, and the direction is encoded in the order you list the corners:
counterclockwise when viewed from outside. Get that order right on every triangle and the
model is a solid with a well-defined inside. Get it backwards on even a few and the model
is inside out there, a little pocket of "outside" trapped in the material, and slicers and
repair tools start to disagree about what is solid and what is air.

I have a test that catches this. It walks every shared edge and checks that the two
triangles meeting there run along it in opposite directions, the way two floor tiles meet
at a seam. When they do not, it counts a "flipped" edge. A clean body has zero. When I
first built the mounting tabs, the whole base came back with ninety-six flipped edges.

## Three ways to point the wrong way

The tabs were the first offender, and the fix was almost funny. I had reused the exact
pattern that cuts a window in the lid, a flat plate with a hole punched through and a
little tunnel of wall connecting top to bottom. But I had "helpfully" forced the hole
outline to run clockwise, thinking a hole should wind opposite to the plate. The proven
lid code does no such thing; it hands the hole to the triangulator counterclockwise and
lets the fill routine sort out the winding. My clockwise hole flipped the entire tunnel.
Twenty-four segments, two triangles each, times two tabs: ninety-six. I deleted one word,
the reversal, and it went to zero. The lesson I keep relearning: when you copy a routine
that works, copy what it actually does, not what you assume it must be doing.

The DIN cradle was subtler. It is built by sweeping a hook-shaped cross-section along the
length of the rail, and my hand-written sweep pointed every face inward. The whole cradle
was a perfectly formed pocket of negative space. Rather than reason my way through the
winding of a swept prism, I threw the hand-written sweep away and built it from a routine I
already trusted, the plain vertical extrude, then rotated the result into place. A rotation
cannot turn a solid inside out; only a mirror can. Reuse the trustworthy thing and move it
with an honest motion, and correctness comes along for free.

And the wall text from the last release had taught me the same thing a month earlier: it
came out inverted because I had placed it with a frame that was secretly a mirror image.
Same disease, same cure. Build it where you know it is right, then move it without
flipping.

## The bug that was not about winding at all

One failure broke the pattern, and it is my favorite kind: the small case nobody thinks
about until it corrupts something. A tiny board, an Arduino Nano, produced a base with
eight open edges, a hole in the surface. Nothing to do with orientation. The culprit was
the recessed feet in the four corners of the bottom. On a normal box they sit well apart.
On an eighteen-millimeter-deep box the two feet on one side reached toward each other until
their circles overlapped, and two overlapping holes punched in the same face is a shape the
triangulator cannot honestly fill. It left a gap.

The fix is the principle this whole project runs on. Do not corrupt the part to satisfy the
request. Shrink the feet until they fit, and if they cannot fit at all, leave them out and
say so in the warnings. Block, do not corrupt. A tool that quietly hands you a broken model
is worse than one that tells you it could not do the thing you asked.

## Measure your own board

The last piece needed no new geometry at all, which is its own kind of satisfying. The
engine already accepted a board size, a list of holes, and a list of ports as plain
numbers; the named boards are just presets that fill those in. So "measure your own board"
is mostly a matter of letting you type the numbers yourself, and then saving them in the
project file so the board you measured once is yours forever. The escape hatch was there
the whole time. v1.2 just put a handle on it.

## The through-line

Mounting tabs, a rail clip, a rubber seal, a custom board. Different features, one lesson
repeated until it stuck: a shape is not just where its surfaces are, but which way they
face, and the safest way to get the facing right is to never derive it twice. Build the
thing where you trust it. Move it with a rotation, never a mirror. And when the part will
not honor the request, refuse the request, do not wreck the part.

Own your tools. Know which way is out.

Make. Hack. Learn. Share. Repeat.
