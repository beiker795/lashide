// 多玩法测试：gb/gd/sc 三种模式各跑一局，验证牌墙数、能正常结束、积分守恒、血战禁吃
const WebSocket = require('ws');
const MODES = [
  {mode:'gb', expectWall:83, name:'国标'},
  {mode:'gd', expectWall:83, name:'广东'},
  {mode:'sc', expectWall:55, name:'血战'}
];
function playOne(m){
  return new Promise((resolve)=>{
    const ws = new WebSocket('ws://localhost:3000');
    let seenWall=null, sawChow=false, done=false;
    const timer = setTimeout(()=>{ if(!done){ done=true; resolve({mode:m.mode, timeout:true}); try{ws.close();}catch(e){} } }, 90000);
    ws.on('open', ()=>ws.send(JSON.stringify({type:'quickstart', name:m.name, mode:m.mode})));
    ws.on('message', (raw)=>{
      const msg = JSON.parse(raw);
      if(msg.type!=='state') return;
      if(seenWall===null && msg.phase==='turn') seenWall = msg.wallCount;
      const ya = msg.yourActions;
      if(ya && ya.type==='dingque'){
        ws.send(JSON.stringify({type:'dingque', suit:'m'}));
      } else if(ya && ya.type==='discard'){
        const hand = (msg.players[msg.youSeat]||{}).hand;
        if(hand) ws.send(JSON.stringify({type:'discard', tile:hand[0]}));
      } else if(ya && ya.type==='claim'){
        for(const o of ya.options){ if(o.action==='chow') sawChow=true; }
        const opt = ya.options.find(o=>o.action==='hu')||ya.options.find(o=>o.action==='pung')||null;
        ws.send(JSON.stringify({type:'claim', action:opt?opt.action:'pass', tiles:opt?opt.tiles:undefined}));
      }
      if(msg.winner && !done){
        done=true; clearTimeout(timer);
        const w = msg.winner;
        const deltasOk = w.draw ? true : (w.deltas.reduce((a,b)=>a+b,0)===0);
        resolve({mode:m.mode, wall:seenWall, expectWall:m.expectWall, wallOk:seenWall===m.expectWall, ended:true, deltasOk, sawChowInSc: m.mode==='sc'?sawChow:'n/a'});
        try{ws.close();}catch(e){}
      }
    });
    ws.on('error', (e)=>{ if(!done){ done=true; clearTimeout(timer); resolve({mode:m.mode, err:e.message}); try{ws.close();}catch(x){} } });
  });
}
(async()=>{
  const results = {};
  for(const m of MODES){ console.log('测试', m.mode, '...'); results[m.mode] = await playOne(m); }
  console.log('=== 多玩法测试结果 ===');
  let allOk = true;
  for(const m of MODES){
    const r = results[m.mode];
    const ok = r && r.ended && r.wallOk && r.deltasOk && (m.mode!=='sc' || r.sawChowInSc===false);
    if(!ok) allOk=false;
    console.log(m.mode, JSON.stringify(r), ok?'OK':'FAIL');
  }
  if(results['sc'] && results['sc'].sawChowInSc===true){ console.log('血战模式出现「吃」选项 -> 禁吃失败'); allOk=false; }
  console.log(allOk?'MODES_OK':'MODES_FAIL');
  process.exit(allOk?0:1);
})();
