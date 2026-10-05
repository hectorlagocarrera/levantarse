// Servidor de avisos de «Levántate» (Cloudflare Worker + Durable Objects).
// Guarda el ciclo de cada dispositivo y le envía una notificación push en cada cambio de fase,
// aunque el móvil esté bloqueado o la app cerrada.

import { DurableObject } from 'cloudflare:workers';
import { advance, nextEvent, hoursActive } from '../../schedule.js';
import { sendPush, generateVapidKeys } from './webpush.js';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const SUBJECT = 'https://hectorlagocarrera.github.io/levantarse/';
// Sin horario laboral, el servidor se detiene solo tras este tiempo por si se olvida pararlo.
const MAX_RUN_WITHOUT_HOURS = 14 * HOUR;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...cors } });

function messageFor(event, cfg) {
  const sit = Math.round(cfg.sitMs / MIN);
  const stand = Math.round(cfg.standMs / MIN);
  if (event === 'stand') {
    return { title: '¡Levántate!', body: `Llevas ${sit} min sentado. Ponte de pie y muévete ${stand} min.`, kind: 'stand' };
  }
  return { title: 'Ya puedes sentarte', body: `Pausa completada. Te avisaremos dentro de ${sit} min.`, kind: 'sit' };
}

function validSubscription(s, env) {
  const okScheme = (e) => e.startsWith('https://') || (env.DEV === '1' && e.startsWith('http://127.0.0.1'));
  return s && typeof s.endpoint === 'string' && okScheme(s.endpoint) && s.endpoint.length < 1000
    && s.keys && typeof s.keys.p256dh === 'string' && typeof s.keys.auth === 'string'
    && s.keys.p256dh.length < 200 && s.keys.auth.length < 100;
}

const isTime = (s) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

function validPlan(p) {
  if (!p || !p.state || !p.cfg) return false;
  const { state: st, cfg } = p;
  const okMs = (v, lo, hi) => Number.isFinite(v) && v >= lo && v <= hi;
  if (!okMs(cfg.sitMs, MIN, 180 * MIN) || !okMs(cfg.standMs, MIN, 60 * MIN)) return false;
  if (!['sit', 'stand'].includes(st.phase) || !Number.isFinite(st.phaseEnd) || !Number.isFinite(st.cursor)) return false;
  if (Math.abs(st.phaseEnd - Date.now()) > 8 * 24 * HOUR || Math.abs(st.cursor - Date.now()) > 8 * 24 * HOUR) return false;
  if (cfg.hours && cfg.hours.on) {
    if (!isTime(cfg.hours.from) || !isTime(cfg.hours.to) || typeof cfg.hours.tz !== 'string') return false;
    try { new Intl.DateTimeFormat('en-GB', { timeZone: cfg.hours.tz }); } catch { return false; }
  }
  return true;
}

// Claves VAPID del servidor: se generan una sola vez y se guardan.
export class Keys extends DurableObject {
  async getKeys() {
    let keys = await this.ctx.storage.get('vapid');
    if (!keys) {
      keys = await generateVapidKeys();
      await this.ctx.storage.put('vapid', keys);
    }
    return keys;
  }
}

async function vapidKeys(env) {
  const stub = env.KEYS.get(env.KEYS.idFromName('vapid'));
  return stub.getKeys();
}

// Un planificador por dispositivo (suscripción push).
export class Scheduler extends DurableObject {
  async schedule(subscription, plan) {
    await this.ctx.storage.put({ sub: subscription, plan: { ...plan, startedAt: plan.startedAt || Date.now() } });
    return this.rearm();
  }

  async test(subscription, delayMs) {
    await this.ctx.storage.put({ sub: subscription, testAt: Date.now() + delayMs });
    return this.rearm();
  }

  async cancel() {
    await this.ctx.storage.delete('plan');
    return this.rearm();
  }

  async rearm() {
    const now = Date.now();
    const [plan, testAt] = await Promise.all([this.ctx.storage.get('plan'), this.ctx.storage.get('testAt')]);
    const times = [];
    let next = null;
    if (plan) {
      next = nextEvent(plan.state, plan.cfg, now);
      if (next) times.push(next.at);
      if (!hoursActive(plan.cfg.hours)) times.push(plan.startedAt + MAX_RUN_WITHOUT_HOURS);
    }
    if (testAt) times.push(testAt);
    if (times.length) {
      await this.ctx.storage.setAlarm(Math.max(now, Math.min(...times)));
    } else {
      await this.ctx.storage.deleteAlarm();
      await this.ctx.storage.deleteAll();
    }
    return { next: next ? { at: next.at, event: next.event } : null };
  }

  async push(payload, topic) {
    const sub = await this.ctx.storage.get('sub');
    if (!sub) return;
    const keys = await vapidKeys(this.env);
    const status = await sendPush(sub, payload, { ...keys, subject: SUBJECT }, { topic });
    if (status === 404 || status === 410) {
      // La suscripción ya no existe (app desinstalada o permisos retirados).
      await this.ctx.storage.deleteAll();
      await this.ctx.storage.deleteAlarm();
      return false;
    }
    if (status >= 400) console.log('push rechazado', status);
    return true;
  }

  async alarm() {
    const now = Date.now();
    const testAt = await this.ctx.storage.get('testAt');
    if (testAt && testAt <= now) {
      await this.ctx.storage.delete('testAt');
      const ok = await this.push({ title: '¡Funciona!', body: 'Así te llegarán los avisos con el móvil bloqueado.', kind: 'test' }, 'test');
      if (ok === false) return;
    }

    const plan = await this.ctx.storage.get('plan');
    if (plan) {
      if (!hoursActive(plan.cfg.hours) && now >= plan.startedAt + MAX_RUN_WITHOUT_HOURS) {
        await this.ctx.storage.delete('plan');
        await this.push({ title: 'Temporizador detenido', body: 'Llevaba 14 horas en marcha. Abre la app para volver a empezar.', kind: 'stop' }, 'stop');
      } else {
        let last = null;
        plan.state = advance(plan.state, plan.cfg, now, (event, at) => { last = { event, at }; });
        await this.ctx.storage.put('plan', plan);
        // Si la alarma llega muy tarde, no se envían avisos viejos.
        if (last && now - last.at < 5 * MIN) {
          const ok = await this.push(messageFor(last.event, plan.cfg), 'fase');
          if (ok === false) return;
        }
      }
    }
    await this.rearm();
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    try {
      if (request.method === 'GET' && url.pathname === '/vapid') {
        const keys = await vapidKeys(env);
        return json({ publicKey: keys.publicKey });
      }
      if (request.method === 'GET' && url.pathname === '/') {
        return json({ ok: true, app: 'levantarse-push' });
      }
      if (request.method !== 'POST') return json({ error: 'not found' }, 404);

      const body = await request.json().catch(() => null);
      if (!body) return json({ error: 'JSON inválido' }, 400);

      if (url.pathname === '/cancel') {
        if (typeof body.endpoint !== 'string') return json({ error: 'endpoint' }, 400);
        const stub = env.SCHEDULER.get(env.SCHEDULER.idFromName(body.endpoint));
        return json(await stub.cancel());
      }

      if (!validSubscription(body.subscription, env)) return json({ error: 'suscripción inválida' }, 400);
      const stub = env.SCHEDULER.get(env.SCHEDULER.idFromName(body.subscription.endpoint));

      if (url.pathname === '/schedule') {
        if (!validPlan(body.plan)) return json({ error: 'plan inválido' }, 400);
        return json(await stub.schedule(body.subscription, body.plan));
      }
      if (url.pathname === '/test') {
        const delay = Math.min(60, Math.max(0, Number(body.delaySeconds) || 0)) * 1000;
        return json(await stub.test(body.subscription, delay));
      }
      return json({ error: 'not found' }, 404);
    } catch (err) {
      console.log('error', err && err.stack);
      return json({ error: 'error interno' }, 500);
    }
  },
};
