// 验证"吃碰杠胡"动作广播：连本地/线上 server，自动对局，收集 type==='action' 消息
const WebSocket = require('ws');
const HOST = process.env.HOST || 'localhost:3000';
const proto = HOST.includes('railway.app') ? 'wss' : 'ws';
const URL = proto + '://' + HOST;

const seen = new Set();
let mySeat = -1, wins = 0, claimed = 0;
const ws = new WebSocket(URL);

function autoPlay(m){
  if(m.type === 'action'){ seen.add(m.action); return; }
  if(m.type !== 'state') return;
  mySeat = m.youSeat;
  const ya = m.yourActions;
  if(ya && ya.type === 'discard'){
    const hand = (m.players[mySeat] || {}).hand;
    if(hand && hand.length) ws.send(JSON.stringify({type:'discard', tile:hand[0]}));
  } else if(ya && ya.type === 'claim'){
    const o = ya.options.find(x=>x.action==='hu') || ya.options.find(x=>x.action==='kong') || ya.options.find(x=>x.action==='pung') || ya.options.find(x=>x.action==='chow') || null;
    ws.send(JSON.stringify({type:'claim', action:o?o.action:'pass', tiles:o?o.tiles:undefined}));
    if(o) claimed++;
  }
}

ws.on('open', ()=>{ ws.send(JSON.stringify({type:'quickstart', name:'语音测试', mode:'gb'})); });
ws.on('message', (raw)=>{
  const m = JSON.parse(raw);
  if(m.type === 'state' && m.winner){
    wins++;
    if(wins <= 8) ws.send(JSON.stringify({type:'again'}));
    else { report(); ws.close(); }
    return;
  }
  autoPlay(m);
});
ws.on('error', (e)=>{ console.log('WS_ERR', e.message); process.exit(2); });

const TO = setTimeout(()=>{ report(); process.exit(0); }, 75000);
function report(){
  clearTimeout(TO);
  console.log('ACTION_SEEN=' + JSON.stringify([...seen]));
  console.log('WINS=' + wins + ' CLAIMS_MADE=' + claimed);
  const need = ['chow','pung','kong','hu','zimo'];
  const got = need.filter(a=>seen.has(a));
  console.log('COVERED=' + got.length + '/' + need.length + ' (' + got.join(',') + ')');
}
