# I built a boolean engine, and it taught me why they are hard

*Draft for Gears of Resistance*

For a year of enclosure work SCABBARD has done everything by construction. Every hole, every
boss, every wall was placed by building the exact triangles, in the exact order, so the
result came out watertight on the first try. It never subtracted one shape from another,
because subtracting shapes, real constructive solid geometry, is famously one of the harder
things in computational geometry, and I wanted to earn my way up to it.

v2.0 was the release where I finally wrote the boolean engine. It went about the way the old
hands warned me it would, and the story is worth telling honestly, because the interesting
part is not the win. It is the wall I hit, and the decision I made when I hit it.

## The engine

The classic way to do mesh booleans without a library is a BSP tree: partition space by the
planes of one solid's faces, use that partition to sort the other solid's faces into inside
and outside, throw away the parts you do not want, and stitch the rest back together. It is
an elegant algorithm and it is only a few hundred lines. I hand-rolled it, no dependencies,
same as everything else in this file.

And on clean inputs it works beautifully. Subtract a box from a slab and you get a perfect
watertight recess. The volume comes out exact to the cubic millimeter. I added a healing
pass to close the T-junctions that BSP CSG leaves behind, the little seams where a cut edge
on one face meets the middle of another, and after healing the box-in-slab result is fully
manifold. Zero boundary edges, zero non-manifold edges. Clean.

So SCABBARD v2.0 can now mill a real recessed pocket into the lid. Drop an inset label area,
a flush bezel for a screen, a plaque you can set raised text into. That is a genuinely new
capability that construction alone could never give me, and it is rock solid.

## The wall

Then I tried to engrave text, which was the headline I had promised myself for v2, the thing
that would finally turn the old cosmetic emboss into a real recess. And text is where the
elegant algorithm falls off a cliff.

The trouble is that the strokes of a letter overlap. An A is not four separate rectangles;
it is four rectangles that share corners and cross in the middle. When you hand a boolean
engine a cutter made of overlapping boxes, you have handed it a shape whose own surface
passes through itself, and BSP CSG has no idea what to do with that. The output comes back
with holes in it.

The textbook fix is to union the strokes into one clean solid first, then subtract that. So I
tried. Unioning a whole word, thirty-odd overlapping strokes, one after another. The polygon
count roughly doubled with each union as the tree re-clipped everything against everything,
the healing pass got slower on the growing mesh, and somewhere around the fourth letter the
whole thing ran the machine out of memory and fell over.

That is not a bug I can patch. That is the actual, well-known reason people write libraries
like Manifold and spend years making them robust and fast. Coplanar faces, self-intersecting
inputs, numerical robustness, the combinatorial blowup of chained operations: these are the
hard parts, and a few hundred lines of hand-rolled BSP does not solve them. It was never
going to.

## The decision

Here is the part I actually care about. When you hit a wall like that, you have a choice, and
the choice reveals what kind of tool you are building.

I could have shipped the engraving anyway. The self-intersecting version produces something,
after all; the volume is roughly right; a lot of slicers would auto-repair the mess and print
it, mostly. Plenty of software ships exactly that and calls it a feature.

I did not, because SCABBARD's entire promise, the thing that separates it from a toy, is that
what it hands you is watertight. Every version has held that line. Shipping a text feature
that quietly emits torn, non-manifold meshes would trade the one guarantee that matters for a
checkbox on a release note. Not worth it.

So v2.0 ships the CSG engine, and it ships the pocket, the case the engine handles cleanly and
provably. Every boolean result is checked before it is used, and if it does not come out
watertight and manifold, the feature declines and falls back rather than handing you a broken
part. True per-glyph engraving stays on the shelf, honestly labeled as future work that needs
a real polygon-union step, and in the meantime the recess pocket plus raised text gives you
the engraved-plaque look with none of the risk.

Alongside it, two smaller things that did not need the boolean engine at all: the gasket now
has a matching bead on the lid that seats into the base channel, and the DIN clip has a sprung
variant with thin flexing lips. Both built the old way, by construction, watertight on the
first try.

## The through-line

A boolean engine was the one tool I had put off building for a year, and now that I have built
it I understand exactly why the good ones are hard, and why the honest move is to use it only
where I can prove it is clean. The win was never going to be "SCABBARD does everything now."
The win is that it does the thing it can do perfectly, tells the truth about the thing it
cannot, and never once hands you a part with a hole in it.

Own your tools. Know their edges. Ship the truth.

Make. Hack. Learn. Share. Repeat.
