import { advance, nextWindowStart } from './schedule.js';
import { PUSH_URL } from './config.js';
import { buildIcs, cycles } from './calendar.js';

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
  calFrom: '09:00',
  calTo: '18:00',
  calWeekdays: true,
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
// running: temporizador en marcha. phase: 'sit' | 'stand'. off: fuera de horario. paused: ms restantes si está en pausa.
const IDLE_STATE = {
  running: false,
  phase: 'sit',
  phaseEnd: 0,
  cursor: 0,
  duration: 0,
  off: false,
  paused: null,
  startedAt: 0,
  nextEyes: null,
  moveAlerted: false,
};
let state = { ...IDLE_STATE, ...load(KEYS.state, {}) };
if (typeof state.running !== 'boolean') state = { ...IDLE_STATE }; // estado de una versión anterior
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
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

const clock = (t) => new Date(t).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

function durations() {
  if (settings.preset === 'custom') return { sit: settings.sit, stand: settings.stand };
  const p = PRESETS[settings.preset];
  return { sit: p.sit, stand: p.stand };
}

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

// Configuración del ciclo en el formato que comparten la app y el servidor (schedule.js).
function cycleCfg() {
  const d = durations();
  return {
    sitMs: d.sit * MIN,
    standMs: d.stand * MIN,
    hours: { on: settings.hoursOn, from: settings.from, to: settings.to, tz: TZ },
  };
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
  // Con el servidor activo, esas notificaciones ya llegan por push: evita duplicarlas.
  if (pushSub && (kind === 'stand' || kind === 'sit')) return;
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
  const want = settings.wakeLock && state.running && !document.hidden;
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

// ---------- Avisos con el móvil bloqueado (servidor push) ----------

let pushSub = null;
let pushStatus = 'checking';
let pushNext = null;
let syncTimer = null;

function b64ToBytes(s) {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

async function api(path, body) {
  const res = await fetch(PUSH_URL + path, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

// interactive: se llama desde un botón, así que puede pedir permiso y crear la suscripción.
async function ensurePush(interactive) {
  if (!PUSH_URL) { pushStatus = 'unconfigured'; renderPush(); return null; }
  if (!pushSupported()) {
    pushStatus = IS_IOS && !IS_STANDALONE ? 'needs-install' : 'unsupported';
    renderPush();
    return null;
  }
  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub && interactive && Notification.permission === 'granted') {
      const { publicKey } = await api('/vapid');
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
    }
    pushSub = sub;
    pushStatus = sub ? 'on' : Notification.permission === 'denied' ? 'denied' : 'off';
  } catch (err) {
    console.warn('push', err);
    pushStatus = Notification.permission === 'denied' ? 'denied' : 'error';
  }
  renderPush();
  return pushSub;
}

// Envía al servidor el estado actual para que programe los avisos (o los cancele).
function syncPush() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(async () => {
    if (!pushSub) return;
    try {
      if (state.running && state.paused == null) {
        const { phase, phaseEnd, off, cursor, duration } = state;
        const r = await api('/schedule', {
          subscription: pushSub.toJSON(),
          plan: { state: { phase, phaseEnd, off, cursor, duration }, cfg: cycleCfg(), startedAt: state.startedAt },
        });
        pushNext = r.next;
      } else {
        await api('/cancel', { endpoint: pushSub.endpoint });
        pushNext = null;
      }
      pushStatus = 'on';
    } catch (err) {
      console.warn('sync', err);
      pushStatus = 'error';
    }
    renderPush();
  }, 300);
}

async function testPush() {
  unlockAudio();
  await requestPermission();
  const sub = await ensurePush(true);
  if (!sub) return;
  try {
    await api('/test', { subscription: sub.toJSON(), delaySeconds: 10 });
    $('pushStatus').textContent = 'Bloquea el móvil ahora: el aviso de prueba llegará en 10 segundos.';
  } catch {
    pushStatus = 'error';
    renderPush();
  }
}

function renderPush() {
  const msgs = {
    checking: 'Comprobando…',
    unconfigured: 'El servidor de avisos aún no está configurado. Mientras tanto, deja la app abierta en primer plano.',
    'needs-install': 'Para recibirlos en iPhone, añade la app a la pantalla de inicio (Compartir → Añadir a pantalla de inicio) y ábrela desde allí.',
    unsupported: 'Este navegador no admite notificaciones push. Deja la app abierta en primer plano.',
    denied: 'Has bloqueado las notificaciones. Actívalas en Ajustes del iPhone → Notificaciones → Levántate.',
    off: 'Desactivados. Pulsa «Empezar» o «Probar» y acepta las notificaciones.',
    error: 'No se pudo contactar con el servidor de avisos. Se reintentará; mientras, deja la app abierta.',
  };
  let text = msgs[pushStatus];
  if (pushStatus === 'on') {
    text = '✓ Activados: te llegarán aunque el móvil esté bloqueado.';
    if (state.running && state.paused == null && pushNext) {
      text += ` Próximo aviso a las ${clock(pushNext.at)}.`;
    }
  }
  $('pushStatus').textContent = text;
  $('pushBox').classList.toggle('push-on', pushStatus === 'on');
  $('pushTestBtn').classList.toggle('hidden', ['unconfigured', 'unsupported', 'needs-install', 'denied'].includes(pushStatus));
}

// ---------- Lógica del temporizador ----------

function startPhase(phase, at = Date.now()) {
  const d = durations();
  const dur = (phase === 'sit' ? d.sit : d.stand) * MIN;
  Object.assign(state, {
    phase, cursor: at, duration: dur, phaseEnd: at + dur, off: false, paused: null, moveAlerted: false,
  });
  resetEyes();
  if (phase === 'stand') pickExercise();
}

function resetEyes() {
  state.nextEyes = state.phase === 'sit' && !state.off && settings.eyes && state.duration > 20 * MIN
    ? state.cursor + 20 * MIN : null;
}

function changed() {
  saveState();
  updateWakeLock();
  syncPush();
  render();
}

async function start() {
  unlockAudio();
  const perm = requestPermission(); // primero, para que iOS lo asocie al toque
  const now = Date.now();
  state.running = true;
  state.startedAt = now;
  startPhase('sit', now);
  tick();
  changed();
  await perm;
  if (await ensurePush(true)) syncPush();
}

function stop() {
  state = { ...IDLE_STATE };
  changed();
}

function togglePause() {
  unlockAudio();
  const now = Date.now();
  if (state.paused != null) {
    const shift = now - (state.phaseEnd - state.paused);
    state.phaseEnd = now + state.paused;
    state.cursor = now;
    if (state.nextEyes) state.nextEyes += shift;
    state.paused = null;
  } else {
    state.paused = Math.max(0, state.phaseEnd - now);
  }
  changed();
}

function skip() {
  unlockAudio();
  if (state.phase === 'sit') {
    startPhase('stand');
  } else {
    today().skipped += 1;
    saveHistory();
    startPhase('sit');
  }
  changed();
}

function alertFor(kind) {
  if (kind === 'stand') {
    notify('stand', '¡Levántate!', `Llevas ${durations().sit} min sentado. Ponte de pie y muévete ${Math.round(state.duration / MIN)} min.`);
  } else {
    const t = today();
    const msg = t.breaks >= settings.goal
      ? `¡Objetivo diario cumplido! Llevas ${t.breaks} pausas hoy.`
      : `Pausa ${t.breaks} de ${settings.goal}. Te avisaremos dentro de ${durations().sit} min.`;
    notify('sit', 'Ya puedes sentarte', msg);
  }
}

function tick() {
  const now = Date.now();
  if (!state.running || state.paused != null) { render(); return; }

  // Avanza por todas las fases que hayan terminado (también si el móvil estuvo bloqueado).
  const cfg = cycleCfg();
  const prevCursor = state.cursor;
  let last = null;
  const next = advance(state, cfg, now, (event, at) => {
    last = { event, at };
    if (event === 'sit') {
      const t = today();
      t.breaks += 1;
      t.standMin += Math.round(cfg.standMs / MIN);
      saveHistory();
    }
  });
  if (next !== state) {
    const { phase, phaseEnd, off, cursor, duration } = next;
    Object.assign(state, { phase, phaseEnd, off, cursor, duration });
    if (state.cursor !== prevCursor) {
      state.moveAlerted = false;
      resetEyes();
      if (state.phase === 'stand') pickExercise();
      renderWeek();
    }
    saveState();
    // Solo suena si el cambio acaba de ocurrir, no al volver horas después.
    if (last && now - last.at < 90 * 1000) alertFor(last.event);
  }

  if (!state.off) {
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
  const idle = !state.running;
  const paused = state.paused != null;
  const off = state.running && state.off;
  const resumeAt = off ? nextWindowStart(now, cycleCfg().hours) : 0;
  let remaining;
  if (idle) remaining = durations().sit * MIN;
  else if (paused) remaining = state.paused;
  else if (off) remaining = resumeAt - now;
  else remaining = state.phaseEnd - now;
  const total = idle || off ? remaining : state.duration;

  document.body.classList.toggle('standing', state.running && !off && state.phase === 'stand');

  let label;
  let hint;
  if (idle) {
    label = 'Listo para empezar';
    hint = 'Pulsa «Empezar» cuando te sientes a trabajar.';
  } else if (off) {
    label = 'Fuera de horario';
    hint = `Volverá a empezar a las ${clock(resumeAt)}.`;
  } else if (state.phase === 'sit') {
    label = 'Sentado';
    hint = 'Trabaja tranquilo. Te avisaremos cuando toque levantarse.';
  } else {
    label = '¡De pie!';
    hint = settings.preset === 'cornell' && remaining <= 2 * MIN
      ? 'Últimos minutos: camina y muévete.'
      : 'Levántate y muévete. Te avisaremos cuando puedas sentarte.';
  }
  if (paused) label += ' · en pausa';

  $('phaseLabel').textContent = label;
  $('phaseHint').textContent = hint;
  $('timeLeft').textContent = fmt(remaining);

  const frac = total > 0 ? Math.min(1, Math.max(0, remaining / total)) : 1;
  const ring = $('ringFg');
  ring.style.strokeDasharray = String(RING_LEN);
  ring.style.strokeDashoffset = String(RING_LEN * (1 - frac));

  $('exerciseBox').classList.toggle('hidden', !(state.running && !off && state.phase === 'stand' && settings.exercises));

  $('startBtn').textContent = idle ? 'Empezar' : 'Reiniciar';
  $('pauseBtn').disabled = idle || off;
  $('pauseBtn').textContent = paused ? 'Reanudar' : 'Pausar';
  $('skipBtn').disabled = idle || off;
  $('skipBtn').textContent = state.phase === 'stand' ? 'Ya me siento' : 'Levantarme ya';
  $('stopBtn').disabled = idle;

  document.title = idle || off
    ? 'Levántate'
    : `${state.phase === 'stand' ? '▲ De pie' : '● Sentado'} ${fmt(remaining)}${paused ? ' (pausa)' : ''}`;
  renderPush();

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
      syncPush();
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
  if (state.running) info += ' Los cambios se aplican a partir de la siguiente fase.';
  $('presetInfo').textContent = info;
  if ($('calSummary')) renderCalendar();
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
      if (key === 'eyes' && state.running && state.phase === 'sit') {
        state.nextEyes = el.checked && state.phaseEnd - Date.now() > 20 * MIN ? Date.now() + 20 * MIN : null;
        saveState();
      }
      if (key === 'hoursOn') syncPush();
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
      syncPush();
      tick();
    });
  }

  const clampInput = (el, min, max, key) => {
    el.addEventListener('change', () => {
      const v = Math.round(Number(el.value));
      settings[key] = Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : DEFAULT_SETTINGS[key];
      el.value = settings[key];
      saveSettings();
      if (key !== 'goal') syncPush();
      render();
      renderCalendar();
      renderWeek();
    });
  };
  clampInput($('sitInput'), 1, 180, 'sit');
  clampInput($('standInput'), 1, 60, 'stand');
  $('goalInput').value = settings.goal;
  clampInput($('goalInput'), 1, 30, 'goal');
}

// ---------- Calendario ----------

function calOptions() {
  const d = durations();
  return { sit: d.sit, stand: d.stand, from: settings.calFrom, to: settings.calTo, weekdaysOnly: settings.calWeekdays };
}

function renderCalendar() {
  const n = cycles(calOptions()).length;
  const d = durations();
  $('calSummary').textContent = n
    ? `${n} pausas al día (${d.sit} min sentado / ${d.stand} min de pie), ${settings.calWeekdays ? 'de lunes a viernes' : 'todos los días'}.`
    : 'El horario es demasiado corto para esta pauta.';
  $('calBtn').disabled = n === 0;
}

function downloadCalendar() {
  const ics = buildIcs(calOptions());
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
  if (IS_IOS) {
    // Safari en iPhone abre el calendario directamente y ofrece «Añadir todo».
    window.location.href = url;
  } else {
    const a = document.createElement('a');
    a.href = url;
    a.download = 'levantate.ics';
    document.body.append(a);
    a.click();
    a.remove();
  }
  setTimeout(() => URL.revokeObjectURL(url), 60 * 1000);
}

function bindCalendar() {
  $('calFrom').value = settings.calFrom;
  $('calTo').value = settings.calTo;
  $('calWeekdays').checked = settings.calWeekdays;
  for (const [id, key] of [['calFrom', 'calFrom'], ['calTo', 'calTo']]) {
    $(id).addEventListener('change', (e) => {
      if (!e.target.value) return;
      settings[key] = e.target.value;
      saveSettings();
      renderCalendar();
    });
  }
  $('calWeekdays').addEventListener('change', (e) => {
    settings.calWeekdays = e.target.checked;
    saveSettings();
    renderCalendar();
  });
  $('calBtn').addEventListener('click', downloadCalendar);
  renderCalendar();
}

function init() {
  pruneHistory();
  saveHistory();
  renderExercise();
  renderPresets();
  bindSettings();
  bindCalendar();
  renderWeek();
  renderPermission();
  renderIosHelp();
  if (!('vibrate' in navigator)) $('vibrateToggle').closest('label').classList.add('hidden');
  if (!('wakeLock' in navigator)) $('wakeToggle').closest('label').classList.add('hidden');
  updateWakeLock();
  ensurePush(false).then((sub) => { if (sub && state.running) syncPush(); });

  $('startBtn').addEventListener('click', () => { start(); renderPresets(); });
  $('pushTestBtn').addEventListener('click', testPush);
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
      if (pushSub) syncPush();
    }
    updateWakeLock();
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
    navigator.serviceWorker.ready.then((reg) => { swReg = reg; });
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data && e.data.type === 'push') tick();
    });
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
