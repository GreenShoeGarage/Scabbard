var E = require("./engine.js");
var buildModel = E.SCAB_MODEL.buildModel, BOARDS = E.SCAB_MODEL.BOARDS;
var check = E.SCAB_CHECK.checkManifold, vol = E.SCAB_CHECK.meshVolume;
var STL = E.SCAB_STL, Mesh = E.SCAB_MESH;

var fails = 0;

// per-body manifold check: slice each body's triangles into a temp mesh-like and check
function checkBodies(mesh, tag) {
  var V = mesh.verts, T = mesh.tris, ok = true;
  var list = mesh.bodies.length ? mesh.bodies : [{ start: 0, count: T.length / 3, name: "all" }];
  for (var bi = 0; bi < list.length; bi++) {
    var b = list[bi], sub = { verts: V, tris: [] };
    for (var t = b.start; t < b.start + b.count; t++) sub.tris.push(T[t*3], T[t*3+1], T[t*3+2]);
    var c = check(sub), v = vol(sub);
    // Text legends are emitted as overlapping stroke prisms: self-intersection
    // (nonmanifold) is expected and slicer-unioned. Require closed + consistent
    // winding + positive volume for text; full manifold for structural bodies.
    var isText = b.name === "text";
    var good = c.closed && c.consistent && v > 0.001 && (isText || c.manifold);
    if (!good) { ok = false;
      console.log("   BODY FAIL " + tag + "/" + b.name + " tris=" + b.count +
        " boundary=" + c.boundary + " nonmani=" + c.nonmanifold + " flipped=" + c.flipped + " vol=" + v.toFixed(2));
    }
  }
  return ok;
}

function testPart(name, mesh) {
  var c = check(mesh), v = vol(mesh);
  // Multi-body parts intentionally overlap (tongue into slab, text on lid);
  // whole-mesh manifold is not meaningful across bodies. Require closed +
  // consistent on the whole, and full manifold per body (relaxed for text).
  var wholeOK = c.closed && c.consistent && v > 0;
  var bodyOK = checkBodies(mesh, name);
  var ok = wholeOK && bodyOK;
  console.log((ok ? "  PASS " : "  FAIL ") + name + "  bodies=" + mesh.bodies.length +
    " tris=" + mesh.triCount() + " whole[b=" + c.boundary + " nm=" + c.nonmanifold + " f=" + c.flipped + "] vol=" + v.toFixed(0));
  if (!ok) fails++;
  return ok;
}

Object.keys(BOARDS).forEach(function (key) {
  console.log("\n== " + key + " (" + BOARDS[key].name + ") ==");
  var cfg = { board: key, lidAttach: key === "generic" ? "screw" : "snap",
    text: { str: key.toUpperCase().slice(0,6), size: 6, mode: "raised", height: 0.8 },
    vents: { side: "back", count: 4 }, fan: (key === "pi5") ? { side: "back", size: 40 } : null,
    exitSlot: (key === "pi4" || key === "pi5") ? { side: "back", off: 20, w: 22, h: 6 } : null };
  var M = buildModel(cfg);
  testPart("base", M.base);
  testPart("lid", M.lid);
  if (key === "generic") testPart("coupon", M.coupon);
  if (M.warnings.length) console.log("   warnings:", M.warnings);
});

// STL round-trip on one full base
var M = buildModel({ board: "pi5", lidAttach: "snap", text: { str: "PI5", size: 8, mode: "raised" } });
var bin = STL.meshToBinarySTL(M.base);
var re = STL.parseBinarySTL(bin);
var rc = check(re);
console.log("\nSTL round-trip pi5 base: reparsed tris=" + re.triCount() + " boundary=" + rc.boundary + " nonmani=" + rc.nonmanifold);
if (rc.boundary !== 0 || rc.nonmanifold !== 0) fails++;

// emboss text variant
var Me = buildModel({ board: "uno_r4", lidAttach: "snap", text: { str: "UNO", size: 8, mode: "emboss", depth: 0.8 } });
console.log("\n== emboss lid text ==");
testPart("lid(emboss)", Me.lid);

console.log(fails === 0 ? "\nALL MODEL TESTS PASS" : "\n" + fails + " FAILURES");
process.exit(fails === 0 ? 0 : 1);
