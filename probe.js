// 探针2：叫3分当地主，首发必为合法（领出单张），持续出牌，观察连接是否存活
const WebSocket = require('ws');
const RANKS = { '3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,'J':11,'Q':12,'K':13,'A':14,'2':15 };
function rankOf(c){ if(c==='X') return 16; if(c==='D') return 17; return RANKS[c]; }
const ws = new WebSocket('ws://localhost:3000');
let n = 0, bid = false, plays = 0;
ws.on('open', () => ws.send(JSON.stringify({ type: 'quickstart', game: 'ddz', name: 'probe2', score: 0 })));
ws.on('message', (raw) => {
  let m; try { m = JSON.parse(raw); } catch (e) { return; }
  if (m.type === 'joined') { console.log('JOINED seat=' + m.seat); return; }
  if (m.type === 'state') {
    n++;
    if (m.winner) { console.log('WINNER deltas=' + JSON.stringify(m.winner.deltas)); ws.close(); return; }
    if (m.phase === 'bidding' && m.youSeat === 0 && m.yourActions && m.yourActions.type === 'bid') {
      ws.send(JSON.stringify({ type: 'bid', score: 3 })); // 直接叫3当地主
      return;
    }
    if (m.phase === 'playing' && m.youSeat === 0 && m.yourActions && m.yourActions.type === 'play') {
      const h = m.players[0].hand;
      const lp = m.lastPlay;
      let play = null;
      if (!lp || lp.seat === 0) play = [h[0]];                       // 领出：最小单，合法
      else if (lp.type === 'single') {
        const need = rankOf(lp.cards[0]);
        const bigger = h.filter(c => rankOf(c) > need).sort((a,b)=>rankOf(a)-rankOf(b));
        if (bigger.length) play = [bigger[0]];
      }
      if (play) { ws.send(JSON.stringify({ type: 'play', cards: play })); plays++; }
      else if (m.yourActions.canPass) ws.send(JSON.stringify({ type: 'pass' }));
    }
  }
});
ws.on('close', (code) => console.log('CLIENT_CLOSE code=' + code + ' plays=' + plays));
ws.on('error', (e) => console.log('CLIENT_ERR ' + e.message));
setTimeout(() => { console.log('PROBE_DONE states=' + n + ' plays=' + plays); process.exit(0); }, 30000);
