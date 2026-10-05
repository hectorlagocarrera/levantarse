// Genera un calendario (.ics) con un aviso para levantarse y otro para sentarse en cada ciclo.
// Las alertas del Calendario del iPhone llegan aunque esté bloqueado, sin servidor ni cuentas.
// Usa hora «flotante» (sin zona): el iPhone las interpreta en su hora local.

const pad = (n) => String(n).padStart(2, '0');
const esc = (t) => t.replace(/\\/g, '\\\\').replace(/[,;]/g, (c) => '\\' + c).replace(/\n/g, '\\n');

// Las líneas de un .ics no deben pasar de 75 bytes (RFC 5545): se parten con salto + espacio.
function fold(line) {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const parts = [];
  let cur = '';
  let len = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (len + n > (parts.length ? 74 : 75)) { parts.push(cur); cur = ''; len = 0; }
    cur += ch;
    len += n;
  }
  parts.push(cur);
  return parts.join('\r\n ');
}

function hhmm(s) {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
}

function stamp(d, minuteOfDay) {
  const day = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  return `${day}T${pad(Math.floor(minuteOfDay / 60))}${pad(minuteOfDay % 60)}00`;
}

function utcStamp(d) {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
}

// Primer día en que empiezan los avisos: hoy, o el próximo lunes si solo laborables y hoy es fin de semana.
function firstDay(weekdaysOnly, now) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  while (weekdaysOnly && (d.getDay() === 0 || d.getDay() === 6)) d.setDate(d.getDate() + 1);
  return d;
}

// Ciclos dentro del horario: [{ stand: minuto del día, sit: minuto del día }]
export function cycles({ sit, stand, from, to }) {
  const out = [];
  const end = hhmm(to);
  for (let t = hhmm(from); t + sit < end; t += sit + stand) {
    out.push({ stand: t + sit, sit: Math.min(t + sit + stand, end) });
  }
  return out;
}

export function buildIcs({ sit, stand, from, to, weekdaysOnly = true, now = new Date() }) {
  const day = firstDay(weekdaysOnly, now);
  const rrule = weekdaysOnly ? 'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' : 'RRULE:FREQ=DAILY';
  const dtstamp = utcStamp(now);
  const id = `${sit}-${stand}-${from.replace(':', '')}-${to.replace(':', '')}-${weekdaysOnly ? 'lv' : 'd'}`;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Levantate//Pausas activas//ES',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Levántate',
  ];
  const event = (uid, start, mins, summary, desc) => {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${uid}@levantarse`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART:${stamp(day, start)}`,
      `DURATION:PT${mins}M`,
      rrule,
      `SUMMARY:${esc(summary)}`,
      `DESCRIPTION:${esc(desc)}`,
      'TRANSP:TRANSPARENT',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${esc(summary)}`,
      'TRIGGER:PT0S',
      'END:VALARM',
      'END:VEVENT',
    );
  };
  cycles({ sit, stand, from, to }).forEach((c, i) => {
    event(`${id}-${i}-de-pie`, c.stand, stand, '🚶 ¡Levántate!',
      `Llevas ${sit} min sentado. Ponte de pie y muévete ${stand} min.`);
    event(`${id}-${i}-sentado`, c.sit, 1, '🪑 Ya puedes sentarte',
      `Pausa completada. Próximo aviso en ${sit} min.`);
  });
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
