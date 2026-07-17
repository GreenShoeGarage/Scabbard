# A ZIP file is just bytes: SCABBARD learns 3MF

*Draft for Gears of Resistance*

SCABBARD, the board-fitted enclosure generator, shipped its first version able to export
STL. STL is the lingua franca of 3D printing and it works, but it has two real failings.
It carries no units, so a case modeled in millimetres can import as an inch-scale monster
if the slicer guesses wrong. And it has no notion of separate parts: a base with its
bosses and a lid with its posts come through as one undifferentiated cloud of triangles
that the slicer has to guess how to split.

3MF fixes both. It is a modern format, it declares its units, and it can hold several
named objects in one file. So v1.1 exports 3MF, and the base and lid arrive as two
objects the slicer can pick up and arrange independently.

Here is the catch that made this interesting. A 3MF file is a ZIP archive. Inside it are
a few small XML files describing the mesh and the package. And SCABBARD is one HTML file
that runs from disk with no libraries, on purpose. So I could not reach for a ZIP library.
I had to write the ZIP container by hand.

## The format nobody reads

Everyone uses ZIP a thousand times a day and almost nobody has looked at one. I had not,
not really, until this. It turns out to be one of those formats that is intimidating from
a distance and almost friendly up close, the way a lot of things are once you stop being
afraid of them.

A ZIP file, stripped to its bones, is three things. First, each file inside gets a little
header followed by its bytes: a magic number so tools know what they are looking at, a few
fields for sizes and a checksum, the file name, then the data. String these together, one
per file. Second, after all the files comes a central directory, which is the same
information again in a slightly different shape, a table of contents that lets a reader
jump straight to any file without scanning the whole archive. Third, a short record at the
very end that says where the table of contents starts and how many files there are. A
reader opens a ZIP by seeking to the end, reading that last record, jumping to the
directory, and going from there.

That is the whole idea. There is compression too, of course, that is the thing ZIP is
famous for. But compression is optional. The format has a mode called "stored" that means
the bytes go in raw, uncompressed. For three tiny XML files describing a case, compression
would save nothing worth the code, so SCABBARD stores them plain. That decision turned a
daunting task into an afternoon: no deflate, no Huffman tables, just headers and bytes in
the right order with the right little-endian integers.

## The checksum that made me slow down

There is one field you cannot fake: the CRC-32 checksum of each file's contents. The
reader recomputes it and rejects the archive if it does not match. This is the part that
either works or silently produces a file every tool refuses to open, which is a miserable
way to spend an evening.

CRC-32 is a beautiful little algorithm. It is essentially long division in a strange kind
of arithmetic, and the fast version precomputes a table of 256 values so you can process a
byte at a time with a lookup and an exclusive-or. I typed it in from the definition,
generated the table at load, and then did the thing you always do with code that has to be
exactly right and gives no partial credit: I tested it against a known answer. I made
SCABBARD write a 3MF, then opened it with a completely separate, boring, industrial-grade
ZIP tool and asked that tool to verify every checksum. When it said all good, I believed
it. When the model XML parsed and the vertex counts matched the mesh down to the last
triangle, I believed that too.

That is the whole discipline, really. Do not trust your own new code because it looks
right. Make something else that you did not write check it, and only then move on.

## The other three things v1.1 learned

The 3MF work was the deep end, but the release carries three more everyday additions.

You can now put text on the outside of a wall, not just the lid, a raised legend proud of
the surface. There was a subtle trap here worth naming: the first version came out inside
out, every surface facing the wrong way, because the little coordinate frame I used to
place text on a vertical wall was a mirror image of the one that works flat on the lid. A
mirror flips a shape's sense of inside and outside. The fix was to build the text flat,
where I know it is right, and then rotate it onto the wall with a motion that turns
without flipping. Same lesson as always: reuse the thing you have already proven, do not
re-derive it in a new orientation and hope.

You can mount a fan on the lid now, blowing down through it, with the opening and the four
screw holes placed at the real spacing for the fan size. And if you ask for a fan that
does not fit, an eighty millimetre fan on a Raspberry Pi lid the fan is wider than, it
declines and tells you, rather than punching mounting holes off the edge of the part.
Block, do not corrupt. That principle earns its keep in every release.

And the vents got polite. If you put breathing slots and a GPIO exit slot on the same
wall, the vents now step aside and cluster in the clear space next to the slot instead of
colliding with it. They shrink their own count to fit if they have to, and say so.

## The through-line

None of this needed a dependency. A ZIP writer, a checksum, a fan mount, text on a wall.
Every piece is a couple dozen lines that I now understand, in a file that will still open
in a browser in ten years because it asks nothing of the world but a browser. That is the
whole bet of these instruments, and 3MF was a good test of it. The format that felt like
it must require a library turned out to be bytes in an order, and the order is written
down for anyone willing to read it.

Own your tools. Read the format. It is just bytes.

Make. Hack. Learn. Share. Repeat.
