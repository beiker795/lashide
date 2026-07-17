const WebSocket = require('ws');
const URL = 'wss://wechat-mahjong-production-fc6f.up.railway.app';

function makeClient(name, onState){
  const ws = new WebSocket(URL);
  ws.name = name; ws.seat = -1; ws.code = '';
  ws.on('message', (raw)=>{
    const m = JSON.parse(raw);
    if(m.type==='joined'){ ws.seat=m.seat; ws.code=m.code; }
    else if(m.type==='state'){ onState(ws, m); }
  });
  ws.on('error', (e)=>{ console.log(name+' WS error:', e.message); });
  return ws;
}
function totalTiles(m){
  let t = m.wallCount;
  for(const p of m.players){
    const hc = p.hand ? p.hand.length : p.handCount;
    t += hc + p.melds.reduce((a,md)=>a+md.tiles.length,0) + p.discards.length;
  }
  return t;
}
function autoAct(ws, m){
  if(m.winner){ return {done:true, m}; }
  const ya = m.yourActions;
  if(ya && ya.type==='discard'){
    const hand = m.players[m.youSeat].hand;
    ws.send(JSON.stringify({type:'discard', tile: hand[0]}));
  } else if(ya && ya.type==='claim'){
    const opt = ya.options.find(o=>o.action==='hu') || ya.options.find(o=>o.action==='pung') || null;
    ws.send(JSON.stringify({type:'claim', action: opt?opt.action:'pass', tiles: opt?opt.tiles:undefined}));
  }
  return {done:false};
}

function scenarioQuickstart(){
  return new Promise((resolve)=>{
    const c = makeClient('A', (ws,m)=>{
      const r = autoAct(ws, m);
      if(r.done){
        const tot = totalTiles(m);
        const bots = m.players.filter(p=>p.isBot).length;
        console.log('[Railway quickstart] 结束 phase='+m.phase+' 牌数='+tot+' 机器人='+bots+' 胜者='+(m.winner.draw?'流局':m.winner.winners.map(w=>m.players[w].name).join(',')));
        resolve(tot===136 && bots>=1);
      }
    });
    c.on('open', ()=>{ console.log('WS 已连接 Railway'); c.send(JSON.stringify({type:'quickstart', name:'甲'})); });
    c.on('error', ()=>resolve(false));
  });
}

(async ()=>{
  const ok = await scenarioQuickstart();
  console.log(ok ? 'RAILWAY_OK' : 'RAILWAY_FAIL');
  process.exit(ok?0:1);
})();
setTimeout(()=>{ console.log('TIMEOUT'); process.exit(1); }, 60000);
