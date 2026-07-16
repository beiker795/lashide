const WebSocket = require('ws');
const URL = 'ws://localhost:3000';

function makeClient(name, onState){
  const ws = new WebSocket(URL);
  ws.name = name; ws.seat = -1; ws.code = '';
  ws.on('message', (raw)=>{
    const m = JSON.parse(raw);
    if(m.type==='joined'){ ws.seat=m.seat; ws.code=m.code; }
    else if(m.type==='state'){ onState(ws, m); }
  });
  ws.on('error', (e)=>{ console.log(name+' error', e.message); });
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
    const results={};
    const c = makeClient('A', (ws,m)=>{
      const r = autoAct(ws, m);
      if(r.done){
        const tot = totalTiles(m);
        const bots = m.players.filter(p=>p.isBot).length;
        console.log('[quickstart] 结束 phase='+m.phase+' 牌数='+tot+' 机器人席位='+bots+' 胜者='+(m.winner.draw?'流局':m.winner.winners.map(w=>m.players[w].name).join(',')));
        if(tot!==136){ console.log('FAIL quickstart 牌数!=136'); }
        if(bots<1){ console.log('FAIL 未补机器人'); }
        resolve(true);
      }
    });
    c.on('open', ()=>{ c.send(JSON.stringify({type:'quickstart', name:'甲'})); });
  });
}
function scenarioTwoHuman(){
  return new Promise((resolve)=>{
    let finished=false;
    const A = makeClient('A', (ws,m)=>{
      const r=autoAct(ws,m);
      if(r.done && !finished){
        finished=true;
        const tot=totalTiles(m);
        console.log('[2人房] 结束 phase='+m.phase+' 牌数='+tot+' 胜者='+(m.winner.draw?'流局':m.winner.winners.map(w=>m.players[w].name).join(',')));
        if(tot!==136) console.log('FAIL 2人房 牌数!=136');
        resolve(true);
      }
    });
    let B=null;
    A.on('open', ()=>{ A.send(JSON.stringify({type:'create', name:'甲'})); });
    A.on('message', (raw)=>{
      const m=JSON.parse(raw);
      if(m.type==='joined' && A.seat===0 && !B){
        B = makeClient('B', (ws2,m2)=>{
          const r=autoAct(ws2,m2);
          if(r.done && !finished){ finished=true; const tot=totalTiles(m2); console.log('[2人房-B视角] 结束 牌数='+tot); resolve(true); }
        });
        B.on('open', ()=>{ B.send(JSON.stringify({type:'join', name:'乙', code:A.code})); 
          setTimeout(()=>{ A.send(JSON.stringify({type:'start'})); }, 300);
        });
        // 中途让 B 掉线，验证转机器人后游戏继续
        setTimeout(()=>{ console.log('[2人房] 乙掉线，测试转机器人'); B.close(); }, 2500);
      }
    });
  });
}

(async ()=>{
  await scenarioQuickstart();
  await scenarioTwoHuman();
  console.log('ALL_TESTS_DONE');
  process.exit(0);
})();
setTimeout(()=>{ console.log('TIMEOUT'); process.exit(1); }, 90000);
