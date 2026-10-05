// Pruebas de la lógica de ciclos: node worker/test/schedule.test.mjs
import assert from 'node:assert/strict';
import { step, advance, nextEvent, inWindow } from '../../schedule.js';

const MIN = 60000;
const tz = 'Europe/Madrid';
const t = (iso) => Date.parse(iso);
const cfg = { sitMs: 30 * MIN, standMs: 5 * MIN, hours: { on: false } };

// Ciclo simple: 30 sentado -> aviso levantarse -> 5 de pie -> aviso sentarse.
let st = { phase: 'sit', phaseEnd: t('2026-10-05T08:30:00Z'), off: false, cursor: t('2026-10-05T08:00:00Z') };
let r = step(st, cfg);
assert.equal(r.event, 'stand');
assert.equal(r.at, t('2026-10-05T08:30:00Z'));
r = step(r.state, cfg);
assert.equal(r.event, 'sit');
assert.equal(r.at, t('2026-10-05T08:35:00Z'));

// advance cuenta todos los avisos pasados.
const evs = [];
advance(st, cfg, t('2026-10-05T10:00:00Z'), (e, at) => evs.push([e, new Date(at).toISOString()]));
assert.deepEqual(evs.map((x) => x[0]), ['stand', 'sit', 'stand', 'sit', 'stand', 'sit']);

// Horario 09:00-18:00 Madrid (UTC+2 en octubre): 07:00Z-16:00Z.
const hcfg = { ...cfg, hours: { on: true, from: '09:00', to: '18:00', tz } };
assert.equal(inWindow(t('2026-10-05T07:00:00Z'), hcfg.hours), true);
assert.equal(inWindow(t('2026-10-05T16:00:00Z'), hcfg.hours), false);

// Fase que acabaría después de las 18:00 -> pasa a fuera de horario a las 18:00 sin aviso.
st = { phase: 'sit', phaseEnd: t('2026-10-05T16:10:00Z'), off: false, cursor: t('2026-10-05T15:40:00Z') };
r = step(st, hcfg);
assert.equal(r.event, null);
assert.equal(r.state.off, true);
assert.equal(r.at, t('2026-10-05T16:00:00Z'));

// Siguiente aviso: al día siguiente 09:30 Madrid (07:30Z).
let n = nextEvent(st, hcfg, t('2026-10-05T15:41:00Z'));
assert.equal(n.event, 'stand');
assert.equal(new Date(n.at).toISOString(), '2026-10-06T07:30:00.000Z');

// Empezado de madrugada (fuera de horario) -> primer aviso a las 09:30.
st = { phase: 'sit', phaseEnd: t('2026-10-05T03:30:00Z'), off: false, cursor: t('2026-10-05T03:00:00Z') };
n = nextEvent(st, hcfg, t('2026-10-05T03:00:00Z'));
assert.equal(new Date(n.at).toISOString(), '2026-10-05T07:30:00.000Z');

// Horario nocturno que cruza la medianoche 22:00-06:00.
const night = { ...cfg, hours: { on: true, from: '22:00', to: '06:00', tz } };
assert.equal(inWindow(t('2026-10-05T21:00:00Z'), night.hours), true); // 23:00 local
assert.equal(inWindow(t('2026-10-05T10:00:00Z'), night.hours), false);

// Cambio de hora (25 oct 2026, Madrid pasa a UTC+1): jornada empieza 09:00 local = 08:00Z.
st = { phase: 'sit', phaseEnd: t('2026-10-23T16:10:00Z'), off: false, cursor: t('2026-10-23T15:59:00Z') };
n = nextEvent(st, hcfg, t('2026-10-24T20:00:00Z'));
assert.equal(new Date(n.at).toISOString(), '2026-10-25T08:30:00.000Z');

// from == to se trata como sin horario.
const same = { ...cfg, hours: { on: true, from: '09:00', to: '09:00', tz } };
assert.equal(step({ phase: 'sit', phaseEnd: 5, off: false, cursor: 0 }, same).event, 'stand');

console.log('schedule: OK');
