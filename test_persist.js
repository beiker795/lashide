// 模拟浏览器 localStorage 的持久化端到端验证
// 流程：甲 快速开始 → 自动打一局得分 → 退大厅 → 以同一昵称创建新房 → 校验座位分带入
const WebSocket = require('ws');
const LOCAL = {}; // mock localStorage，key: mj_score_<name>
function getStoredScore(name){ return parseInt(LOCAL['mj_score_'+name]) || 0; }
function setStoredScore(name, score){ LOCAL['mj_score_'+name] = String(score); }

const URL = 'wss://wechat-mahjong-production-fc6f.up.railway.app';
const NAME = '甲';
let phase = 'r1';     // r1: 在A房打一局；r2: 建B房校验
let code1 = null, brought = 0, sawR2Score = null;
const ws = new WebSocket(URL);

function autoAct(m){
  if(m.winner) return {winner:true};
  const ya = m.yourActions;
  if(ya && ya.type==='discard'){ const hand = m.players[m.youSeat].hand; return {act:{type:'discard', tile:hand[0]}}; }
  if(ya && ya.type==='claim'){ const o = ya.options.find(x=>x.action==='hu') || ya.options.find(x=>x.action==='pung') || null; return {act:{type:'claim', action:o?o.action:'pass', tiles:o?o.tiles:undefined}}; }
  return {act:null};
}

ws.on('open', ()=>{ console.log('OPEN'); ws.send(JSON.stringify({type:'quickstart', name:NAME, score:getStoredScore(NAME)})); });
ws.on('message', (raw)=>{
  const m = JSON.parse(raw);
  if(m.type==='joined'){ if(phase==='r1') code1 = m.code; return; }
  if(m.type==='lobby'){
    if(phase==='r2'){ console.log('[B房] 收到大厅，点击开始游戏'); ws.send(JSON.stringify({type:'start'})); }
    return;
  }
  if(m.type!=='state') return;
  if(phase==='r1'){
    if(m.winner){
      if(!m.winner.draw){ brought = (m.winner.deltas && m.winner.deltas[m.youSeat]) || 0; }
      else brought = 0;
      setStoredScore(NAME, getStoredScore(NAME) + brought);
      console.log('[A房] 本局得分=' + brought + '，localStorage 累计=' + getStoredScore(NAME));
      phase = 'r2';
      console.log('[退大厅] 以昵称「' + NAME + '」创建新房，带入分=' + getStoredScore(NAME));
      ws.send(JSON.stringify({type:'create', name:NAME, score:getStoredScore(NAME)}));
      return;
    }
    const a = autoAct(m); if(a.act) ws.send(JSON.stringify(a.act));
    return;
  }
  if(phase==='r2'){
    if(m.youSeat===0 && m.phase!=='lobby' && m.scores){
      sawR2Score = m.scores[0];
      const ok = sawR2Score === getStoredScore(NAME);
      console.log('[B房] 座位分=' + sawR2Score + '，期望(localStorage)=' + getStoredScore(NAME) + (ok ? ' ✅ 换房保留成功' : ' ❌ 不一致'));
      console.log(ok ? 'PERSIST_OK' : 'PERSIST_FAIL');
      ws.close(); process.exit(ok ? 0 : 1);
    }
    const a = autoAct(m); if(a.act) ws.send(JSON.stringify(a.act));
    return;
  }
});
ws.on('error', (e)=>{ console.log('WSERR', e.message); process.exit(2); });
setTimeout(()=>{ console.log('TIMEOUT phase=' + phase); process.exit(3); }, 60000);
