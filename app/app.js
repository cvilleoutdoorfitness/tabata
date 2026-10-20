'use strict';

const VERSION = 'v1.0.0';
const STORE_KEY = 'fitclub-tabata-settings';

const DEFAULTS = {
  work: 20,
  rest: 10,
  rounds: 5,
  prep: 5,
  sndStart: 'whistle',
  sndRest: 'beeps',
  sndDone: 'bell',
  ticks: true,
  vibrate: true,
  volume: 1,
};

const CHEERS = [
  'Great work, Fit Club!',
  'Crushed it!',
  'Nailed it. Go grab some water.',
  'That was legendary.',
  'Sweaty and proud!',
  'See you tomorrow, outside!',
];

const $ = (id) => document.getElementById(id);
const el = {
  body: document.body,
  phase: $('phase'),
  count: $('count'),
  round: $('round'),
  barFill: $('barFill'),
  summary: $('summary'),
  mainBtn: $('mainBtn'),
  resetBtn: $('resetBtn'),
};

// ---------- settings ----------

let settings = load();

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
    return { ...DEFAULTS, ...saved };
  } catch (e) {
    return { ...DEFAULTS };
  }
}

function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(settings)); } catch (e) {}
}

// ---------- schedule ----------

function buildSchedule(s) {
  const segs = [];
  if (s.prep > 0) segs.push({ phase: 'prep', dur: s.prep, round: 0 });
  for (let r = 1; r <= s.rounds; r++) {
    segs.push({ phase: 'work', dur: s.work, round: r });
    if (r < s.rounds && s.rest > 0) segs.push({ phase: 'rest', dur: s.rest, round: r });
  }
  let t = 0;
  for (const seg of segs) { seg.start = t; t += seg.dur; seg.end = t; }
  return { segs, total: t };
}

function fmt(sec) {
  sec = Math.max(0, Math.ceil(sec - 1e-6));
  if (sec < 60) return String(sec);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function fmtClock(sec) {
  sec = Math.round(sec);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

// ---------- timer engine ----------

const state = {
  mode: 'idle', // idle | running | paused | done
  plan: null,
  t0: 0, // performance.now() at (virtual) start
  frozen: 0, // elapsed seconds while paused
  idx: -1,
  lastTick: null,
  timer: null,
};

function elapsed() {
  return state.mode === 'running' ? (performance.now() - state.t0) / 1000 : state.frozen;
}

function start() {
  Sounds.unlock();
  state.plan = buildSchedule(settings);
  state.t0 = performance.now();
  state.frozen = 0;
  state.idx = -1;
  state.lastTick = null;
  setMode('running');
  keepAwake(true);
  loop();
}

function pause() {
  state.frozen = elapsed();
  setMode('paused');
}

function resume() {
  Sounds.unlock();
  state.t0 = performance.now() - state.frozen * 1000;
  setMode('running');
  keepAwake(true);
  loop();
}

function reset() {
  setMode('idle');
  keepAwake(false);
  renderIdle();
}

function finish() {
  state.frozen = state.plan.total;
  setMode('done');
  keepAwake(false);
  Sounds.play(settings.sndDone);
  buzz([400, 150, 400, 150, 600]);
  el.body.dataset.phase = 'done';
  el.phase.textContent = 'Done!';
  setCount(fmtClock(state.plan.total));
  el.round.textContent = `${settings.rounds} round${settings.rounds === 1 ? '' : 's'} complete`;
  el.barFill.style.width = '100%';
  el.summary.textContent = CHEERS[Math.floor(Math.random() * CHEERS.length)];
}

function setMode(mode) {
  state.mode = mode;
  el.body.classList.toggle('running', mode === 'running');
  el.body.classList.toggle('paused', mode === 'paused');
  el.mainBtn.textContent = { idle: 'Start', running: 'Pause', paused: 'Resume', done: 'Go again' }[mode];
  el.resetBtn.hidden = !(mode === 'paused' || mode === 'done');
  clearInterval(state.timer);
  if (mode === 'running') state.timer = setInterval(loop, 50);
}

function loop() {
  if (state.mode !== 'running') return;
  const e = elapsed();
  const { segs, total } = state.plan;
  if (e >= total) { finish(); return; }

  let idx = state.idx < 0 ? 0 : state.idx;
  while (idx < segs.length - 1 && e >= segs[idx].end) idx++;
  const seg = segs[idx];

  if (idx !== state.idx) {
    // Only announce the segment we're in, even if the page slept through others.
    state.idx = idx;
    enter(seg);
  }

  const remaining = seg.end - e;
  const secLeft = Math.ceil(remaining - 1e-6);

  // 3-2-1 beeps leading into each exercise.
  if (settings.ticks && seg.phase !== 'work' && secLeft <= 3 && secLeft >= 1 && state.lastTick !== `${idx}:${secLeft}`) {
    state.lastTick = `${idx}:${secLeft}`;
    Sounds.tick();
  }

  setCount(fmt(remaining));
  el.barFill.style.width = `${Math.min(100, ((e - seg.start) / seg.dur) * 100)}%`;
  el.summary.textContent = `${fmtClock(total - e)} left in workout`;
}

function setCount(text) {
  el.count.textContent = text;
  el.count.classList.toggle('long', text.length > 2);
}

function enter(seg) {
  el.body.dataset.phase = seg.phase;
  if (seg.phase === 'prep') {
    el.phase.textContent = 'Get ready';
    el.round.textContent = `${settings.rounds} × ${settings.work}s / ${settings.rest}s`;
  } else if (seg.phase === 'work') {
    el.phase.textContent = 'Work!';
    el.round.textContent = `Round ${seg.round} of ${settings.rounds}`;
    Sounds.play(settings.sndStart);
    buzz([350]);
  } else {
    el.phase.textContent = 'Rest';
    el.round.textContent = `Next: round ${seg.round + 1} of ${settings.rounds}`;
    Sounds.play(settings.sndRest);
    buzz([150, 100, 150]);
  }
}

function buzz(pattern) {
  if (settings.vibrate && navigator.vibrate) {
    try { navigator.vibrate(pattern); } catch (e) {}
  }
}

function renderIdle() {
  const { total } = buildSchedule(settings);
  el.body.dataset.phase = 'idle';
  el.phase.textContent = 'Tabata';
  setCount(fmtClock(total));
  el.round.textContent = `${settings.rounds} × ${settings.work}s work / ${settings.rest}s rest`;
  el.barFill.style.width = '0';
  el.summary.textContent = isStandalone()
    ? 'Tap Start when you’re ready'
    : 'Tip: tap ? to add this timer to your home screen';
}

el.mainBtn.addEventListener('click', () => {
  ({ idle: start, running: pause, paused: resume, done: start })[state.mode]();
});
el.resetBtn.addEventListener('click', reset);

// ---------- keep the screen awake ----------

let wakeLock = null;

async function keepAwake(on) {
  if (!('wakeLock' in navigator)) return;
  try {
    if (on && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch (e) { wakeLock = null; }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && (state.mode === 'running' || state.mode === 'paused')) {
    keepAwake(true);
    loop();
  }
});

// ---------- settings UI ----------

const settingsSheet = $('settings');
const helpSheet = $('help');

function openSheet(sheet) { sheet.hidden = false; sheet.querySelector('.sheet-body').scrollTop = 0; }
function closeSheet(sheet) { sheet.hidden = true; if (state.mode === 'idle') renderIdle(); }

$('settingsBtn').addEventListener('click', () => { syncSettingsUI(); openSheet(settingsSheet); });
$('settingsDone').addEventListener('click', () => closeSheet(settingsSheet));
$('helpBtn').addEventListener('click', () => openSheet(helpSheet));
$('helpDone').addEventListener('click', () => closeSheet(helpSheet));

function syncSettingsUI() {
  document.querySelectorAll('.stepper').forEach((st) => {
    st.querySelector('output').textContent = settings[st.dataset.key];
  });
  ['sndStart', 'sndRest', 'sndDone'].forEach((k) => { $(k).value = settings[k]; });
  $('ticks').checked = settings.ticks;
  $('vibrate').checked = settings.vibrate;
  $('vibrate').closest('.toggle').hidden = !navigator.vibrate;
  $('volume').value = settings.volume;
  const { total } = buildSchedule(settings);
  $('totalHint').textContent = `Total workout: ${fmtClock(total)} (including get ready)`;
}

// Steppers with press-and-hold to repeat.
document.querySelectorAll('.stepper').forEach((st) => {
  const key = st.dataset.key;
  const min = +st.dataset.min, max = +st.dataset.max, step = +st.dataset.step;
  st.querySelectorAll('.step').forEach((btn) => {
    const dir = +btn.dataset.d;
    let holdTimer = null, repeats = 0;
    const bump = () => {
      const cur = settings[key];
      // snap to the step grid so e.g. 23 goes to 25 or 20
      let next = dir > 0 ? Math.floor(cur / step) * step + step : Math.ceil(cur / step) * step - step;
      next = Math.min(max, Math.max(min, next));
      if (next !== cur) {
        settings[key] = next;
        save();
        syncSettingsUI();
      }
    };
    const stop = () => { clearTimeout(holdTimer); holdTimer = null; };
    const repeat = () => {
      bump();
      repeats++;
      holdTimer = setTimeout(repeat, repeats > 8 ? 60 : 140);
    };
    btn.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      repeats = 0;
      bump();
      holdTimer = setTimeout(repeat, 450);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((t) => btn.addEventListener(t, stop));
    btn.addEventListener('contextmenu', (ev) => ev.preventDefault());
    // keyboard users
    btn.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); bump(); } });
  });
});

['sndStart', 'sndRest', 'sndDone'].forEach((k) => {
  const sel = $(k);
  Sounds.list.forEach(({ id, label }) => sel.add(new Option(label, id)));
  sel.addEventListener('change', () => {
    settings[k] = sel.value;
    save();
    Sounds.unlock();
    Sounds.play(sel.value);
  });
});

document.querySelectorAll('.test').forEach((btn) => {
  btn.addEventListener('click', () => { Sounds.unlock(); Sounds.play($(btn.dataset.for).value); });
});

['ticks', 'vibrate'].forEach((k) => {
  $(k).addEventListener('change', () => { settings[k] = $(k).checked; save(); });
});

$('volume').addEventListener('input', () => {
  settings.volume = +$('volume').value;
  Sounds.setVolume(settings.volume);
  save();
});
$('volume').addEventListener('change', () => { Sounds.unlock(); Sounds.tick(); });

$('resetDefaults').addEventListener('click', () => {
  settings = { ...DEFAULTS };
  Sounds.setVolume(settings.volume);
  save();
  syncSettingsUI();
});

// ---------- install / offline ----------

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

let installPrompt = null;
window.addEventListener('beforeinstallprompt', (ev) => {
  ev.preventDefault();
  installPrompt = ev;
  $('installBtn').hidden = false;
});
$('installBtn').addEventListener('click', async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice.catch(() => {});
  installPrompt = null;
  $('installBtn').hidden = true;
});
window.addEventListener('appinstalled', () => { $('installBtn').hidden = true; });

$('installedNote').hidden = !isStandalone();
$('version').textContent = VERSION;

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

Sounds.setVolume(settings.volume);
renderIdle();
