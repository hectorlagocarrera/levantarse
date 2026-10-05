// Genera los calendarios ya hechos de calendarios/: node scripts/generar-calendarios.mjs
import { writeFileSync } from 'node:fs';
import { buildIcs } from '../calendar.js';

const now = new Date(2026, 9, 5, 8, 0); // lunes 5 oct 2026: fecha fija para que el archivo no cambie
const presets = { recomendado: [30, 5], cornell: [20, 10], minimo: [50, 10] };
for (const [name, [sit, stand]] of Object.entries(presets)) {
  const ics = buildIcs({ sit, stand, from: '09:00', to: '18:00', weekdaysOnly: true, now });
  writeFileSync(new URL(`../calendarios/${name}-9-18-lv.ics`, import.meta.url), ics);
  console.log(name, (ics.match(/BEGIN:VEVENT/g) || []).length, 'avisos al día');
}
