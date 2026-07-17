// ====== 联机麻将服务端（国标简化版）======
// 权威逻辑全部在服务器：房间、实时同步、机器人补位、掉线转机器人
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

// ----------------- 基础工具（与已验证引擎一致） -----------------
function ti(t){ const s=t[0], r=+t.slice(1); if(s==='m') return r-1; if(s==='s') return 9+r-1; if(s==='p') return 18+r-1; return 27+r-1; }
function fromIndex(i){ if(i<9) return 'm'+(i+1); if(i<18) return 's'+(i-9+1); if(i<27) return 'p'+(i-18+1); return 'z'+(i-27+1); }
function toCounts(arr){ let c=new Array(34).fill(0); for(const t of arr) c[ti(t)]++; return c; }
function canFormMelds(c){
  let i=-1;
  for(let k=0;k<34;k++){ if(c[k]>0){ i=k; break; } }
  if(i===-1) return true;
  if(c[i]>=3){ c[i]-=3; if(canFormMelds(c)){ c[i]+=3; return true; } c[i]+=3; }
  if(i<27 && (i%9)<=6 && c[i+1]>0 && c[i+2]>0){
    c[i]--; c[i+1]--; c[i+2]--;
    if(canFormMelds(c)){ c[i]++; c[i+1]++; c[i+2]++; return true; }
    c[i]++; c[i+1]++; c[i+2]++;
  }
  return false;
}
function isWinningHand(c){
  let ok=true, pairs=0;
  for(let k=0;k<34;k++){ if(c[k]%2!==0){ ok=false; break; } if(c[k]===2) pairs++; }
  if(ok && pairs===7) return true;
  for(let k=0;k<34;k++){ if(c[k]>=2){ c[k]-=2; let r=canFormMelds(c); c[k]+=2; if(r) return true; } }
  return false;
}
function handValue(c){
  let x=c.slice(); let score=0;
  for(let i=0;i<34;i++){ while(x[i]>=3){ x[i]-=3; score+=2; } }
  for(let i=0;i<34;i++){ if(x[i]>=2){ x[i]-=2; score+=1; } }
  for(let s=0;s<3;s++){ for(let r=0;r<7;r++){ let i=s*9+r; while(x[i]>0&&x[i+1]>0&&x[i+2]>0){ x[i]--;x[i+1]--;x[i+2]--; score+=2; } } }
  return score;
}
function bestDiscardValue(hand){
  let best=-1, seen={};
  for(let idx=0;idx<hand.length;idx++){ let t=hand[idx]; if(seen[t]) continue; seen[t]=1; let h2=hand.slice(); h2.splice(idx,1); let v=handValue(toCounts(h2)); if(v>best) best=v; }
  return best;
}
function aiChooseDiscard(g, seat){
  let hand=g.players[seat].hand, bestScore=-1, bestTile=null, seen={};
  for(let idx=0;idx<hand.length;idx++){
    let t=hand[idx]; if(seen[t]) continue; seen[t]=1;
    let h2=hand.slice(); h2.splice(idx,1);
    let v=handValue(toCounts(h2));
    let s=t[0], r=+t.slice(1); let pref=(s==='z')?10:(r===1||r===9)?5:0;
    let score=v*100+pref;
    if(score>bestScore || bestTile===null){ bestScore=score; bestTile=t; }
  }
  return bestTile;
}
function chowCombos(hand, tile){
  let s=tile[0], r=+tile.slice(1), combos=[];
  if(r<=7 && hand.includes(s+(r+1)) && hand.includes(s+(r+2))) combos.push([s+(r+1), s+(r+2)]);
  if(r>=2 && r<=8 && hand.includes(s+(r-1)) && hand.includes(s+(r+1))) combos.push([s+(r-1), s+(r+1)]);
  if(r>=3 && hand.includes(s+(r-2)) && hand.includes(s+(r-1))) combos.push([s+(r-2), s+(r-1)]);
  return combos;
}
function removeOne(arr, t){ let i=arr.indexOf(t); if(i>=0) arr.splice(i,1); }
function removeFromHand(g, seat, tile){ let h=g.players[seat].hand; let i=h.indexOf(tile); if(i>=0) h.splice(i,1); }
function sortHand(g, seat){ g.players[seat].hand.sort((a,b)=>ti(a)-ti(b)); }
function buildWall(){ let w=[]; for(const s of ['m','s','p']) for(let r=1;r<=9;r++) for(let k=0;k<4;k++) w.push(s+r); for(let r=1;r<=7;r++) for(let k=0;k<4;k++) w.push('z'+r); return w; }
function shuffle(a){ for(let i=a.length-1;i>0;i--){ let j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }

function isAllPung(c){ let pairs=0; for(let i=0;i<34;i++){ if(c[i]!==0 && c[i]!==2 && c[i]!==3) return false; if(c[i]===2) pairs++; } return pairs===1; }
function winInfo(g, seat, tile, selfDraw){
  let pl=g.players[seat]; let all=pl.hand.slice(); all.push(tile);
  let c=toCounts(all), melds=pl.melds, labels=[];
  if(selfDraw) labels.push('自摸');
  if(melds.length===0){ let pairs=0, ok=true; for(let i=0;i<34;i++){ if(c[i]%2!==0){ok=false;break;} if(c[i]===2) pairs++; } if(ok && pairs===7) labels.push('七对'); }
  if(!melds.some(m=>m.type==='chow') && isAllPung(c)) labels.push('碰碰胡');
  let suits=new Set(all.map(t=>t[0])); if(suits.size===1) labels.push('清一色');
  if(labels.length===0) labels.push('平胡');
  return labels.join(' ');
}
// 数值番数（用于积分）
function computeFan(g, seat, tile, selfDraw){
  let pl=g.players[seat]; let all=pl.hand.slice(); all.push(tile);
  let c=toCounts(all), melds=pl.melds; let fan=1;
  if(selfDraw) fan+=1;
  if(melds.length===0){ let pairs=0, ok=true; for(let i=0;i<34;i++){ if(c[i]%2!==0){ok=false;break;} if(c[i]===2) pairs++; } if(ok && pairs===7) fan+=2; }
  if(!melds.some(m=>m.type==='chow') && isAllPung(c)) fan+=2;
  let suits=new Set(all.map(t=>t[0])); if(suits.size===1) fan+=4;
  return fan;
}

// ----------------- 房间与对局流程 -----------------
const rooms = {};
function genCode(){ const cs='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s=''; for(let i=0;i<4;i++) s+=cs[Math.floor(Math.random()*cs.length)]; return s; }

function newGame(room){
  const g={ wall: shuffle(buildWall()), players: room.players, turn:0, drawnTile:null, lastDiscard:null, phase:'play', winner:null };
  room.game=g; room.awaiting=null; room.pendingClaims=null; room.awaitTimer=null;
  for(let s=0;s<4;s++){ let p=g.players[s]; p.hand=[]; p.melds=[]; p.discards=[]; }
  for(let i=0;i<13;i++) for(let s=0;s<4;s++) g.players[s].hand.push(g.wall.pop());
  for(let s=0;s<4;s++) sortHand(g,s);
  g.turn=0;
}
function startGame(room){
  // 空位填机器人
  let bi=0;
  for(let s=0;s<4;s++){ if(!room.players[s]){ bi++; room.players[s]={ ws:null, name:'机器人'+String.fromCharCode(64+bi), isBot:true, connected:true, seat:s }; } }
  newGame(room);
  proceedTurn(room);
}
function restartGame(room){ startGame(room); }

function proceedTurn(room){
  const g=room.game;
  if(g.phase==='over') return;
  let seat=g.turn;
  if(g.wall.length===0){ endRoundDraw(room); return; }
  let tile=g.wall.pop(); g.players[seat].hand.push(tile); g.drawnTile=tile; sortHand(g,seat); g.phase='turn';
  if(g.players[seat].isBot){ setTimeout(()=>botTurn(room,seat), 600); }
  else { room.awaiting={seat, kind:'discard'}; broadcast(room); }
}
function botTurn(room, seat){
  const g=room.game; const pl=g.players[seat];
  if(isWinningHand(toCounts(pl.hand))){ endRound(room,[seat], g.drawnTile, true); return; }
  let c=toCounts(pl.hand);
  for(let i=0;i<34;i++){ if(c[i]>=4){ doAnKong(room,seat,fromIndex(i)); return; } }
  if(g.drawnTile){ let di=ti(g.drawnTile); for(const m of pl.melds){ if(m.type==='pung'&&ti(m.tiles[0])===di){ doBuKong(room,seat,g.drawnTile); return; } } }
  let d=aiChooseDiscard(g,seat); doDiscard(room,seat,d);
}
function doAnKong(room, seat, tile){
  const g=room.game, pl=g.players[seat];
  for(let k=0;k<4;k++) removeFromHand(g,seat,tile);
  pl.melds.push({type:'kong', tiles:[tile,tile,tile,tile], from:seat, an:true});
  if(g.wall.length){ let d=g.wall.pop(); pl.hand.push(d); g.drawnTile=d; sortHand(g,seat); }
  g.turn=seat; afterKong(room,seat);
}
function doBuKong(room, seat, tile){
  const g=room.game, pl=g.players[seat];
  for(const m of pl.melds){ if(m.type==='pung'&&ti(m.tiles[0])===ti(tile)){ m.type='kong'; m.tiles.push(tile); m.from=seat; break; } }
  removeFromHand(g,seat,tile);
  if(g.wall.length){ let d=g.wall.pop(); pl.hand.push(d); g.drawnTile=d; sortHand(g,seat); }
  g.turn=seat; afterKong(room,seat);
}
function afterKong(room, seat){
  const g=room.game;
  if(g.players[seat].isBot){ setTimeout(()=>botTurn(room,seat), 600); }
  else { room.awaiting={seat, kind:'discard'}; broadcast(room); }
}
function enterDiscardPhase(room, seat){
  const g=room.game; g.drawnTile=null;
  if(g.players[seat].isBot){ setTimeout(()=>botTurn(room,seat), 600); }
  else { room.awaiting={seat, kind:'discard'}; broadcast(room); }
}
function doDiscard(room, seat, tile){
  const g=room.game;
  removeFromHand(g,seat,tile);
  g.players[seat].discards.push(tile);
  g.lastDiscard={seat,tile}; g.phase='claim'; room.awaiting=null;
  onDiscard(room, seat, tile);
  broadcast(room);
}
function claimOptionsFor(g, seat, tile, fromSeat){
  let hand=g.players[seat].hand, c=toCounts(hand), idx=ti(tile), opts=[];
  let test=hand.slice(); test.push(tile);
  if(isWinningHand(toCounts(test))) opts.push({action:'hu'});
  if(c[idx]===3) opts.push({action:'kong'});
  if(c[idx]>=2){
    let r=+tile.slice(1); let isJunk=(tile[0]==='z')||r===1||r===9;
    let multi=Object.values(c).filter(v=>v>=2).length>=2;
    if(isJunk||multi) opts.push({action:'pung'});
  }
  if((seat+3)%4===fromSeat && idx<27){
    for(const combo of chowCombos(hand,tile)){
      let h2=hand.slice(); removeOne(h2,combo[0]); removeOne(h2,combo[1]);
      if(handValue(toCounts(h2)) >= bestDiscardValue(hand)-2) opts.push({action:'chow', tiles:combo});
    }
  }
  return opts;
}
function botClaimChoice(g, seat, tile, fromSeat){
  let opts=claimOptionsFor(g,seat,tile,fromSeat);
  if(opts.some(o=>o.action==='hu')) return opts.find(o=>o.action==='hu');
  if(opts.some(o=>o.action==='kong')) return opts.find(o=>o.action==='kong');
  if(opts.some(o=>o.action==='pung')) return opts.find(o=>o.action==='pung');
  if(opts.some(o=>o.action==='chow')) return opts.find(o=>o.action==='chow');
  return null;
}
function onDiscard(room, seat, tile){
  const g=room.game;
  let possible={};
  for(let p=0;p<4;p++){ if(p===seat) continue; let o=claimOptionsFor(g,p,tile,seat); if(o.length) possible[p]=o; }
  let botChoices=[], humanSeats=[], optionsBySeat={};
  for(let p in possible){
    optionsBySeat[p]=possible[p];
    if(g.players[p].isBot) botChoices.push({seat:+p, choice: botClaimChoice(g,+p,tile,seat)});
    else humanSeats.push(+p);
  }
  if(humanSeats.length===0){ finalizeClaims(room, seat, tile, botChoices, {}); return; }
  room.pendingClaims={ fromSeat:seat, tile, botChoices, humanResponses:{}, humanSeats, optionsBySeat,
    timer: setTimeout(()=>{
      if(!room.pendingClaims) return;
      for(let p of room.pendingClaims.humanSeats){ if(!(p in room.pendingClaims.humanResponses)) room.pendingClaims.humanResponses[p]={action:'pass'}; }
      resolvePending(room);
    }, 8000)
  };
  broadcast(room);
}
function onClaimResponse(room, seat, choice){
  if(!room.pendingClaims) return;
  if(room.pendingClaims.humanSeats.includes(seat) && !(seat in room.pendingClaims.humanResponses)){
    room.pendingClaims.humanResponses[seat]=choice;
    if(Object.keys(room.pendingClaims.humanResponses).length === room.pendingClaims.humanSeats.length) resolvePending(room);
  }
}
function resolvePending(room){
  const pc=room.pendingClaims; if(!pc) return; clearTimeout(pc.timer); room.pendingClaims=null;
  finalizeClaims(room, pc.fromSeat, pc.tile, pc.botChoices, pc.humanResponses);
}
function finalizeClaims(room, fromSeat, tile, botChoices, humanResponses){
  const g=room.game; let all=[];
  for(const b of botChoices) if(b.choice) all.push({seat:b.seat, ...b.choice});
  for(const p in humanResponses){ if(humanResponses[p].action!=='pass') all.push({seat:+p, ...humanResponses[p]}); }
  let hus=all.filter(c=>c.action==='hu');
  if(hus.length){ endRound(room, hus.map(c=>c.seat), tile, false); return; }
  let pk=all.filter(c=>c.action==='pung'||c.action==='kong');
  if(pk.length){ executeClaim(room, pk[0], tile, fromSeat); return; }
  let ch=all.filter(c=>c.action==='chow');
  if(ch.length){ executeClaim(room, ch[0], tile, fromSeat); return; }
  g.turn=(fromSeat+1)%4; proceedTurn(room);
}
function executeClaim(room, claim, tile, fromSeat){
  const g=room.game, seat=claim.seat, pl=g.players[seat];
  g.players[fromSeat].discards.pop();
  if(claim.action==='chow'){
    for(const t of claim.tiles) removeFromHand(g,seat,t);
    pl.melds.push({type:'chow', tiles:[claim.tiles[0], claim.tiles[1], tile], from:fromSeat});
    g.turn=seat; enterDiscardPhase(room,seat);
  } else if(claim.action==='pung'){
    removeFromHand(g,seat,tile); removeFromHand(g,seat,tile);
    pl.melds.push({type:'pung', tiles:[tile,tile,tile], from:fromSeat});
    g.turn=seat; enterDiscardPhase(room,seat);
  } else if(claim.action==='kong'){
    removeFromHand(g,seat,tile); removeFromHand(g,seat,tile); removeFromHand(g,seat,tile);
    pl.melds.push({type:'kong', tiles:[tile,tile,tile,tile], from:fromSeat});
    g.turn=seat;
    if(g.wall.length){ let d=g.wall.pop(); pl.hand.push(d); g.drawnTile=d; sortHand(g,seat); }
    afterKong(room,seat);
  }
}
function endRound(room, winners, tile, selfDraw){
  const g=room.game; g.phase='over'; g.winner={winners, tile, selfDraw}; room.awaiting=null; room.pendingClaims=null;
  if(room.awaitTimer) clearTimeout(room.awaitTimer);
  if(!room.scores) room.scores=[0,0,0,0];
  let deltas=[0,0,0,0];
  if(selfDraw){
    let F=computeFan(g, winners[0], tile, true);
    deltas[winners[0]] += 3*F;
    for(let p=0;p<4;p++) if(p!==winners[0]) deltas[p] -= F;
  } else {
    let discarder = g.lastDiscard ? g.lastDiscard.seat : -1;
    for(const w of winners){
      let F=computeFan(g, w, tile, false);
      deltas[w] += F;
      if(discarder>=0) deltas[discarder] -= F;
    }
  }
  for(let p=0;p<4;p++) room.scores[p] += deltas[p];
  g.winner.scores=room.scores.slice();
  g.winner.deltas=deltas;
  broadcast(room);
}
function endRoundDraw(room){
  const g=room.game; g.phase='over'; g.winner={draw:true}; room.awaiting=null; room.pendingClaims=null;
  broadcast(room);
}

// ----------------- 视图与广播 -----------------
function buildView(room, seat){
  const g=room.game;
  let players=g.players.map((p,s)=>({
    seat:s, name:p.name, isBot:p.isBot, connected:p.connected,
    handCount:p.hand.length,
    hand: s===seat ? p.hand.slice().sort((a,b)=>ti(a)-ti(b)) : null,
    melds:p.melds, discards:p.discards
  }));
  let yourActions=null;
  if(room.awaiting && room.awaiting.seat===seat){
    let self=[]; let pl=g.players[seat];
    if(isWinningHand(toCounts(pl.hand))) self.push({action:'zimo',label:'自摸胡'});
    let c=toCounts(pl.hand);
    for(let i=0;i<34;i++){ if(c[i]>=4) self.push({action:'ankong',tile:fromIndex(i),label:'暗杠 '+fromIndex(i)}); }
    if(g.drawnTile){ let di=ti(g.drawnTile); for(const m of pl.melds){ if(m.type==='pung'&&ti(m.tiles[0])===di) self.push({action:'bukong',tile:g.drawnTile,label:'补杠 '+g.drawnTile}); } }
    yourActions={type:'discard', self};
  } else if(room.pendingClaims && room.pendingClaims.humanSeats.includes(seat)){
    yourActions={type:'claim', options: room.pendingClaims.optionsBySeat[seat], tile: room.pendingClaims.tile};
  }
  return { type:'state', youSeat:seat, turn:g.turn, wallCount:g.wall.length, phase:g.phase,
    scores: room.scores || [0,0,0,0],
    lastDiscard:g.lastDiscard, players, yourActions,
    winner: g.winner ? {
      draw: !!g.winner.draw, winners:g.winner.winners, tile:g.winner.tile, selfDraw:g.winner.selfDraw,
      scores: g.winner.scores, deltas: g.winner.deltas,
      info: g.winner.draw ? [] : g.winner.winners.map(w=>({seat:w, name:g.players[w].name, fan:winInfo(g,w,g.winner.tile,g.winner.selfDraw), fanNum:computeFan(g,w,g.winner.tile,g.winner.selfDraw), delta:g.winner.deltas[w], hand:g.players[w].hand.concat([g.winner.tile]) }))
    } : null
  };
}
function buildSpectatorView(room){
  const g=room.game;
  let players=room.players.map((p,s)=>({
    seat:s, name:p?p.name:null, isBot:p?p.isBot:false, connected:p?p.connected:false,
    handCount:p&&p.hand?p.hand.length:0,
    hand: (p&&p.hand)? p.hand.slice().sort((a,b)=>ti(a)-ti(b)) : null,
    melds:(p&&p.melds)?p.melds:[], discards:(p&&p.discards)?p.discards:[]
  }));
  let winner=null;
  if(g && g.winner){
    winner={ draw:!!g.winner.draw, winners:g.winner.winners, tile:g.winner.tile, selfDraw:g.winner.selfDraw,
      scores:g.winner.scores, deltas:g.winner.deltas,
      info: g.winner.draw?[]:g.winner.winners.map(w=>({seat:w, name:g.players[w].name, fan:winInfo(g,w,g.winner.tile,g.winner.selfDraw), fanNum:computeFan(g,w,g.winner.tile,g.winner.selfDraw), delta:g.winner.deltas[w], hand:g.players[w].hand.concat([g.winner.tile]) })) };
  }
  return { type:'state', youSeat:-1, turn: g?g.turn:-1, wallCount: g?g.wall.length:0, phase: g?g.phase:'lobby',
    scores: room.scores||[0,0,0,0], lastDiscard: g?g.lastDiscard:null, players, yourActions:null, winner };
}
function buildLobby(room){
  return { type:'lobby', code:room.code, host:room.host, started: !!(room.game && room.game.phase!=='over'),
    players: room.players.map((p,s)=>({seat:s, name:p?p.name:null, isBot:p?p.isBot:false, connected:p?p.connected:false})) };
}
function send(ws, obj){ if(ws && ws.readyState===1) ws.send(JSON.stringify(obj)); }
function broadcast(room){ for(let s=0;s<4;s++){ let p=room.players[s]; if(p && p.ws && p.connected) send(p.ws, buildView(room,s)); } for(const sp of (room.spectators||[])) send(sp.ws, buildSpectatorView(room)); }
function broadcastLobby(room){ for(let s=0;s<4;s++){ let p=room.players[s]; if(p && p.ws && p.connected) send(p.ws, buildLobby(room)); } for(const sp of (room.spectators||[])) send(sp.ws, buildSpectatorView(room)); }

// ----------------- 连接与消息处理 -----------------
const server = http.createServer((req,res)=>{
  let url = req.url.split('?')[0];
  if(url==='/' || url==='/index.html'){
    fs.readFile(path.join(__dirname,'public','index.html'),(e,data)=>{
      if(e){ res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}); res.end(data);
    });
  } else { res.writeHead(404); res.end('not found'); }
});
const wss = new WebSocket.Server({ server });

function findEmptySeat(room){ for(let s=0;s<4;s++) if(!room.players[s] || !room.players[s].connected) return s; return -1; }

wss.on('connection', (ws)=>{
  ws.roomCode=null; ws.seat=null;
  ws.on('message', (raw)=>{
    let m; try{ m=JSON.parse(raw); }catch(e){ return; }
    handleMsg(ws, m);
  });
  ws.on('close', ()=>handleDisconnect(ws));
});

function handleMsg(ws, m){
  if(m.type==='quickstart'){
    let code=genCode(); while(rooms[code]) code=genCode();
    let room={ code, host:0, players:[null,null,null,null], scores:[0,0,0,0], spectators:[] };
    rooms[code]=room;
    room.players[0]={ ws, name:(m.name||'玩家')+'', isBot:false, connected:true, seat:0 };
    room.scores[0]=m.score||0;
    ws.roomCode=code; ws.seat=0;
    send(ws,{type:'joined', code, seat:0});
    startGame(room);
    return;
  }
  if(m.type==='create'){
    let code=genCode(); while(rooms[code]) code=genCode();
    let room={ code, host:0, players:[null,null,null,null], scores:[0,0,0,0], spectators:[] };
    rooms[code]=room;
    room.players[0]={ ws, name:(m.name||'玩家')+'', isBot:false, connected:true, seat:0 };
    room.scores[0]=m.score||0;
    ws.roomCode=code; ws.seat=0;
    send(ws,{type:'joined', code, seat:0});
    broadcastLobby(room);
    return;
  }
  if(m.type==='join'){
    let room=rooms[m.code];
    if(!room){ send(ws,{type:'error', msg:'房间不存在'}); return; }
    if(room.game && room.game.phase!=='over'){ send(ws,{type:'error', msg:'房间已开始'}); return; }
    let seat=findEmptySeat(room);
    if(seat<0){ send(ws,{type:'error', msg:'房间已满'}); return; }
    room.players[seat]={ ws, name:(m.name||'玩家')+'', isBot:false, connected:true, seat };
    room.scores[seat]=m.score||0;
    ws.roomCode=room.code; ws.seat=seat;
    send(ws,{type:'joined', code:room.code, seat});
    broadcastLobby(room);
    return;
  }
  if(m.type==='spectate'){
    let room=rooms[m.code];
    if(!room){ send(ws,{type:'error', msg:'房间不存在'}); return; }
    ws.roomCode=room.code; ws.seat=-1; ws.isSpectator=true;
    room.spectators=room.spectators||[];
    room.spectators.push(ws);
    send(ws,{type:'joined', code:room.code, seat:-1});
    send(ws, buildSpectatorView(room));
    return;
  }
  if(m.type==='start'){
    let room=rooms[ws.roomCode]; if(!room) return;
    if(ws.seat!==room.host){ send(ws,{type:'error', msg:'只有房主能开始'}); return; }
    if(!room.game || room.game.phase==='over'){ startGame(room); }
    return;
  }
  if(m.type==='again'){
    let room=rooms[ws.roomCode]; if(!room) return;
    restartGame(room);
    return;
  }
  if(m.type==='discard'){
    let room=rooms[ws.roomCode]; if(!room||!room.game) return;
    if(!(room.awaiting && room.awaiting.seat===ws.seat)) return;
    if(!room.game.players[ws.seat].hand.includes(m.tile)) return;
    if(room.awaitTimer){ clearTimeout(room.awaitTimer); room.awaitTimer=null; }
    room.awaiting=null;
    doDiscard(room, ws.seat, m.tile);
    return;
  }
  if(m.type==='zimo'){
    let room=rooms[ws.roomCode]; if(!room||!room.game) return;
    if(!(room.awaiting && room.awaiting.seat===ws.seat)) return;
    if(isWinningHand(toCounts(room.game.players[ws.seat].hand))){ room.awaiting=null; endRound(room,[ws.seat], room.game.drawnTile, true); }
    return;
  }
  if(m.type==='ankong'){
    let room=rooms[ws.roomCode]; if(!room||!room.game) return;
    if(!(room.awaiting && room.awaiting.seat===ws.seat)) return;
    let c=toCounts(room.game.players[ws.seat].hand);
    if(ti(m.tile)<34 && c[ti(m.tile)]>=4){ room.awaiting=null; doAnKong(room, ws.seat, m.tile); }
    return;
  }
  if(m.type==='bukong'){
    let room=rooms[ws.roomCode]; if(!room||!room.game) return;
    if(!(room.awaiting && room.awaiting.seat===ws.seat)) return;
    let g=room.game, pl=g.players[ws.seat];
    if(g.drawnTile && ti(g.drawnTile)===ti(m.tile) && pl.melds.some(md=>md.type==='pung'&&ti(md.tiles[0])===ti(m.tile))){ room.awaiting=null; doBuKong(room, ws.seat, m.tile); }
    return;
  }
  if(m.type==='claim'){
    let room=rooms[ws.roomCode]; if(!room) return;
    onClaimResponse(room, ws.seat, {action:m.action, tiles:m.tiles});
    return;
  }
  if(m.type==='leave'){ handleDisconnect(ws); return; }
}

function handleDisconnect(ws){
  let room=rooms[ws.roomCode]; if(!room) return;
  if(ws.seat===-1){ let i=(room.spectators||[]).indexOf(ws); if(i>=0) room.spectators.splice(i,1); return; }
  let seat=ws.seat; if(seat==null) return;
  let p=room.players[seat];
  if(!p) return;
  // 大厅阶段：直接移除
  if(!room.game || room.game.phase==='over'){
    room.players[seat]=null;
    broadcastLobby(room);
    if(room.players.every(x=>!x)) delete rooms[room.code];
    return;
  }
  // 对局中：转为机器人，保证继续
  p.isBot=true; p.connected=false; p.name=p.name+'🤖'; p.ws=null;
  if(room.awaiting && room.awaiting.seat===seat){ room.awaiting=null; botTurn(room,seat); }
  if(room.pendingClaims && room.pendingClaims.humanSeats.includes(seat)){
    onClaimResponse(room, seat, {action:'pass'});
  }
  broadcast(room);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, ()=>{ console.log('麻将服务器已启动: http://localhost:'+PORT); });
