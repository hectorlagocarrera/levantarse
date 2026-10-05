'use strict';

// ---------- Datos ----------

const PRESETS = {
  columbia: {
    name: 'Recomendado',
    sit: 30,
    stand: 5,
    info: 'Universidad de Columbia (2023): 5 minutos de caminata ligera cada 30 minutos sentado. Fue la pauta más eficaz para reducir glucosa y tensión arterial.',
  },
  cornell: {
    name: 'Cornell 20-8-2',
    sit: 20,
    stand: 10,
    info: 'Ergonomía de Cornell: 20 minutos sentado, 8 de pie y 2 moviéndote. Te avisaremos cuando toque moverte en los 2 últimos minutos.',
  },
  hourly: {
    name: 'Mínimo (1 h)',
    sit: 50,
    stand: 10,
    info: 'Pauta mínima: nunca más de una hora seguida sentado. Útil si tu trabajo no permite pausas tan frecuentes.',
  },
  custom: {
    name: 'Personalizado',
    sit: null,
    stand: null,
    info: 'Elige tus propios tiempos. Procura no superar 60 minutos sentado y moverte al menos 2-5 minutos en cada pausa.',
  },
};

const EXERCISES = [
  ['Camina', 'Da una vuelta por la casa o la oficina, o sube y baja unas escaleras.'],
  ['Elevación de talones', 'De pie, sube y baja los talones despacio 15 veces. Activa la circulación de las piernas.'],
  ['Sentadillas suaves', '10 sentadillas lentas, espalda recta y rodillas detrás de las puntas de los pies.'],
  ['Rotación de hombros', '10 círculos hacia atrás y 10 hacia delante, con los brazos relajados.'],
  ['Estiramiento cervical', 'Inclina la oreja hacia el hombro y mantén 15 s por lado. Sin forzar.'],
  ['Apertura de pecho', 'Entrelaza las manos tras la espalda, abre el pecho y mira al frente 20 s.'],
  ['Estiramiento de isquiotibiales', 'Apoya el talón en un escalón bajo, pierna estirada, inclínate desde la cadera 20 s por lado.'],
  ['Flexores de cadera', 'Paso largo adelante, rodilla trasera relajada y empuja la cadera al frente 20 s por lado.'],
  ['Muñecas y antebrazos', 'Brazo estirado, palma hacia fuera, tira suavemente de los dedos 15 s por mano.'],
  ['Bebe agua', 'Rellena tu vaso. Hidratarte también te obligará a levantarte más a menudo.'],
  ['Descansa la vista', 'Mira por la ventana a algo lejano durante 20 segundos y parpadea varias veces.'],
  ['Marcha en el sitio', 'Levanta las rodillas alternando durante 1 minuto a ritmo cómodo.'],
];

const DEFAULT_SETTINGS = {
  preset: 'columbia',
  sit: 30,
  stand: 5,
  sound: true,
  soundType: 'campana',
  volume: 90,
  repeat: 2,
  wakeLock: true,
  vibrate: true,
  exercises: true,
  eyes: false,
  hoursOn: false,
  from: '09:00',
  to: '18:00',
  goal: 12,
};

const KEYS = {
  settings: 'levantarse.settings',
  state: 'levantarse.state',
  history: 'levantarse.history',
};

const RING_LEN = 2 * Math.PI * 52;
const MIN = 60 * 1000;

// ---------- Almacenamiento ----------

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Sin almacenamiento (modo privado): la app sigue funcionando en memoria.
  }
}

let settings = { ...DEFAULT_SETTINGS, ...load(KEYS.settings, {}) };
// phase: 'idle' | 'sit' | 'stand'
let state = {
  phase: 'idle',
  phaseStart: 0,
  phaseEnd: 0,
  duration: 0,
  pausedRemaining: null,
  autoPaused: false,
  nextEyes: null,
  moveAlerted: false,
  ...load(KEYS.state, {}),
};
let history = load(KEYS.history, {});

const saveSettings = () => save(KEYS.settings, settings);
const saveState = () => save(KEYS.state, state);
const saveHistory = () => save(KEYS.history, history);

// ---------- Utilidades ----------

const $ = (id) => document.getElementById(id);

function dayKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function today() {
  const k = dayKey();
  if (!history[k]) history[k] = { breaks: 0, standMin: 0, skipped: 0 };
  return history[k];
}

function pruneHistory() {
  const cutoff = Date.now() - 60 * 24 * 60 * MIN;
  for (const k of Object.keys(history)) {
    if (new Date(k + 'T00:00').getTime() < cutoff) delete history[k];
  }
}

function fmt(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function durations() {
  if (settings.preset === 'custom') return { sit: settings.sit, stand: settings.stand };
  const p = PRESETS[settings.preset];
  return { sit: p.sit, stand: p.stand };
}

function minutesOfDay(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function withinHours(d = new Date()) {
  if (!settings.hoursOn) return true;
  const now = d.getHours() * 60 + d.getMinutes();
  const from = minutesOfDay(settings.from);
  const to = minutesOfDay(settings.to);
  return from <= to ? now >= from && now < to : now >= from || now < to;
}

// ---------- Avisos: sonido, vibración, notificación ----------

let audioCtx = null;
let masterOut = null;

function unlockAudio() {
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    audioCtx = new Ctx();
    // Compresor + ganancia final: permite subir mucho el volumen sin distorsionar.
    const comp = audioCtx.createDynamicsCompressor();
    comp.threshold.value = -24;
    comp.knee.value = 6;
    comp.ratio.value = 8;
    comp.attack.value = 0.002;
    comp.release.value = 0.15;
    masterOut = audioCtx.createGain();
    comp.connect(masterOut).connect(audioCtx.destination);
    masterOut.comp = comp;
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
}

// Una nota: varias ondas (parciales) con envolvente de ataque y caída.
function note(t, { f, type = 'sine', dur = 0.3, peak = 1, partials = [[1, 1]], sweepTo = null }) {
  for (const [mult, amp] of partials) {
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f * mult, t);
    if (sweepTo) osc.frequency.linearRampToValueAtTime(sweepTo * mult, t + dur);
    const p = Math.max(0.0002, peak * amp);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(p, t + 0.01);
    if (type === 'sine' || type === 'triangle') {
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    } else {
      g.gain.setValueAtTime(p, t + dur * 0.8);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    }
    osc.connect(g).connect(masterOut.comp);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }
}

// Cada sonido define su patrón para «levantarse»; el de «sentarse» es más corto y descendente.
const SOUND_TYPES = {
  campana: {
    name: 'Campana',
    notes: [1046.5, 1318.5, 1568],
    play: (t, f) => note(t, { f, dur: 1.1, partials: [[1, 1], [2.76, 0.35], [5.4, 0.15]] }),
    step: 0.32,
  },
  alarma: {
    name: 'Alarma',
    notes: [880, 660, 880, 660, 880, 660],
    play: (t, f) => note(t, { f, type: 'square', dur: 0.17, peak: 0.6 }),
    step: 0.19,
  },
  digital: {
    name: 'Reloj digital',
    notes: [2000, 2000, 2000, 2000],
    play: (t, f) => note(t, { f, type: 'square', dur: 0.07, peak: 0.55 }),
    step: 0.13,
  },
  sirena: {
    name: 'Sirena',
    notes: [600, 600],
    play: (t, f) => note(t, { f, type: 'sawtooth', dur: 0.55, peak: 0.45, sweepTo: f * 2 }),
    step: 0.6,
  },
  marimba: {
    name: 'Marimba',
    notes: [523.25, 659.25, 783.99, 1046.5],
    play: (t, f) => note(t, { f, type: 'triangle', dur: 0.4, partials: [[1, 1], [4, 0.2]] }),
    step: 0.16,
  },
  gong: {
    name: 'Gong',
    notes: [196, 196],
    play: (t, f) => note(t, { f, dur: 2.6, partials: [[1, 1], [1.48, 0.6], [2.03, 0.4], [2.97, 0.25]] }),
    step: 1.4,
  },
};

function soundPattern(kind) {
  const def = SOUND_TYPES[settings.soundType] || SOUND_TYPES.campana;
  if (kind === 'stand') return def.notes;
  if (kind === 'sit') return def.notes.slice(0, 2).reverse();
  return def.notes.slice(0, 1);
}

// iOS: «playback» hace que suene aunque el iPhone esté en modo silencio.
// Se vuelve a «auto» al terminar para no cortar la música de otras apps más de lo necesario.
let sessionTimer = null;
function holdAudioSession(seconds) {
  if (!navigator.audioSession) return;
  try { navigator.audioSession.type = 'playback'; } catch { return; }
  clearTimeout(sessionTimer);
  sessionTimer = setTimeout(() => {
    try { navigator.audioSession.type = 'auto'; } catch { /* ignorado */ }
  }, seconds * 1000 + 1500);
}

function playSound(kind, force = false) {
  if ((!settings.sound && !force) || !audioCtx) return;
  if (audioCtx.state !== 'running') audioCtx.resume();
  const def = SOUND_TYPES[settings.soundType] || SOUND_TYPES.campana;
  const v = settings.volume / 100;
  masterOut.gain.setValueAtTime(v * v * 2.5, audioCtx.currentTime); // curva perceptual con margen extra
  const notes = soundPattern(kind);
  const repeats = kind === 'eyes' ? 1 : settings.repeat;
  let t = audioCtx.currentTime + 0.05;
  for (let r = 0; r < repeats; r++) {
    for (const f of notes) {
      def.play(t, f);
      t += def.step;
    }
    t += 0.6;
  }
  holdAudioSession(t - audioCtx.currentTime + 2.5);
}

let swReg = null;

async function notify(kind, title, body) {
  playSound(kind);
  if (settings.vibrate && navigator.vibrate) {
    navigator.vibrate(kind === 'stand' ? [300, 150, 300, 150, 300] : [200, 100, 200]);
  }
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const options = {
    body,
    tag: 'levantarse-' + kind,
    renotify: true,
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    requireInteraction: kind === 'stand',
  };
  try {
    if (swReg) {
      await swReg.showNotification(title, options);
    } else {
      new Notification(title, options);
    }
  } catch {
    try { new Notification(title, options); } catch { /* sin notificaciones */ }
  }
}

async function requestPermission() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') {
    try { await Notification.requestPermission(); } catch { /* ignorado */ }
  }
  renderPermission();
}

// ---------- iOS y pantalla encendida ----------

const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const IS_STANDALONE = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

let wakeLock = null;

async function updateWakeLock() {
  const want = settings.wakeLock && state.phase !== 'idle' && !document.hidden;
  if (want && !wakeLock && 'wakeLock' in navigator) {
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } catch { wakeLock = null; }
  } else if (!want && wakeLock) {
    wakeLock.release().catch(() => {});
    wakeLock = null;
  }
}

function renderIosHelp() {
  const box = $('iosHelp');
  if (!IS_IOS) { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  $('iosInstall').classList.toggle('hidden', IS_STANDALONE);
  box.open = !IS_STANDALONE;
}

// ---------- Lógica del temporizador ----------

function startPhase(phase, now = Date.now()) {
  const d = durations();
  const minutes = phase === 'sit' ? d.sit : d.stand;
  state.phase = phase;
  state.phaseStart = now;
  state.duration = minutes * MIN;
  state.phaseEnd = now + state.duration;
  state.pausedRemaining = null;
  state.autoPaused = false;
  state.moveAlerted = false;
  state.nextEyes = phase === 'sit' && settings.eyes && minutes > 20 ? now + 20 * MIN : null;
  if (phase === 'stand') pickExercise();
  saveState();
  updateWakeLock();
}

function start() {
  unlockAudio();
  requestPermission();
  startPhase('sit');
  render();
}

function stop() {
  state = { ...state, phase: 'idle', pausedRemaining: null, autoPaused: false, nextEyes: null };
  saveState();
  updateWakeLock();
  render();
}

function togglePause() {
  unlockAudio();
  const now = Date.now();
  if (state.pausedRemaining != null) {
    resume(now);
  } else {
    pause(now, false);
  }
  render();
}

function pause(now, auto) {
  state.pausedRemaining = Math.max(0, state.phaseEnd - now);
  state.autoPaused = auto;
  saveState();
}

function resume(now) {
  const shift = now - (state.phaseEnd - state.pausedRemaining);
  state.phaseEnd = now + state.pausedRemaining;
  if (state.nextEyes) state.nextEyes += shift;
  state.pausedRemaining = null;
  state.autoPaused = false;
  saveState();
}

function skip() {
  unlockAudio();
  if (state.phase === 'sit') {
    startPhase('stand');
  } else if (state.phase === 'stand') {
    today().skipped += 1;
    saveHistory();
    startPhase('sit');
  }
  render();
}

function onSitEnd(now) {
  const sitMin = Math.round(state.duration / MIN);
  startPhase('stand', now);
  const standMin = Math.round(state.duration / MIN);
  notify('stand', '¡Levántate!', `Llevas ${sitMin} min sentado. Ponte de pie y muévete ${standMin} min.`);
}

function onStandEnd(now) {
  const t = today();
  t.breaks += 1;
  t.standMin += Math.round(state.duration / MIN);
  saveHistory();
  startPhase('sit', now);
  const msg = t.breaks >= settings.goal
    ? `¡Objetivo diario cumplido! Llevas ${t.breaks} pausas hoy.`
    : `Pausa ${t.breaks} de ${settings.goal}. Te avisaremos dentro de ${durations().sit} min.`;
  notify('sit', 'Ya puedes sentarte', msg);
}

function tick() {
  const now = Date.now();
  if (state.phase === 'idle') return;

  // Horario laboral: pausa automática fuera de horario y reanuda al volver.
  const inHours = withinHours(new Date(now));
  if (!inHours && state.pausedRemaining == null) {
    pause(now, true);
  } else if (inHours && state.autoPaused) {
    resume(now);
  }

  if (state.pausedRemaining == null) {
    if (state.phase === 'sit' && state.nextEyes && now >= state.nextEyes) {
      state.nextEyes += 20 * MIN;
      if (state.nextEyes > state.phaseEnd - MIN) state.nextEyes = null;
      saveState();
      notify('eyes', 'Descansa la vista', 'Regla 20-20-20: mira algo a 6 metros durante 20 segundos.');
    }

    if (state.phase === 'stand' && settings.preset === 'cornell' && !state.moveAlerted
        && state.phaseEnd - now <= 2 * MIN && state.phaseEnd > now) {
      state.moveAlerted = true;
      saveState();
      notify('move', 'Ahora muévete', 'Últimos 2 minutos: camina un poco antes de volver a sentarte.');
    }

    if (now >= state.phaseEnd) {
      if (state.phase === 'sit') onSitEnd(now);
      else onStandEnd(now);
    }
  }
  render();
}

// ---------- Interfaz ----------

let exerciseIdx = Math.floor(Math.random() * EXERCISES.length);

function pickExercise() {
  let next = exerciseIdx;
  while (EXERCISES.length > 1 && next === exerciseIdx) {
    next = Math.floor(Math.random() * EXERCISES.length);
  }
  exerciseIdx = next;
  renderExercise();
}

function renderExercise() {
  const [name, desc] = EXERCISES[exerciseIdx];
  $('exerciseName').textContent = name;
  $('exerciseDesc').textContent = desc;
}

function render() {
  const now = Date.now();
  const idle = state.phase === 'idle';
  const paused = state.pausedRemaining != null;
  const remaining = idle ? durations().sit * MIN : paused ? state.pausedRemaining : state.phaseEnd - now;
  const total = idle ? remaining : state.duration;

  document.body.classList.toggle('standing', state.phase === 'stand');

  let label;
  let hint;
  if (idle) {
    label = 'Listo para empezar';
    hint = 'Pulsa «Empezar» cuando te sientes a trabajar.';
  } else if (state.phase === 'sit') {
    label = 'Sentado';
    hint = 'Trabaja tranquilo. Te avisaremos cuando toque levantarse.';
  } else {
    label = '¡De pie!';
    hint = settings.preset === 'cornell' && remaining <= 2 * MIN
      ? 'Últimos minutos: camina y muévete.'
      : 'Levántate y muévete. Te avisaremos cuando puedas sentarte.';
  }
  if (paused) {
    label += state.autoPaused ? ' · fuera de horario' : ' · en pausa';
    if (state.autoPaused) hint = `Se reanudará a las ${settings.from}.`;
  }

  $('phaseLabel').textContent = label;
  $('phaseHint').textContent = hint;
  $('timeLeft').textContent = fmt(remaining);

  const frac = total > 0 ? Math.min(1, Math.max(0, remaining / total)) : 1;
  const ring = $('ringFg');
  ring.style.strokeDasharray = String(RING_LEN);
  ring.style.strokeDashoffset = String(RING_LEN * (1 - frac));

  $('exerciseBox').classList.toggle('hidden', !(state.phase === 'stand' && settings.exercises));

  $('startBtn').textContent = idle ? 'Empezar' : 'Reiniciar';
  $('pauseBtn').disabled = idle;
  $('pauseBtn').textContent = paused ? 'Reanudar' : 'Pausar';
  $('skipBtn').disabled = idle;
  $('skipBtn').textContent = state.phase === 'stand' ? 'Ya me siento' : 'Levantarme ya';
  $('stopBtn').disabled = idle;

  document.title = idle
    ? 'Levántate'
    : `${state.phase === 'stand' ? '▲ De pie' : '● Sentado'} ${fmt(remaining)}${paused ? ' (pausa)' : ''}`;

  renderStats();
}

function renderStats() {
  const t = history[dayKey()] || { breaks: 0, standMin: 0, skipped: 0 };
  $('statBreaks').textContent = t.breaks;
  $('statStand').textContent = t.standMin;
  $('statSkipped').textContent = t.skipped;
  const pct = Math.min(100, Math.round((t.breaks / settings.goal) * 100));
  $('statGoal').textContent = pct + '%';
  $('goalFill').style.width = pct + '%';
}

function renderWeek() {
  const days = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
  const items = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const rec = history[dayKey(d)];
    items.push({ label: days[d.getDay()], value: rec ? rec.breaks : 0, today: i === 0 });
  }
  const max = Math.max(settings.goal, ...items.map((x) => x.value));
  const chart = $('weekChart');
  chart.replaceChildren(...items.map((x) => {
    const col = document.createElement('div');
    col.className = 'week-col' + (x.today ? ' today' : '');
    col.title = `${x.value} pausas`;
    const val = document.createElement('span');
    val.className = 'week-val';
    val.textContent = x.value || '';
    const bar = document.createElement('div');
    bar.className = 'week-bar';
    bar.style.height = `${(x.value / max) * 70}%`;
    const lab = document.createElement('span');
    lab.className = 'week-day';
    lab.textContent = x.label;
    col.append(val, bar, lab);
    return col;
  }));
}

function renderPresets() {
  const wrap = $('presets');
  wrap.replaceChildren(...Object.entries(PRESETS).map(([id, p]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'preset';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(settings.preset === id));
    const name = document.createElement('span');
    name.className = 'preset-name';
    name.textContent = p.name;
    const vals = document.createElement('span');
    vals.className = 'preset-vals';
    vals.textContent = p.sit ? `${p.sit} min sentado · ${p.stand} min de pie` : 'Tus tiempos';
    b.append(name, vals);
    b.addEventListener('click', () => {
      settings.preset = id;
      saveSettings();
      renderPresets();
      render();
    });
    return b;
  }));
  const d = durations();
  $('sitInput').value = d.sit;
  $('standInput').value = d.stand;
  $('sitInput').disabled = settings.preset !== 'custom';
  $('standInput').disabled = settings.preset !== 'custom';
  let info = PRESETS[settings.preset].info;
  if (state.phase !== 'idle') info += ' Los cambios se aplican a partir de la siguiente fase.';
  $('presetInfo').textContent = info;
}

function renderPermission() {
  const show = !('Notification' in window) || Notification.permission !== 'granted';
  $('permNotice').classList.toggle('hidden', !show);
  $('permBtn').classList.toggle('hidden', !('Notification' in window) || Notification.permission === 'denied');
  if ('Notification' in window && Notification.permission === 'denied') {
    $('permNotice').firstChild.textContent =
      'Has bloqueado las notificaciones. Actívalas en los ajustes del sitio del navegador para recibir avisos con la pestaña en segundo plano. ';
  }
}

function bindSettings() {
  const toggles = {
    soundToggle: 'sound',
    vibrateToggle: 'vibrate',
    exerciseToggle: 'exercises',
    eyesToggle: 'eyes',
    hoursToggle: 'hoursOn',
    wakeToggle: 'wakeLock',
  };
  for (const [id, key] of Object.entries(toggles)) {
    const el = $(id);
    el.checked = !!settings[key];
    el.addEventListener('change', () => {
      settings[key] = el.checked;
      saveSettings();
      if (key === 'wakeLock') updateWakeLock();
      if (key === 'sound') $('soundBox').classList.toggle('hidden', !el.checked);
      if (key === 'hoursOn') $('hoursBox').classList.toggle('hidden', !el.checked);
      if (key === 'eyes' && state.phase === 'sit') {
        state.nextEyes = el.checked && state.phaseEnd - Date.now() > 20 * MIN ? Date.now() + 20 * MIN : null;
        saveState();
      }
      tick();
    });
  }
  $('hoursBox').classList.toggle('hidden', !settings.hoursOn);

  const soundSel = $('soundType');
  soundSel.replaceChildren(...Object.entries(SOUND_TYPES).map(([id, d]) => new Option(d.name, id)));
  soundSel.value = settings.soundType;
  $('repeatInput').value = String(settings.repeat);
  $('volumeInput').value = settings.volume;
  $('volumeVal').textContent = settings.volume + '%';
  $('soundBox').classList.toggle('hidden', !settings.sound);
  const preview = () => { unlockAudio(); playSound('stand', true); };
  soundSel.addEventListener('change', () => { settings.soundType = soundSel.value; saveSettings(); preview(); });
  $('repeatInput').addEventListener('change', (e) => { settings.repeat = Number(e.target.value); saveSettings(); });
  $('volumeInput').addEventListener('input', (e) => {
    settings.volume = Number(e.target.value);
    $('volumeVal').textContent = settings.volume + '%';
  });
  $('volumeInput').addEventListener('change', () => { saveSettings(); preview(); });
  $('soundTestBtn').addEventListener('click', preview);
  $('hoursFrom').value = settings.from;
  $('hoursTo').value = settings.to;
  for (const [id, key] of [['hoursFrom', 'from'], ['hoursTo', 'to']]) {
    $(id).addEventListener('change', (e) => {
      if (!e.target.value) return;
      settings[key] = e.target.value;
      saveSettings();
      tick();
    });
  }

  const clampInput = (el, min, max, key) => {
    el.addEventListener('change', () => {
      const v = Math.round(Number(el.value));
      settings[key] = Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : DEFAULT_SETTINGS[key];
      el.value = settings[key];
      saveSettings();
      render();
      renderWeek();
    });
  };
  clampInput($('sitInput'), 1, 180, 'sit');
  clampInput($('standInput'), 1, 60, 'stand');
  $('goalInput').value = settings.goal;
  clampInput($('goalInput'), 1, 30, 'goal');
}

function init() {
  pruneHistory();
  saveHistory();
  renderExercise();
  renderPresets();
  bindSettings();
  renderWeek();
  renderPermission();
  renderIosHelp();
  if (!('vibrate' in navigator)) $('vibrateToggle').closest('label').classList.add('hidden');
  if (!('wakeLock' in navigator)) $('wakeToggle').closest('label').classList.add('hidden');
  updateWakeLock();

  $('startBtn').addEventListener('click', () => { start(); renderPresets(); });
  $('pauseBtn').addEventListener('click', togglePause);
  $('skipBtn').addEventListener('click', skip);
  $('stopBtn').addEventListener('click', () => { stop(); renderPresets(); });
  $('nextExercise').addEventListener('click', pickExercise);
  $('permBtn').addEventListener('click', requestPermission);
  $('testBtn').addEventListener('click', async () => {
    unlockAudio();
    await requestPermission();
    notify('stand', '¡Levántate! (prueba)', 'Así se verán los avisos.');
  });
  document.addEventListener('pointerdown', unlockAudio, { once: true });

  // Al volver a la pestaña, actualiza al instante (los navegadores ralentizan los temporizadores en segundo plano).
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      if (audioCtx && audioCtx.state !== 'running') audioCtx.resume().catch(() => {});
      tick();
      renderWeek();
    }
    updateWakeLock();
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
    navigator.serviceWorker.ready.then((reg) => { swReg = reg; });
  }

  tick();
  render();
  setInterval(tick, 1000);

  let lastDay = dayKey();
  setInterval(() => {
    const k = dayKey();
    if (k !== lastDay) { lastDay = k; renderWeek(); renderStats(); }
  }, MIN);
}

init();
