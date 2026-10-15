'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('./wsmini.js');
const LV = require('./level.js');

const LEVELS = LV.MAPS.map((_, i) => LV.build(i));   // 12 maps
const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 50;               // lobby limit
const COUNTDOWN_MS = 3000;            // 3-2-1 before each round
const AFTER_FIRST_FINISH_MS = 20000;  // round closes this long after the first finisher
const FAST = !!process.env.TEST_FAST;   // tests only: very short rounds
const TIME_SCALE = FAST ? 0.02 : 1;
const BREAK_MS = FAST ? 1500 : 10000;   // results screen between rounds
const TICK_MS = 66;                   // ~15 snapshots / second

/* ---------- static files ---------- */
const PUB = __dirname;
const ALLOWED = new Set(['index.html', 'level.js', 'manifest.json', 'icon.svg']);
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png'
};
const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url === '/health') { res.writeHead(200); return res.end('ok'); }
  const rel = url === '/' ? '/index.html' : url;
  const name = rel.replace(/^\//, '');
  if (!ALLOWED.has(name)) { res.writeHead(404); return res.end('Not found'); }
  const file = path.join(PUB, name);
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

/* ---------- lobbies ---------- */
const lobbies = new Map();   // key -> lobby
let nextId = 1;

function newLobby(key, priv) {
  const now = Date.now();
  const map = process.env.START_MAP !== undefined ? (+process.env.START_MAP % LEVELS.length) : Math.floor(Math.random() * LEVELS.length);
  const l = {
    key, priv, players: new Map(), state: 'run', map, nextMap: 0,
    start: now, endAt: now + LEVELS[map].time * 1000 * TIME_SCALE, breakEnd: 0, results: []
  };
  lobbies.set(key, l);
  return l;
}

function findLobby(code) {
  if (code) {
    const key = 'p:' + code;
    const l = lobbies.get(key) || newLobby(key, true);
    return l.players.size < MAX_PLAYERS ? l : null;
  }
  for (const l of lobbies.values()) {
    if (!l.priv && l.players.size < MAX_PLAYERS) return l;
  }
  return newLobby('pub:' + nextId + ':' + Date.now(), false);
}

function send(ws, obj) {
  if (ws.readyState === 1) ws.send(JSON.stringify(obj));
}
function sendAll(l, obj, except) {
  const s = JSON.stringify(obj);
  for (const p of l.players.values()) {
    if (p !== except && p.ws.readyState === 1) p.ws.send(s);
  }
}

function resetPlayer(p, now, startAt) {
  const lv = LEVELS[p.map];
  p.x = LV.laneX(p.id); p.y = lv.spawn.y - LV.PH;
  p.cp = 0; p.maxCp = 0; p.fin = false; p.t0 = startAt === undefined ? now : startAt; p.lt = now;
}

function newRound(l, now) {
  l.map = l.nextMap; l.state = 'run'; l.start = now + COUNTDOWN_MS;
  l.endAt = l.start + LEVELS[l.map].time * 1000 * TIME_SCALE; l.results = [];
  for (const p of l.players.values()) { p.map = l.map; resetPlayer(p, now, l.start); }
  sendAll(l, { t: 'reset', map: l.map, name: LEVELS[l.map].name });
}

function tickLobby(l, now) {
  if (l.state === 'run' && now >= l.endAt) {
    l.state = 'break'; l.breakEnd = now + BREAK_MS;
    l.nextMap = (l.map + 1) % LEVELS.length;
    sendAll(l, { t: 'end', results: l.results.slice(0, 10), next: { i: l.nextMap, name: LEVELS[l.nextMap].name } });
  } else if (l.state === 'break' && now >= l.breakEnd) {
    newRound(l, now);
  }
  if (!l.players.size) return;
  const target = l.state === 'run' ? l.endAt : l.breakEnd;
  const snap = {
    t: 'n', s: l.state === 'run' ? 0 : 1,
    l: Math.max(0, Math.ceil((target - now) / 1000)),
    c: l.players.size, m: l.map,
    p: []
  };
  for (const p of l.players.values()) snap.p.push([p.id, Math.round(p.x), Math.round(p.y), p.f, p.fin ? 1 : 0]);
  sendAll(l, snap);
}

setInterval(() => {
  const now = Date.now();
  for (const [key, l] of lobbies) {
    if (!l.players.size) { lobbies.delete(key); continue; }
    tickLobby(l, now);
  }
}, TICK_MS);

/* ---------- sockets ---------- */
const wss = new WebSocketServer({ server, maxPayload: 1024 });

wss.on('connection', (ws) => {
  let me = null, lobby = null;
  let msgCount = 0;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  const rate = setInterval(() => { msgCount = 0; }, 1000);

  ws.on('message', (raw) => {
    if (++msgCount > 60) return;                // flood protection
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m.t !== 'string') return;
    const now = Date.now();

    if (m.t === 'join' && !me) {
      const name = String(m.name || '').replace(/[^\w \-.!]/g, '').trim().slice(0, 14) || 'Runner';
      const code = String(m.room || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
      lobby = findLobby(code);
      if (!lobby) { send(ws, { t: 'full' }); return; }
      me = { id: nextId++, ws, name, map: lobby.map };
      resetPlayer(me, now);
      me.f = 1;
      sendAll(lobby, { t: 'pj', p: { id: me.id, name } }, null);
      lobby.players.set(me.id, me);
      send(ws, {
        t: 'welcome', id: me.id, max: MAX_PLAYERS,
        room: lobby.priv ? lobby.key.slice(2) : '',
        s: lobby.state === 'run' ? 0 : 1, map: lobby.map, mapName: LEVELS[lobby.map].name,
        next: lobby.state === 'run' ? null : { i: lobby.nextMap, name: LEVELS[lobby.nextMap].name },
        players: [...lobby.players.values()].map(p => ({ id: p.id, name: p.name })),
        results: lobby.results.slice(0, 10)
      });
      return;
    }
    if (!me || !lobby) return;

    if (m.t === 's') {
      const dt = Math.max(20, now - me.lt); me.lt = now;
      const x = +m.x, y = +m.y;
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      const lv = LEVELS[lobby.map];
      if (x < -400 || x > lv.finish.x + 1200 || y > 6000 || y < -9000) return;
      // speed sanity check: snap the player back if they teleport
      if (Math.hypot(x - me.x, y - me.y) > (dt / 1000) * 1800 + 80) {
        send(ws, { t: 'fix', x: me.x, y: me.y });
        return;
      }
      me.x = x; me.y = y; me.f = m.f === -1 ? -1 : 1;
      const cp = m.cp | 0;
      if (cp >= 0 && cp <= me.maxCp + 2 && cp < lv.cps.length) {
        me.cp = cp; me.maxCp = Math.max(me.maxCp, cp);
      }
    } else if (m.t === 'rs') {            // respawn at checkpoint
      const cp = Math.min(m.cp | 0, me.maxCp);
      const c = LEVELS[lobby.map].cps[Math.max(0, cp)];
      me.cp = Math.max(0, cp); me.x = c.x; me.y = c.y - LV.PH; me.lt = now;
    } else if (m.t === 'fin') {
      if (lobby.state !== 'run' || me.fin) return;
      const lv = LEVELS[lobby.map], f = lv.finish;
      const secs = (now - me.t0) / 1000;
      if (me.x + LV.PW < f.x - 60 || secs < (f.x - lv.spawn.x) / 350) return;
      me.fin = true;
      const time = Math.round(secs * 10) / 10;
      lobby.results.push({ n: me.name, t: time });
      if (lobby.results.length === 1) lobby.endAt = Math.min(lobby.endAt, now + AFTER_FIRST_FINISH_MS);
      sendAll(lobby, { t: 'fin', id: me.id, name: me.name, time, rank: lobby.results.length });
    }
  });

  ws.on('close', () => {
    clearInterval(rate);
    if (me && lobby) {
      lobby.players.delete(me.id);
      sendAll(lobby, { t: 'pl', id: me.id });
    }
  });
  ws.on('error', () => {});
});

// drop dead connections
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false; ws.ping();
  }
}, 30000);

server.listen(PORT, () => console.log('Rooftop Run listening on :' + PORT));
