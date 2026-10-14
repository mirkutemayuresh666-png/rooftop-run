// Shared by the browser and the server so both agree on the course.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LEVEL = factory();
})(this, function () {
  const PW = 26, PH = 40;           // player width / height
  const RUN = 290;                  // top running speed (px/s)

  function rng(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // y is the TOP surface of each block. Y grows downward.
  function build(seed) {
    const r = rng(seed);
    const plats = [], cps = [];
    let y = 600;
    plats.push({ x: -300, y, w: 700, h: 80 });
    let rx = 400;                       // right edge of the last platform
    cps.push({ x: 80, y });
    let n = 0;

    while (n < 46) {
      n++;
      if (n % 9 === 0) {
        // Wall-jump tower: climb the left face, mantle onto the ledge on top.
        const H = 330, wx = rx - 40;
        plats.push({ x: wx, y: y - H, w: 40, h: H });
        plats.push({ x: wx, y: y - H, w: 260, h: 40 });
        rx = wx + 260;
        y = y - H;
        cps.push({ x: wx + 150, y });
        y += 240;
        const gap = 100, w = 220;
        plats.push({ x: rx + gap, y, w, h: 80 });
        rx = rx + gap + w;
        continue;
      }
      const gap = 70 + r() * 70;
      const dy = Math.round(r() * 150 - 75);
      const w = Math.round(130 + r() * 140);
      y += dy;
      plats.push({ x: Math.round(rx + gap), y, w, h: 80 });
      rx = Math.round(rx + gap + w);
      if (n % 6 === 0) cps.push({ x: rx - w / 2, y });
    }

    // Finish platform
    const fx = rx + 100;
    plats.push({ x: fx, y, w: 520, h: 80 });
    const finish = { x: fx + 220, y: y - 170, w: 80, h: 170 };
    const spawn = { x: 60, y: 600 };
    return { plats, cps, finish, spawn };
  }


  /* ---------- shared physics (client + test bot) ---------- */
  const G = 2200, JUMP = 800, FALL_MAX = 1400;
  const approach = (v, t, d) => v < t ? Math.min(v + d, t) : Math.max(v - d, t);
  function hits(plats, x, y, w, h) {
    for (const r of plats) if (x < r.x + r.w && x + w > r.x && y < r.y + r.h && y + h > r.y) return true;
    return false;
  }
  function collide(p, plats, axis) {
    for (const r of plats) {
      if (p.x < r.x + r.w && p.x + PW > r.x && p.y < r.y + r.h && p.y + PH > r.y) {
        if (axis === 'x') {
          if (p.vx > 0) p.x = r.x - PW; else if (p.vx < 0) p.x = r.x + r.w;
          p.vx = 0;
        } else {
          if (p.vy > 0) { p.y = r.y - PH; p.onG = true; } else if (p.vy < 0) p.y = r.y + r.h;
          p.vy = 0;
        }
      }
    }
  }
  function newPlayer() {
    return { x: 0, y: 0, vx: 0, vy: 0, onG: false, wall: 0, face: 1, cp: 0, lock: 0, coyote: 0, jbuf: 0, fin: false };
  }
  // inp = {l, r, j (held), jp (pressed this frame; consumed here)}
  function stepPhysics(p, inp, dt, plats) {
    const ax = (inp.r ? 1 : 0) - (inp.l ? 1 : 0);
    if (ax) p.face = ax;
    if (p.lock > 0) p.lock -= dt;
    else p.vx = approach(p.vx, ax * RUN, (p.onG ? 3200 : 2400) * dt);

    if (inp.jp) { p.jbuf = 0.12; inp.jp = false; }
    p.jbuf -= dt;
    p.coyote = p.onG ? 0.1 : p.coyote - dt;
    if (p.jbuf > 0) {
      if (p.coyote > 0) { p.vy = -JUMP; p.jbuf = 0; p.coyote = 0; p.onG = false; }
      else if (p.wall !== 0) {
        p.vy = -JUMP * 0.95; p.vx = -p.wall * 170; p.lock = 0.1; p.face = -p.wall;
        p.jbuf = 0; p.wall = 0;
      }
    }
    if (!inp.j && p.vy < -300) p.vy += G * dt * 1.4;      // variable jump height
    p.vy = Math.min(p.vy + G * dt, FALL_MAX);
    if (p.wall !== 0 && p.vy > 110) p.vy = 110;            // wall slide

    p.onG = false;
    p.x += p.vx * dt; collide(p, plats, 'x');
    p.y += p.vy * dt; collide(p, plats, 'y');

    p.wall = 0;
    if (!p.onG) {
      if (ax < 0 && hits(plats, p.x - 3, p.y + 4, 3, PH - 8)) p.wall = -1;
      else if (ax > 0 && hits(plats, p.x + PW, p.y + 4, 3, PH - 8)) p.wall = 1;
    }
  }

  return { build, newPlayer, stepPhysics, hits, PW, PH, RUN, SEED: 1337 };
});
