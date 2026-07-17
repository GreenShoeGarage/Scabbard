/* SCABBARD engine :: geometry, boards, STL, validators
   License: GPL-3.0. Hand-rolled, no external libraries.
   Loaded both in the browser (attached to window.SCAB) and in Node (module.exports).
   All units are millimetres. Right handed: +x right, +y back (depth), +z up. */
(function (root) {
  "use strict";

  var ENGINE_VERSION = "1.2.1";

  /* ---------------------------------------------------------------- vec */
  function v3(x, y, z) { return [x, y, z]; }
  function sub(a, b) { return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]; }
  function cross(a, b) {
    return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
  }
  function norm(a) {
    var L = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0]/L, a[1]/L, a[2]/L];
  }

  /* -------------------------------------------------------------- Mesh */
  /* A Mesh is a welded, indexed triangle list. Welding by rounded coord
     is what lets the manifold check pair up shared edges. */
  function Mesh() {
    this.verts = [];      // flat [x,y,z, x,y,z, ...]
    this.tris = [];       // flat [i,j,k, ...]
    this._map = Object.create(null);
    this.bodies = [];     // [{start, count, name}] triangle ranges (multi-body)
    this._bodyStart = 0;
    this._bodyName = "body";
  }
  var WELD = 1e4; // 0.0001 mm grid
  Mesh.prototype.vid = function (x, y, z) {
    var kx = Math.round(x * WELD), ky = Math.round(y * WELD), kz = Math.round(z * WELD);
    var key = kx + "," + ky + "," + kz;
    var idx = this._map[key];
    if (idx !== undefined) return idx;
    idx = this.verts.length / 3;
    this.verts.push(kx / WELD, ky / WELD, kz / WELD);
    this._map[key] = idx;
    return idx;
  };
  Mesh.prototype.tri = function (a, b, c) {
    if (a === b || b === c || a === c) return; // drop degenerate
    this.tris.push(a, b, c);
  };
  Mesh.prototype.triP = function (p, q, r) {
    this.tri(this.vid(p[0], p[1], p[2]), this.vid(q[0], q[1], q[2]), this.vid(r[0], r[1], r[2]));
  };
  Mesh.prototype.quadP = function (a, b, c, d) { // CCW a,b,c,d
    this.triP(a, b, c); this.triP(a, c, d);
  };
  Mesh.prototype.beginBody = function (name) {
    this._bodyStart = this.tris.length / 3; this._bodyName = name || "body";
  };
  Mesh.prototype.endBody = function () {
    var start = this._bodyStart, count = this.tris.length / 3 - start;
    if (count > 0) this.bodies.push({ start: start, count: count, name: this._bodyName });
  };
  Mesh.prototype.triCount = function () { return this.tris.length / 3; };

  /* --------------------------------------------------------- earcut
     Ported ear-clipping with hole bridging (mapbox earcut, O(n^2) core,
     z-order hashing omitted; our polygons are small). Public domain algo. */
  function Node(i, x, y) {
    this.i = i; this.x = x; this.y = y;
    this.prev = null; this.next = null;
    this.steiner = false;
  }
  function earcut(data, holeIndices) {
    var hasHoles = holeIndices && holeIndices.length;
    var outerLen = hasHoles ? holeIndices[0] * 2 : data.length;
    var outerNode = linkedList(data, 0, outerLen, true);
    var triangles = [];
    if (!outerNode || outerNode.next === outerNode.prev) return triangles;
    if (hasHoles) outerNode = eliminateHoles(data, holeIndices, outerNode);
    earcutLinked(filterPoints(outerNode), triangles);
    return triangles;
  }
  function linkedList(data, start, end, clockwise) {
    var i, last;
    if (clockwise === (signedArea(data, start, end) > 0)) {
      for (i = start; i < end; i += 2) last = insertNode(i / 2, data[i], data[i + 1], last);
    } else {
      for (i = end - 2; i >= start; i -= 2) last = insertNode(i / 2, data[i], data[i + 1], last);
    }
    if (last && equals(last, last.next)) { removeNode(last); last = last.next; }
    return last;
  }
  function filterPoints(start, end) {
    if (!start) return start;
    if (!end) end = start;
    var p = start, again;
    do {
      again = false;
      if (!p.steiner && (equals(p, p.next) || area(p.prev, p, p.next) === 0)) {
        removeNode(p); p = end = p.prev;
        if (p === p.next) break;
        again = true;
      } else { p = p.next; }
    } while (again || p !== end);
    return end;
  }
  function earcutLinked(ear, triangles, pass) {
    if (!ear) return;
    var stop = ear, prev, next;
    while (ear.prev !== ear.next) {
      prev = ear.prev; next = ear.next;
      if (isEar(ear)) {
        triangles.push(prev.i, ear.i, next.i);
        removeNode(ear);
        ear = next.next; stop = next.next; continue;
      }
      ear = next;
      if (ear === stop) {
        // no ear found this pass: try successively harder fixes
        if (!pass) earcutLinked(filterPoints(ear), triangles, 1);
        else if (pass === 1) { ear = cureLocalIntersections(filterPoints(ear), triangles); earcutLinked(ear, triangles, 2); }
        else if (pass === 2) splitEarcut(ear, triangles);
        break;
      }
    }
  }
  // go through all polygon nodes and cure small local self-intersections
  function cureLocalIntersections(start, triangles) {
    var p = start;
    do {
      var a = p.prev, b = p.next.next;
      if (!equals(a, b) && intersects(a, p, p.next, b) && locallyInside(a, b) && locallyInside(b, a)) {
        triangles.push(a.i, p.i, b.i);
        removeNode(p); removeNode(p.next);
        p = start = b;
      }
      p = p.next;
    } while (p !== start);
    return filterPoints(p);
  }
  // interconnect a polygon using diagonals; split into two, triangulate each
  function splitEarcut(start, triangles) {
    var a = start;
    do {
      var b = a.next.next;
      while (b !== a.prev) {
        if (a.i !== b.i && isValidDiagonal(a, b)) {
          var c = splitPolygon(a, b);
          a = filterPoints(a, a.next);
          c = filterPoints(c, c.next);
          earcutLinked(a, triangles); earcutLinked(c, triangles);
          return;
        }
        b = b.next;
      }
      a = a.next;
    } while (a !== start);
  }
  function isValidDiagonal(a, b) {
    return a.next.i !== b.i && a.prev.i !== b.i && !intersectsPolygon(a, b) &&
      ((locallyInside(a, b) && locallyInside(b, a) && middleInside(a, b) &&
        (area(a.prev, a, b.prev) || area(a, b.prev, b))) ||
       (equals(a, b) && area(a.prev, a, a.next) > 0 && area(b.prev, b, b.next) > 0));
  }
  function sign(n) { return n > 0 ? 1 : n < 0 ? -1 : 0; }
  function onSeg(p, q, r) {
    return q.x <= Math.max(p.x, r.x) && q.x >= Math.min(p.x, r.x) &&
           q.y <= Math.max(p.y, r.y) && q.y >= Math.min(p.y, r.y);
  }
  function intersects(p1, q1, p2, q2) {
    var o1 = sign(area(p1, q1, p2)), o2 = sign(area(p1, q1, q2)),
        o3 = sign(area(p2, q2, p1)), o4 = sign(area(p2, q2, q1));
    if (o1 !== o2 && o3 !== o4) return true;
    if (o1 === 0 && onSeg(p1, p2, q1)) return true;
    if (o2 === 0 && onSeg(p1, q2, q1)) return true;
    if (o3 === 0 && onSeg(p2, p1, q2)) return true;
    if (o4 === 0 && onSeg(p2, q1, q2)) return true;
    return false;
  }
  function intersectsPolygon(a, b) {
    var p = a;
    do {
      if (p.i !== a.i && p.next.i !== a.i && p.i !== b.i && p.next.i !== b.i &&
          intersects(p, p.next, a, b)) return true;
      p = p.next;
    } while (p !== a);
    return false;
  }
  function middleInside(a, b) {
    var p = a, inside = false, px = (a.x + b.x) / 2, py = (a.y + b.y) / 2;
    do {
      if (((p.y > py) !== (p.next.y > py)) && p.next.y !== p.y &&
          (px < (p.next.x - p.x) * (py - p.y) / (p.next.y - p.y) + p.x)) inside = !inside;
      p = p.next;
    } while (p !== a);
    return inside;
  }
  function isEar(ear) {
    var a = ear.prev, b = ear, c = ear.next;
    if (area(a, b, c) >= 0) return false;
    var p = ear.next.next;
    while (p !== ear.prev) {
      if (pointInTriangle(a.x, a.y, b.x, b.y, c.x, c.y, p.x, p.y) && area(p.prev, p, p.next) >= 0) return false;
      p = p.next;
    }
    return true;
  }
  function eliminateHoles(data, holeIndices, outerNode) {
    var queue = [], i, len, start, end, list;
    for (i = 0, len = holeIndices.length; i < len; i++) {
      start = holeIndices[i] * 2;
      end = i < len - 1 ? holeIndices[i + 1] * 2 : data.length;
      list = linkedList(data, start, end, false);
      if (list === list.next) list.steiner = true;
      queue.push(getLeftmost(list));
    }
    queue.sort(function (a, b) { return a.x - b.x; });
    for (i = 0; i < queue.length; i++) outerNode = eliminateHole(queue[i], outerNode);
    return outerNode;
  }
  function eliminateHole(hole, outerNode) {
    var bridge = findHoleBridge(hole, outerNode);
    if (!bridge) return outerNode;
    var bridgeReverse = splitPolygon(bridge, hole);
    filterPoints(bridgeReverse, bridgeReverse.next);
    return filterPoints(bridge, bridge.next);
  }
  function findHoleBridge(hole, outerNode) {
    var p = outerNode, hx = hole.x, hy = hole.y, qx = -Infinity, m;
    do {
      if (hy <= p.y && hy >= p.next.y && p.next.y !== p.y) {
        var x = p.x + (hy - p.y) / (p.next.y - p.y) * (p.next.x - p.x);
        if (x <= hx && x > qx) { qx = x; m = p.x < p.next.x ? p : p.next; if (x === hx) return m; }
      }
      p = p.next;
    } while (p !== outerNode);
    if (!m) return null;
    var stop = m, mx = m.x, my = m.y, tanMin = Infinity, tan;
    p = m;
    do {
      if (hx >= p.x && p.x >= mx && hx !== p.x &&
        pointInTriangle(hy < my ? hx : qx, hy, mx, my, hy < my ? qx : hx, hy, p.x, p.y)) {
        tan = Math.abs(hy - p.y) / (hx - p.x);
        if (locallyInside(p, hole) && (tan < tanMin || (tan === tanMin && (p.x > m.x || (p.x === m.x && sectorContainsSector(m, p)))))) {
          m = p; tanMin = tan;
        }
      }
      p = p.next;
    } while (p !== stop);
    return m;
  }
  function sectorContainsSector(m, p) { return area(m.prev, m, p.prev) < 0 && area(p.next, m, m.next) < 0; }
  function getLeftmost(start) {
    var p = start, leftmost = start;
    do { if (p.x < leftmost.x || (p.x === leftmost.x && p.y < leftmost.y)) leftmost = p; p = p.next; } while (p !== start);
    return leftmost;
  }
  function pointInTriangle(ax, ay, bx, by, cx, cy, px, py) {
    return (cx - px) * (ay - py) - (ax - px) * (cy - py) >= 0 &&
      (ax - px) * (by - py) - (bx - px) * (ay - py) >= 0 &&
      (bx - px) * (cy - py) - (cx - px) * (by - py) >= 0;
  }
  function area(p, q, r) { return (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y); }
  function equals(p1, p2) { return p1.x === p2.x && p1.y === p2.y; }
  function locallyInside(a, b) {
    return area(a.prev, a, a.next) < 0 ?
      area(a, b, a.next) >= 0 && area(a, a.prev, b) >= 0 :
      area(a, b, a.prev) < 0 || area(a, a.next, b) < 0;
  }
  function splitPolygon(a, b) {
    var a2 = new Node(a.i, a.x, a.y), b2 = new Node(b.i, b.x, b.y), an = a.next, bp = b.prev;
    a.next = b; b.prev = a; a2.next = an; an.prev = a2; b2.next = a2; a2.prev = b2; bp.next = b2; b2.prev = bp;
    return b2;
  }
  function insertNode(i, x, y, last) {
    var p = new Node(i, x, y);
    if (!last) { p.prev = p; p.next = p; }
    else { p.next = last.next; p.prev = last; last.next.prev = p; last.next = p; }
    return p;
  }
  function removeNode(p) { p.next.prev = p.prev; p.prev.next = p.next; }
  function signedArea(data, start, end) {
    var sum = 0;
    for (var i = start, j = end - 2; i < end; i += 2) { sum += (data[j] - data[i]) * (data[i + 1] + data[j + 1]); j = i; }
    return sum;
  }

  /* ------------------------------------------------ 2D contour helpers */
  function polyArea(pts) { // signed, CCW positive
    var s = 0;
    for (var i = 0, n = pts.length; i < n; i++) {
      var a = pts[i], b = pts[(i + 1) % n];
      s += a[0] * b[1] - b[0] * a[1];
    }
    return s / 2;
  }
  function ensureCCW(pts) { return polyArea(pts) < 0 ? pts.slice().reverse() : pts; }
  function ensureCW(pts) { return polyArea(pts) > 0 ? pts.slice().reverse() : pts; }
  function circlePts(cx, cy, r, seg) {
    var out = [];
    for (var i = 0; i < seg; i++) { var t = i / seg * Math.PI * 2; out.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]); }
    return out;
  }
  function rectPts(cx, cy, w, h) {
    var x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - h / 2, y1 = cy + h / 2;
    return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  }
  function roundedRectPts(w, h, r, arc) {
    r = Math.max(0, Math.min(r, Math.min(w, h) / 2 - 0.01));
    var pts = [];
    if (!arc || arc < 1) return [[-w/2,-h/2],[w/2,-h/2],[w/2,h/2],[-w/2,h/2]];
    r = Math.max(r, 0); // keep count = 4*(arc+1) even for r~0 (coincident corner samples weld)
    var cx = [w/2 - r, w/2 - r, -w/2 + r, -w/2 + r];
    var cy = [-h/2 + r, h/2 - r, h/2 - r, -h/2 + r];
    var a0 = [-Math.PI/2, 0, Math.PI/2, Math.PI];
    for (var c = 0; c < 4; c++) {
      for (var i = 0; i <= arc; i++) {
        var t = a0[c] + (i / arc) * (Math.PI / 2);
        pts.push([cx[c] + r * Math.cos(t), cy[c] + r * Math.sin(t)]);
      }
    }
    return pts; // CCW
  }

  /* Triangulate a CCW outer polygon (2D) with optional CW holes, emit into
     mesh through a frame mapper. frame(x2,y2) -> [X,Y,Z] in world.
     flip=true reverses winding (for faces whose normal points -frame-normal). */
  function fillPolygon(mesh, outer, holes, frame, flip) {
    var data = [], holeIdx = [];
    outer = ensureCCW(outer);
    for (var i = 0; i < outer.length; i++) data.push(outer[i][0], outer[i][1]);
    if (holes) for (var h = 0; h < holes.length; h++) {
      holeIdx.push(data.length / 2);
      var hp = ensureCW(holes[h]);
      for (var j = 0; j < hp.length; j++) data.push(hp[j][0], hp[j][1]);
    }
    var idx = earcut(data, holeIdx.length ? holeIdx : null);
    for (var t = 0; t < idx.length; t += 3) {
      var A = pt(data, idx[t]), B = pt(data, idx[t + 1]), C = pt(data, idx[t + 2]);
      var PA = frame(A[0], A[1]), PB = frame(B[0], B[1]), PC = frame(C[0], C[1]);
      if (flip) mesh.triP(PA, PC, PB); else mesh.triP(PA, PB, PC);
    }
    function pt(d, i) { return [d[i * 2], d[i * 2 + 1]]; }
  }

  /* ------------------------------------------------------- primitives */

  /* Extruded closed prism from a CCW 2D contour, from z0 to z1, capped.
     Emits a watertight solid. Used for bosses, text strokes, generic boxes. */
  function extrudeContour(mesh, contour, z0, z1) {
    contour = ensureCCW(contour);
    var n = contour.length;
    var frameBot = function (x, y) { return [x, y, z0]; };
    var frameTop = function (x, y) { return [x, y, z1]; };
    fillPolygon(mesh, contour, null, frameBot, true);   // bottom faces down
    fillPolygon(mesh, contour, null, frameTop, false);  // top faces up
    for (var i = 0; i < n; i++) {
      var a = contour[i], b = contour[(i + 1) % n];
      mesh.quadP([a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], z1], [a[0], a[1], z1]);
    }
  }

  /* Vertical cylinder with an axial bore (a tube), z0..z1, outer ro, bore rb.
     If rb<=0 it is a solid post; if rb>0 it is an open tube with top+bottom rings. */
  function tube(mesh, cx, cy, z0, z1, ro, rb, seg) {
    seg = seg || 40;
    var out = circlePts(cx, cy, ro, seg);
    if (rb <= 0.01) { extrudeContour(mesh, out, z0, z1); return; }
    var inn = circlePts(cx, cy, rb, seg);
    for (var i = 0; i < seg; i++) {
      var j = (i + 1) % seg;
      // outer wall (faces out)
      mesh.quadP([out[i][0], out[i][1], z0], [out[j][0], out[j][1], z0], [out[j][0], out[j][1], z1], [out[i][0], out[i][1], z1]);
      // inner wall (faces in)
      mesh.quadP([inn[i][0], inn[i][1], z1], [inn[j][0], inn[j][1], z1], [inn[j][0], inn[j][1], z0], [inn[i][0], inn[i][1], z0]);
      // top ring (faces up)
      mesh.quadP([out[i][0], out[i][1], z1], [out[j][0], out[j][1], z1], [inn[j][0], inn[j][1], z1], [inn[i][0], inn[i][1], z1]);
      // bottom ring (faces down)
      mesh.quadP([inn[i][0], inn[i][1], z0], [inn[j][0], inn[j][1], z0], [out[j][0], out[j][1], z0], [out[i][0], out[i][1], z0]);
    }
  }

  /* A blind bore (pilot hole / counterbore) into the top of a post: post is a
     solid extrude, then we carve a bore that stops at zFloor. Implemented as a
     solid tube z0..zFloor + an open tube zFloor..z1 (bore). Keeps it watertight. */
  function postWithBore(mesh, cx, cy, z0, z1, ro, boreR, boreDepth, seg) {
    seg = seg || 40;
    var zFloor = z1 - boreDepth;
    if (boreR <= 0.01 || boreDepth <= 0.01 || zFloor <= z0) { extrudeContour(mesh, circlePts(cx, cy, ro, seg), z0, z1); return; }
    var out = circlePts(cx, cy, ro, seg), inn = circlePts(cx, cy, boreR, seg);
    // bottom disc (radius ro) faces down
    fillPolygon(mesh, out, null, function (x, y) { return [x, y, z0]; }, true);
    // outer side wall z0..z1 faces out
    for (var i = 0; i < seg; i++) {
      var j = (i + 1) % seg;
      mesh.quadP([out[i][0], out[i][1], z0], [out[j][0], out[j][1], z0], [out[j][0], out[j][1], z1], [out[i][0], out[i][1], z1]);
    }
    // top ring (annulus ro..boreR) at z1 faces up
    fillPolygon(mesh, out, [ensureCW(inn)], function (x, y) { return [x, y, z1]; }, false);
    // bore wall boreR z1..zFloor faces in
    for (var k = 0; k < seg; k++) {
      var j2 = (k + 1) % seg;
      mesh.quadP([inn[k][0], inn[k][1], z1], [inn[j2][0], inn[j2][1], z1], [inn[j2][0], inn[j2][1], zFloor], [inn[k][0], inn[k][1], zFloor]);
    }
    // bore floor (disc radius boreR) at zFloor faces up
    fillPolygon(mesh, inn, null, function (x, y) { return [x, y, zFloor]; }, false);
  }

  // closed ring prism (outer contour with an inner hole), z0..z1
  function ringPrism(mesh, outer, inner, z0, z1) {
    outer = ensureCCW(outer); inner = ensureCCW(inner);
    fillPolygon(mesh, outer, [ensureCW(inner)], function (x, y) { return [x, y, z1]; }, false); // top up
    fillPolygon(mesh, outer, [ensureCW(inner)], function (x, y) { return [x, y, z0]; }, true);  // bottom down
    for (var i = 0; i < outer.length; i++) { var a = outer[i], b = outer[(i + 1) % outer.length];
      mesh.quadP([a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], z1], [a[0], a[1], z1]); }       // outer wall out
    for (var k = 0; k < inner.length; k++) { var c = inner[k], d = inner[(k + 1) % inner.length];
      mesh.quadP([c[0], c[1], z1], [d[0], d[1], z1], [d[0], d[1], z0], [c[0], c[1], z0]); }       // inner wall in
  }

  root.SCAB_PRIM = { extrudeContour: extrudeContour, tube: tube, postWithBore: postWithBore, fillPolygon: fillPolygon, ringPrism: ringPrism };

  /* ============================================================= shell
     Integrated watertight box shell (base):
       bottom disc (outer footprint, faces down)
       outer skin (walls, straight runs are flat panels able to hold holes)
       top rim (annulus between outer and inner footprint, faces up)
       inner skin (cavity walls, straight flat panels)
       cavity floor (inner footprint at floorThk, faces up)
     Corners are faceted arc strips (no holes). Straight runs carry cutouts.
     Everything welds by coordinate. */

  function buildShell(mesh, S) {
    // S: {W,D, wall, floor, height, r, arc, chamfer, wallFeatures}
    var W = S.W, D = S.D, wall = S.wall, floor = S.floor, H = S.height;
    // external vertical corners carry a minimum fillet equal to the wall (stronger, prints cleaner)
    var r = Math.max(S.r || 0, wall + 0.8);
    r = Math.min(r, Math.min(W, D) / 2 - wall - 0.2);
    var arc = Math.max(4, S.arc || 8);
    var ri = Math.max(0, r - wall); // inner corner radius
    var cham = Math.max(0, Math.min(S.chamfer || 0, floor * 0.9, wall * 0.9));

    // 2D footprints (CCW). Outer and inner rounded rects.
    var outer = roundedRectPts(W, D, r, arc);
    var inner = roundedRectPts(W - 2 * wall, D - 2 * wall, ri, arc);
    // Ensure same length for rim ring stitching
    var outerR = roundedRectPts(W, D, r, arc);
    var innerR = roundedRectPts(W - 2 * wall, D - 2 * wall, ri, arc);

    mesh.beginBody("shell");

    // --- bottom disc (faces down) at z=cham (chamfer skirt below it) ---
    var zb = 0;                 // very bottom
    var zc = cham;              // top of the bottom chamfer
    var zTop = H;
    var zCav = floor;           // cavity floor top

    // foot recesses: blind circular pockets in the bottom, recessing upward
    var feet = [];
    if (S.footRecesses && S.footRecesses.length) {
      for (var fr = 0; fr < S.footRecesses.length; fr++) {
        var fo = S.footRecesses[fr], fd = Math.min(fo.depth || 1.5, floor * 0.6);
        feet.push({ pts: circlePts(fo.x, fo.y, fo.r, 28), depth: fd });
      }
    }
    var botHoles = feet.map(function (f) { return f.pts; });
    if (cham > 0.01) {
      var br = Math.max(0, r - cham);
      var botOuter = roundedRectPts(W - 2 * cham, D - 2 * cham, br, arc);
      fillPolygon(mesh, botOuter, botHoles, function (x, y) { return [x, y, zb]; }, true); // faces down
      stitchRings(mesh, botOuter, zb, outer, zc, true);                                     // chamfer skirt
    } else {
      fillPolygon(mesh, outer, botHoles, function (x, y) { return [x, y, zb]; }, true);     // bottom disc w/ foot holes
    }
    for (var fi = 0; fi < feet.length; fi++) {
      var loop = feet[fi].pts, dd = feet[fi].depth;
      fillPolygon(mesh, loop, null, function (x, y) { return [x, y, zb + dd]; }, true);     // pocket ceiling faces down
      for (var j = 0; j < loop.length; j++) {
        var a = loop[j], b = loop[(j + 1) % loop.length];
        mesh.quadP([a[0], a[1], zb], [a[0], a[1], zb + dd], [b[0], b[1], zb + dd], [b[0], b[1], zb]); // pocket wall faces in
      }
    }

    // --- outer skin: straight runs as flat panels (with holes), corners as strips ---
    var runs = straightRuns(W, D, r);
    for (var s = 0; s < runs.length; s++) {
      buildWallRun(mesh, runs[s], zc, zCav, zTop, wall, S.wallFeatures ? S.wallFeatures[runs[s].side] : null, S.warn);
    }
    buildCornerStrips(mesh, W, D, r, ri, arc, zc, zCav, zTop);

    // --- top rim: flat annulus, or an O-ring groove when a gasket is requested ---
    if (S.gasket && S.gasket.on) {
      var gw = Math.min(S.gasket.width || 1.6, wall * 0.6);
      var gd = Math.min(S.gasket.depth || 1.5, (zTop - zCav) * 0.5, wall);
      if (gw >= 0.8 && (wall - gw) / 2 >= 0.5) {
        buildGroovedRim(mesh, W, D, r, arc, wall, zTop, gw, gd);
      } else {
        if (S.warn) S.warn.push("Gasket groove skipped: the wall is too thin for a channel with solid lips. Thicken the wall.");
        fillPolygon(mesh, outerR, [ensureCW(innerR)], function (x, y) { return [x, y, zTop]; }, false);
      }
    } else {
      fillPolygon(mesh, outerR, [ensureCW(innerR)], function (x, y) { return [x, y, zTop]; }, false);
    }

    // --- cavity floor (inner footprint at zCav, faces up) ---
    fillPolygon(mesh, inner, null, function (x, y) { return [x, y, zCav]; }, false);
    // close the gap between cavity floor edge (zCav) and inner skin bottom:
    // inner skin runs from zCav..zTop, cavity floor sits at zCav sharing that ring -> welds.

    mesh.endBody();
    return { r: r, ri: ri, arc: arc, cham: cham, zCav: zCav, zTop: zTop };
  }

  // Grooved rim: replace the flat top annulus with an O-ring channel. Five
  // concentric bands (outer land, outer wall, groove floor, inner wall, inner
  // land), all rounded rects of equal vertex count so the rings stitch cleanly.
  function buildGroovedRim(mesh, W, D, r, arc, wall, zTop, gw, gd) {
    function ring(d) { return roundedRectPts(W - 2 * d, D - 2 * d, Math.max(0.3, r - d), arc); }
    var outerR = ring(0), gOt = ring(wall / 2 - gw / 2), gIt = ring(wall / 2 + gw / 2), innerR = ring(wall);
    var zf = zTop - gd;
    function fz(z) { return function (x, y) { return [x, y, z]; }; }
    fillPolygon(mesh, outerR, [ensureCW(gOt)], fz(zTop), false);   // outer land (up)
    stitchRings(mesh, gOt, zTop, gOt, zf, true);                   // outer groove wall
    fillPolygon(mesh, gOt, [ensureCW(gIt)], fz(zf), false);        // groove floor (up)
    stitchRings(mesh, gIt, zf, gIt, zTop, true);                   // inner groove wall
    fillPolygon(mesh, gIt, [ensureCW(innerR)], fz(zTop), false);   // inner land (up)
  }

  // stitch two rings (same length) into a skirt band; ptsA at zA, ptsB at zB
  function stitchRings(mesh, A, zA, B, zB, faceOut) {
    var n = Math.min(A.length, B.length);
    for (var i = 0; i < n; i++) {
      var j = (i + 1) % n;
      var a0 = [A[i][0], A[i][1], zA], a1 = [A[j][0], A[j][1], zA];
      var b0 = [B[i][0], B[i][1], zB], b1 = [B[j][0], B[j][1], zB];
      if (faceOut) mesh.quadP(a0, a1, b1, b0); else mesh.quadP(a0, b0, b1, a1);
    }
  }

  function straightRuns(W, D, r) {
    // side keys: front(y=-D/2), right(x=+W/2), back(y=+D/2), left(x=-W/2)
    return [
      { side: "front", axis: "x", p0: [-W/2 + r, -D/2], p1: [W/2 - r, -D/2], nrm: [0, -1], len: W - 2*r, pos: -D/2 },
      { side: "right", axis: "y", p0: [W/2, -D/2 + r], p1: [W/2, D/2 - r], nrm: [1, 0], len: D - 2*r, pos: W/2 },
      { side: "back",  axis: "x", p0: [W/2 - r, D/2],  p1: [-W/2 + r, D/2], nrm: [0, 1], len: W - 2*r, pos: D/2 },
      { side: "left",  axis: "y", p0: [-W/2, D/2 - r], p1: [-W/2, -D/2 + r], nrm: [-1, 0], len: D - 2*r, pos: -W/2 }
    ];
  }

  /* A wall run is a flat slab of the shell. Outer skin spans zOut..zTop
     (zOut = chamfer top), inner skin spans zCav..zTop (cavity floor top).
     Holes (through) are punched in both faces and bridged by a tunnel.
     Local face coords: u along the run (0..len), v = z. */
  function buildWallRun(mesh, run, zOut, zCav, zTop, wall, feats, warn) {
    var len = run.len, nx = run.nrm[0], ny = run.nrm[1];
    var dir = [run.p1[0] - run.p0[0], run.p1[1] - run.p0[1]];
    var dl = Math.hypot(dir[0], dir[1]) || 1; dir = [dir[0] / dl, dir[1] / dl];
    function outerW(u, z) { return [run.p0[0] + dir[0] * u, run.p0[1] + dir[1] * u, z]; }
    function innerW(u, z) { return [run.p0[0] + dir[0] * u - nx * wall, run.p0[1] + dir[1] * u - ny * wall, z]; }

    // features in (u,z): through holes (tunnel) and pockets (blind, recess from outer face)
    var through = [], pockets = [], margin = 1.2;
    var placedBoxes = []; // [uMin,uMax,zMin,zMax] of accepted features, to reject overlaps
    function bboxOf(loop) {
      var uMin = Infinity, uMax = -Infinity, zMin = Infinity, zMax = -Infinity;
      for (var i = 0; i < loop.length; i++) { var p = loop[i];
        if (p[0] < uMin) uMin = p[0]; if (p[0] > uMax) uMax = p[0];
        if (p[1] < zMin) zMin = p[1]; if (p[1] > zMax) zMax = p[1]; }
      return [uMin, uMax, zMin, zMax];
    }
    function overlaps(a, b) { // true geometric overlap only (shared area) (this is
      // what corrupts the earcut triangulation; near-adjacent cuts print fine.
      var g = 0.02; // tiny bite so exactly-touching edges also count as overlap
      return a[0] < b[1] - g && a[1] > b[0] + g && a[2] < b[3] - g && a[3] > b[2] + g;
    }
    if (feats && feats.length) {
      for (var f = 0; f < feats.length; f++) {
        var ft = feats[f];
        var lp = featureLoopUZ(ft, len, zCav, zTop, margin);
        if (!lp) { if (warn) warn.push("Feature \"" + (ft.label || run.side) + "\" does not fit the " + run.side + " wall and was dropped."); continue; }
        var bb = bboxOf(lp), clash = false;
        for (var pb = 0; pb < placedBoxes.length; pb++) if (overlaps(bb, placedBoxes[pb])) { clash = true; break; }
        if (clash) { if (warn) warn.push("Feature \"" + (ft.label || run.side) + "\" overlaps another cutout on the " + run.side + " wall and was dropped."); continue; }
        placedBoxes.push(bb);
        // Sub-layer z-stagger (12 um * index): keeps every feature's z-extents
        // unique on this wall so a hole-to-hole earcut bridge can never land on a
        // neighbour's corner. Without this, filterPoints collapses the shared
        // collinear vertex and the tunnel wall no longer matches the face (T-junction).
        // 0.012 mm is far below nozzle/layer resolution, so the cut is unaffected.
        if (f > 0) { var dz = f * 0.012; for (var q = 0; q < lp.length; q++) lp[q][1] += dz; }
        if (ft.kind === "pocket") pockets.push({ loop: lp, depth: Math.min(ft.depth || 0.6, wall * 0.7) });
        else through.push(lp);
      }
    }
    var outwardMatches = (Math.abs(dir[1] - nx) < 1e-6 && Math.abs(-dir[0] - ny) < 1e-6);
    var outerRect = [[0, zOut], [len, zOut], [len, zTop], [0, zTop]];
    var innerRect = [[0, zCav], [len, zCav], [len, zTop], [0, zTop]];
    var outerHoles = through.concat(pockets.map(function (p) { return p.loop; }));
    fillPolygon(mesh, outerRect, outerHoles, function (u, z) { return outerW(u, z); }, !outwardMatches);
    fillPolygon(mesh, innerRect, through, function (u, z) { return innerW(u, z); }, outwardMatches);
    // through tunnels
    for (var h = 0; h < through.length; h++) {
      var loop = through[h];
      for (var i = 0; i < loop.length; i++) {
        var a = loop[i], b = loop[(i + 1) % loop.length];
        var oa = outerW(a[0], a[1]), ob = outerW(b[0], b[1]), ia = innerW(a[0], a[1]), ib = innerW(b[0], b[1]);
        if (outwardMatches) mesh.quadP(oa, ob, ib, ia); else mesh.quadP(oa, ia, ib, ob);
      }
    }
    // pockets: floor at depth d (inward from outer face) + side walls
    function offW(u, z, d) { return [run.p0[0] + dir[0] * u - nx * d, run.p0[1] + dir[1] * u - ny * d, z]; }
    for (var p = 0; p < pockets.length; p++) {
      var pl = pockets[p].loop, d = pockets[p].depth;
      // pocket floor faces outward (-nrm? it faces out of the pocket = outward)
      fillPolygon(mesh, pl, null, function (u, z) { return offW(u, z, d); }, outwardMatches);
      for (var i = 0; i < pl.length; i++) {
        var a = pl[i], b = pl[(i + 1) % pl.length];
        var oa = outerW(a[0], a[1]), ob = outerW(b[0], b[1]), fa = offW(a[0], a[1], d), fb = offW(b[0], b[1], d);
        if (outwardMatches) mesh.quadP(oa, ob, fb, fa); else mesh.quadP(oa, fa, fb, ob);
      }
    }
  }

  function buildCornerStrips(mesh, W, D, r, ri, arc, zOut, zCav, zTop) {
    var ccx = [W/2 - r, W/2 - r, -W/2 + r, -W/2 + r];
    var ccy = [-D/2 + r, D/2 - r, D/2 - r, -D/2 + r];
    var a0 = [-Math.PI/2, 0, Math.PI/2, Math.PI];
    for (var c = 0; c < 4; c++) {
      for (var i = 0; i < arc; i++) {
        var t0 = a0[c] + (i / arc) * (Math.PI / 2);
        var t1 = a0[c] + ((i + 1) / arc) * (Math.PI / 2);
        var oa = [ccx[c] + r * Math.cos(t0), ccy[c] + r * Math.sin(t0)];
        var ob = [ccx[c] + r * Math.cos(t1), ccy[c] + r * Math.sin(t1)];
        var ia = [ccx[c] + ri * Math.cos(t0), ccy[c] + ri * Math.sin(t0)];
        var ib = [ccx[c] + ri * Math.cos(t1), ccy[c] + ri * Math.sin(t1)];
        // outer skin faces out (zOut..zTop)
        mesh.quadP([oa[0], oa[1], zOut], [ob[0], ob[1], zOut], [ob[0], ob[1], zTop], [oa[0], oa[1], zTop]);
        // inner skin faces in (zCav..zTop)
        mesh.quadP([ia[0], ia[1], zTop], [ib[0], ib[1], zTop], [ib[0], ib[1], zCav], [ia[0], ia[1], zCav]);
      }
    }
  }

  // Convert a wall feature (cutout) to a (u,z) loop clamped into the flat panel.
  function featureLoopUZ(feat, len, zFloorTop, zTop, margin) {
    // feat: {u, z, w, h, shape} u=centre along run, z=centre height, w,h size
    var u = feat.u, z = feat.z, w = feat.w, h = feat.h, shape = feat.shape || "rect";
    // clamp centre so the opening + margin stays inside the printable panel
    var uMin = margin + w / 2, uMax = len - margin - w / 2;
    var zMin = zFloorTop + margin + h / 2, zMax = zTop - margin - h / 2;
    if (uMax < uMin || zMax < zMin) return null; // will not fit; caller warns
    u = Math.max(uMin, Math.min(uMax, u));
    z = Math.max(zMin, Math.min(zMax, z));
    if (shape === "round") {
      var rr = Math.min(w, h) / 2, seg = 28, out = [];
      for (var i = 0; i < seg; i++) { var t = i / seg * Math.PI * 2; out.push([u + rr * Math.cos(t), z + rr * Math.sin(t)]); }
      return out;
    }
    // rect
    return [[u - w/2, z - h/2], [u + w/2, z - h/2], [u + w/2, z + h/2], [u - w/2, z + h/2]];
  }

  root.SCAB_SHELL = { buildShell: buildShell, straightRuns: straightRuns };

  /* ================================================================ STL */
  function meshToBinarySTL(mesh) {
    var n = mesh.triCount();
    var buf = new ArrayBuffer(84 + n * 50);
    var dv = new DataView(buf);
    for (var i = 0; i < 80; i++) dv.setUint8(i, 0);
    dv.setUint32(80, n, true);
    var off = 84, V = mesh.verts, T = mesh.tris;
    for (var t = 0; t < n; t++) {
      var a = T[t*3]*3, b = T[t*3+1]*3, c = T[t*3+2]*3;
      var ax=V[a],ay=V[a+1],az=V[a+2], bx=V[b],by=V[b+1],bz=V[b+2], cx=V[c],cy=V[c+1],cz=V[c+2];
      var nx=(by-ay)*(cz-az)-(bz-az)*(cy-ay), ny=(bz-az)*(cx-ax)-(bx-ax)*(cz-az), nz=(bx-ax)*(cy-ay)-(by-ay)*(cx-ax);
      var L=Math.hypot(nx,ny,nz)||1; nx/=L; ny/=L; nz/=L;
      dv.setFloat32(off,nx,true);dv.setFloat32(off+4,ny,true);dv.setFloat32(off+8,nz,true);
      dv.setFloat32(off+12,ax,true);dv.setFloat32(off+16,ay,true);dv.setFloat32(off+20,az,true);
      dv.setFloat32(off+24,bx,true);dv.setFloat32(off+28,by,true);dv.setFloat32(off+32,bz,true);
      dv.setFloat32(off+36,cx,true);dv.setFloat32(off+40,cy,true);dv.setFloat32(off+44,cz,true);
      dv.setUint16(off+48,0,true); off+=50;
    }
    return buf;
  }
  function meshToAsciiSTL(mesh, name) {
    var n = mesh.triCount(), V = mesh.verts, T = mesh.tris, out = ["solid " + (name||"scabbard")];
    for (var t = 0; t < n; t++) {
      var a=T[t*3]*3,b=T[t*3+1]*3,c=T[t*3+2]*3;
      var ax=V[a],ay=V[a+1],az=V[a+2],bx=V[b],by=V[b+1],bz=V[b+2],cx=V[c],cy=V[c+1],cz=V[c+2];
      var nx=(by-ay)*(cz-az)-(bz-az)*(cy-ay),ny=(bz-az)*(cx-ax)-(bx-ax)*(cz-az),nz=(bx-ax)*(cy-ay)-(by-ay)*(cx-ax);
      var L=Math.hypot(nx,ny,nz)||1;
      out.push("  facet normal "+(nx/L)+" "+(ny/L)+" "+(nz/L));
      out.push("    outer loop");
      out.push("      vertex "+ax+" "+ay+" "+az);
      out.push("      vertex "+bx+" "+by+" "+bz);
      out.push("      vertex "+cx+" "+cy+" "+cz);
      out.push("    endloop"); out.push("  endfacet");
    }
    out.push("endsolid " + (name||"scabbard"));
    return out.join("\n");
  }
  function parseBinarySTL(buf) {
    var dv = new DataView(buf), n = dv.getUint32(80, true), m = new Mesh(), off = 84;
    for (var t = 0; t < n; t++) {
      off += 12;
      var p = [];
      for (var k = 0; k < 3; k++) { p.push([dv.getFloat32(off, true), dv.getFloat32(off+4, true), dv.getFloat32(off+8, true)]); off += 12; }
      off += 2;
      m.triP(p[0], p[1], p[2]);
    }
    return m;
  }

  /* ---------------------------------------------------------------- 3MF
     3MF is a ZIP container of XML. We emit one object per part (base, lid,
     coupon), so a slicer opens the case as separate objects it can arrange.
     A store-only ZIP writer and CRC32 are hand-rolled here (no libraries). */
  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) { var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0; }
    return t;
  })();
  function crc32(bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function utf8(str) {
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(str);
    var out = [], i, c; // minimal fallback
    for (i = 0; i < str.length; i++) { c = str.charCodeAt(i);
      if (c < 128) out.push(c);
      else if (c < 2048) { out.push(192 | (c >> 6), 128 | (c & 63)); }
      else { out.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63)); } }
    return new Uint8Array(out);
  }
  // store-only (method 0) ZIP. files: [{name, data:Uint8Array}]
  function zipStore(files) {
    var chunks = [], central = [], offset = 0;
    function u16(v) { return [v & 255, (v >> 8) & 255]; }
    function u32(v) { v = v >>> 0; return [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >> 24) & 255]; }
    for (var f = 0; f < files.length; f++) {
      var nameB = utf8(files[f].name), data = files[f].data, crc = crc32(data);
      var local = [].concat(u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
        u32(crc), u32(data.length), u32(data.length), u16(nameB.length), u16(0));
      chunks.push(new Uint8Array(local)); chunks.push(nameB); chunks.push(data);
      var localLen = local.length + nameB.length + data.length;
      central.push([].concat(u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
        u32(crc), u32(data.length), u32(data.length), u16(nameB.length), u16(0), u16(0), u16(0), u16(0),
        u32(0), u32(offset), Array.prototype.slice.call(nameB)));
      offset += localLen;
    }
    var cd = [], cdStart = offset;
    for (var c2 = 0; c2 < central.length; c2++) { cd = cd.concat(central[c2]); }
    var cdBytes = new Uint8Array(cd); chunks.push(cdBytes);
    var end = [].concat(u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
      u32(cdBytes.length), u32(cdStart), u16(0));
    chunks.push(new Uint8Array(end));
    var total = 0, i2; for (i2 = 0; i2 < chunks.length; i2++) total += chunks[i2].length;
    var out = new Uint8Array(total), pos = 0;
    for (i2 = 0; i2 < chunks.length; i2++) { out.set(chunks[i2], pos); pos += chunks[i2].length; }
    return out;
  }
  function meshObjectXML(mesh, id) {
    var V = mesh.verts, T = mesh.tris, s = ['<object id="' + id + '" type="model"><mesh><vertices>'];
    for (var i = 0; i < V.length; i += 3) s.push('<vertex x="' + f6(V[i]) + '" y="' + f6(V[i+1]) + '" z="' + f6(V[i+2]) + '"/>');
    s.push('</vertices><triangles>');
    for (var t = 0; t < T.length; t += 3) s.push('<triangle v1="' + T[t] + '" v2="' + T[t+1] + '" v3="' + T[t+2] + '"/>');
    s.push('</triangles></mesh></object>');
    return s.join("");
  }
  function f6(v) { return (Math.round(v * 1e6) / 1e6).toString(); }
  // parts: [{name, mesh, dx}] -> Uint8Array of a .3mf file
  function meshTo3MF(parts) {
    var objs = [], items = [];
    for (var i = 0; i < parts.length; i++) {
      var id = i + 1, dx = parts[i].dx || 0;
      objs.push(meshObjectXML(parts[i].mesh, id));
      items.push('<item objectid="' + id + '" transform="1 0 0 0 1 0 0 0 1 ' + f6(dx) + ' 0 0"/>');
    }
    var model = '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">' +
      '<metadata name="Application">SCABBARD ' + ENGINE_VERSION + '</metadata>' +
      '<resources>' + objs.join("") + '</resources>' +
      '<build>' + items.join("") + '</build></model>';
    var contentTypes = '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>';
    var rels = '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Target="/3D/3dmodel.model" Id="rel0" ' +
      'Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>';
    return zipStore([
      { name: "[Content_Types].xml", data: utf8(contentTypes) },
      { name: "_rels/.rels", data: utf8(rels) },
      { name: "3D/3dmodel.model", data: utf8(model) }
    ]);
  }

  /* ========================================================== validators */
  /* Per-mesh manifold check: every undirected edge shared by exactly 2 tris,
     with opposite directions (consistent winding). Reports boundary/nonmanifold. */
  function checkManifold(mesh) {
    var edges = Object.create(null), T = mesh.tris, boundary = 0, nonmani = 0, flipped = 0;
    function add(a, b) {
      var key = a < b ? a + "_" + b : b + "_" + a;
      var e = edges[key] || (edges[key] = { f: 0, r: 0 });
      if (a < b) e.f++; else e.r++;
    }
    for (var t = 0; t < T.length; t += 3) { add(T[t], T[t+1]); add(T[t+1], T[t+2]); add(T[t+2], T[t]); }
    for (var k in edges) {
      var e = edges[k], total = e.f + e.r;
      if (total === 1) boundary++;
      else if (total > 2) nonmani++;
      else if (total === 2 && (e.f !== 1 || e.r !== 1)) flipped++;
    }
    return { closed: boundary === 0, manifold: nonmani === 0, consistent: flipped === 0,
      boundary: boundary, nonmanifold: nonmani, flipped: flipped, edges: Object.keys(edges).length };
  }
  // signed volume via divergence; positive => outward normals overall
  function meshVolume(mesh) {
    var V = mesh.verts, T = mesh.tris, vol = 0;
    for (var t = 0; t < T.length; t += 3) {
      var a=T[t]*3,b=T[t+1]*3,c=T[t+2]*3;
      var ax=V[a],ay=V[a+1],az=V[a+2],bx=V[b],by=V[b+1],bz=V[b+2],cx=V[c],cy=V[c+1],cz=V[c+2];
      vol += (ax*(by*cz-bz*cy) - ay*(bx*cz-bz*cx) + az*(bx*cy-by*cx));
    }
    return vol / 6;
  }
  function bounds(mesh) {
    var V = mesh.verts, mn = [1e9,1e9,1e9], mx = [-1e9,-1e9,-1e9];
    for (var i = 0; i < V.length; i += 3) for (var d = 0; d < 3; d++) { var x = V[i+d]; if (x<mn[d])mn[d]=x; if (x>mx[d])mx[d]=x; }
    return { min: mn, max: mx };
  }

  root.SCAB_STL = { meshToBinarySTL: meshToBinarySTL, meshToAsciiSTL: meshToAsciiSTL, parseBinarySTL: parseBinarySTL, meshTo3MF: meshTo3MF };
  root.SCAB_CHECK = { checkManifold: checkManifold, meshVolume: meshVolume, bounds: bounds };
  root.SCAB_MESH = Mesh;
  root.SCAB_2D = { roundedRectPts: roundedRectPts, circlePts: circlePts, rectPts: rectPts, polyArea: polyArea };
  root.SCAB_VERSION = ENGINE_VERSION;

  /* =============================================================== TEXT
     Single-stroke vector font on a 0..4 (x) by 0..7 (y) cell, baseline at 0.
     Each glyph is a list of polylines. Echoes COOPER's engraving alphabet. */
  var FONT = {
    "A": [[[0,0],[2,7],[4,0]],[[0.7,2.6],[3.3,2.6]]],
    "B": [[[0,0],[0,7],[3,7],[3.6,5.5],[3,4],[0,4]],[[3,4],[3.8,2],[3,0],[0,0]]],
    "C": [[[4,5.5],[3,7],[1,7],[0,5.5],[0,1.5],[1,0],[3,0],[4,1.5]]],
    "D": [[[0,0],[0,7],[2.5,7],[4,5],[4,2],[2.5,0],[0,0]]],
    "E": [[[4,7],[0,7],[0,0],[4,0]],[[0,3.5],[3,3.5]]],
    "F": [[[4,7],[0,7],[0,0]],[[0,3.5],[3,3.5]]],
    "G": [[[4,5.5],[3,7],[1,7],[0,5.5],[0,1.5],[1,0],[3,0],[4,1.5],[4,3],[2.3,3]]],
    "H": [[[0,7],[0,0]],[[4,7],[4,0]],[[0,3.5],[4,3.5]]],
    "I": [[[2,7],[2,0]],[[1,7],[3,7]],[[1,0],[3,0]]],
    "J": [[[3,7],[3,1.5],[2,0],[1,0],[0,1.5]]],
    "K": [[[0,7],[0,0]],[[0,3],[4,7]],[[1.4,4],[4,0]]],
    "L": [[[0,7],[0,0],[4,0]]],
    "M": [[[0,0],[0,7],[2,3.5],[4,7],[4,0]]],
    "N": [[[0,0],[0,7],[4,0],[4,7]]],
    "O": [[[1,0],[3,0],[4,1.5],[4,5.5],[3,7],[1,7],[0,5.5],[0,1.5],[1,0]]],
    "P": [[[0,0],[0,7],[3,7],[4,5.5],[3,4],[0,4]]],
    "Q": [[[1,0],[3,0],[4,1.5],[4,5.5],[3,7],[1,7],[0,5.5],[0,1.5],[1,0]],[[2.4,2],[4,0]]],
    "R": [[[0,0],[0,7],[3,7],[4,5.5],[3,4],[0,4]],[[2,4],[4,0]]],
    "S": [[[4,5.5],[3,7],[1,7],[0,5.5],[1,4],[3,3],[4,1.5],[3,0],[1,0],[0,1.5]]],
    "T": [[[0,7],[4,7]],[[2,7],[2,0]]],
    "U": [[[0,7],[0,1.5],[1,0],[3,0],[4,1.5],[4,7]]],
    "V": [[[0,7],[2,0],[4,7]]],
    "W": [[[0,7],[1,0],[2,3.5],[3,0],[4,7]]],
    "X": [[[0,7],[4,0]],[[0,0],[4,7]]],
    "Y": [[[0,7],[2,3.5],[4,7]],[[2,3.5],[2,0]]],
    "Z": [[[0,7],[4,7],[0,0],[4,0]]],
    "0": [[[1,0],[3,0],[4,1.5],[4,5.5],[3,7],[1,7],[0,5.5],[0,1.5],[1,0]],[[0.6,1],[3.4,6]]],
    "1": [[[1,5.5],[2,7],[2,0]],[[1,0],[3,0]]],
    "2": [[[0,5.5],[1,7],[3,7],[4,5.5],[4,4],[0,0],[4,0]]],
    "3": [[[0,6],[1,7],[3,7],[4,6],[3,4],[1.5,4]],[[3,4],[4,2],[3,0],[1,0],[0,1]]],
    "4": [[[3,0],[3,7],[0,2.5],[4,2.5]]],
    "5": [[[4,7],[0,7],[0,4],[3,4],[4,2.5],[3,0],[1,0],[0,1]]],
    "6": [[[4,6],[3,7],[1,7],[0,5],[0,1.5],[1,0],[3,0],[4,1.5],[4,3],[3,4],[1,4],[0,3]]],
    "7": [[[0,7],[4,7],[1.5,0]]],
    "8": [[[1.5,3.5],[0.4,5],[1,7],[3,7],[3.6,5],[2.5,3.5],[1,2],[1,0.8],[2,0],[3,0.8],[3,2],[1.5,3.5]]],
    "9": [[[0,1],[1,0],[3,0],[4,2],[4,5.5],[3,7],[1,7],[0,5.5],[0,4],[1,3],[3,3],[4,4]]],
    "-": [[[0.5,3.5],[3.5,3.5]]],
    ".": [[[1.8,0],[2.2,0],[2.2,0.4],[1.8,0.4],[1.8,0]]],
    ":": [[[2,1],[2,1.4]],[[2,4],[2,4.4]]],
    "/": [[[0,0],[4,7]]],
    " ": []
  };
  var CELL_W = 4, CELL_H = 7, CHAR_GAP = 1.6;

  function textStrokes(str, height) {
    var scale = height / CELL_H, x = 0, out = [], width = 0;
    for (var i = 0; i < str.length; i++) {
      var g = FONT[str[i].toUpperCase()];
      if (g === undefined) g = FONT[" "];
      for (var s = 0; s < g.length; s++) {
        var pl = g[s], seg = [];
        for (var p = 0; p < pl.length; p++) seg.push([(pl[p][0] + x) * scale, pl[p][1] * scale]);
        out.push(seg);
      }
      x += CELL_W + CHAR_GAP;
    }
    width = (x - CHAR_GAP) * scale;
    return { strokes: out, width: width, height: height };
  }

  /* A Frame maps in-plane (x,y) and out-of-plane disp -> world:
     P(x,y,d) = O + U*x + V*y + N*d. U,V,N are unit vectors. */
  function frameAt(O, U, V, N) {
    return function (x, y, d) {
      return [O[0] + U[0]*x + V[0]*y + N[0]*d, O[1] + U[1]*x + V[1]*y + N[1]*d, O[2] + U[2]*x + V[2]*y + N[2]*d];
    };
  }
  // one stroke segment as a watertight box prism in a frame; disp from dLo..dHi
  function strokeBox(mesh, F, x0, y0, x1, y1, w, dLo, dHi) {
    var dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy);
    if (L < 1e-6) { // a dot: little square
      dx = 1; dy = 0; L = 1; x1 = x0 + 0.001;
    }
    var px = -dy / L * (w / 2), py = dx / L * (w / 2);
    // extend ends by w/2 for rounded-ish joints
    var ex = dx / L * (w / 2), ey = dy / L * (w / 2);
    var A = [x0 - ex + px, y0 - ey + py], B = [x1 + ex + px, y1 + ey + py],
        C = [x1 + ex - px, y1 + ey - py], Dd = [x0 - ex - px, y0 - ey - py];
    var lo = [F(A[0],A[1],dLo), F(B[0],B[1],dLo), F(C[0],C[1],dLo), F(Dd[0],Dd[1],dLo)];
    var hi = [F(A[0],A[1],dHi), F(B[0],B[1],dHi), F(C[0],C[1],dHi), F(Dd[0],Dd[1],dHi)];
    mesh.quadP(lo[0], lo[3], lo[2], lo[1]); // bottom (faces -N)
    mesh.quadP(hi[0], hi[1], hi[2], hi[3]); // top (faces +N)
    for (var i = 0; i < 4; i++) { var j = (i + 1) % 4; mesh.quadP(lo[i], lo[j], hi[j], hi[i]); }
  }

  // place text: raised prisms (dLo=0,dHi=h) or, for embossed, caller carves a pad and sets dLo=-depth,dHi=0
  function emitText(mesh, F, layout, strokeW, dLo, dHi, alignCenter) {
    var ox = alignCenter ? -layout.width / 2 : 0;
    for (var s = 0; s < layout.strokes.length; s++) {
      var seg = layout.strokes[s];
      for (var i = 0; i + 1 < seg.length; i++) {
        strokeBox(mesh, F, seg[i][0] + ox, seg[i][1] - layout.height / 2, seg[i+1][0] + ox, seg[i+1][1] - layout.height / 2, strokeW, dLo, dHi);
      }
    }
  }

  /* ============================================================== BOSSES */
  function addBoss(mesh, hole, zTop0, standoffH, kind, nozzle, warn) {
    var z0 = zTop0, z1 = zTop0 + standoffH;
    var screw = hole.screw || 3;                 // nominal screw dia (M3 default)
    var boreR, bossR;
    if (kind === "heatset") { boreR = (screw + 1.0) / 2; bossR = boreR + Math.max(1.6, 2 * nozzle); }
    else if (kind === "through") { boreR = (screw + 0.5) / 2; bossR = boreR + Math.max(1.4, 2 * nozzle); }
    else { boreR = (screw - 0.7) / 2; bossR = boreR + Math.max(1.4, 2 * nozzle); } // self-tap (thread-forming)
    if (bossR - boreR < nozzle * 2) {            // COOPER's lesson: keep a full wall, block otherwise
      bossR = boreR + nozzle * 2 + 0.2;
      if (warn) warn.push("Boss at (" + hole.x.toFixed(1) + "," + hole.y.toFixed(1) + ") widened to keep a full wall around its bore.");
    }
    mesh.beginBody("boss");
    if (kind === "through") tube(mesh, hole.x, hole.y, z0, z1, bossR, boreR, 36);
    else postWithBore(mesh, hole.x, hole.y, z0, z1, bossR, boreR, Math.min(standoffH * 0.9, standoffH - 0.6), 36);
    mesh.endBody();
    return { bossR: bossR, boreR: boreR, z1: z1 };
  }

  /* ======================================================= CASE MOUNTING
     Additive bodies fused to the base: mounting-flange tabs (plain hole or
     keyhole) and a printed DIN-rail cradle. All by construction, no CSG. */

  // Keyhole outline as one CCW loop: a head circle (radius R) with a slot of
  // width sw running length L in unit direction (dx,dy), ending in a semicircle.
  function keyholeContour(cx, cy, R, sw, L, dx, dy) {
    var hw = sw / 2, px = -dy, py = dx;                 // perpendicular unit
    var t = Math.sqrt(Math.max(0, R * R - hw * hw));    // where slot sides meet the head circle
    var aP = Math.atan2(py * hw + dy * t, px * hw + dx * t);   // angle of P+ on circle
    var aM = Math.atan2(-py * hw + dy * t, -px * hw + dx * t); // angle of P- on circle
    var pts = [];
    // major arc of the head, from P- around the back (through -d) to P+
    var back = Math.atan2(-dy, -dx);
    var seg = 26;
    // walk from aM to aP the long way (passing through 'back')
    function norm(a) { while (a < 0) a += Math.PI * 2; return a; }
    var start = norm(aM), end = norm(aP), bb = norm(back);
    if (!(start < bb && bb < end)) { if (end < start) end += Math.PI * 2; }
    if (end < start) end += Math.PI * 2;
    for (var i = 0; i <= seg; i++) { var a = start + (end - start) * i / seg;
      pts.push([cx + R * Math.cos(a), cy + R * Math.sin(a)]); }
    // down the +perp slot side to the end centre, then semicircle, then back up
    var ecx = cx + dx * L, ecy = cy + dy * L;
    var qPx = ecx + px * hw, qPy = ecy + py * hw;       // Q+
    var qMx = ecx - px * hw, qMy = ecy - py * hw;       // Q-
    pts.push([qPx, qPy]);
    var a0 = Math.atan2(qPy - ecy, qPx - ecx), a1 = Math.atan2(qMy - ecy, qMx - ecx);
    if (a1 < a0) a1 += Math.PI * 2;
    for (var k = 1; k < 12; k++) { var aa = a0 + (a1 - a0) * k / 12;
      pts.push([ecx + hw * Math.cos(aa), ecy + hw * Math.sin(aa)]); }
    pts.push([qMx, qMy]);
    return ensureCCW(pts);
  }

  // One flange tab on a wall, extending outward, with a plain or keyhole hole.
  function buildMountTab(mesh, side, W, D, along, tabW, tabLen, thk, overlap, holeKind, screw) {
    var out = { front: [0, -1], back: [0, 1], left: [-1, 0], right: [1, 0] }[side];
    var horiz = (side === "left" || side === "right");
    var faceX = W / 2, faceY = D / 2;
    // tab centre: start at the wall face, go outward by tabLen/2 minus the overlap
    var innerX, innerY;
    if (side === "left")  { innerX = -faceX; innerY = along; }
    else if (side === "right") { innerX = faceX; innerY = along; }
    else if (side === "front") { innerX = along; innerY = -faceY; }
    else { innerX = along; innerY = faceY; }
    var cx = innerX + out[0] * (tabLen / 2 - overlap / 2);
    var cy = innerY + out[1] * (tabLen / 2 - overlap / 2);
    var longLen = tabLen + overlap;                 // along the outward axis
    var boxW = horiz ? longLen : tabW;              // x-extent
    var boxD = horiz ? tabW : longLen;              // y-extent
    var contour = roundedRectPts(boxW, boxD, Math.min(3, tabW / 2 - 0.5), 6);
    for (var i = 0; i < contour.length; i++) { contour[i][0] += cx; contour[i][1] += cy; }
    // hole centre: out toward the free end
    var hcx = cx + out[0] * (tabLen * 0.18), hcy = cy + out[1] * (tabLen * 0.18);
    var holes = [];
    if (holeKind === "keyhole") {
      var R = screw * 1.15 + 1.2; // head clearance radius
      // slot points inward (toward the wall / box), so you hang then slide out
      holes.push(keyholeContour(hcx, hcy, R, screw + 0.6, tabLen * 0.4, -out[0], -out[1]));
    } else {
      holes.push(circlePts(hcx, hcy, (screw + 0.6) / 2, 24));
    }
    mesh.beginBody("mount");
    fillPolygon(mesh, contour, holes, function (x, y) { return [x, y, thk]; }, false); // top
    fillPolygon(mesh, contour, holes, function (x, y) { return [x, y, 0]; }, true);     // bottom
    for (var e = 0; e < contour.length; e++) { var a = contour[e], b = contour[(e + 1) % contour.length];
      mesh.quadP([a[0], a[1], 0], [b[0], b[1], 0], [b[0], b[1], thk], [a[0], a[1], thk]); }
    for (var s = 0; s < holes.length; s++) { var loop = holes[s];
      for (var k2 = 0; k2 < loop.length; k2++) { var c = loop[k2], d2 = loop[(k2 + 1) % loop.length];
        mesh.quadP([c[0], c[1], 0], [c[0], c[1], thk], [d2[0], d2[1], thk], [d2[0], d2[1], 0]); } }
    mesh.endBody();
  }

  // Sweep a closed (y,z) profile along x from x0 to x1 into a watertight prism.
  // Reuse the proven extrudeContour (profile as an XY contour extruded x0..x1),
  // then cyclically permute coords (X,Y,Z)->(Z,X,Y). A cyclic permutation is a
  // rotation (determinant +1), so winding and positive volume are preserved.
  function sweepProfileX(mesh, profile, x0, x1) {
    var tmp = new Mesh();
    extrudeContour(tmp, profile, x0, x1);   // verts are (py, pz, xval)
    var b0 = mesh.verts.length / 3, V = tmp.verts, T = tmp.tris;
    for (var i = 0; i < V.length; i += 3) mesh.verts.push(V[i+2], V[i], V[i+1]); // -> (xval, py, pz)
    for (var t = 0; t < T.length; t += 3) mesh.tris.push(b0 + T[t], b0 + T[t+1], b0 + T[t+2]);
  }

  // DIN-rail cradle on the bottom: two inward-hooking lips 35mm apart (TS35).
  // Clips on by a slight flex; a fixed cradle, not a sprung clip.
  function buildDinCradle(mesh, W, D, along, len) {
    var span = 35, gap = span / 2, lipT = 2.2, hook = 1.6, drop = 6.5, hookH = 2.2;
    len = Math.min(len || Math.min(W, D) * 0.6, D - 8);
    var x0 = along - len / 2, x1 = along + len / 2;
    // profile in (y, z), z=0 at box bottom growing downward (negative z)
    // left lip hooks in +y, right lip hooks in -y
    function lip(sign) {
      var yOuter = sign * (gap + lipT), yInner = sign * gap, yHook = sign * (gap - hook);
      return [
        [yOuter, 0], [yOuter, -drop], [yHook, -drop], [yHook, -drop + hookH],
        [yInner, -drop + hookH], [yInner, 0]
      ];
    }
    mesh.beginBody("din");
    sweepProfileX(mesh, ensurePolyCCWYZ(lip(1)), x0, x1);
    sweepProfileX(mesh, ensurePolyCCWYZ(lip(-1)), x0, x1);
    // a thin web joining the two lips at the box bottom so they print as one body
    var webT = 1.6;
    sweepProfileX(mesh, [[-(gap + 0.1), 0], [-(gap + 0.1), -webT], [gap + 0.1, -webT], [gap + 0.1, 0]], x0, x1);
    mesh.endBody();
  }
  // ensure a (y,z) profile is CCW in the y-z plane for outward sweep normals
  function ensurePolyCCWYZ(p) {
    var area = 0; for (var i = 0; i < p.length; i++) { var a = p[i], b = p[(i + 1) % p.length]; area += a[0] * b[1] - b[0] * a[1]; }
    return area < 0 ? p.slice().reverse() : p;
  }
  // copy a temp mesh's triangles into dst as a fresh (non-welded) body, so an
  // overlapping add-on never welds to the shell and flips shared edges.
  // opt.swapXY reflects x<->y (used to re-aim an x-swept body along y) and
  // reverses winding to keep normals outward.
  function appendRaw(dst, src, name, opt) {
    var b0 = dst.verts.length / 3, V = src.verts, T = src.tris, swap = opt && opt.swapXY;
    dst.beginBody(name);
    for (var i = 0; i < V.length; i += 3) {
      if (swap) dst.verts.push(V[i+1], V[i], V[i+2]); else dst.verts.push(V[i], V[i+1], V[i+2]);
    }
    for (var t = 0; t < T.length; t += 3) {
      if (swap) dst.tris.push(b0 + T[t], b0 + T[t+2], b0 + T[t+1]);
      else dst.tris.push(b0 + T[t], b0 + T[t+1], b0 + T[t+2]);
    }
    dst.endBody();
  }

  /* ================================================================ LID
     Built in its own coordinate frame, print-ready (flat, top up at z=lidThk).
     Snap/friction tongue OR screw-down corner holes; optional window + text. */
  function buildLid(cfg, geo) {
    var m = new Mesh(); m.warn = [];
    var W = cfg.W, D = cfg.D, wall = cfg.wall, lidThk = cfg.lidThk, r = geo.r, ri = geo.ri, arc = geo.arc;
    var z0 = 0, zTop = lidThk;
    var outer = roundedRectPts(W, D, r, arc);

    // through features: LED window + screw holes
    var holes = [], screwHoles = [];
    if (cfg.lidWindow && cfg.lidWindow.w > 0) {
      holes.push(cfg.lidWindow.shape === "round"
        ? circlePts(cfg.lidWindow.x || 0, cfg.lidWindow.y || 0, Math.min(cfg.lidWindow.w, cfg.lidWindow.h) / 2, 32)
        : rectPts(cfg.lidWindow.x || 0, cfg.lidWindow.y || 0, cfg.lidWindow.w, cfg.lidWindow.h));
    }
    if (cfg.lidAttach === "screw") {
      var inset = Math.max(r + 3, 7), sr = ((cfg.lidScrew || 3) + 0.6) / 2;
      var cs = [[W/2 - inset, D/2 - inset], [-(W/2 - inset), D/2 - inset], [W/2 - inset, -(D/2 - inset)], [-(W/2 - inset), -(D/2 - inset)]];
      for (var i = 0; i < 4; i++) { holes.push(circlePts(cs[i][0], cs[i][1], sr, 24)); screwHoles.push({ x: cs[i][0], y: cs[i][1], screw: cfg.lidScrew || 3 }); }
    }
    // lid-mounted fan: a central opening plus four mounting screw holes at the
    // standard pitch for the fan size (blows down through the lid).
    if (cfg.lidFan && cfg.lidFan.size) {
      var fsz = cfg.lidFan.size, fx = cfg.lidFan.x || 0, fy = cfg.lidFan.y || 0;
      var pitch = ({ 30: 24, 40: 32, 50: 40, 60: 50, 70: 61.5, 80: 71.5 })[fsz] || fsz * 0.8;
      var openR = (cfg.lidFan.openDia || fsz * 0.9) / 2;
      var fscrew = (cfg.lidFan.screw || 3.4) / 2;
      // the whole footprint (screw pattern + hole radius) must sit inside the lid
      var footR = pitch / 2 + fscrew + 1.2;
      var limX = W / 2 - Math.max(r, wall) - 1, limY = D / 2 - Math.max(r, wall) - 1;
      if (Math.abs(fx) + footR > limX || Math.abs(fy) + footR > limY || openR + 1 > Math.min(limX, limY)) {
        if (m.warn) m.warn.push("A " + fsz + "mm fan does not fit this lid and was left off. Try a smaller fan or a larger case.");
      } else {
        holes.push(circlePts(fx, fy, openR, 40));
        var fsp = [[pitch/2, pitch/2], [-pitch/2, pitch/2], [pitch/2, -pitch/2], [-pitch/2, -pitch/2]];
        for (var fk = 0; fk < 4; fk++) holes.push(circlePts(fx + fsp[fk][0], fy + fsp[fk][1], fscrew, 20));
      }
    }

    // --- slab body (with holes, watertight) ---
    m.beginBody("lid");
    fillPolygon(m, outer, holes, function (x, y) { return [x, y, zTop]; }, false); // top up
    fillPolygon(m, outer, holes, function (x, y) { return [x, y, z0]; }, true);    // bottom down
    for (var e = 0; e < outer.length; e++) { var a = outer[e], b = outer[(e + 1) % outer.length];
      m.quadP([a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], zTop], [a[0], a[1], zTop]); } // outer wall
    for (var s = 0; s < holes.length; s++) { var loop = holes[s];
      for (var k = 0; k < loop.length; k++) { var c = loop[k], d2 = loop[(k + 1) % loop.length];
        m.quadP([c[0], c[1], z0], [c[0], c[1], zTop], [d2[0], d2[1], zTop], [d2[0], d2[1], z0]); } } // hole tunnels
    m.endBody();

    // --- tongue ring (snap / friction) as its own watertight body ---
    if (cfg.lidAttach === "snap" || cfg.lidAttach === "friction") {
      var clr = cfg.lidClearance != null ? cfg.lidClearance : 0.3;
      var tOW = W - 2 * wall - 2 * clr, tOD = D - 2 * wall - 2 * clr, tOR = Math.max(0.4, ri - clr);
      var lipW = Math.max(cfg.lipWidth || 1.6, wall * 0.7);
      var tIW = tOW - 2 * lipW, tID = tOD - 2 * lipW, tIR = Math.max(0.2, tOR - lipW);
      var tongueO = roundedRectPts(tOW, tOD, tOR, arc), tongueI = roundedRectPts(tIW, tID, tIR, arc);
      var lipH = cfg.lipH || 4;
      m.beginBody("tongue");
      ringPrism(m, tongueO, tongueI, -lipH, z0 + 0.001); // slight overlap into slab so slicer unions
      m.endBody();
    }

    // --- text on the lid top (raised prisms, or embossed via recessed prisms) ---
    if (cfg.text && cfg.text.str) {
      var lay = textStrokes(cfg.text.str, cfg.text.size || 6);
      var sw = Math.max(cfg.text.stroke || 0.9, cfg.nozzle * 1.6);
      var tx = cfg.text.x || 0, ty = cfg.text.y || 0;
      m.beginBody("text");
      if (cfg.text.mode === "emboss") {
        var d = Math.min(cfg.text.depth || 0.8, lidThk * 0.5);
        emitTextAxis(m, tx, ty, zTop - d, zTop, lay, sw, true); // recessed into the top
      } else {
        emitTextAxis(m, tx, ty, zTop, zTop + (cfg.text.height || 0.8), lay, sw, true); // proud of the top
      }
      m.endBody();
    }
    return m;
  }

  // axis-aligned text on a horizontal face: each stroke is a CCW rectangle extruded z0..z1
  function emitTextAxis(mesh, ox, oy, z0, z1, lay, w, center) {
    var dx0 = center ? -lay.width / 2 : 0, dy0 = -lay.height / 2;
    for (var s = 0; s < lay.strokes.length; s++) {
      var seg = lay.strokes[s];
      for (var i = 0; i + 1 < seg.length; i++) {
        var x0 = ox + dx0 + seg[i][0], y0 = oy + dy0 + seg[i][1];
        var x1 = ox + dx0 + seg[i+1][0], y1 = oy + dy0 + seg[i+1][1];
        var dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1;
        var px = -dy / L * (w / 2), py = dx / L * (w / 2), ex = dx / L * (w / 2), ey = dy / L * (w / 2);
        var contour = [[x0 - ex + px, y0 - ey + py], [x1 + ex + px, y1 + ey + py], [x1 + ex - px, y1 + ey - py], [x0 - ex - px, y0 - ey - py]];
        extrudeContour(mesh, contour, z0, z1);
      }
    }
  }

  /* Raised text on the outer face of a wall. side in front/back/left/right.
     Build the text flat via the validated emitTextAxis path (extruded +z,
     positive volume), then map it onto the wall with an orientation-preserving
     transform (determinant +1) so volume stays positive. Emboss on a wall needs
     a true pocket (boolean subtraction) and is not in this engine, so wall text
     is raised only. */
  function emitWallText(mesh, side, W, D, floor, interiorH, lay, strokeW, height, offU, vC) {
    var xFace = W / 2, yFace = D / 2;
    vC = (vC == null) ? floor + interiorH / 2 : vC;
    offU = offU || 0;
    var tmp = new Mesh();
    emitTextAxis(tmp, 0, 0, 0, height, lay, strokeW, true); // local: x=u, y=v, z=outward depth
    // map local (lx,ly,lz) -> world per wall; each map has determinant +1
    var map;
    if (side === "front")      map = function (x, y, z) { return [offU + x, -yFace - z, vC + y]; };
    else if (side === "back")  map = function (x, y, z) { return [offU - x, yFace + z, vC + y]; };
    else if (side === "left")  map = function (x, y, z) { return [-xFace - z, offU - x, vC + y]; };
    else                        map = function (x, y, z) { return [xFace + z, offU + x, vC + y]; };
    var base = mesh.verts.length / 3, TV = tmp.verts, TT = tmp.tris;
    for (var i = 0; i < TV.length; i += 3) { var w = map(TV[i], TV[i+1], TV[i+2]);
      mesh.verts.push(w[0], w[1], w[2]); }
    for (var t = 0; t < TT.length; t += 3) mesh.tris.push(base + TT[t], base + TT[t+1], base + TT[t+2]);
  }

  /* ============================================================= COUPON
     Fit-test / tolerance calibration: a slot ladder + a boss with a screw hole. */
  function buildCoupon(nozzle) {
    var m = new Mesh(); m.warn = [];
    var thk = 3, W = 60, D = 22;
    m.beginBody("coupon");
    // base plate with a ladder of slots (clearances 0.10..0.50)
    var slots = [];
    var clr = [0.10, 0.15, 0.20, 0.25, 0.30, 0.40, 0.50];
    var slotW = 6, slotH = 2 + 0; // reference tab thickness 2.0 mm
    for (var i = 0; i < clr.length; i++) {
      var cx = -W/2 + 5 + i * ((W - 10) / (clr.length - 1));
      slots.push(rectPts(cx, 4, slotW, 2.0 + clr[i]));
    }
    // top & bottom of plate with slot holes
    fillPolygon(m, rectPts(0, 0, W, D), slots, function (x, y) { return [x, y, thk]; }, false);
    fillPolygon(m, rectPts(0, 0, W, D), slots, function (x, y) { return [x, y, 0]; }, true);
    // plate sides
    var pl = rectPts(0, 0, W, D);
    for (var e = 0; e < 4; e++) { var a = pl[e], b = pl[(e+1)%4]; m.quadP([a[0],a[1],0],[b[0],b[1],0],[b[0],b[1],thk],[a[0],a[1],thk]); }
    // slot tunnels
    for (var s = 0; s < slots.length; s++) { var loop = slots[s]; for (var k = 0; k < loop.length; k++) { var a2 = loop[k], b2 = loop[(k+1)%loop.length]; m.quadP([a2[0],a2[1],0],[a2[0],a2[1],thk],[b2[0],b2[1],thk],[b2[0],b2[1],0]); } }
    m.endBody();
    // a self-tap boss with a screw hole (M3) to calibrate real hole size
    m.beginBody("coupon-boss");
    postWithBore(m, W/2 - 8, -5, thk, thk + 8, 3.2, 1.25, 7, 32);
    m.endBody();
    return m;
  }

  /* ============================================================= BOARDS
     Dimensions are typical starting points. VERIFY against the official
     mechanical drawing before the first real print. Origin at board centre.
     Connector offset is along the named wall (signed), z is centre height
     above the PCB top surface. */
  var UNO_HOLES = [ // classic Uno pattern (deliberately non-symmetric), approx from datasheet
    { x: -31.7, y: -18.3 }, { x: 26.7, y: -20.3 }, { x: 26.7, y: 22.9 }, { x: -16.8, y: 22.9 }
  ];
  var BOARDS = {
    uno_r4: {
      name: "Arduino Uno R4 (Minima / WiFi)", W: 68.6, D: 53.4, pcb: 1.6, holeDia: 3.2, standoff: 6, headerStack: 9,
      holes: UNO_HOLES.map(function (h) { return { x: h.x, y: h.y, screw: 3 }; }),
      connectors: [
        { label: "USB-C", side: "left", off: 16, z: 3.0, w: 9.5, h: 3.6, on: true },
        { label: "Barrel", side: "left", off: 6, z: 5.5, w: 9.2, h: 11, shape: "round", on: true }
      ],
      matrix: { note: "WiFi variant 12x8 LED matrix, lid window optional" }
    },
    uno_q: {
      name: "Arduino Uno Q", W: 68.58, D: 53.34, pcb: 1.6, holeDia: 3.2, standoff: 6, headerStack: 9,
      holes: UNO_HOLES.map(function (h) { return { x: h.x, y: h.y, screw: 3 }; }),
      connectors: [
        { label: "USB-C", side: "left", off: 16, z: 3.0, w: 9.5, h: 3.6, on: true },
        { label: "Qwiic", side: "left", off: 2, z: 3.0, w: 4.5, h: 3.5, on: true },
        { label: "Power", side: "right", off: 18, z: 3.0, w: 4, h: 4, shape: "round", on: false }
      ],
      note: "Bottom-mounted high-speed connectors (CSI/DSI/audio/SDMMC): a base clearance pocket or knock-out may be needed.",
      matrix: { note: "8x13 RGB matrix, lid window optional" }
    },
    mkr: {
      name: "Arduino MKR line", W: 61.5, D: 25, pcb: 1.6, holeDia: 2.2, standoff: 5, headerStack: 9,
      holes: [ { x: -27, y: 0, screw: 2 }, { x: 27, y: 0, screw: 2 } ],
      connectors: [
        { label: "USB", side: "left", off: 0, z: 2.0, w: 8, h: 3.0, on: true },
        { label: "LiPo JST", side: "right", off: 8, z: 2.0, w: 6, h: 4, on: false },
        { label: "Antenna", side: "right", off: -6, z: 2.0, w: 5, h: 5, shape: "round", on: false }
      ],
      note: "One footprint, per-board connector overlay: toggle micro-USB vs USB-C, LiPo, Qwiic, u.FL/SMA."
    },
    pi4: {
      name: "Raspberry Pi 4 Model B", W: 85, D: 56, pcb: 1.6, holeDia: 2.7, standoff: 3, headerStack: 8.5,
      holes: [ { x: -39, y: -24.5, screw: 2.5 }, { x: 19, y: -24.5, screw: 2.5 }, { x: -39, y: 24.5, screw: 2.5 }, { x: 19, y: 24.5, screw: 2.5 } ],
      connectors: [
        { label: "USB-C", side: "front", off: -31.5, z: 1.6, w: 9, h: 3.4, on: true },
        { label: "microHDMI0", side: "front", off: -19, z: 1.6, w: 7.5, h: 3.5, on: true },
        { label: "microHDMI1", side: "front", off: -6, z: 1.6, w: 7.5, h: 3.5, on: true },
        { label: "A/V", side: "front", off: 8, z: 2.0, w: 6.5, h: 6.5, shape: "round", on: false },
        { label: "USB3", side: "right", off: -18, z: 8, w: 15, h: 16, on: true },
        { label: "USB2", side: "right", off: 4, z: 8, w: 15, h: 16, on: true },
        { label: "Ethernet", side: "right", off: 24, z: 8, w: 16, h: 14, on: true },
        { label: "microSD", side: "back", off: -33, z: -1.5, w: 12, h: 3, on: true }
      ],
      note: "microSD is on the underside: a side access slot is provided. 40-pin GPIO exit slot optional."
    },
    pi5: {
      name: "Raspberry Pi 5", W: 85, D: 56, pcb: 1.6, holeDia: 2.7, standoff: 3, headerStack: 8.5,
      holes: [ { x: -39, y: -24.5, screw: 2.5 }, { x: 19, y: -24.5, screw: 2.5 }, { x: -39, y: 24.5, screw: 2.5 }, { x: 19, y: 24.5, screw: 2.5 } ],
      connectors: [
        { label: "USB-C", side: "front", off: -31.5, z: 1.6, w: 9, h: 3.4, on: true },
        { label: "microHDMI0", side: "front", off: -19, z: 1.6, w: 7.5, h: 3.5, on: true },
        { label: "microHDMI1", side: "front", off: -6, z: 1.6, w: 7.5, h: 3.5, on: true },
        { label: "Power btn", side: "front", off: 3, z: 2, w: 4, h: 4, shape: "round", on: false },
        { label: "Ethernet", side: "left", off: -18, z: 8, w: 16, h: 14, on: true },
        { label: "USB3", side: "left", off: 2, z: 8, w: 15, h: 16, on: true },
        { label: "USB2", side: "left", off: 24, z: 8, w: 15, h: 16, on: true },
        { label: "microSD", side: "back", off: -33, z: -1.5, w: 12, h: 3, on: true }
      ],
      note: "Same holes as Pi 4 but USB/Ethernet swapped sides: Pi 4 and Pi 5 lids are NOT interchangeable. Active-cooler fan header common."
    },
    esp32_devkit: {
      name: "ESP32 DevKit (30-pin)", W: 52, D: 28.3, pcb: 1.6, holeDia: 3.2, standoff: 5, headerStack: 9,
      holes: [ { x: -23, y: -11.5, screw: 2.5 }, { x: 23, y: -11.5, screw: 2.5 }, { x: -23, y: 11.5, screw: 2.5 }, { x: 23, y: 11.5, screw: 2.5 } ],
      connectors: [ { label: "USB", side: "left", off: 0, z: 2.0, w: 8.5, h: 3.2, on: true } ],
      note: "NOMINAL: 30-pin DOIT-style footprint. Wide 38-pin and other clones vary; verify against your board."
    },
    pi_zero2: {
      name: "Raspberry Pi Zero 2 W", W: 65, D: 30, pcb: 1.6, holeDia: 2.75, standoff: 3, headerStack: 8.5,
      holes: [ { x: -29, y: -11.5, screw: 2.5 }, { x: 29, y: -11.5, screw: 2.5 }, { x: -29, y: 11.5, screw: 2.5 }, { x: 29, y: 11.5, screw: 2.5 } ],
      connectors: [
        { label: "mini-HDMI", side: "front", off: -12, z: 1.6, w: 7.5, h: 3.5, on: true },
        { label: "USB data", side: "front", off: 4, z: 1.6, w: 8, h: 3, on: true },
        { label: "USB power", side: "front", off: 16, z: 1.6, w: 8, h: 3, on: true },
        { label: "microSD", side: "left", off: 0, z: -1.0, w: 12, h: 2.5, on: true }
      ],
      note: "NOMINAL: 58x23 mm hole pattern. Verify port positions against your board."
    },
    feather: {
      name: "Adafruit Feather", W: 50.8, D: 22.9, pcb: 1.6, holeDia: 2.5, standoff: 5, headerStack: 9,
      holes: [ { x: -22.5, y: -8.9, screw: 2.5 }, { x: 22.5, y: -8.9, screw: 2.5 }, { x: -22.5, y: 8.9, screw: 2.5 }, { x: 22.5, y: 8.9, screw: 2.5 } ],
      connectors: [
        { label: "USB", side: "left", off: 0, z: 2.0, w: 9, h: 3.4, on: true },
        { label: "LiPo JST", side: "right", off: 6, z: 2.0, w: 6, h: 4, on: false }
      ],
      note: "NOMINAL: standard Feather outline. USB type varies by board (micro vs USB-C); verify."
    },
    nano: {
      name: "Arduino Nano", W: 45, D: 18, pcb: 1.6, standoff: 4, headerStack: 9,
      holes: [],
      connectors: [ { label: "USB", side: "left", off: 0, z: 2.0, w: 8, h: 3.2, on: true } ],
      note: "NOMINAL: most Nanos have no mounting holes (breadboard part). USB type varies; verify."
    },
    generic: {
      name: "Generic project box", W: 80, D: 60, pcb: 1.6, standoff: 5, headerStack: 0,
      holes: [ { x: -30, y: -22, screw: 3 }, { x: 30, y: -22, screw: 3 }, { x: -30, y: 22, screw: 3 }, { x: 30, y: 22, screw: 3 } ],
      connectors: [],
      note: "Fully parametric escape hatch: set your own interior, holes, and connector cutouts."
    }
  };

  /* Map a connector to a wall feature (u,z). u is centred on the wall run. */
  function connectorToFeature(conn, runLen, zBase) {
    return {
      label: conn.label, kind: "through", shape: conn.shape || "rect",
      u: runLen / 2 + (conn.off || 0), z: zBase + (conn.z || 0),
      w: conn.w, h: conn.h
    };
  }

  /* ============================================================ MODEL */
  function buildModel(cfg) {
    var board = BOARDS[cfg.board] || BOARDS.generic;
    var warn = [];
    var nozzle = cfg.nozzle || 0.4;
    var wall = Math.max(cfg.wall || 2.4, nozzle * 2);
    var floor = Math.max(cfg.floor || 2.4, nozzle * 2);
    var lidThk = Math.max(cfg.lidThk || 2.4, nozzle * 2);
    var clearance = cfg.clearance != null ? cfg.clearance : 0.4;   // board fit clearance (from coupon)
    var standoff = cfg.standoff != null ? cfg.standoff : board.standoff;

    // interior from board + clearance; interior height from stack
    var pcb = cfg.customPcb || board.pcb;
    var bx = (cfg.customW || board.W), by = (cfg.customD || board.D);
    var interiorW = bx + 2 * clearance + 2 * (cfg.sideGap || 1.5);
    var interiorD = by + 2 * clearance + 2 * (cfg.sideGap || 1.5);
    var stack = standoff + pcb + (cfg.headerStack != null ? cfg.headerStack : board.headerStack) + (cfg.extraStack || 0);
    // interior must also clear the tallest side connector: a cutout needs its top
    // (pcbTop + conn.z + conn.h/2) to sit below the rim with room for the margin,
    // or the port would be dropped as "does not fit". Fold that into the height.
    var connsForH = cfg.connectors || board.connectors || [];
    var tallestTop = 0;
    for (var ci = 0; ci < connsForH.length; ci++) { var cc = connsForH[ci];
      if (cc.on === false) continue;
      var top = standoff + pcb + (cc.z || 0) + (cc.h || 0) / 2 + 2.0; // 2mm = margin + a little air
      if (top > tallestTop) tallestTop = top;
    }
    var interiorH = Math.max(cfg.minHeight || 0, stack + (cfg.headroom || 3), tallestTop);
    var W = interiorW + 2 * wall, D = interiorD + 2 * wall;
    var height = floor + interiorH;
    var zCav = floor;

    // z base for connector centres = cavity floor + standoff + pcb (PCB top)
    var pcbTop = zCav + standoff + pcb;

    // wall features from connectors
    var runs = straightRuns(W, D, Math.max(cfg.corner || 3, wall + 0.8));
    var runLen = {}; runs.forEach(function (r) { runLen[r.side] = r.len; });
    var wallFeatures = { front: [], back: [], left: [], right: [] };
    var conns = cfg.connectors || board.connectors || [];
    for (var i = 0; i < conns.length; i++) {
      var c = conns[i]; if (c.on === false) continue;
      if (!wallFeatures[c.side]) continue;
      wallFeatures[c.side].push(connectorToFeature(c, runLen[c.side], pcbTop));
    }
    // GPIO/header exit slot
    if (cfg.exitSlot && cfg.exitSlot.side && wallFeatures[cfg.exitSlot.side]) {
      wallFeatures[cfg.exitSlot.side].push({ label: "exit slot", kind: "through", shape: "rect",
        u: runLen[cfg.exitSlot.side] / 2 + (cfg.exitSlot.off || 0), z: pcbTop + (cfg.exitSlot.z || 6),
        w: cfg.exitSlot.w || 20, h: cfg.exitSlot.h || 8 });
    }
    // vents (slots) on a wall, routed around an exit slot on the same wall
    if (cfg.vents && cfg.vents.side && wallFeatures[cfg.vents.side]) {
      var vside = cfg.vents.side, vrun = runLen[vside];
      var n = cfg.vents.count || 4, vw = cfg.vents.w || 2.5, gap = cfg.vents.gap || 4;
      // slot height adapts to interior: never taller than the cavity can hold with margins
      var vh = Math.max(2, Math.min(cfg.vents.h || 14, interiorH - 2 * 1.2 - 1));
      var margin = Math.max(wall + 1.5, 4), keepout = Math.max(gap, 3);
      // find the clear region: whole wall, or the larger side of an exit slot
      var lo = margin, hi = vrun - margin;
      if (cfg.exitSlot && cfg.exitSlot.side === vside) {
        var exU = vrun / 2 + (cfg.exitSlot.off || 0), exHalf = (cfg.exitSlot.w || 20) / 2;
        var leftW = (exU - exHalf - keepout) - lo, rightW = hi - (exU + exHalf + keepout);
        if (leftW >= rightW) hi = exU - exHalf - keepout; else lo = exU + exHalf + keepout;
      }
      var avail = hi - lo, center = (lo + hi) / 2;
      // fit the count to the region, dropping extras rather than colliding
      while (n > 1 && n * vw + (n - 1) * gap > avail) n--;
      if ((cfg.vents.count || 4) > n) warn.push("Vents reduced to " + n + " to fit clear space on the " + vside + " wall.");
      if (n * vw + (n - 1) * gap <= avail) {
        var total = n * vw + (n - 1) * gap, start = center - total / 2 + vw / 2;
        for (var v = 0; v < n; v++) wallFeatures[vside].push({ label: "vent", kind: "through", shape: "rect",
          u: start + v * (vw + gap), z: zCav + (cfg.vents.z || interiorH / 2), w: vw, h: vh });
      } else {
        warn.push("No room for vents on the " + vside + " wall alongside the other cutouts.");
      }
    }
    // fan mount on a wall (center hole + 4 screw holes)
    if (cfg.fan && cfg.fan.side && wallFeatures[cfg.fan.side]) {
      var fs = cfg.fan.size || 40, hole = fs * 0.9, pitch = ({30:24,40:32,50:40,60:50})[fs] || fs * 0.8;
      var cu = runLen[cfg.fan.side] / 2 + (cfg.fan.off || 0), cz = zCav + (cfg.fan.z || interiorH / 2);
      wallFeatures[cfg.fan.side].push({ label: "fan", kind: "through", shape: "round", u: cu, z: cz, w: hole, h: hole });
      var sp = [[pitch/2,pitch/2],[-pitch/2,pitch/2],[pitch/2,-pitch/2],[-pitch/2,-pitch/2]];
      for (var sfi = 0; sfi < 4; sfi++) wallFeatures[cfg.fan.side].push({ label: "fan-screw", kind: "through", shape: "round",
        u: cu + sp[sfi][0], z: cz + sp[sfi][1], w: 3.4, h: 3.4 });
    }

    // foot recesses (4 corners of the bottom)
    var footRecesses = [];
    if (cfg.feet !== false) {
      var fr = cfg.footR || 5, fin = Math.max(fr + 2, wall + fr + 1);
      var cxF = W / 2 - fin, cyF = D / 2 - fin;
      // shrink the feet so neighbours never overlap (2*center must exceed 2*r + slack)
      var maxR = Math.min(cxF, cyF) - 0.6;
      if (maxR < fr) fr = maxR;
      if (fr < 2) { warn.push("Feet skipped: the base is too small to fit non-overlapping foot recesses."); }
      else {
        [[cxF, cyF], [-cxF, cyF], [cxF, -cyF], [-cxF, -cyF]].forEach(function (p) {
          footRecesses.push({ x: p[0], y: p[1], r: fr, depth: cfg.footDepth || 1.5 });
        });
      }
    }

    // --- build base ---
    var base = new Mesh(); base.warn = warn;
    var geo = buildShell(base, { W: W, D: D, wall: wall, floor: floor, height: height,
      r: cfg.corner || 3, arc: cfg.arc || 10, chamfer: cfg.chamfer != null ? cfg.chamfer : 0.8,
      wallFeatures: wallFeatures, footRecesses: footRecesses, gasket: cfg.gasket, warn: warn });

    // bosses on real hole coordinates
    var holes = (cfg.customHoles || board.holes || []);
    for (var hI = 0; hI < holes.length; hI++) {
      addBoss(base, holes[hI], zCav, standoff, cfg.bossKind || "heatset", nozzle, warn);
    }
    // corner screw posts for a screw-down lid: aligned to the lid's screw holes
    // (same inset formula as buildLid), full-height, with a self-tap pilot bore
    // down from the rim so a screw through the lid threads into the post.
    if ((cfg.lidAttach || "snap") === "screw") {
      var lidScrew = cfg.lidScrew || 3;
      var inset = Math.max(geo.r + 3, 7);
      var postRo = Math.max(lidScrew / 2 + Math.max(1.8, 2 * nozzle), wall + 0.8);
      var pilot = Math.max(0.6, (lidScrew - 0.7) / 2);          // thread-forming pilot
      var boreDepth = Math.min(height - zCav - 1.2, Math.max(6, lidScrew * 2.5));
      var pp = [[W/2 - inset, D/2 - inset], [-(W/2 - inset), D/2 - inset],
                [W/2 - inset, -(D/2 - inset)], [-(W/2 - inset), -(D/2 - inset)]];
      for (var lp2 = 0; lp2 < pp.length; lp2++) {
        base.beginBody("lidpost");
        postWithBore(base, pp[lp2][0], pp[lp2][1], zCav, height, postRo, pilot, boreDepth, 36);
        base.endBody();
      }
    }
    // wall-mounted text: raised legend on the outer face of a chosen wall,
    // as its own watertight body (slicer unions it onto the wall).
    if (cfg.wallText && cfg.wallText.str && wallFeatures[cfg.wallText.side]) {
      var wlay = textStrokes(cfg.wallText.str, cfg.wallText.size || 6);
      var wsw = Math.max(cfg.wallText.stroke || 0.9, nozzle * 1.6);
      var wh = cfg.wallText.height || 0.8;
      var vC = (cfg.wallText.z != null) ? zCav + cfg.wallText.z : zCav + interiorH / 2;
      base.beginBody("text");
      emitWallText(base, cfg.wallText.side, W, D, floor, interiorH, wlay, wsw, wh, cfg.wallText.off || 0, vC);
      base.endBody();
    }

    // case mounting: flange tabs (plain hole or keyhole) on two opposite walls.
    // Each tab is built in its own mesh and appended raw so it never welds to
    // the shell (a weld there would flip the shared edges).
    if (cfg.mountTabs && cfg.mountTabs.sides) {
      var mt = cfg.mountTabs, mThk = Math.max(mt.thk || Math.max(floor, 3), 2.4);
      var mScrew = mt.screw || 4, mKind = mt.hole || "plain";
      var tabW = Math.max(mt.tabW || (mScrew * 3 + 6), mScrew * 2 + 6);
      var tabLen = Math.max(mt.tabLen || (mScrew * 3 + 8), mScrew * 2 + 8);
      var pair = mt.sides === "fb" ? ["front", "back"] : ["left", "right"];
      for (var pt = 0; pt < 2; pt++) {
        var tmt = new Mesh(); buildMountTab(tmt, pair[pt], W, D, 0, tabW, tabLen, mThk, 2, mKind, mScrew);
        appendRaw(base, tmt, "mount");
      }
    }
    // DIN-rail cradle on the bottom, running along the long axis.
    if (cfg.din) {
      var tdin = new Mesh();
      if (W >= D) { buildDinCradle(tdin, W, D, 0, cfg.din.len || W * 0.6); appendRaw(base, tdin, "din"); }
      else { buildDinCradle(tdin, D, W, 0, cfg.din.len || D * 0.6); appendRaw(base, tdin, "din", { swapXY: true }); }
    }

    // --- lid ---
    var lid = buildLid({ W: W, D: D, wall: wall, lidThk: lidThk, nozzle: nozzle,
      lidAttach: cfg.lidAttach || "snap", lipH: cfg.lipH || 4, lidScrew: cfg.lidScrew || 3,
      lidWindow: cfg.lidWindow, lidFan: cfg.lidFan, text: cfg.text }, geo);
    (lid.warn || []).forEach(function (w) { warn.push(w); });

    // --- coupon ---
    var coupon = buildCoupon(nozzle);

    // --- ghost board (preview only) ---
    var ghost = new Mesh();
    ghost.beginBody("ghost");
    var gz0 = zCav + standoff, gz1 = gz0 + pcb;
    extrudeContour(ghost, rectPts(0, 0, bx, by), gz0, gz1);
    ghost.endBody();

    return {
      base: base, lid: lid, coupon: coupon, ghost: ghost, geo: geo, warnings: warn,
      meta: { board: board.name, W: W, D: D, height: height, lidThk: lidThk, interiorH: interiorH,
        stack: stack, standoff: standoff, note: board.note || "", pcbTop: pcbTop }
    };
  }

  root.SCAB_MODEL = { buildModel: buildModel, buildLid: buildLid, buildCoupon: buildCoupon, BOARDS: BOARDS,
    textStrokes: textStrokes, FONT: FONT };

  if (typeof module !== "undefined" && module.exports) module.exports = root;
})(typeof window !== "undefined" ? window : (typeof global !== "undefined" ? global : this));
