// All sounds are synthesized with the Web Audio API, so the app needs no
// audio files and works fully offline.
'use strict';

const Sounds = (() => {
  let ctx = null;
  let master = null;
  let noiseBuf = null;
  let volume = 1;
  let keepAlive = null;
  let stale = false; // context stopped after it had been playing

  // iPhone/iPad (iPadOS reports itself as a Mac with touch).
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  // iOS 17+: play through the ringer/silent switch like a media app.
  // Set it before any audio starts, and again on every unlock because iOS
  // can drop back to the default after an interruption.
  function setSessionType() {
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {}
  }
  setSessionType();

  function build() {
    const AC = window.AudioContext || window.webkitAudioContext;
    const c = new AC();
    ctx = c;
    stale = false;
    let ran = c.state === 'running';
    c.onstatechange = () => {
      if (c.state === 'running') ran = true;
      else if (ran && c === ctx) stale = true;
    };
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 6;
    comp.ratio.value = 6;
    comp.attack.value = 0.003;
    comp.release.value = 0.15;
    master = ctx.createGain();
    master.gain.value = volume;
    master.connect(comp);
    comp.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  function ensure() {
    // iOS can leave a context "interrupted" (ringer switch, a call, Siri,
    // locking the phone) and sometimes never lets it resume. A closed or
    // interrupted context is thrown away and rebuilt so sound comes back
    // without restarting the app.
    if (ctx && (ctx.state === 'closed' || ctx.state === 'interrupted')) drop();
    if (!ctx) build();
    return ctx;
  }

  function drop() {
    const c = ctx;
    ctx = null;
    try { c.close().catch(() => {}); } catch (e) {}
  }

  function wake() {
    ensure();
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
  }

  // A silent, looping <audio> element puts iOS in "media playback" mode,
  // which is what lets Web Audio play while the ringer is set to silent on
  // iPhones where navigator.audioSession is missing or ignored (e.g. the
  // home-screen app). It has to be started from a tap.
  function silentWav() {
    const rate = 8000, n = rate / 2; // half a second of silence
    const buf = new ArrayBuffer(44 + n);
    const v = new DataView(buf);
    const str = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
    str(0, 'RIFF'); v.setUint32(4, 36 + n, true); str(8, 'WAVE');
    str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
    str(36, 'data'); v.setUint32(40, n, true);
    for (let i = 0; i < n; i++) v.setUint8(44 + i, 128); // 8-bit silence
    return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  }

  function startKeepAlive() {
    if (!isIOS) return;
    if (!keepAlive) {
      keepAlive = document.createElement('audio');
      keepAlive.src = silentWav();
      keepAlive.loop = true;
      keepAlive.preload = 'auto';
      keepAlive.setAttribute('playsinline', '');
      keepAlive.setAttribute('x-webkit-airplay', 'deny');
      keepAlive.disableRemotePlayback = true;
    }
    if (keepAlive.paused) {
      const p = keepAlive.play();
      if (p) p.catch(() => {});
    }
  }

  // Call from a user gesture (tap) so iOS/Android allow audio. Safe to call
  // on every tap: it also repairs audio that iOS has stopped.
  function unlock() {
    // A context iOS stopped mid-session can come back "running" but silent,
    // so on a tap we start over with a fresh one.
    if (stale) drop();
    setSessionType();
    startKeepAlive();
    wake();
    const b = ctx.createBufferSource();
    b.buffer = ctx.createBuffer(1, 1, 22050);
    b.connect(ctx.destination);
    b.start(0);
  }

  // Any tap anywhere re-arms audio, so a stuck context fixes itself the next
  // time the coach touches the screen.
  ['pointerdown', 'touchend', 'keydown'].forEach((ev) =>
    document.addEventListener(ev, () => { if (ctx) unlock(); }, { capture: true, passive: true }));

  // Coming back to the app (after locking the phone, a call, switching
  // apps) restarts audio that iOS paused.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && ctx) { startKeepAlive(); wake(); }
  });

  function setVolume(v) {
    volume = v;
    if (master) master.gain.value = v;
  }

  // ---- building blocks -------------------------------------------------

  function env(g, t, a, peak, hold, rel) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.setValueAtTime(peak, t + a + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + hold + rel);
    return t + a + hold + rel;
  }

  function tone(t, freq, dur, { type = 'sine', peak = 0.6, a = 0.005, rel = 0.03, dest = master } = {}) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.connect(g); g.connect(dest);
    const end = env(g, t, a, peak, Math.max(0, dur - a - rel), rel);
    o.start(t); o.stop(end + 0.05);
    return o;
  }

  function noise(t, dur, { filter = 'bandpass', freq = 2000, q = 1, peak = 0.3, a = 0.01, rel = 0.05 } = {}) {
    const n = ctx.createBufferSource();
    n.buffer = noiseBuf; n.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = filter; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    n.connect(f); f.connect(g); g.connect(master);
    const end = env(g, t, a, peak, Math.max(0, dur - a - rel), rel);
    n.start(t); n.stop(end + 0.05);
  }

  // ---- the sounds ------------------------------------------------------

  function whistleBlast(t, dur) {
    // Pea whistle: high tone with the fast "trill" of the rattling pea.
    const o = ctx.createOscillator();
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(2900, t);
    lfo.frequency.value = 32;
    lfoGain.gain.value = 180;
    lfo.connect(lfoGain); lfoGain.connect(o.frequency);
    // amplitude flutter as well
    const am = ctx.createGain();
    const amLfo = ctx.createGain();
    amLfo.gain.value = 0.35;
    lfo.connect(amLfo); amLfo.connect(am.gain);
    am.gain.value = 0.65;
    o.connect(am); am.connect(g); g.connect(master);
    const end = env(g, t, 0.02, 0.55, dur - 0.08, 0.06);
    o.start(t); lfo.start(t); o.stop(end + 0.05); lfo.stop(end + 0.05);
    noise(t, dur, { freq: 3000, q: 2, peak: 0.12 });
    return end;
  }

  const defs = {
    none: { label: 'None', play: (t) => t },

    whistle: {
      label: "Coach's whistle",
      play: (t) => whistleBlast(t, 0.9),
    },
    whistle2: {
      label: 'Double whistle',
      play: (t) => { whistleBlast(t, 0.22); return whistleBlast(t + 0.32, 0.6); },
    },
    beeps: {
      label: 'Three beeps',
      play: (t) => {
        for (let i = 0; i < 3; i++) tone(t + i * 0.28, 1000, 0.18, { type: 'square', peak: 0.35 });
        return t + 0.75;
      },
    },
    longbeep: {
      label: 'Long beep',
      play: (t) => tone(t, 1000, 0.8, { type: 'square', peak: 0.35 }) && t + 0.8,
    },
    rising: {
      label: 'Rising beeps',
      play: (t) => {
        [660, 880, 1320].forEach((f, i) => tone(t + i * 0.2, f, i === 2 ? 0.45 : 0.14, { type: 'square', peak: 0.35 }));
        return t + 0.85;
      },
    },
    bell: {
      label: 'Boxing bell',
      play: (t) => {
        const ring = (s) => {
          [[1, 0.5], [2.76, 0.25], [5.4, 0.12], [8.93, 0.06]].forEach(([m, p]) =>
            tone(s, 520 * m, 1.6, { type: 'sine', peak: p, a: 0.002, rel: 1.5 }));
        };
        ring(t); ring(t + 0.35); ring(t + 0.7);
        return t + 2.3;
      },
    },
    airhorn: {
      label: 'Air horn',
      play: (t) => {
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass'; lp.frequency.value = 2400; lp.connect(master);
        [415, 440, 523, 554].forEach((f) => {
          const o = tone(t, f, 1.1, { type: 'sawtooth', peak: 0.16, a: 0.02, rel: 0.12, dest: lp });
          o.frequency.setValueAtTime(f * 0.92, t);
          o.frequency.exponentialRampToValueAtTime(f, t + 0.08);
        });
        return t + 1.2;
      },
    },
    cowbell: {
      label: 'More cowbell!',
      play: (t) => {
        const hit = (s) => {
          const bp = ctx.createBiquadFilter();
          bp.type = 'bandpass'; bp.frequency.value = 2600; bp.Q.value = 0.8; bp.connect(master);
          [587, 845].forEach((f) => tone(s, f, 0.5, { type: 'square', peak: 0.5, a: 0.001, rel: 0.45, dest: bp }));
        };
        hit(t); hit(t + 0.22); hit(t + 0.44);
        return t + 1;
      },
    },
    honk: {
      label: 'Clown horn',
      play: (t) => {
        const honk = (s) => {
          const bp = ctx.createBiquadFilter();
          bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 1.5; bp.connect(master);
          const o = tone(s, 330, 0.28, { type: 'sawtooth', peak: 0.7, a: 0.01, rel: 0.05, dest: bp });
          o.frequency.setValueAtTime(300, s);
          o.frequency.linearRampToValueAtTime(380, s + 0.06);
          o.frequency.linearRampToValueAtTime(340, s + 0.28);
        };
        honk(t); honk(t + 0.38);
        return t + 0.75;
      },
    },
    quack: {
      label: 'Duck',
      play: (t) => {
        const quack = (s) => {
          const bp = ctx.createBiquadFilter();
          bp.type = 'bandpass'; bp.Q.value = 3;
          bp.frequency.setValueAtTime(1400, s);
          bp.frequency.exponentialRampToValueAtTime(700, s + 0.22);
          bp.connect(master);
          const o = tone(s, 240, 0.24, { type: 'sawtooth', peak: 0.9, a: 0.01, rel: 0.06, dest: bp });
          o.frequency.setValueAtTime(260, s);
          o.frequency.exponentialRampToValueAtTime(190, s + 0.24);
        };
        quack(t); quack(t + 0.3); quack(t + 0.6);
        return t + 0.9;
      },
    },
    laser: {
      label: 'Pew pew laser',
      play: (t) => {
        for (let i = 0; i < 3; i++) {
          const s = t + i * 0.2;
          const o = tone(s, 1800, 0.18, { type: 'square', peak: 0.25, rel: 0.05 });
          o.frequency.setValueAtTime(1800, s);
          o.frequency.exponentialRampToValueAtTime(180, s + 0.18);
        }
        return t + 0.6;
      },
    },
    slideup: {
      label: 'Slide whistle up',
      play: (t) => slide(t, 450, 1900),
    },
    slidedown: {
      label: 'Slide whistle down',
      play: (t) => slide(t, 1900, 450),
    },
    levelup: {
      label: 'Video game level up',
      play: (t) => {
        [523, 659, 784, 1047, 784, 1047].forEach((f, i) =>
          tone(t + i * 0.08, f, i === 5 ? 0.3 : 0.075, { type: 'square', peak: 0.25, rel: 0.02 }));
        return t + 0.75;
      },
    },
    gameover: {
      label: 'Video game over',
      play: (t) => {
        [784, 659, 523, 392, 330, 262].forEach((f, i) =>
          tone(t + i * 0.13, f, i === 5 ? 0.5 : 0.11, { type: 'square', peak: 0.25, rel: 0.03 }));
        return t + 1.2;
      },
    },
    fanfare: {
      label: 'Victory fanfare',
      play: (t) => {
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass'; lp.frequency.value = 3000; lp.connect(master);
        const notes = [[523, 0, 0.12], [523, 0.15, 0.12], [523, 0.3, 0.12], [698, 0.45, 0.5], [880, 0.95, 0.2], [784, 1.15, 0.2], [880, 1.35, 0.2], [1047, 1.55, 0.8]];
        notes.forEach(([f, s, d]) => {
          tone(t + s, f, d, { type: 'sawtooth', peak: 0.22, a: 0.02, rel: 0.06, dest: lp });
          tone(t + s, f * 1.005, d, { type: 'square', peak: 0.08, a: 0.02, rel: 0.06, dest: lp });
        });
        return t + 2.4;
      },
    },
    trombone: {
      label: 'Sad trombone',
      play: (t) => {
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass'; lp.frequency.value = 1200; lp.Q.value = 2; lp.connect(master);
        const notes = [[294, 0, 0.45], [277, 0.5, 0.45], [262, 1.0, 0.45], [247, 1.5, 1.3]];
        notes.forEach(([f, s, d], i) => {
          const o = tone(t + s, f, d, { type: 'sawtooth', peak: 0.45, a: 0.04, rel: 0.12, dest: lp });
          if (i === 3) {
            const vib = ctx.createOscillator(); const vg = ctx.createGain();
            vib.frequency.value = 6; vg.gain.value = 7;
            vib.connect(vg); vg.connect(o.frequency);
            vib.start(t + s + 0.2); vib.stop(t + s + d);
          }
        });
        return t + 2.9;
      },
    },
    gong: {
      label: 'Gong',
      play: (t) => {
        [[1, 0.35], [1.48, 0.2], [2.02, 0.18], [2.67, 0.1], [3.4, 0.07]].forEach(([m, p]) =>
          tone(t, 110 * m, 3.5, { type: 'sine', peak: p, a: 0.01, rel: 3.3 }));
        noise(t, 0.6, { filter: 'lowpass', freq: 1500, peak: 0.15, rel: 0.5 });
        return t + 3.6;
      },
    },
    random: { label: 'Surprise me! (random)', play: null },
  };

  function slide(t, from, to) {
    const o = tone(t, from, 0.7, { type: 'sine', peak: 0.5, a: 0.03, rel: 0.08 });
    o.frequency.setValueAtTime(from, t);
    o.frequency.exponentialRampToValueAtTime(to, t + 0.65);
    const vib = ctx.createOscillator(); const vg = ctx.createGain();
    vib.frequency.value = 9; vg.gain.value = 25;
    vib.connect(vg); vg.connect(o.frequency);
    vib.start(t); vib.stop(t + 0.75);
    return t + 0.75;
  }

  const funny = ['airhorn', 'cowbell', 'honk', 'quack', 'laser', 'slideup', 'slidedown', 'levelup', 'trombone', 'gong'];

  function play(id) {
    wake();
    if (id === 'random') id = funny[Math.floor(Math.random() * funny.length)];
    const d = defs[id] || defs.none;
    d.play(ctx.currentTime + 0.02);
  }

  // Short countdown tick (3-2-1).
  function tick(final) {
    wake();
    tone(ctx.currentTime + 0.01, final ? 1320 : 880, 0.12, { type: 'square', peak: 0.3 });
  }

  const list = Object.entries(defs).map(([id, d]) => ({ id, label: d.label }));

  // Exposed for tests.
  const context = () => ctx;
  const keepAliveOn = () => !!keepAlive && !keepAlive.paused;

  return { unlock, play, tick, setVolume, list, context, keepAliveOn };
})();
