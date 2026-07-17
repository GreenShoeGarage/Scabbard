var E = require("./engine.js");
var Mesh = E.SCAB_MESH, buildShell = E.SCAB_SHELL.buildShell;
var check = E.SCAB_CHECK.checkManifold, vol = E.SCAB_CHECK.meshVolume, bounds = E.SCAB_CHECK.bounds;
var STL = E.SCAB_STL;

var fails = 0;
function report(name, m) {
  var c = check(m), v = vol(m), b = bounds(m);
  var ok = c.closed && c.manifold && c.consistent && v > 0;
  console.log((ok ? "PASS " : "FAIL ") + name +
    "  tris=" + m.triCount() + " edges=" + c.edges +
    " boundary=" + c.boundary + " nonmani=" + c.nonmanifold + " flipped=" + c.flipped +
    " vol=" + v.toFixed(1));
  if (!ok) { fails++; }
  return c;
}

function shell(cfg) { var m = new Mesh(); m.warn = []; buildShell(m, Object.assign({ warn: m.warn }, cfg)); return m; }

// 1. plain sharp box
report("min-fillet box, no holes", shell({ W: 80, D: 60, wall: 2.4, floor: 2.4, height: 30, r: 0, arc: 0, chamfer: 0 }));
// 2. sharp box with chamfer
report("min-fillet box + chamfer", shell({ W: 80, D: 60, wall: 2.4, floor: 2.4, height: 30, r: 0, arc: 0, chamfer: 1.2 }));
// 3. rounded box
report("rounded box", shell({ W: 80, D: 60, wall: 2.4, floor: 2.4, height: 30, r: 4, arc: 8, chamfer: 1.2 }));
// 4. rounded box with a USB-C hole on front
var m4 = shell({ W: 80, D: 60, wall: 2.4, floor: 2.4, height: 30, r: 4, arc: 8, chamfer: 1.2,
  wallFeatures: { front: [{ label: "USB-C", u: 40, z: 8, w: 10, h: 4, shape: "rect" }] } });
report("rounded box + USB-C rect hole", m4);
// 5. multiple holes incl round
var m5 = shell({ W: 90, D: 70, wall: 2.4, floor: 2.4, height: 32, r: 3, arc: 6, chamfer: 1.0,
  wallFeatures: {
    front: [{ label: "USB-C", u: 30, z: 7, w: 10, h: 4 }, { label: "barrel", u: 55, z: 7, w: 9, h: 9, shape: "round" }],
    right: [{ label: "hdmi", u: 20, z: 9, w: 15, h: 6 }]
  } });
report("box + 3 mixed holes", m5);
console.log("m5 warnings:", m5.warn);

// 6. STL round trip on m4
var bin = STL.meshToBinarySTL(m4);
var re = STL.parseBinarySTL(bin);
var rc = report("STL binary round-trip (m4)", re);
console.log("original edges", check(m4).edges, "reparsed edges", rc.edges);

console.log(fails === 0 ? "\nALL SHELL TESTS PASS" : "\n" + fails + " FAILURES");
process.exit(fails === 0 ? 0 : 1);
