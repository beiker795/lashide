// ====== 联机麻将服务端（国标简化版）======
// 权威逻辑全部在服务器：房间、实时同步、机器人补位、掉线转机器人
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const ddz = require('./ddz.js');

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
function buildWall(mode){ let w=[]; for(const s of ['m','s','p']) for(let r=1;r<=9;r++) for(let k=0;k<4;k++) w.push(s+r); if(mode!=='sc'){ for(let r=1;r<=7;r++) for(let k=0;k<4;k++) w.push('z'+r); } return w; }
function shuffle(a){ for(let i=a.length-1;i>0;i--){ let j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }

function isAllPung(c){ let pairs=0; for(let i=0;i<34;i++){ if(c[i]!==0 && c[i]!==2 && c[i]!==3) return false; if(c[i]===2) pairs++; } return pairs===1; }
function winInfo(g, seat, tile, selfDraw){
  let pl=g.players[seat]; let all=pl.hand.slice(); if(!selfDraw) all.push(tile);
  let c=toCounts(all), melds=pl.melds, labels=[];
  if(selfDraw) labels.push('自摸');
  if(melds.length===0){ let pairs=0, ok=true; for(let i=0;i<34;i++){ if(c[i]%2!==0){ok=false;break;} if(c[i]===2) pairs++; } if(ok && pairs===7) labels.push('七对'); }
  if(!melds.some(m=>m.type==='chow') && isAllPung(c)) labels.push((g.mode==='gd')?'对对胡':'碰碰胡');
  let suits=new Set(all.map(t=>t[0])); if(suits.size===1) labels.push('清一色');
  if((g.mode==='gd') && suits.has('z') && suits.size<=2) labels.push('混一色');
  if(labels.length===0) labels.push('平胡');
  return labels.join(' ');
}
// 数值番数（用于积分）
function computeFan(g, seat, tile, selfDraw){
  let pl=g.players[seat]; let all=pl.hand.slice(); if(!selfDraw) all.push(tile);
  let c=toCounts(all), melds=pl.melds; let fan=1;
  if(selfDraw) fan+=1;
  if(melds.length===0){ let pairs=0, ok=true; for(let i=0;i<34;i++){ if(c[i]%2!==0){ok=false;break;} if(c[i]===2) pairs++; } if(ok && pairs===7) fan+=2; }
  if(!melds.some(m=>m.type==='chow') && isAllPung(c)) fan+=2;
  let suits=new Set(all.map(t=>t[0])); if(suits.size===1) fan+=4;
  if((g.mode==='gd') && suits.has('z') && suits.size<=2) fan+=3;
  return fan;
}

// ----------------- 房间与对局流程 -----------------
const rooms = {};
function genCode(){ const cs='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s=''; for(let i=0;i<4;i++) s+=cs[Math.floor(Math.random()*cs.length)]; return s; }

function newGame(room){
  const mode=room.mode||'gb';
  const g={ mode, wall: shuffle(buildWall(mode)), players: room.players, turn:0, drawnTile:null, lastDiscard:null, phase:'play', winner:null,
    dingQue: (mode==='sc')?[null,null,null,null]:null, huPlayers: (mode==='sc')?[]:null };
  room.game=g; room.awaiting=null; room.pendingClaims=null; room.awaitTimer=null;
  for(let s=0;s<4;s++){ let p=g.players[s]; p.hand=[]; p.melds=[]; p.discards=[]; p.hu=false; p.huInfo=null; }
  for(let i=0;i<13;i++) for(let s=0;s<4;s++) g.players[s].hand.push(g.wall.pop());
  for(let s=0;s<4;s++) sortHand(g,s);
  g.turn=0;
  g.startScores = room.scores ? room.scores.slice() : [0,0,0,0];
  if(mode==='sc') startDingQue(room);
}
function startDingQue(room){
  const g=room.game;
  for(let s=0;s<4;s++){ if(g.players[s].isBot) g.dingQue[s]=botPickDingQue(g,s); }
  if(g.dingQue.every(x=>x!==null)) startPlay(room);
  else { g.phase='dingque'; broadcast(room); }
}
function botPickDingQue(g, seat){
  let cnt=[0,0,0]; const hand=g.players[seat].hand;
  for(const t of hand){ const i='msp'.indexOf(t[0]); if(i>=0) cnt[i]++; }
  let min=0; for(let i=1;i<3;i++) if(cnt[i]<cnt[min]) min=i;
  return 'msp'[min];
}
function startPlay(room){ const g=room.game; g.phase='play'; g.turn=0; proceedTurn(room); }
// 血战：能否胡（已定缺且无缺门牌）
function canHuScWith(g, seat, allTiles){
  if(!g.dingQue || g.dingQue[seat]===null) return false;
  const dq=g.dingQue[seat];
  for(const t of allTiles){ if(t[0]===dq) return false; }
  for(const m of g.players[seat].melds){ for(const t of m.tiles){ if(t[0]===dq) return false; } }
  return true;
}
// 血战：是否听牌（差一张能胡）
function isTingpai(g, seat){
  const pl=g.players[seat]; const hand=pl.hand.slice(); const dq=g.dingQue?g.dingQue[seat]:null;
  for(let i=0;i<hand.length;i++){
    let h2=hand.slice(); h2.splice(i,1);
    for(let k=0;k<34;k++){
      let suit = k<9?'m':(k<18?'s':(k<27?'p':'z'));
      if(g.mode==='sc' && suit==='z') continue;
      if(dq && suit===dq) continue;
      let c=toCounts(h2); c[k]++; if(isWinningHand(c)) return true;
    }
  }
  return false;
}
function startGame(room){
  // 空位填机器人
  let bi=0;
  for(let s=0;s<4;s++){ if(!room.players[s]){ bi++; room.players[s]={ ws:null, name:'机器人'+String.fromCharCode(64+bi), isBot:true, connected:true, seat:s }; } }
  newGame(room);
  if((room.mode||'gb')!=='sc') proceedTurn(room);
}
function restartGame(room){ startGame(room); }

function proceedTurn(room){
  const g=room.game;
  if(g.phase==='over') return;
  if(g.wall.length===0){ endRoundDraw(room); return; }
  let seat=g.turn;
  if(g.huPlayers && g.huPlayers.includes(seat)){ g.turn=(seat+1)%4; return proceedTurn(room); }
  let tile=g.wall.pop(); g.players[seat].hand.push(tile); g.drawnTile=tile; sortHand(g,seat); g.phase='turn';
  if(g.players[seat].isBot){ setTimeout(()=>botTurn(room,seat), 600); }
  else { room.awaiting={seat, kind:'discard'}; broadcast(room); }
}
function botTurn(room, seat){
  const g=room.game; const pl=g.players[seat];
  if(g.drawnTile && isWinningHand(toCounts(pl.hand)) && (g.mode!=='sc' || canHuScWith(g,seat,pl.hand))){ endRound(room,[seat], g.drawnTile, true); return; }
  let c=toCounts(pl.hand);
  for(let i=0;i<34;i++){ if(c[i]>=4){ doAnKong(room,seat,fromIndex(i)); return; } }
  if(g.drawnTile){ let di=ti(g.drawnTile); for(const m of pl.melds){ if(m.type==='pung'&&ti(m.tiles[0])===di){ doBuKong(room,seat,g.drawnTile); return; } } }
  let d=aiChooseDiscard(g,seat); doDiscard(room,seat,d);
}
function doAnKong(room, seat, tile){
  const g=room.game, pl=g.players[seat];
  for(let k=0;k<4;k++) removeFromHand(g,seat,tile);
  pl.melds.push({type:'kong', tiles:[tile,tile,tile,tile], from:seat, an:true});
  announce(room,{action:'kong',seat,name:pl.name,tile,an:true});
  if(g.wall.length){ let d=g.wall.pop(); pl.hand.push(d); g.drawnTile=d; sortHand(g,seat); }
  g.turn=seat; afterKong(room,seat);
}
function doBuKong(room, seat, tile){
  const g=room.game, pl=g.players[seat];
  for(const m of pl.melds){ if(m.type==='pung'&&ti(m.tiles[0])===ti(tile)){ m.type='kong'; m.tiles.push(tile); m.from=seat; break; } }
  removeFromHand(g,seat,tile);
  announce(room,{action:'kong',seat,name:pl.name,tile});
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
  if(isWinningHand(toCounts(test)) && (g.mode!=='sc' || canHuScWith(g,seat,test))) opts.push({action:'hu'});
  if(c[idx]===3) opts.push({action:'kong'});
  if(c[idx]>=2){
    let r=+tile.slice(1); let isJunk=(tile[0]==='z')||r===1||r===9;
    let multi=Object.values(c).filter(v=>v>=2).length>=2;
    if(isJunk||multi) opts.push({action:'pung'});
  }
  if((seat+3)%4===fromSeat && idx<27 && g.mode!=='sc'){
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
  for(let p=0;p<4;p++){ if(p===seat) continue; if(g.huPlayers && g.huPlayers.includes(p)) continue; let o=claimOptionsFor(g,p,tile,seat); if(o.length) possible[p]=o; }
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
    announce(room,{action:'chow',seat,name:pl.name,tile});
    g.turn=seat; enterDiscardPhase(room,seat);
  } else if(claim.action==='pung'){
    removeFromHand(g,seat,tile); removeFromHand(g,seat,tile);
    pl.melds.push({type:'pung', tiles:[tile,tile,tile], from:fromSeat});
    announce(room,{action:'pung',seat,name:pl.name,tile});
    g.turn=seat; enterDiscardPhase(room,seat);
  } else if(claim.action==='kong'){
    removeFromHand(g,seat,tile); removeFromHand(g,seat,tile); removeFromHand(g,seat,tile);
    pl.melds.push({type:'kong', tiles:[tile,tile,tile,tile], from:fromSeat});
    announce(room,{action:'kong',seat,name:pl.name,tile});
    g.turn=seat;
    if(g.wall.length){ let d=g.wall.pop(); pl.hand.push(d); g.drawnTile=d; sortHand(g,seat); }
    afterKong(room,seat);
  }
}
function endRound(room, winners, tile, selfDraw){
  const g=room.game;
  for(const w of winners){ announce(room,{action: selfDraw?'zimo':'hu', seat:w, name:g.players[w].name, tile}); }
  if(g.mode==='sc'){ endRoundSc(room, winners, tile, selfDraw); return; }
  g.phase='over'; g.winner={winners, tile, selfDraw}; room.awaiting=null; room.pendingClaims=null;
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
// 血战到底结算（支持续打 + 查叫）
function computeFanSc(g, seat, tile, selfDraw){
  let pl=g.players[seat]; let all=pl.hand.slice(); if(!selfDraw) all.push(tile);
  let c=toCounts(all), melds=pl.melds; let fan=1;
  if(selfDraw) fan+=1;
  let isQiDui=(melds.length===0);
  if(isQiDui){ let pairs=0, ok=true; for(let i=0;i<34;i++){ if(c[i]%2!==0){ok=false;break;} if(c[i]===2) pairs++; } if(ok && pairs===7) fan+=2; }
  if(!melds.some(m=>m.type==='chow') && isAllPung(c)) fan+=2;
  let suits=new Set(all.map(t=>t[0]));
  if(suits.size===1){ fan+=4; if(isQiDui) fan+=2; }
  return fan;
}
function endRoundSc(room, winners, tile, selfDraw){
  const g=room.game;
  if(!room.scores) room.scores=[0,0,0,0];
  let deltas=[0,0,0,0];
  for(const w of winners){
    g.players[w].hu=true;
    if(!g.huPlayers.includes(w)) g.huPlayers.push(w);
    let F=computeFanSc(g,w,tile,selfDraw);
    g.players[w].huInfo={tile, selfDraw, fan:F, name:g.players[w].name};
    if(selfDraw){
      for(let p=0;p<4;p++){ if(p!==w && !g.players[p].hu){ deltas[w]+=F; deltas[p]-=F; } }
    } else {
      let discarder=g.lastDiscard?g.lastDiscard.seat:-1;
      if(discarder>=0 && !g.players[discarder].hu){ deltas[w]+=F; deltas[discarder]-=F; }
    }
  }
  for(let p=0;p<4;p++) room.scores[p]+=deltas[p];
  if(g.huPlayers.length>=3 || g.wall.length===0){
    g.phase='over';
    let cd=[0,0,0,0];
    if(g.wall.length===0 && g.huPlayers.length<4){
      let ting=[], notTing=[];
      for(let p=0;p<4;p++){ if(!g.players[p].hu){ if(isTingpai(g,p)) ting.push(p); else notTing.push(p); } }
      for(const np of notTing){ for(const tp of ting){ cd[tp]+=1; cd[np]-=1; } }
      for(let p=0;p<4;p++) room.scores[p]+=cd[p];
    }
    const huInfos=g.players.map((p,s)=>p.huInfo?{seat:s,name:p.name,fan:winInfo(g,s,p.huInfo.tile,p.huInfo.selfDraw),fanNum:p.huInfo.fan,delta:deltas[s]||0,selfDraw:p.huInfo.selfDraw}:null).filter(Boolean);
    g.winner={ scEnd:true, winners:g.huPlayers.slice(), huInfos, deltas: cd.some(x=>x!==0)?cd:deltas, roundDeltas: room.scores.map((s,i)=>s-(g.startScores?g.startScores[i]:0)), scores:room.scores.slice() };
    broadcast(room);
    return;
  }
  // 续打：本局继续，轮到下家
  g.phase='play'; g.winner=null;
  let from = selfDraw ? winners[0] : (g.lastDiscard?g.lastDiscard.seat:-1);
  g.turn=(from+1)%4;
  broadcast(room);
  setTimeout(()=>proceedTurn(room), 400);
}
function endRoundDraw(room){
  const g=room.game;
  if(g.mode==='sc'){ endRoundSc(room, [], null, false); return; }
  g.phase='over'; g.winner={draw:true}; room.awaiting=null; room.pendingClaims=null;
  broadcast(room);
}

// ----------------- 视图与广播 -----------------
function buildWinnerInfo(g){
  if(!g.winner) return null;
  if(g.winner.scEnd){
    return { scEnd:true, winners:g.winner.winners, huInfos:g.winner.huInfos, deltas:g.winner.deltas, roundDeltas:g.winner.roundDeltas, scores:g.winner.scores };
  }
  const win=g.winner;
  return {
    draw: !!win.draw, winners:win.winners, tile:win.tile, selfDraw:win.selfDraw,
    scores: win.scores, deltas: win.deltas,
    info: win.draw ? [] : win.winners.map(w=>({
      seat:w, name:g.players[w].name,
      fan: winInfo(g,w,win.tile,win.selfDraw), fanNum: computeFan(g,w,win.tile,win.selfDraw),
      delta: win.deltas[w],
      hand: win.selfDraw ? g.players[w].hand.slice() : g.players[w].hand.concat([win.tile])
    }))
  };
}
function buildView(room, seat){
  const g=room.game;
  let players=g.players.map((p,s)=>({
    seat:s, name:p.name, isBot:p.isBot, connected:p.connected, hu:!!p.hu,
    handCount:p.hand.length,
    hand: s===seat ? p.hand.slice().sort((a,b)=>ti(a)-ti(b)) : null,
    melds:p.melds, discards:p.discards
  }));
  let yourActions=null;
  if(g.phase==='dingque' && g.dingQue && g.dingQue[seat]===null && !g.players[seat].isBot){
    yourActions={type:'dingque', options:['m','s','p']};
  } else if(room.awaiting && room.awaiting.seat===seat){
    let self=[]; let pl=g.players[seat];
    if(isWinningHand(toCounts(pl.hand)) && (g.mode!=='sc' || canHuScWith(g,seat,pl.hand))) self.push({action:'zimo',label:'自摸胡'});
    let c=toCounts(pl.hand);
    for(let i=0;i<34;i++){ if(c[i]>=4) self.push({action:'ankong',tile:fromIndex(i),label:'暗杠 '+fromIndex(i)}); }
    if(g.drawnTile){ let di=ti(g.drawnTile); for(const m of pl.melds){ if(m.type==='pung'&&ti(m.tiles[0])===di) self.push({action:'bukong',tile:g.drawnTile,label:'补杠 '+g.drawnTile}); } }
    yourActions={type:'discard', self};
  } else if(room.pendingClaims && room.pendingClaims.humanSeats.includes(seat)){
    yourActions={type:'claim', options: room.pendingClaims.optionsBySeat[seat], tile: room.pendingClaims.tile};
  }
  return { type:'state', youSeat:seat, turn:g.turn, wallCount:g.wall.length, phase:g.phase, mode:g.mode,
    scores: room.scores || [0,0,0,0],
    lastDiscard:g.lastDiscard, players, yourActions,
    winner: buildWinnerInfo(g)
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
    winner=buildWinnerInfo(g);
  }
  return { type:'state', youSeat:-1, turn: g?g.turn:-1, wallCount: g?g.wall.length:0, phase: g?g.phase:'lobby',
    mode: g?g.mode:'gb', scores: room.scores||[0,0,0,0], lastDiscard: g?g.lastDiscard:null, players, yourActions:null, winner };
}
function buildLobby(room){
  return { type:'lobby', code:room.code, host:room.host, mode:room.mode||'gb', started: !!(room.game && room.game.phase!=='over'),
    players: room.players.map((p,s)=>({seat:s, name:p?p.name:null, isBot:p?p.isBot:false, connected:p?p.connected:false})) };
}
function send(ws, obj){ if(ws && ws.readyState===1){ try { ws.send(JSON.stringify(obj)); } catch(e){} } }
// 向房间内所有人（含观战）广播一个独立的动作事件，供客户端播放语音
function announce(room, payload){ let msg; try { msg=JSON.stringify({type:'action', ...payload}); } catch(e){ return; } for(let s=0;s<4;s++){ let p=room.players[s]; if(p && p.ws && p.connected) p.ws.send(msg); } for(const sp of (room.spectators||[])) if(sp.ws) sp.ws.send(msg); }
function broadcast(room){ for(let s=0;s<4;s++){ let p=room.players[s]; if(p && p.ws && p.connected) send(p.ws, buildView(room,s)); } for(const sp of (room.spectators||[])) send(sp.ws, buildSpectatorView(room)); }
function broadcastLobby(room){ for(let s=0;s<4;s++){ let p=room.players[s]; if(p && p.ws && p.connected) send(p.ws, buildLobby(room)); } for(const sp of (room.spectators||[])) send(sp.ws, buildSpectatorView(room)); }

// ----------------- 连接与消息处理 -----------------
const server = http.createServer((req,res)=>{
  let url = req.url.split('?')[0];
  if(url==='/'){
    fs.readFile(path.join(__dirname,'public','home.html'),(e,data)=>{
      if(e){ res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}); res.end(data);
    });
    return;
  }
  if(url==='/index.html'){
    fs.readFile(path.join(__dirname,'public','index.html'),(e,data)=>{
      if(e){ res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}); res.end(data);
    });
    return;
  }
  // 静态资源（public 下）：ddz.html、voices/* 等
  let f = path.normalize(path.join(__dirname,'public', url));
  let pub = path.join(__dirname,'public');
  if(f.startsWith(pub) && fs.existsSync(f) && fs.statSync(f).isFile()){
    let ext=path.extname(f).toLowerCase();
    let ct = ext==='.html'?'text/html': ext==='.js'?'application/javascript': ext==='.css'?'text/css': ext==='.json'?'application/json': ext==='.mp3'?'audio/mpeg':'application/octet-stream';
    res.writeHead(200,{'Content-Type':ct+'; charset=utf-8'}); res.end(fs.readFileSync(f));
    return;
  }
  res.writeHead(404); res.end('not found');
});
const wss = new WebSocket.Server({ server });

function findEmptySeat(room){ for(let s=0;s<4;s++) if(!room.players[s] || !room.players[s].connected) return s; return -1; }

wss.on('connection', (ws)=>{
  ws.roomCode=null; ws.seat=null;
  ws.on('message', (raw)=>{
    let m; try{ m=JSON.parse(raw); }catch(e){ return; }
    try { handleMsg(ws, m); } catch (e) {}
  });
  ws.on('close', (code, reason)=>{ handleDisconnect(ws); });
  ws.on('error', (e)=>{});
});
process.on('uncaughtException', (e)=>{});
process.on('unhandledRejection', (e)=>{});

function handleMsg(ws, m){
  // 多游戏路由：ddz 房间的消息交给 ddz.js 全权处理（麻将路径不受影响）
  const room = ws.roomCode ? rooms[ws.roomCode] : null;
  if((m.game==='ddz') || (room && room.gameType==='ddz')){ ddz.handle(ws, m, room); return; }
  if(m.type==='quickstart'){
    let code=genCode(); while(rooms[code]) code=genCode();
    let room={ code, host:0, mode:(m.mode||'gb'), players:[null,null,null,null], scores:[0,0,0,0], spectators:[] };
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
    let room={ code, host:0, mode:(m.mode||'gb'), players:[null,null,null,null], scores:[0,0,0,0], spectators:[] };
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
    send(ws,{type:'joined', code:room.code, seat, mode:room.mode});
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
  if(m.type==='dingque'){
    let room=rooms[ws.roomCode]; if(!room||!room.game) return;
    const g=room.game;
    if(g.phase!=='dingque' || !g.dingQue || g.dingQue[ws.seat]!==null) return;
    if(!['m','s','p'].includes(m.suit)) return;
    g.dingQue[ws.seat]=m.suit;
    if(g.dingQue.every(x=>x!==null)) startPlay(room);
    else broadcast(room);
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
  if(room.gameType==='ddz'){ ddz.handleDisconnect(ws, room); return; }
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
ddz.init({ send, announce, rooms }); // 注入共享工具，供 ddz 模块复用广播与动作播报
server.listen(PORT, ()=>{ console.log('麻将/斗地主服务器已启动: http://localhost:'+PORT); });
