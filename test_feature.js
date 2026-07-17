process.on('uncaughtException', e=>{ console.log('UNCAUGHT', e.message); process.exit(9); });
const WebSocket = require('ws');
const URL='ws://localhost:3000';

let pass=true; const fail=(m)=>{ console.log('FAIL: '+m); pass=false; };
const assert=(c,m)=>{ if(!c) fail(m); else console.log('OK: '+m); };

const ws1=new WebSocket(URL);
const ws2=new WebSocket(URL);
let phase='r1';            // r1 -> 打到出结果; r2 -> 校验带入分并触发观战
let code1=null, code2=null, broughtScore=null;
let spectatorGotView=false, spectatorNoAction=false, gameContinuedAfterLeave=false, spectatePhaseSent=false, ws1AfterLeave=0, scoreAsserted=false;

function autoAct1(m){
  if(m.winner) return {winner:true};
  const ya=m.yourActions;
  if(ya && ya.type==='discard'){ const hand=(m.players[m.youSeat]||{}).hand; if(hand) return {act:{type:'discard',tile:hand[0]}}; }
  else if(ya && ya.type==='claim'){ const o=ya.options.find(x=>x.action==='hu')||ya.options.find(x=>x.action==='pung')||null; return {act:{type:'claim',action:o?o.action:'pass',tiles:o?o.tiles:undefined}}; }
  return null;
}

ws1.on('open',()=>{ ws1.send(JSON.stringify({type:'quickstart', name:'甲', score:0})); });

ws1.on('message',(raw)=>{
  const m=JSON.parse(raw);
  if(gameContinuedAfterLeave && m.type==='state') ws1AfterLeave++;
  if(m.type==='joined'){
    if(m.seat===0){
      if(phase==='r1'){ code1=m.code; }
      else if(phase==='r2' && m.code!==code1){ code2=m.code; console.log('WS1 新房 code2='+code2); maybeSpectate(); }
    }
    return;
  }
  if(m.type!=='state') return;

  if(phase==='r1'){
    const a=autoAct1(m);
    if(a && a.winner){
      broughtScore = m.winner.draw ? 0 : (m.winner.deltas[m.youSeat] || 0);
      console.log('R1 结束，甲本局得分='+broughtScore+'，换房带入');
      phase='r2';
      ws1.send(JSON.stringify({type:'create', name:'甲', score:broughtScore}));
    } else if(a && a.act){ ws1.send(JSON.stringify(a.act)); }
    return;
  }

  if(phase==='r2'){
    if(m.youSeat===0 && m.phase==='lobby'){ ws1.send(JSON.stringify({type:'start'})); return; }
    if(m.youSeat===0 && m.phase!=='lobby' && m.scores && !scoreAsserted){
      scoreAsserted=true;
      assert(m.scores[0]===broughtScore, '换房后座位积分保留为 '+broughtScore+'（实际 '+m.scores[0]+'）');
    }
    maybeSpectate();
    const a=autoAct1(m);
    if(a && a.act) ws1.send(JSON.stringify(a.act));
    return;
  }
});

function maybeSpectate(){
  if(spectatePhaseSent || !code2) return;
  spectatePhaseSent=true;
  console.log('触发 WS2 观战 code2='+code2);
  ws2.send(JSON.stringify({type:'spectate', name:'观众', code:code2}));
}

ws2.on('open',()=>{ /* 由 ws1 触发 spectate */ });
ws2.on('message',(raw)=>{
  const m=JSON.parse(raw);
  if(m.type==='joined'){ if(m.seat===-1) console.log('WS2 以观战者身份加入（seat=-1）'); return; }
  if(m.type==='state' && m.youSeat===-1){
    spectatorGotView=true;
    assert(m.yourActions===null, '观战者无操作按钮(yourActions=null)');
    assert(m.players.length===4, '观战者能看到4个玩家');
    spectatorNoAction = (m.yourActions===null);
    ws2.send(JSON.stringify({type:'discard', tile:'m1'})); // 应被服务端忽略
    setTimeout(()=>{ console.log('WS2 断开观战'); ws2.close(); gameContinuedAfterLeave=true; ws1.send(JSON.stringify({type:'again'})); }, 500);
  }
});

setTimeout(()=>{
  console.log('--- 总结 ---');
  assert(spectatorGotView, '观战者收到牌桌视图(youSeat=-1)');
  assert(spectatorNoAction, '观战者无操作按钮');
  assert(ws1AfterLeave>0, '观战者断开后对局继续(WS1 后续收到 '+ws1AfterLeave+' 条状态)');
  console.log(pass?'FEATURE_OK (换房积分保留 + 观战 全部通过)':'FEATURE_FAIL');
  process.exit(pass?0:1);
}, 60000);
