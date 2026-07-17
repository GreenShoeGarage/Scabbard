const E = require('./engine.js');
const { checkManifold: chk, meshVolume: vol } = E.SCAB_CHECK;
let fails = 0;
const ok=(c,l)=>{console.log((c?'PASS':'FAIL')+' '+l);if(!c)fails++;};
function bodiesOK(mesh){ const V=mesh.verts,T=mesh.tris; let good=true;
  const list=mesh.bodies.length?mesh.bodies:[{start:0,count:T.length/3,name:'all'}];
  for(const b of list){ const sub={verts:V,tris:[]};
    for(let t=b.start;t<b.start+b.count;t++)sub.tris.push(T[t*3],T[t*3+1],T[t*3+2]);
    const c=chk(sub),v=vol(sub),isText=b.name==='text';
    if(!(c.closed&&c.consistent&&v>0.001&&(isText||c.manifold))){good=false;console.log('   bad body',b.name,JSON.stringify(c),'vol',v.toFixed(3));}}
  return good; }

// mount tabs: plain + keyhole, both side pairs
[['lr','plain'],['lr','keyhole'],['fb','plain'],['fb','keyhole']].forEach(([sides,hole])=>{
  const M=E.SCAB_MODEL.buildModel({board:'pi5',mountTabs:{sides,hole,screw:4}});
  const c=chk(M.base);
  ok(c.closed&&c.consistent&&bodiesOK(M.base),'mount tabs '+sides+'/'+hole+' base watertight+bodies');
  ok(M.base.bodies.some(b=>b.name==='mount'),'mount tabs '+sides+'/'+hole+' emitted mount bodies');
});
// DIN cradle both orientations (wide board -> x, tall board -> y swap path)
['pi5','mkr'].forEach(bd=>{
  const M=E.SCAB_MODEL.buildModel({board:bd,din:{}});
  const c=chk(M.base);
  ok(c.closed&&c.consistent&&bodiesOK(M.base),'DIN cradle on '+bd+' base watertight+bodies');
});
// custom board (measure your own)
{
  const M=E.SCAB_MODEL.buildModel({board:'generic',customW:70,customD:40,customPcb:1.0,
    customHoles:[{x:-30,y:-15,screw:3},{x:30,y:15,screw:3}],
    connectors:[{label:'USB-C',side:'front',off:0,z:3,w:9.5,h:3.6,on:true},{label:'Term',side:'back',off:-10,z:5,w:12,h:8,on:true}]});
  const c=chk(M.base);
  ok(c.closed&&c.consistent&&bodiesOK(M.base),'custom board base watertight+bodies');
  ok(Math.abs(M.meta.W-(70+2*(0.4+1.5)+2*2.4))<0.01,'custom board sized from customW ('+M.meta.W.toFixed(1)+')');
}
// new library boards build clean
['esp32_devkit','pi_zero2','feather','nano'].forEach(bd=>{
  const M=E.SCAB_MODEL.buildModel({board:bd});
  const c=chk(M.base), cl=chk(M.lid);
  ok(c.closed&&c.consistent&&bodiesOK(M.base)&&cl.closed&&cl.consistent,'new board '+bd+' base+lid watertight');
});
// gasket groove (opt-in), watertight shell + thin-wall guard
['generic','pi5','uno_r4','mkr'].forEach(bd=>{
  const M=E.SCAB_MODEL.buildModel({board:bd,wall:3,gasket:{on:true}});
  const V=M.base.verts,T=M.base.tris,b=M.base.bodies.find(x=>x.name==='shell');
  const sub={verts:V,tris:[]};for(let t=b.start;t<b.start+b.count;t++)sub.tris.push(T[t*3],T[t*3+1],T[t*3+2]);
  const c=chk(sub);
  ok(c.closed&&c.manifold&&c.consistent&&vol(sub)>0,'gasket groove on '+bd+' shell watertight');
});
{
  const M=E.SCAB_MODEL.buildModel({board:'generic',wall:2,gasket:{on:true}});
  ok(M.warnings.some(w=>/[Gg]asket/.test(w)),'gasket skipped on thin wall with warning');
}
console.log(fails===0?'\nALL V1.2 TESTS PASS':'\n'+fails+' V1.2 FAILURES');
process.exit(fails?1:0);
