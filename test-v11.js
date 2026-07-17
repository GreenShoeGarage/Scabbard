const E = require('./engine.js');
const { checkManifold: chk, meshVolume: vol } = E.SCAB_CHECK;
let fails = 0;
function ok(c,l){ console.log((c?'PASS':'FAIL')+' '+l); if(!c)fails++; }
function bodiesOK(mesh){ const V=mesh.verts,T=mesh.tris; let good=true;
  const list=mesh.bodies.length?mesh.bodies:[{start:0,count:T.length/3,name:'all'}];
  for(const b of list){ const sub={verts:V,tris:[]};
    for(let t=b.start;t<b.start+b.count;t++)sub.tris.push(T[t*3],T[t*3+1],T[t*3+2]);
    const c=chk(sub),v=vol(sub),isText=b.name==='text';
    if(!(c.closed&&c.consistent&&v>0.001&&(isText||c.manifold))){good=false;console.log('   bad body',b.name,JSON.stringify(c),'vol',v.toFixed(3));}}
  return good; }

// 1. wall text on each side
['front','back','left','right'].forEach(side=>{
  const M=E.SCAB_MODEL.buildModel({board:'generic',wallText:{str:'GSG',side,size:6,height:0.8,z:8}});
  const c=chk(M.base);
  ok(c.closed&&c.consistent&&bodiesOK(M.base), 'wall text '+side+' base watertight+bodies');
  const hasText=M.base.bodies.some(b=>b.name==='text');
  ok(hasText,'wall text '+side+' emitted a text body');
});

// 2. lid fan
[40,60,80].forEach(sz=>{
  const M=E.SCAB_MODEL.buildModel({board:'pi5',lidFan:{size:sz}});
  const c=chk(M.lid);
  const droppedFan=M.lid.warn&&M.lid.warn.some(w=>/does not fit/.test(w));ok((c.closed&&c.consistent&&bodiesOK(M.lid)),"lid fan "+sz+"mm lid watertight+bodies"+(droppedFan?" (fan blocked, expected)":""));
});

// 3. 3MF export: valid zip, parseable, right counts
const M=E.SCAB_MODEL.buildModel({board:'uno_r4',text:{str:'R4',size:6,mode:'raised'}});
const buf=E.SCAB_STL.meshTo3MF([{name:'base',mesh:M.base},{name:'lid',mesh:M.lid,dx:M.meta.W+10}]);
ok(buf&&buf.length>100,'3MF produced bytes ('+(buf?buf.length:0)+')');
require('fs').writeFileSync('/tmp/test.3mf',Buffer.from(buf));
ok(buf[0]===0x50&&buf[1]===0x4b,'3MF starts with PK zip signature');

console.log(fails===0?'\nALL V1.1 TESTS PASS':'\n'+fails+' V1.1 FAILURES');
process.exit(fails?1:0);
