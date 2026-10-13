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

  return { build, PW, PH, RUN, SEED: 1337 };
});
