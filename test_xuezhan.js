// 血战到底测试：验证定缺流程、续打(有人胡后继续)、终局(scEnd)、积分守恒(roundDeltas和=0)
process.on('uncaughtException', e=>{ console.log('UNCAUGHT', e.stack); process.exit(9); });
process.on('unhandledRejection', e=>{ console.log('UNHANDLED', e&&e.stack); process.exit(8); });
const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:3000');
let dingqueSent=false, dingqueSeen=false, huSeen=0, scEnd=false, roundOk=false, wallStart=null;
ws.on('open', ()=>ws.send(JSON.stringify({type:'quickstart', name:'血战测试', mode:'sc'})));
ws.on('message', (raw)=>{
  const m = JSON.parse(raw);
  if(m.type!=='state') return;
  if(wallStart===null && m.phase==='turn') wallStart=m.wallCount;
  if(m.yourActions && m.yourActions.type==='dingque'){
    dingqueSeen=true;
    if(!dingqueSent){ dingqueSent=true; ws.send(JSON.stringify({type:'dingque', suit:'m'})); }
    return;
  }
  const ya=m.yourActions;
  if(ya && ya.type==='discard'){
    const zimoOpt=(ya.self||[]).find(x=>x.action==='zimo');
    if(zimoOpt){ ws.send(JSON.stringify({type:'zimo'})); }
    else { const hand=(m.players[m.youSeat]||{}).hand; if(hand) ws.send(JSON.stringify({type:'discard', tile:hand[0]})); }
  }
  else if(ya && ya.type==='claim'){ const o=ya.options.find(x=>x.action==='hu')||ya.options.find(x=>x.action==='pung')||null; ws.send(JSON.stringify({type:'claim', action:o?o.action:'pass', tiles:o?o.tiles:undefined})); }
  for(const p of m.players){ if(p && p.hu) huSeen=Math.max(huSeen,1); }
  if(m.winner && m.winner.scEnd){
    scEnd=true;
    const rd=m.winner.roundDeltas||m.winner.deltas;
    roundOk = rd ? (rd.reduce((a,b)=>a+b,0)===0) : false;
    const sd=(m.winner.huInfos||[]).filter(x=>x.selfDraw).length;
    console.log('SC_END wallStart='+wallStart+' huSeen='+huSeen+' huCount='+(m.winner.huInfos||[]).length+' selfDraw='+sd+' roundDeltasSum='+rd.reduce((a,b)=>a+b,0));
    ws.close();
    process.exit((dingqueSeen && scEnd && roundOk && huSeen>=1) ? 0 : 1);
  }
});
ws.on('error',(e)=>{ console.log('ERR', e.message); process.exit(2); });
setTimeout(()=>{ console.log('TIMEOUT dingqueSeen='+dingqueSeen+' huSeen='+huSeen+' scEnd='+scEnd); process.exit(3); }, 90000);
