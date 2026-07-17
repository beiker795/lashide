// ====== 斗地主游戏模块（标准3人）======
// 由 server.js 路由调用：所有 ddz 房间的消息在此全权处理。
// 复用 server 的 send / announce（动作播报，供语音）。
let send = (ws, obj) => {};
let announce = (room, payload) => {};
let rooms = {};

function init(ctx) { send = ctx.send; announce = ctx.announce; if (ctx.rooms) rooms = ctx.rooms; }

// ----------------- 牌定义 -----------------
// 普通牌点数：3..10,J,Q,K,A,2（各4张）；王：X=小王, D=大王
const RANKS = { '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14, '2': 15 };
const JOKER_SMALL = 'X', JOKER_BIG = 'D';
const DISP = { '3': '3', '4': '4', '5': '5', '6': '6', '7': '7', '8': '8', '9': '9', '10': '10', 'J': 'J', 'Q': 'Q', 'K': 'K', 'A': 'A', '2': '2', 'X': '🃏', 'D': '🃏' };
function rankOf(c) { if (c === JOKER_SMALL) return 16; if (c === JOKER_BIG) return 17; return RANKS[c]; }
function isJoker(c) { return c === JOKER_SMALL || c === JOKER_BIG; }
function newDeck() { let d = []; for (const r of Object.keys(RANKS)) for (let k = 0; k < 4; k++) d.push(r); d.push(JOKER_SMALL); d.push(JOKER_BIG); return d; }
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { let j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function sortCards(cards) { return cards.slice().sort((a, b) => rankOf(a) - rankOf(b)); }
function handCounts(hand) { let c = {}; for (const t of hand) c[t] = (c[t] || 0) + 1; return c; }

// ----------------- 牌型识别 -----------------
function isConsecutive(ranks) { for (let i = 0; i < ranks.length - 1; i++) if (ranks[i + 1] - ranks[i] !== 1) return false; return true; }

// 返回 {type, rank, len} 或 null（非法牌型）
function analyze(cards) {
  if (!cards || cards.length === 0) return null;
  let n = cards.length;
  let counts = handCounts(cards);
  let uniq = Object.keys(counts);
  let ranks = uniq.map(rankOf).sort((a, b) => a - b);
  // 王炸
  if (n === 2 && counts[JOKER_SMALL] === 1 && counts[JOKER_BIG] === 1) return { type: 'rocket', rank: 100, len: 2 };
  // 炸弹
  if (n === 4 && uniq.length === 1) return { type: 'bomb', rank: rankOf(uniq[0]), len: 4 };
  // 单
  if (n === 1) return { type: 'single', rank: rankOf(uniq[0]), len: 1 };
  // 对
  if (n === 2 && uniq.length === 1) return { type: 'pair', rank: rankOf(uniq[0]), len: 2 };
  // 三
  if (n === 3 && uniq.length === 1) return { type: 'triple', rank: rankOf(uniq[0]), len: 3 };
  // 三带一
  if (n === 4 && uniq.length === 2) {
    let tri = uniq.find(u => counts[u] === 3);
    if (tri) return { type: 'triple_single', rank: rankOf(tri), len: 4 };
  }
  // 三带二
  if (n === 5 && uniq.length === 2) {
    let tri = uniq.find(u => counts[u] === 3); let pr = uniq.find(u => counts[u] === 2);
    if (tri && pr) return { type: 'triple_pair', rank: rankOf(tri), len: 5 };
  }
  // 顺子（>=5 单张，不含2/王）
  if (n >= 5 && uniq.length === n && uniq.every(u => !isJoker(u) && u !== '2') && isConsecutive(ranks)) {
    return { type: 'straight', rank: ranks[0], len: n };
  }
  // 连对（>=3 对连续）
  if (n >= 6 && n % 2 === 0 && uniq.length === n / 2 && uniq.every(u => counts[u] === 2) && !uniq.some(u => isJoker(u) || u === '2')) {
    if (isConsecutive(ranks)) return { type: 'straight_pair', rank: ranks[0], len: n };
  }
  // 飞机（>=2 连续三张）
  let tris = uniq.filter(u => counts[u] === 3).map(rankOf).sort((a, b) => a - b);
  if (tris.length >= 2 && isConsecutive(tris) && !tris.some(r => r >= 15)) {
    let group = tris.length;
    if (n === 3 * group) return { type: 'plane', rank: tris[0], len: n };
    if (n === 4 * group) return { type: 'plane_single', rank: tris[0], len: n };
    if (n === 5 * group) return { type: 'plane_pair', rank: tris[0], len: n };
  }
  return null;
}

// 能否压过上家：prev 为 null 表示首出
function canBeat(prev, cur) {
  if (!prev) return cur !== null;
  if (!cur) return false;
  if (cur.type === 'rocket') return true;
  if (cur.type === 'bomb') {
    if (prev.type === 'rocket') return false;
    if (prev.type === 'bomb') return cur.rank > prev.rank;
    return true;
  }
  if (prev.type === 'bomb' || prev.type === 'rocket') return false;
  return cur.type === prev.type && cur.len === prev.len && cur.rank > prev.rank;
}

// ----------------- 房间与对局 -----------------
function newGame(room) {
  // 空位填机器人（3人）
  for (let s = 0; s < 3; s++) {
    if (!room.players[s] || !room.players[s].connected) {
      room.players[s] = { ws: null, name: '机器人' + (s + 1), isBot: true, connected: true, seat: s };
    }
  }
  room.gameType = 'ddz';
  room.maxPlayers = 3;
  let deck = shuffle(newDeck());
  let g = {
    type: 'ddz', phase: 'bidding', landlord: null, turn: 0,
    bottomCards: deck.slice(0, 3),
    bids: [null, null, null], lastBid: 0, bidTurn: 0, bidCount: 0,
    lastPlay: null, passCount: 0, multiplier: 1,
    winner: null, startScores: room.scores ? room.scores.slice() : [0, 0, 0]
  };
  let hands = [deck.slice(3, 20), deck.slice(20, 37), deck.slice(37, 54)];
  for (let s = 0; s < 3; s++) {
    let p = room.players[s];
    p.hand = sortCards(hands[s]); p.melds = []; p.discards = []; p.isLandlord = false; p.played = [];
  }
  room.game = g; room.awaiting = null;
  broadcast(room);
}

function botBid(seat, hand) {
  let c = handCounts(hand);
  let strength = 0;
  if (c[JOKER_BIG]) strength += 1.5;
  if (c[JOKER_SMALL]) strength += 1;
  if (c['2']) strength += c['2'] * 0.5;
  for (const r of ['A', 'K']) if (c[r]) strength += c[r] * 0.25;
  for (const k in c) if (c[k] === 4) strength += 1.5; // 炸弹
  let want = strength >= 3 ? 3 : strength >= 2 ? 2 : strength >= 1 ? 1 : 0;
  return want;
}

function handleBid(room, seat, score) {
  const g = room.game;
  if (g.phase !== 'bidding' || seat !== g.bidTurn) return;
  if (typeof score !== 'number') return;
  score = Math.max(0, Math.min(3, Math.floor(score)));
  if (score > 0 && score <= g.lastBid) return; // 必须高于当前最高分（0=不叫）
  g.bids[seat] = score;
  g.bidCount++;
  if (score > g.lastBid) g.lastBid = score;
  // 叫3分或满3次叫分立即结束
  if (score === 3 || g.bidCount >= 3) { finishBidding(room); return; }
  g.bidTurn = (g.bidTurn + 1) % 3;
  // 轮到机器人则自动叫（想叫但叫不过时自动过，保证轮转不卡死）
  let p = room.players[g.bidTurn];
  if (p.isBot) {
    let botSeat = g.bidTurn;
    setTimeout(() => { try { if (room.game === g && g.phase === 'bidding' && g.bidTurn === botSeat) { let want = botBid(botSeat, p.hand); handleBid(room, botSeat, want > g.lastBid ? want : 0); } } catch (e) { console.error('BOT_BID_ERR', e); } }, 500);
  }
  broadcast(room);
}

function finishBidding(room) {
  const g = room.game;
  let landlord = -1;
  if (g.lastBid === 0) { // 全场不叫，流局重发
    newGame(room); return;
  }
  for (let s = 0; s < 3; s++) if (g.bids[s] === g.lastBid) { landlord = s; break; }
  g.landlord = landlord;
  g.multiplier = g.lastBid; // 底分倍数
  let p = room.players[landlord];
  p.isLandlord = true;
  p.hand = sortCards(p.hand.concat(g.bottomCards));
  g.phase = 'playing'; g.turn = landlord; g.lastPlay = null; g.passCount = 0;
  // 地主若是机器人则自动出牌
  if (p.isBot) setTimeout(() => botStep(room, landlord), 300);
  else broadcast(room);
}

// 从手牌移除若干牌
function removeCards(hand, cards) {
  let h = hand.slice();
  for (const c of cards) { let i = h.indexOf(c); if (i >= 0) h.splice(i, 1); }
  return h;
}

function handlePlay(room, seat, cards) {
  const g = room.game;
  if (g.phase !== 'playing' || seat !== g.turn) return;
  let p = room.players[seat];
  // 校验手牌确实包含这些牌
  let cnt = handCounts(cards); let hc = handCounts(p.hand);
  for (const k in cnt) if ((hc[k] || 0) < cnt[k]) return;
  let cur = analyze(cards);
  if (!cur) return;
  let isLead = (g.lastPlay === null || g.lastPlay.seat === seat);
  if (!isLead && !canBeat(g.lastPlay, cur)) return;
  // 出牌生效
  p.hand = removeCards(p.hand, cards);
  p.played.push({ cards: sortCards(cards), type: cur.type });
  if (cur.type === 'bomb' || cur.type === 'rocket') { g.multiplier *= 2; announce(room, { action: cur.type === 'rocket' ? 'wangzha' : 'zhadan', seat, name: p.name }); }
  if (p.hand.length === 0) { endRound(room, seat); return; }
  g.lastPlay = { seat, cards: sortCards(cards), type: cur.type, rank: cur.rank, len: cur.len }; g.passCount = 0;
  g.turn = (seat + 1) % 3;
  // 下家机器人
  let np = room.players[g.turn];
  if (np.isBot) setTimeout(() => botStep(room, g.turn), 300);
  else broadcast(room);
}

function handlePass(room, seat) {
  const g = room.game;
  if (g.phase !== 'playing' || seat !== g.turn) return;
  let isLead = (g.lastPlay === null || g.lastPlay.seat === seat);
  if (isLead) return; // 首出不能过
  g.passCount++;
  if (g.passCount >= 2) { // 其余两家都过，回到最后出牌者重新首出
    let leader = g.lastPlay.seat;
    g.lastPlay = null; g.passCount = 0; g.turn = leader;
  } else {
    g.turn = (seat + 1) % 3;
  }
  let np = room.players[g.turn];
  if (g.turn === seat) { if (np.isBot) setTimeout(() => botStep(room, g.turn), 300); else broadcast(room); }
  else if (np.isBot) setTimeout(() => botStep(room, g.turn), 300);
  else broadcast(room);
}

// ----------------- 机器人出牌 -----------------
function findBeats(hand, lastPlay) {
  let res = [];
  let counts = handCounts(hand);
  let byRank = {};
  for (const c of hand) (byRank[rankOf(c)] = byRank[rankOf(c)] || []).push(c);
  // 单
  for (const c of hand) { let cur = analyze([c]); if (canBeat(lastPlay, cur)) res.push([c]); }
  // 对
  for (const k in counts) if (counts[k] >= 2) { let pair = [k, k]; let cur = analyze(pair); if (canBeat(lastPlay, cur)) res.push(pair); }
  // 三 / 三带
  for (const k in counts) if (counts[k] >= 3) {
    let tri = [k, k, k];
    let cur = analyze(tri); if (canBeat(lastPlay, cur)) res.push(tri);
    // 三带一
    let single = hand.find(x => x !== k); if (single) { let t = tri.concat([single]); let cur2 = analyze(t); if (canBeat(lastPlay, cur2)) res.push(t); }
    // 三带二
    let pr = Object.keys(counts).find(x => x !== k && counts[x] >= 2); if (pr) { let t = tri.concat([pr, pr]); let cur2 = analyze(t); if (canBeat(lastPlay, cur2)) res.push(t); }
  }
  // 炸弹
  for (const k in counts) if (counts[k] === 4) { let bomb = [k, k, k, k]; let cur = analyze(bomb); if (canBeat(lastPlay, cur)) res.push(bomb); }
  // 王炸
  if (counts[JOKER_SMALL] && counts[JOKER_BIG]) res.push([JOKER_SMALL, JOKER_BIG]);
  return res;
}

function botLead(hand) {
  // 优先出最小非炸弹单/对，保留大牌
  let counts = handCounts(hand);
  let singles = Object.keys(counts).filter(k => counts[k] === 1 && counts[k] < 4).sort((a, b) => rankOf(a) - rankOf(b));
  let pairs = Object.keys(counts).filter(k => counts[k] === 2).sort((a, b) => rankOf(a) - rankOf(b));
  if (pairs.length && rankOf(pairs[0]) < 11) return [pairs[0], pairs[0]];
  if (singles.length) return [singles[0]];
  // 否则出最小的对/单
  let all = hand.slice().sort((a, b) => rankOf(a) - rankOf(b));
  return [all[0]];
}

function botStep(room, seat) {
  const g = room.game;
  if (g.phase !== 'playing' || g.turn !== seat) return;
  let p = room.players[seat];
  let isLead = (g.lastPlay === null || g.lastPlay.seat === seat);
  if (isLead) {
    let play = botLead(p.hand);
    handlePlay(room, seat, play);
    return;
  }
  let beats = findBeats(p.hand, g.lastPlay);
  if (beats.length === 0) { handlePass(room, seat); return; }
  // 选最小压制（按 rank 升序），且尽量不拆炸弹
  beats.sort((a, b) => analyze(a).rank - analyze(b).rank);
  let nonBomb = beats.filter(b => analyze(b).type !== 'bomb' && analyze(b).type !== 'rocket');
  let choice = nonBomb.length ? nonBomb[0] : beats[beats.length - 1]; // 没小牌才用炸弹
  handlePlay(room, seat, choice);
}

// ----------------- 结算 -----------------
function endRound(room, winnerSeat) {
  const g = room.game;
  let landlord = g.landlord;
  let base = g.lastBid || 1;
  let mult = g.multiplier;
  // 春天判定：地主出牌后农民未出过任何牌，或农民出过牌地主一次未接
  let farmerPlayed = [0, 1, 2].filter(s => s !== landlord).some(s => room.players[s].played.length > 0);
  let landlordPlayed = room.players[landlord].played.length > 0;
  if (winnerSeat === landlord && !farmerPlayed) mult *= 2; // 地主春天
  if (winnerSeat !== landlord && !landlordPlayed) mult *= 2; // 反春天（简化）
  let deltas = [0, 0, 0];
  let unit = base * mult;
  if (winnerSeat === landlord) {
    for (let s = 0; s < 3; s++) if (s !== landlord) deltas[s] = -unit;
    deltas[landlord] = 2 * unit;
  } else {
    deltas[landlord] = -2 * unit;
    for (let s = 0; s < 3; s++) if (s !== landlord) deltas[s] = unit;
  }
  if (!room.scores) room.scores = [0, 0, 0];
  for (let s = 0; s < 3; s++) room.scores[s] += deltas[s];
  g.phase = 'over'; g.winner = {
    winnerSeat, landlord, base, mult, deltas, scores: room.scores.slice(),
    roundDeltas: room.scores.map((s, i) => s - (g.startScores ? g.startScores[i] : 0))
  };
  broadcast(room);
}

// ----------------- 视图 -----------------
function buildWinner(g) {
  const w = g.winner;
  return { winnerSeat: w.winnerSeat, landlord: w.landlord, base: w.base, mult: w.mult, deltas: w.deltas, scores: w.scores, roundDeltas: w.roundDeltas };
}

function buildView(room, seat) {
  const g = room.game;
  let players = [0, 1, 2].map(s => {
    let p = room.players[s];
    return {
      seat: s, name: p.name, isBot: p.isBot, connected: p.connected,
      isLandlord: s === g.landlord, handCount: p.hand ? p.hand.length : 0,
      hand: s === seat ? p.hand.slice() : null,
      played: p.played ? p.played.slice() : []
    };
  });
  let yourActions = null;
  if (g.phase === 'bidding' && g.bidTurn === seat && !room.players[seat].isBot) {
    yourActions = { type: 'bid', min: g.lastBid + 1, max: 3 };
  } else if (g.phase === 'playing' && g.turn === seat && !room.players[seat].isBot) {
    let canPass = !(g.lastPlay === null || g.lastPlay.seat === seat);
    yourActions = { type: 'play', canPass };
  }
  return {
    type: 'state', game: 'ddz', youSeat: seat, turn: g.turn, bidTurn: g.bidTurn, phase: g.phase,
    landlord: g.landlord, multiplier: g.multiplier, bottomCards: (seat === g.landlord && g.landlord !== null) ? g.bottomCards : (g.landlord !== null ? g.bottomCards : null),
    lastPlay: g.lastPlay, bids: g.bids, lastBid: g.lastBid,
    scores: room.scores || [0, 0, 0], players, yourActions,
    winner: g.winner ? buildWinner(g) : null
  };
}
function buildSpectatorView(room) {
  const g = room.game;
  let players = [0, 1, 2].map(s => {
    let p = room.players[s];
    return { seat: s, name: p ? p.name : null, isBot: p ? p.isBot : false, connected: p ? p.connected : false, isLandlord: s === (g ? g.landlord : null), handCount: p && p.hand ? p.hand.length : 0, hand: null, played: p && p.played ? p.played.slice() : [] };
  });
  return {
    type: 'state', game: 'ddz', youSeat: -1, turn: g ? g.turn : -1, phase: g ? g.phase : 'lobby',
    landlord: g ? g.landlord : null, multiplier: g ? g.multiplier : 1, bottomCards: (g && g.landlord !== null) ? g.bottomCards : null,
    lastPlay: g ? g.lastPlay : null, bids: g ? g.bids : [null, null, null], lastBid: g ? g.lastBid : 0,
    scores: room.scores || [0, 0, 0], players, yourActions: null, winner: g && g.winner ? buildWinner(g) : null
  };
}
function buildLobby(room) {
  return { type: 'lobby', game: 'ddz', code: room.code, host: room.host, started: !!(room.game && room.game.phase !== 'over'),
    players: [0, 1, 2].map(s => { let p = room.players[s]; return { seat: s, name: p ? p.name : null, isBot: p ? p.isBot : false, connected: p ? p.connected : false }; }) };
}
function broadcast(room) {
  for (let s = 0; s < 3; s++) { let p = room.players[s]; if (p && p.ws && p.connected) send(p.ws, buildView(room, s)); }
  for (const sp of (room.spectators || [])) send(sp.ws, buildSpectatorView(room));
}
function broadcastLobby(room) {
  for (let s = 0; s < 3; s++) { let p = room.players[s]; if (p && p.ws && p.connected) send(p.ws, buildLobby(room)); }
  for (const sp of (room.spectators || [])) send(sp.ws, buildSpectatorView(room));
}

// ----------------- 消息路由（房间生命周期 + 游戏内） -----------------
function genCode() { const cs = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s = ''; for (let i = 0; i < 4; i++) s += cs[Math.floor(Math.random() * cs.length)]; return s; }
function findEmptySeat(room) { for (let s = 0; s < (room.maxPlayers || 3); s++) if (!room.players[s] || !room.players[s].connected) return s; return -1; }

function handle(ws, m, room) {
  if (m.type === 'quickstart') {
    let code = genCode(); while (rooms[code]) code = genCode();
    let r = { code, host: 0, gameType: 'ddz', mode: 'ddz', players: [null, null, null], scores: [0, 0, 0], spectators: [] };
    rooms[code] = r;
    r.players[0] = { ws, name: (m.name || '玩家') + '', isBot: false, connected: true, seat: 0 };
    r.scores[0] = m.score || 0;
    ws.roomCode = code; ws.seat = 0;
    send(ws, { type: 'joined', code, seat: 0, game: 'ddz' });
    newGame(r);
    return;
  }
  if (m.type === 'create') {
    let code = genCode(); while (rooms[code]) code = genCode();
    let r = { code, host: 0, gameType: 'ddz', mode: 'ddz', players: [null, null, null], scores: [0, 0, 0], spectators: [] };
    rooms[code] = r;
    r.players[0] = { ws, name: (m.name || '玩家') + '', isBot: false, connected: true, seat: 0 };
    r.scores[0] = m.score || 0;
    ws.roomCode = code; ws.seat = 0;
    send(ws, { type: 'joined', code, seat: 0, game: 'ddz' });
    broadcastLobby(r);
    return;
  }
  if (m.type === 'join') {
    let r = rooms[m.code];
    if (!r || r.gameType !== 'ddz') { send(ws, { type: 'error', msg: '房间不存在' }); return; }
    if (r.game && r.game.phase !== 'over') { send(ws, { type: 'error', msg: '房间已开始' }); return; }
    let seat = findEmptySeat(r);
    if (seat < 0) { send(ws, { type: 'error', msg: '房间已满' }); return; }
    r.players[seat] = { ws, name: (m.name || '玩家') + '', isBot: false, connected: true, seat };
    r.scores[seat] = m.score || 0;
    ws.roomCode = r.code; ws.seat = seat;
    send(ws, { type: 'joined', code: r.code, seat, game: 'ddz' });
    broadcastLobby(r);
    return;
  }
  if (m.type === 'spectate') {
    let r = rooms[m.code];
    if (!r || r.gameType !== 'ddz') { send(ws, { type: 'error', msg: '房间不存在' }); return; }
    ws.roomCode = r.code; ws.seat = -1; ws.isSpectator = true;
    r.spectators = r.spectators || []; r.spectators.push(ws);
    send(ws, { type: 'joined', code: r.code, seat: -1, game: 'ddz' });
    send(ws, buildSpectatorView(r));
    return;
  }
  if (m.type === 'start') {
    if (!room || ws.seat !== room.host) return;
    if (!room.game || room.game.phase === 'over') newGame(room);
    return;
  }
  if (m.type === 'again') { if (room) newGame(room); return; }
  if (m.type === 'bid') { if (room) handleBid(room, ws.seat, m.score); return; }
  if (m.type === 'play') { if (room) handlePlay(room, ws.seat, m.cards || []); return; }
  if (m.type === 'pass') { if (room) handlePass(room, ws.seat); return; }
  if (m.type === 'leave') { handleDisconnect(ws); return; }
}

function handleDisconnect(ws, room) {
  if (!room) return;
  let seat = ws.seat;
  if (seat === null || seat === -1) return;
  let p = room.players[seat];
  if (!p) return;
  if (!room.game || room.game.phase === 'over') {
    room.players[seat] = null;
    broadcastLobby(room);
    if (room.players.every(x => !x)) delete rooms[room.code];
    return;
  }
  // 对局中转为机器人
  p.isBot = true; p.connected = false; p.name = p.name + '🤖'; p.ws = null;
  const g = room.game;
  if (g.phase === 'bidding' && g.bidTurn === seat) setTimeout(() => { if (room.game === g && g.phase === 'bidding' && g.bidTurn === seat) handleBid(room, seat, botBid(seat, p.hand)); }, 400);
  else if (g.phase === 'playing' && g.turn === seat) setTimeout(() => botStep(room, seat), 400);
  broadcast(room);
}

module.exports = { init, handle, handleDisconnect };
