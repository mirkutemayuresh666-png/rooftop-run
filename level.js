// Shared by the browser and the server so both agree on the courses and the physics.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LEVEL = factory();
})(this, function () {
  const PW = 26, PH = 40;           // player width / height
  const RUN = 290;                  // top running speed (px/s)
  const BOUNCE = 1150;              // launch speed from a bounce pad

  function rng(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* 12 maps. Surface kinds: n normal, b bounce pad, i ice, c conveyor, m mud, w climbing wall. */
  const MAPS = [
    { name: 'Sunny Start',      theme: 'day',     seed: 101, n: 24, gap: [60, 105],  dy: [-45, 45],  w: [190, 300], time: 150 },
    { name: 'Bouncy Bay',       theme: 'beach',   seed: 202, n: 26, gap: [60, 115],  dy: [-55, 55],  w: [160, 260], bounce: 0.28, time: 170 },
    { name: 'Slippery Slopes',  theme: 'ice',     seed: 303, n: 28, gap: [60, 110],  dy: [-55, 55],  w: [190, 300], ice: 0.6, time: 170 },
    { name: 'Candy Climb',      theme: 'candy',   seed: 404, n: 30, gap: [60, 115],  dy: [-60, 60],  w: [160, 270], tower: 6, time: 190 },
    { name: 'Conveyor Canyon',  theme: 'desert',  seed: 505, n: 28, gap: [60, 115],  dy: [-55, 55],  w: [200, 300], conv: 0.55, time: 180 },
    { name: 'Mud Meadow',       theme: 'jungle',  seed: 606, n: 26, gap: [60, 120],  dy: [-55, 55],  w: [220, 320], mud: 0.55, time: 190 },
    { name: 'Cloud Hoppers',    theme: 'cloud',   seed: 707, n: 32, gap: [80, 130],  dy: [-65, 65],  w: [120, 175], time: 180 },
    { name: 'Tower Trouble',    theme: 'sunset',  seed: 808, n: 32, gap: [60, 115],  dy: [-60, 60],  w: [160, 260], tower: 4, time: 200 },
    { name: 'Neon Nights',      theme: 'city',    seed: 909, n: 34, gap: [65, 125],  dy: [-65, 65],  w: [130, 220], bounce: 0.12, time: 190 },
    { name: 'Starlight Dash',   theme: 'space',   seed: 1010, n: 34, gap: [70, 130], dy: [-70, 70],  w: [130, 210], ice: 0.2, bounce: 0.15, time: 200 },
    { name: 'Mixed Mayhem',     theme: 'night',   seed: 1111, n: 38, gap: [65, 120], dy: [-60, 60],  w: [170, 270], ice: 0.18, conv: 0.18, mud: 0.14, bounce: 0.12, tower: 9, time: 220 },
    { name: 'Mega Marathon',    theme: 'rainbow', seed: 1212, n: 58, gap: [65, 125], dy: [-65, 65],  w: [150, 260], ice: 0.14, conv: 0.14, mud: 0.1, bounce: 0.12, tower: 11, time: 300 }
  ];

  // y is the TOP surface of each block. Y grows downward.
  function build(i) {
    const d = MAPS[i];
    const r = rng(d.seed);
    const rg = a => a[0] + r() * (a[1] - a[0]);
    const ice = d.ice || 0, conv = d.conv || 0, mud = d.mud || 0;
    const plats = [], cps = [];
    let y = 600;
    plats.push({ x: -300, y, w: 700, h: 80, k: 'n' });
    let rx = 400;                       // right edge of the last platform
    cps.push({ x: 80, y });
    let n = 0, sinceCp = 0;

    while (n < d.n) {
      n++; sinceCp++;
      if (d.tower && n % d.tower === 0) {
        // Wall-jump tower: climb the left face, mantle onto the ledge on top.
        const H = 330, wx = rx - 40;
        plats.push({ x: wx, y: y - H, w: 40, h: H, k: 'w' });
        plats.push({ x: wx, y: y - H, w: 260, h: 40, k: 'n' });
        rx = wx + 260; y -= H;
        cps.push({ x: wx + 150, y }); sinceCp = 0;
        y += 240;
        const w = 220;
        plats.push({ x: rx + 100, y, w, h: 80, k: 'n' });
        rx = rx + 100 + w;
        continue;
      }
      if (d.bounce && n > 2 && r() < d.bounce) {
        // Bounce pad that launches you over a wide gap onto a higher platform.
        const pw = 90;
        plats.push({ x: rx, y, w: pw, h: 36, k: 'b' });          // flush with the last platform: run onto it
        rx = rx + pw;
        const g2 = Math.round(105 + r() * 45), rise = Math.round(100 + r() * 60), w = Math.round(220 + r() * 70);
        y -= rise;
        plats.push({ x: Math.round(rx + g2), y, w, h: 80, k: 'n' });
        rx = Math.round(rx + g2 + w);
        if (sinceCp >= 6) { cps.push({ x: rx - w / 2, y }); sinceCp = 0; }
        continue;
      }
      const gap = rg(d.gap), dy = Math.round(rg(d.dy));
      let w = Math.round(rg(d.w));
      const q = r();
      let k = 'n', cv = 0;
      if (q < ice) k = 'i';
      else if (q < ice + conv) { k = 'c'; cv = (r() < 0.5 ? 1 : -1) * 110; }
      else if (q < ice + conv + mud) k = 'm';
      if (k !== 'n') w = Math.max(w, 200);
      y += dy;
      plats.push({ x: Math.round(rx + gap), y, w, h: 80, k, cv });
      rx = Math.round(rx + gap + w);
      if (sinceCp >= 6) { cps.push({ x: rx - w / 2, y }); sinceCp = 0; }
    }

    const fx = rx + 100;
    plats.push({ x: fx, y, w: 560, h: 80, k: 'n' });
    const finish = { x: fx + 240, y: y - 190, w: 90, h: 190 };
    return { plats, cps, finish, spawn: { x: 60, y: 600 }, name: d.name, theme: d.theme, time: d.time || 180, idx: i };
  }
  const laneX = id => 60 - (id % 8) * 32;      // players start staggered on the start platform

  /* ---------- shared physics (client + server tests) ---------- */
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
          if (p.vx > 0 || p.pushed > 0) p.x = r.x - PW; else if (p.vx < 0 || p.pushed < 0) p.x = r.x + r.w;
          p.vx = 0;
        } else {
          if (p.vy > 0) { p.y = r.y - PH; p.onG = true; p.ground = r; } else if (p.vy < 0) p.y = r.y + r.h;
          p.vy = 0;
        }
      }
    }
  }
  function newPlayer() {
    return { x: 0, y: 0, vx: 0, vy: 0, onG: false, wall: 0, face: 1, cp: 0, lock: 0, coyote: 0, jbuf: 0, fin: false, ground: null, bounced: false, pushed: 0 };
  }
  // inp = {l, r, j (held), jp (pressed this frame; consumed here)}
  function stepPhysics(p, inp, dt, plats) {
    const ax = (inp.r ? 1 : 0) - (inp.l ? 1 : 0);
    if (ax) p.face = ax;
    const g0 = p.onG ? p.ground : null, k0 = g0 ? g0.k : 'n';
    if (p.lock > 0) p.lock -= dt;
    else {
      const top = k0 === 'm' ? RUN * 0.55 : RUN;
      const acc = p.onG ? (k0 === 'i' ? 380 : 3200) : 2400;
      p.vx = approach(p.vx, ax * top, acc * dt);
    }

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
    if (!inp.j && p.vy < -300 && p.vy > -JUMP - 1) p.vy += G * dt * 1.4;   // variable jump height (not for bounces)
    p.vy = Math.min(p.vy + G * dt, FALL_MAX);
    if (p.wall !== 0 && p.vy > 110) p.vy = 110;            // wall slide

    const belt = g0 && g0.k === 'c' ? g0.cv : 0;           // conveyor belt push
    p.pushed = belt;
    p.onG = false;
    p.x += (p.vx + belt) * dt; collide(p, plats, 'x');
    p.y += p.vy * dt; collide(p, plats, 'y');
    if (p.onG && p.ground && p.ground.k === 'b') { p.vy = -BOUNCE; p.onG = false; p.bounced = true; }

    p.wall = 0;
    if (!p.onG) {
      if (ax < 0 && hits(plats, p.x - 3, p.y + 4, 3, PH - 8)) p.wall = -1;
      else if (ax > 0 && hits(plats, p.x + PW, p.y + 4, 3, PH - 8)) p.wall = 1;
    }
  }

  return { MAPS, build, laneX, newPlayer, stepPhysics, hits, PW, PH, RUN };
});
