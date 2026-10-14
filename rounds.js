// Fast-forward round cycle: checks map rotation, 'end' preview, 'reset' with new map, snapshots carry the map.
const { spawn } = require('child_process');
const srv = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: 3992, TEST_FAST: '1', START_MAP: '0' }, cwd: __dirname + '/..' });
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
setTimeout(() => {
  const ws = new WebSocket('ws://localhost:3992'); const log = []; let lastSnapMap = null;
  ws.onopen = () => ws.send(JSON.stringify({ t: 'join', name: 'R' }));
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.t === 'n') lastSnapMap = m.m; else log.push(m); };
  setTimeout(() => {
    const w = log.find(m => m.t === 'welcome'), end = log.find(m => m.t === 'end'), res = log.filter(m => m.t === 'reset');
    ok(w && w.map === 0 && w.mapName === 'Sunny Start', 'welcome carries the starting map (Sunny Start)');
    ok(end && end.next && end.next.i === 1 && end.next.name === 'Bouncy Bay', 'round end announces the next map (Bouncy Bay)');
    ok(res.length >= 1 && res[0].map === 1, 'reset starts the next map');
    ok(lastSnapMap !== null && lastSnapMap >= 1, 'snapshots carry the current map index (' + lastSnapMap + ')');
    srv.kill(); console.log(fail ? fail + ' FAILED' : 'ALL PASSED'); process.exit(fail ? 1 : 0);
  }, 9000);
}, 700);
