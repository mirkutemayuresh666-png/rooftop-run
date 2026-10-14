// Headless bot that plays every map with the real shared physics to prove each is completable.
const L = require('../level.js');
const { PW, PH } = L;

function run(i) {
  const lv = L.build(i);
  const p = L.newPlayer();
  const inp = { l: false, r: true, j: false, jp: false };
  const respawn = () => { const c = lv.cps[p.cp]; p.x = c.x; p.y = c.y - PH; p.vx = p.vy = 0; p.lock = 0; p.wall = 0; p.ground = null; };
  p.x = L.laneX(1); p.y = lv.spawn.y - PH;
  let t = 0, falls = 0, bounces = 0;
  const dt = 1 / 60;
  while (t < lv.time) {
    t += dt;
    inp.l = false; inp.r = true;
    const grounded = p.onG;
    const ahead = L.hits(lv.plats, p.x + PW + 14, p.y + PH + 2, 2, 2);
    const wallAhead = L.hits(lv.plats, p.x + PW + 3, p.y + 4, 3, PH - 8);
    inp.j = !grounded;
    if (grounded && (!ahead || wallAhead) && !inp.jp) { inp.jp = true; inp.j = true; }
    if (!grounded && p.wall !== 0) inp.jp = true;
    L.stepPhysics(p, inp, dt, lv.plats);
    if (p.bounced) { p.bounced = false; bounces++; }
    if (p.onG) for (let k = p.cp + 1; k < lv.cps.length; k++)
      if (p.x >= lv.cps[k].x && Math.abs(p.y + PH - lv.cps[k].y) < 2) p.cp = k;
    if (p.y > lv.cps[p.cp].y + 800) { falls++; respawn(); }
    const f = lv.finish;
    if (p.x + PW > f.x && p.x < f.x + f.w && p.y + PH > f.y && p.y < f.y + f.h) return { done: true, t, falls, bounces, lim: lv.time };
  }
  return { done: false, t, falls, bounces, cp: p.cp, of: lv.cps.length, x: Math.round(p.x), fx: lv.finish.x, lim: lv.time };
}
let bad = 0;
for (let i = 0; i < L.MAPS.length; i++) {
  const r = run(i);
  console.log(String(i + 1).padStart(2), L.MAPS[i].name.padEnd(17), r.done ? 'PASS' : 'FAIL', JSON.stringify(r));
  if (!r.done) bad++;
}
console.log(bad ? bad + ' map(s) not completable by the bot' : 'ALL 12 MAPS COMPLETED');
process.exit(bad ? 1 : 0);
