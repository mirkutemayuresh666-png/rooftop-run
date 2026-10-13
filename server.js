'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const LV = require('./public/level.js');

const LEVEL = LV.build(LV.SEED);
const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 50;               // lobby limit
const RUN_MS = 180000;                // max round length
const AFTER_FIRST_FINISH_MS = 20000;  // round closes this long after the first finisher
const BREAK_MS = 10000;               // results screen between rounds
const TICK_MS = 66;                   // ~15 snapshots / second
const MIN_RUN_SECONDS = (LEVEL.finish.x - LEVEL.spawn.x) / 350;

/* ---------- static files ---------- */
const PUB = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png'
};
const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url === '/health') { res.writeHead(200); return res.end('ok'); }
  const rel = url === '/' ? '/index.html' : url;
  const file = path.normalize(path.join(PUB, rel));
  if (!file.startsWith(PUB)) { res.writeHead(403); return res.end(); }
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
  const l = {
    key, priv, players: new Map(), state: 'run',
    start: now, endAt: now + RUN_MS, breakEnd: 0, results: []
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

function resetPlayer(p, now) {
  p.x = LEVEL.spawn.x; p.y = LEVEL.spawn.y - LV.PH;
  p.cp = 0; p.maxCp = 0; p.fin = false; p.t0 = now; p.lt = now;
}

function newRound(l, now) {
  l.state = 'run'; l.start = now; l.endAt = now + RUN_MS; l.results = [];
  for (const p of l.players.values()) resetPlayer(p, now);
  sendAll(l, { t: 'reset' });
}

function tickLobby(l, now) {
  if (l.state === 'run' && now >= l.endAt) {
    l.state = 'break'; l.breakEnd = now + BREAK_MS;
    sendAll(l, { t: 'end', results: l.results.slice(0, 10) });
  } else if (l.state === 'break' && now >= l.breakEnd) {
    newRound(l, now);
  }
  if (!l.players.size) return;
  const target = l.state === 'run' ? l.endAt : l.breakEnd;
  const snap = {
    t: 'n', s: l.state === 'run' ? 0 : 1,
    l: Math.max(0, Math.ceil((target - now) / 1000)),
    c: l.players.size,
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
      me = { id: nextId++, ws, name };
      resetPlayer(me, now);
      me.f = 1;
      sendAll(lobby, { t: 'pj', p: { id: me.id, name } }, null);
      lobby.players.set(me.id, me);
      send(ws, {
        t: 'welcome', id: me.id, max: MAX_PLAYERS,
        room: lobby.priv ? lobby.key.slice(2) : '',
        s: lobby.state === 'run' ? 0 : 1,
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
      if (x < -400 || x > LEVEL.finish.x + 1200 || y > 6000 || y < -9000) return;
      // speed sanity check: snap the player back if they teleport
      if (Math.hypot(x - me.x, y - me.y) > (dt / 1000) * 1800 + 80) {
        send(ws, { t: 'fix', x: me.x, y: me.y });
        return;
      }
      me.x = x; me.y = y; me.f = m.f === -1 ? -1 : 1;
      const cp = m.cp | 0;
      if (cp >= 0 && cp <= me.maxCp + 2 && cp < LEVEL.cps.length) {
        me.cp = cp; me.maxCp = Math.max(me.maxCp, cp);
      }
    } else if (m.t === 'rs') {            // respawn at checkpoint
      const cp = Math.min(m.cp | 0, me.maxCp);
      const c = LEVEL.cps[Math.max(0, cp)];
      me.cp = Math.max(0, cp); me.x = c.x; me.y = c.y - LV.PH; me.lt = now;
    } else if (m.t === 'fin') {
      if (lobby.state !== 'run' || me.fin) return;
      const f = LEVEL.finish;
      const secs = (now - me.t0) / 1000;
      if (me.x + LV.PW < f.x - 60 || secs < MIN_RUN_SECONDS) return;
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
