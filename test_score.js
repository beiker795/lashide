const WebSocket = require('ws');
const URL = 'ws://localhost:3000';
const TARGET = 6;
let round=0, allOk=true;

const ws = new WebSocket(URL);
function autoAct(m){
  if(m.winner) return {done:true};
  const ya=m.yourActions;
  if(ya && ya.type==='discard'){
    const hand=m.players[m.youSeat].hand;
    return {act:{type:'discard', tile:hand[0]}};
  } else if(ya && ya.type==='claim'){
    const opt=ya.options.find(o=>o.action==='hu')||ya.options.find(o=>o.action==='pung')||null;
    return {act:{type:'claim', action:opt?opt.action:'pass', tiles:opt?opt.tiles:undefined}};
  }
  return null;
}
ws.on('open', ()=>{ ws.send(JSON.stringify({type:'quickstart', name:'甲'})); });
ws.on('message', (raw)=>{
  const m=JSON.parse(raw);
  if(m.type!=='state') return;
  const act=autoAct(m);
  if(act && act.act) ws.send(JSON.stringify(act.act));
  if(act && act.done){
    const w=m.winner;
    if(w.draw){ console.log('[局'+round+'] 流局，积分不变'); if(round<TARGET) ws.send(JSON.stringify({type:'again'})); else { console.log(allOk?'SCORE_OK':'SCORE_FAIL'); process.exit(allOk?0:1);} return; }
    round++;
    const d=w.deltas, sumD=d.reduce((a,b)=>a+b,0), sumS=w.scores.reduce((a,b)=>a+b,0);
    const ok = sumD===0 && sumS===0;
    if(!ok) allOk=false;
    const parts=[0,1,2,3].map(s=>m.players[s].name+'='+(d[s]>=0?'+':'')+d[s]).join(' ');
    console.log('[局'+round+'] 本局 ['+parts+'] 和='+sumD+' | 累计和='+sumS+' '+(ok?'OK':'FAIL'));
    if(round>=TARGET){ console.log(allOk?'SCORE_OK (积分守恒，'+TARGET+'局通过)':'SCORE_FAIL'); process.exit(allOk?0:1); }
    else ws.send(JSON.stringify({type:'again'}));
  }
});
ws.on('error', (e)=>{ console.log('WS error', e.message); process.exit(2); });
setTimeout(()=>{ console.log('TIMEOUT'); process.exit(3); }, 120000);
