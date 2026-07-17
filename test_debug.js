const WebSocket=require('ws');
const ws=new WebSocket('ws://localhost:3000');
let n=0;
ws.on('open',()=>{console.log('OPEN');ws.send(JSON.stringify({type:'quickstart',name:'测试',mode:process.argv[2]||'gb'}));});
ws.on('message',(raw)=>{
  const m=JSON.parse(raw);
  if(m.type!=='state'){console.log('NONSTATE',m.type);return;}
  n++;
  const ya=m.yourActions;
  let yat=ya?ya.type:'null';
  console.log('#'+n+' phase='+m.phase+' youSeat='+m.youSeat+' wall='+m.wallCount+' ya='+yat+(m.winner?' WINNER':''));
  if(m.winner){console.log('WINNER deltas=',JSON.stringify(m.winner.deltas));ws.close();process.exit(0);}
  if(ya&&ya.type==='discard'){const hand=(m.players[m.youSeat]||{}).hand;if(hand){ws.send(JSON.stringify({type:'discard',tile:hand[0]}));}}
  else if(ya&&ya.type==='claim'){const o=ya.options.find(x=>x.action==='hu')||ya.options.find(x=>x.action==='pung')||null;ws.send(JSON.stringify({type:'claim',action:o?o.action:'pass',tiles:o?o.tiles:undefined}));}
});
ws.on('error',e=>{console.log('ERR',e.message);process.exit(2);});
setTimeout(()=>{console.log('TIMEOUT n='+n);process.exit(3);},30000);
