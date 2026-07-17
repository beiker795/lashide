// 线上验证：指定模式 quickstart，确认能开局且 mode 正确
const WebSocket = require('ws');
const mode = process.argv[2] || 'gd';
const URL = 'wss://wechat-mahjong-production-fc6f.up.railway.app';
const ws = new WebSocket(URL);
let got = false;
ws.on('open', ()=>{ console.log('OPEN', mode); ws.send(JSON.stringify({type:'quickstart', name:'线上验证', mode})); });
ws.on('message', (raw)=>{
  const m = JSON.parse(raw);
  if(m.type==='state' && m.phase==='turn' && !got){
    got = true;
    console.log('ONLINE OK mode='+m.mode+' wall='+m.wallCount+' youSeat='+m.youSeat);
    ws.close(); process.exit(0);
  }
});
ws.on('error', (e)=>{ console.log('WSERR', e.message); process.exit(2); });
setTimeout(()=>{ console.log('TIMEOUT'); process.exit(3); }, 20000);
