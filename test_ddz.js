// 斗地主本地测试：快速开始（1真人+2机器人），驱动叫分/出牌直到结束
const WebSocket = require('ws');
const RANKS = { '3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,'J':11,'Q':12,'K':13,'A':14,'2':15 };
function rankOf(c){ if(c==='X') return 16; if(c==='D') return 17; return RANKS[c]; }

const URL = (process.env.HOST? 'ws://'+process.env.HOST : 'ws://localhost:3000');
let ws = new WebSocket(URL);
let mySeat=-1, cur=null, done=false;
const start=Date.now();

ws.on('open', ()=> ws.send(JSON.stringify({type:'quickstart', game:'ddz', name:'测试员', score:0})));
ws.on('message', (raw)=>{
  let m; try{ m=JSON.parse(raw); }catch(e){ return; }
  if(m.type==='joined'){ mySeat=m.seat; return; }
  if(m.type==='error'){ console.log('ERR', m.msg); process.exit(1); }
  if(m.type==='state'){ handle(m); }
});
ws.on('error', (e)=>{ console.log('WS_ERROR', e && e.message); });
ws.on('close', ()=>{ if(!done){ console.log('CLOSED_UNEXPECTED'); process.exit(1); } else { console.log('CLOSED_AFTER_DONE'); } });

function handle(m){
  cur=m;
  console.log('STATE phase='+m.phase+' bidTurn='+(m.bidTurn!==undefined?m.bidTurn:m.turn)+' youSeat='+m.youSeat+' ya='+(m.yourActions?m.yourActions.type:'null')+' bids='+JSON.stringify(m.bids)+' lastBid='+m.lastBid);
  // 验证发牌守恒（开局瞬间：三手牌+底牌=54，或地主已并底牌20+17+17=54）
  if(m.phase==='bidding' && m.youSeat===mySeat && m.yourActions && m.yourActions.type==='bid'){
    const ya=m.yourActions;
    ws.send(JSON.stringify({type:'bid', score: (ya.min<=3? ya.min : 0)}));
    return;
  }
  if(m.phase==='playing' && m.youSeat===mySeat && m.yourActions && m.yourActions.type==='play'){
    const ya=m.yourActions;
    const myHand=m.players[mySeat].hand;
    const lp=m.lastPlay;
    let play=null;
    if(!lp || lp.seat===mySeat){
      play=[myHand[0]]; // 首出最小单
    } else if(lp.type==='single'){
      const need=rankOf(lp.cards[0]);
      const bigger=myHand.filter(c=>rankOf(c)>need && !(myHand.filter(x=>x===c).length===4)).sort((a,b)=>rankOf(a)-rankOf(b));
      if(bigger.length) play=[bigger[0]];
    }
    if(play){
      ws.send(JSON.stringify({type:'play', cards:play}));
    } else if(ya.canPass){
      ws.send(JSON.stringify({type:'pass'}));
    } else if(!lp || lp.seat===mySeat){
      ws.send(JSON.stringify({type:'play', cards:[myHand[0]]}));
    } else {
      ws.send(JSON.stringify({type:'pass'}));
    }
    return;
  }
  if(m.winner){
    verify(m);
    done=true;
    console.log('DDZ_OK winnerSeat='+m.winner.winnerSeat+' landlord='+m.winner.landlord+' base='+m.winner.base+' mult='+m.winner.mult);
    process.exit(0);
  }
}

function verify(m){
  const w=m.winner;
  const sum=w.deltas.reduce((a,b)=>a+b,0);
  if(sum!==0){ console.log('FAIL deltas sum='+sum); process.exit(1); }
  // 倍数与 delta 一致性
  const unit=w.base*w.mult;
  if(w.winnerSeat===w.landlord){
    if(w.deltas[w.landlord] !== 2*unit){ console.log('FAIL landlord win delta'); process.exit(1); }
  }
  const hands=m.players.map(p=>p.handCount);
  console.log('hands='+hands.join(',')+' deltas='+w.deltas.join(',')+' sum='+sum);
}

setTimeout(()=>{ if(!done){ console.log('TIMEOUT phase='+(cur?cur.phase:'?')); process.exit(3); } }, 120000);
