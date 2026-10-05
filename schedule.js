// Lógica del ciclo sentado/de pie, compartida por la app y el servidor de avisos.
// Ambos calculan las mismas fechas a partir del mismo estado, así que van sincronizados
// aunque el móvil esté bloqueado.
//
// Estado: { phase: 'sit' | 'stand', phaseEnd, off, cursor, duration }
//   off    -> fuera del horario laboral (en espera hasta el siguiente inicio de jornada)
//   cursor -> momento desde el que el estado es válido
// Config: { sitMs, standMs, hours: { on, from: 'HH:MM', to: 'HH:MM', tz } }

const MINUTE = 60 * 1000;
const DAY_MIN = 24 * 60;
const formatters = new Map();

function minuteOfDay(t, tz) {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    formatters.set(tz, f);
  }
  const parts = f.formatToParts(new Date(t));
  const h = Number(parts.find((p) => p.type === 'hour').value);
  const m = Number(parts.find((p) => p.type === 'minute').value);
  return h * 60 + m;
}

function hhmm(s) {
  const [h, m] = String(s).split(':').map(Number);
  return h * 60 + m;
}

const floorMinute = (t) => t - (t % MINUTE);

export function hoursActive(hours) {
  return !!(hours && hours.on && hhmm(hours.from) !== hhmm(hours.to));
}

export function inWindow(t, hours) {
  if (!hoursActive(hours)) return true;
  const now = minuteOfDay(t, hours.tz);
  const from = hhmm(hours.from);
  const to = hhmm(hours.to);
  return from <= to ? now >= from && now < to : now >= from || now < to;
}

// t dentro de horario -> fin de esa jornada.
function windowEnd(t, hours) {
  const d = (hhmm(hours.to) - minuteOfDay(t, hours.tz) + DAY_MIN) % DAY_MIN || DAY_MIN;
  return floorMinute(t) + d * MINUTE;
}

// t fuera de horario -> siguiente inicio de jornada.
export function nextWindowStart(t, hours) {
  const d = (hhmm(hours.from) - minuteOfDay(t, hours.tz) + DAY_MIN) % DAY_MIN || DAY_MIN;
  return floorMinute(t) + d * MINUTE;
}

// Siguiente cambio de estado. event: 'stand' (toca levantarse), 'sit' (puedes sentarte) o null.
export function step(st, cfg) {
  if (hoursActive(cfg.hours)) {
    if (st.off) {
      const s = inWindow(st.cursor, cfg.hours) ? st.cursor : nextWindowStart(st.cursor, cfg.hours);
      return {
        at: s,
        event: null,
        state: { phase: 'sit', phaseEnd: s + cfg.sitMs, off: false, cursor: s, duration: cfg.sitMs },
      };
    }
    if (!inWindow(st.cursor, cfg.hours)) {
      return { at: st.cursor, event: null, state: { ...st, off: true } };
    }
    const we = windowEnd(st.cursor, cfg.hours);
    if (we <= st.phaseEnd) {
      return { at: we, event: null, state: { ...st, off: true, cursor: we } };
    }
  }
  const next = st.phase === 'sit' ? 'stand' : 'sit';
  const d = next === 'sit' ? cfg.sitMs : cfg.standMs;
  return {
    at: st.phaseEnd,
    event: next,
    state: { phase: next, phaseEnd: st.phaseEnd + d, off: false, cursor: st.phaseEnd, duration: d },
  };
}

// Avanza el estado hasta `now`, llamando a onEvent(event, at, state) en cada aviso.
export function advance(st, cfg, now, onEvent) {
  for (let i = 0; i < 100000; i++) {
    const r = step(st, cfg);
    if (r.at > now) return st;
    st = r.state;
    if (r.event && onEvent) onEvent(r.event, r.at, st);
  }
  return st;
}

// Primer momento futuro en que habrá un aviso (o null si no hay ninguno en una semana).
export function nextEvent(st, cfg, now) {
  st = advance(st, cfg, now);
  const limit = now + 8 * DAY_MIN * MINUTE;
  for (let i = 0; i < 100000; i++) {
    const r = step(st, cfg);
    if (r.at > limit) return null;
    if (r.event) return { at: r.at, event: r.event, state: r.state };
    st = r.state;
  }
  return null;
}
