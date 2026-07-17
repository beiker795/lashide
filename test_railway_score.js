process.on('uncaughtException', e=>{ console.log('UNCAUGHT', e.message); process.exit(9); });
const WebSocket = require('ws');
const ws = new WebSocket('wss://wechat-mahjong-production-fc6f.up.railway.app');
let round = 0, allOk = true;
ws.on('open', ()=>{ console.log('RAILWAY_OPEN'); ws.send(JSON.stringify({type:'quickstart', name:'线上测试'})); });
ws.on('message', (raw)=>{
  const m = JSON.parse(raw);
  if(m.type!=='state') return;
  const ya = m.yourActions;
  if(ya && ya.type==='discard'){ const hand=(m.players[m.youSeat]||{}).hand; if(hand) ws.send(JSON.stringify({type:'discard', tile:hand[0]})); }
  else if(ya && ya.type==='claim'){ const o=ya.options.find(x=>x.action==='hu')||ya.options.find(x=>x.action==='pung')||null; ws.send(JSON.stringify({type:'claim', action:o?o.action:'pass', tiles:o?o.tiles:undefined})); }
  if(m.winner){
    const w = m.winner;
    if(w.draw){ if(round<3) ws.send(JSON.stringify({type:'again'})); else { console.log('RAILWAY_SCORE_OK'); process.exit(0); } return; }
    round++;
    const d=w.deltas, sumD=d.reduce((a,b)=>a+b,0), sumS=w.scores.reduce((a,b)=>a+b,0);
    const ok = sumD===0 && sumS===0; if(!ok) allOk=false;
    console.log('[局'+round+'] deltas='+JSON.stringify(d)+' sum='+sumD+' scores='+JSON.stringify(w.scores)+(ok?' OK':' FAIL'));
    if(round>=3){ console.log(allOk?'RAILWAY_SCORE_OK (线上积分同步正常)':'RAILWAY_SCORE_FAIL'); process.exit(allOk?0:1); }
    else ws.send(JSON.stringify({type:'again'}));
  }
});
ws.on('error', e=>{ console.log('WSERR', e.message); process.exit(2); });
setTimeout(()=>{ console.log('TIMEOUT rounds='+round); process.exit(3); }, 90000);
