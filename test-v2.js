const E = require('./engine.js');
const { checkManifold: chk, meshVolume: vol } = E.SCAB_CHECK;
let fails = 0; const ok=(c,l)=>{console.log((c?'PASS':'FAIL')+' '+l);if(!c)fails++;};
function bodiesOK(mesh){ const V=mesh.verts,T=mesh.tris; let good=true;
  const list=mesh.bodies.length?mesh.bodies:[{start:0,count:T.length/3,name:'all'}];
  for(const b of list){ const s={verts:V,tris:[]};
    for(let t=b.start;t<b.start+b.count;t++)s.tris.push(T[t*3],T[t*3+1],T[t*3+2]);
    const c=chk(s),v=vol(s),isText=b.name==='text';
    if(!(c.closed&&c.consistent&&v>0.001&&(isText||c.manifold))){good=false;console.log('  bad',b.name,JSON.stringify(c),v.toFixed(2));}}
  return good; }
const whole=(m)=>{const c=chk(m);return c.closed&&c.consistent;};

// CSG engine sanity (box subtract fully manifold)
const {SCAB_MESH:Mesh,SCAB_PRIM:{extrudeContour},SCAB_2D:{rectPts}}=E;
function box(w,d,z0,z1,cx,cy){const m=new Mesh();extrudeContour(m,rectPts(cx||0,cy||0,w,d),z0,z1);return m;}
let R=E.SCAB_CSG.subtract(box(40,40,0,10),box(10,10,6,12));let c=chk(R);
ok(c.closed&&c.manifold&&c.consistent,'CSG box subtract fully manifold');

// lid pocket via CSG on real boards
['uno_r4','pi5','giga'].forEach(bd=>{
  const M=E.SCAB_MODEL.buildModel({board:bd,lidPocket:{shape:'rect',w:30,h:12,x:0,y:-8,depth:1.2}});
  const cl=chk(M.lid);
  ok(cl.closed&&cl.consistent&&cl.manifold&&bodiesOK(M.lid),'lid pocket on '+bd+' fully manifold');
  ok(vol(M.lid)>0,'lid pocket '+bd+' positive volume');
});
// gasket bead present with gasket on (thick wall)
{
  const M=E.SCAB_MODEL.buildModel({board:'pi5',wall:3,gasket:{on:true}});
  ok(M.lid.bodies.some(b=>b.name==='bead'),'gasket bead emitted on lid');
  ok(whole(M.base)&&bodiesOK(M.lid),'gasket base+lid watertight with bead');
}
// sprung DIN
['pi5','mkr'].forEach(bd=>{
  const M=E.SCAB_MODEL.buildModel({board:bd,din:{sprung:true}});
  ok(whole(M.base)&&bodiesOK(M.base),'sprung DIN on '+bd+' watertight');
});
console.log(fails===0?'\nALL V2.0 TESTS PASS':'\n'+fails+' V2.0 FAILURES');
process.exit(fails?1:0);
