// Starts the real server and checks lobby limits, snapshots, anti-cheat and static files.
const { spawn } = require('child_process');
const http = require('http');
const PORT = 3999;
const srv = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT }, cwd: __dirname + '/..' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) failed++; };

function get(path) {
  return new Promise(res => http.get({ port: PORT, path }, r => { let b = ''; r.on('data', d => b += d); r.on('end', () => res({ s: r.statusCode, b })); }));
}
function client(name, room) {
  const ws = new WebSocket('ws://localhost:' + PORT);
  const c = { ws, name, msgs: [], id: null, lastSnap: null, full: false, welcome: null };
  ws.onopen = () => ws.send(JSON.stringify({ t: 'join', name, room }));
  ws.onmessage = e => {
    const m = JSON.parse(e.data); c.msgs.push(m);
    if (m.t === 'welcome') { c.id = m.id; c.welcome = m; }
    if (m.t === 'n') c.lastSnap = m;
    if (m.t === 'full') c.full = true;
  };
  return c;
}

(async () => {
  await sleep(600);
  ok((await get('/')).s === 200, 'serves index.html');
  ok((await get('/level.js')).s === 200, 'serves level.js');
  ok((await get('/health')).b === 'ok', 'health check');
  ok((await get('/../server.js')).s !== 200, 'blocks path traversal');

  // 52 public players -> lobby of 50, then a second lobby
  const pub = [];
  for (let i = 0; i < 52; i++) { pub.push(client('P' + i)); await sleep(15); }
  await sleep(600);
  const counts = pub.map(c => c.lastSnap && c.lastSnap.c);
  ok(counts.slice(0, 50).every(n => n === 50), 'first 50 public players share one lobby of 50');
  ok(counts.slice(50).every(n => n === 2), 'players 51-52 are placed in a new lobby (count 2)');
  ok(pub.slice(0, 50).every(c => c.lastSnap.p.length === 50), 'snapshot lists all 50 players');

  // leaving frees a slot
  pub[0].ws.close(); await sleep(300);
  const late = client('Late'); await sleep(400);
  ok(late.lastSnap && late.lastSnap.c === 50, 'freed slot is reused by the next joiner');

  // private room cap
  const room = [];
  for (let i = 0; i < 50; i++) { room.push(client('R' + i, 'TEST1')); await sleep(10); }
  await sleep(400);
  const extra = client('Extra', 'test1'); await sleep(400);
  ok(room.every(c => c.welcome), '50 players joined private room TEST1');
  ok(extra.full, '51st player in a private room is told it is full');

  // anti-cheat: teleport gets corrected
  const a = room[1];
  a.ws.send(JSON.stringify({ t: 's', x: 5000, y: 0, f: 1, cp: 0 })); await sleep(200);
  ok(a.msgs.some(m => m.t === 'fix'), 'teleport is rejected with a position fix');
  // too-fast finish rejected
  a.ws.send(JSON.stringify({ t: 'fin' })); await sleep(200);
  ok(!a.msgs.some(m => m.t === 'fin'), 'instant finish is rejected');
  // malformed input does not crash
  a.ws.send('not json'); a.ws.send(JSON.stringify({ t: 's', x: 'NaN' })); await sleep(200);
  ok((await get('/health')).b === 'ok', 'server survives malformed messages');

  [...pub, late, ...room, extra].forEach(c => { try { c.ws.close(); } catch (e) {} });
  srv.kill();
  console.log(failed ? failed + ' FAILED' : 'ALL PASSED');
  process.exit(failed ? 1 : 0);
})();
