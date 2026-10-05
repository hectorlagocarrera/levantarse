// Presupuestos: crear presupuestos y recuperar precios anteriores por cliente y material.
// Los datos viven en el navegador (localStorage) y se completan con datos.json del repositorio.
(() => {
  const { parseNum, normalize, matches, parseBudgetText } = window.Parser;
  const $ = (id) => document.getElementById(id);
  const KEY = 'presupuestos-v1';

  // ---------- Datos ----------

  const DEFAULT_AJUSTES = { nombre: '', cif: '', direccion: '', contacto: '', iva: 21, validez: '30 días', condiciones: '' };
  let db = { presupuestos: [], borrados: [], ajustes: { ...DEFAULT_AJUSTES } };

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        db = { ...db, ...saved, ajustes: { ...DEFAULT_AJUSTES, ...(saved.ajustes || {}) } };
      }
    } catch { /* sin almacenamiento: se trabaja en memoria */ }
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(db)); return true; } catch { return false; }
  }

  // Añade presupuestos nuevos (por id) sin pisar los que ya existen ni revivir los borrados.
  function merge(list) {
    const have = new Set(db.presupuestos.map((p) => p.id));
    const gone = new Set(db.borrados);
    let added = 0;
    for (const p of list || []) {
      if (!p || !p.id || have.has(p.id) || gone.has(p.id)) continue;
      db.presupuestos.push(cleanBudget(p));
      have.add(p.id);
      added++;
    }
    return added;
  }

  function cleanBudget(p) {
    return {
      id: p.id,
      numero: p.numero || '',
      fecha: p.fecha || '',
      cliente: (p.cliente || '').trim(),
      notas: p.notas || '',
      iva: p.iva == null ? 21 : Number(p.iva),
      origen: p.origen || '',
      lineas: (p.lineas || []).map((l) => ({
        concepto: (l.concepto || '').trim(),
        cantidad: Number(l.cantidad) || 0,
        precio: Number(l.precio) || 0,
        descuento: Number(l.descuento) || 0,
      })),
    };
  }

  async function loadSeed() {
    try {
      const res = await fetch('datos.json', { cache: 'no-cache' });
      if (!res.ok) return;
      const data = await res.json();
      if (merge(data.presupuestos || data)) { save(); refreshAll(); }
    } catch { /* sin datos.json o sin conexión */ }
  }

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const today = () => new Date().toISOString().slice(0, 10);
  const byDateDesc = (a, b) => (b.fecha || '').localeCompare(a.fecha || '');

  // ---------- Formato ----------

  const money = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });
  const numFmt = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 4 });
  const fmtMoney = (n) => money.format(n || 0);
  const fmtNum = (n) => numFmt.format(n || 0);
  function fmtDate(iso) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  }
  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  const importe = (l) => (l.cantidad || 0) * (l.precio || 0) * (1 - (l.descuento || 0) / 100);
  function totals(p) {
    const base = p.lineas.reduce((s, l) => s + importe(l), 0);
    const iva = base * (Number(p.iva) || 0) / 100;
    return { base, iva, total: base + iva };
  }

  // ---------- Pestañas ----------

  function showTab(name) {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
    document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('hidden', p.id !== 'tab-' + name));
    window.scrollTo(0, 0);
  }
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));

  function refreshLists() {
    const clientes = [...new Set(db.presupuestos.map((p) => p.cliente).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
    $('clientes').innerHTML = clientes.map((c) => `<option value="${esc(c)}">`).join('');
    const conceptos = new Map();
    for (const p of db.presupuestos) for (const l of p.lineas) if (l.concepto) conceptos.set(normalize(l.concepto), l.concepto);
    $('conceptos').innerHTML = [...conceptos.values()].sort((a, b) => a.localeCompare(b, 'es')).map((c) => `<option value="${esc(c)}">`).join('');
  }

  function refreshAll() {
    refreshLists();
    renderSearch();
    renderList();
  }

  // ---------- Buscar precios ----------

  // Todas las líneas que coinciden, de la más reciente a la más antigua.
  function findLines(cliente, material) {
    const hits = [];
    for (const p of db.presupuestos) {
      if (cliente && !matches(p.cliente, cliente)) continue;
      p.lineas.forEach((l, i) => {
        if (material && !matches(l.concepto, material)) return;
        hits.push({ p, l, i });
      });
    }
    return hits.sort((a, b) => byDateDesc(a.p, b.p));
  }

  function renderSearch() {
    const cliente = $('qCliente').value.trim();
    const material = $('qMaterial').value.trim();
    const hits = findLines(cliente, material);
    $('qVacio').classList.toggle('hidden', db.presupuestos.length > 0);
    $('qResultados').innerHTML = hits.slice(0, 300).map(({ p, l, i }) => `
      <tr>
        <td>${fmtDate(p.fecha)}</td>
        <td>${esc(p.cliente)}</td>
        <td><a href="#" data-open="${esc(p.id)}">${esc(p.numero || '—')}</a></td>
        <td>${esc(l.concepto)}</td>
        <td class="num">${fmtNum(l.cantidad)}</td>
        <td class="num"><strong>${fmtMoney(l.precio)}</strong>${l.descuento ? ` <span class="muted">−${fmtNum(l.descuento)}%</span>` : ''}</td>
        <td><button class="btn small" data-use="${esc(p.id)}:${i}" title="Añadir esta línea al presupuesto que estás haciendo">Usar</button></td>
      </tr>`).join('');

    if ((cliente || material) && hits.length) {
      const precios = hits.map((h) => h.l.precio);
      const last = hits[0];
      $('qResumen').innerHTML = `
        <div><span>Último precio</span><strong>${fmtMoney(last.l.precio)}</strong><small>${fmtDate(last.p.fecha)} · ${esc(last.p.cliente)}</small></div>
        <div><span>Mínimo</span><strong>${fmtMoney(Math.min(...precios))}</strong></div>
        <div><span>Máximo</span><strong>${fmtMoney(Math.max(...precios))}</strong></div>
        <div><span>Veces</span><strong>${hits.length}</strong></div>`;
    } else {
      $('qResumen').innerHTML = (cliente || material) ? '<p class="muted">Sin coincidencias.</p>' : '';
    }
  }
  $('qCliente').addEventListener('input', renderSearch);
  $('qMaterial').addEventListener('input', renderSearch);

  $('qResultados').addEventListener('click', (e) => {
    const open = e.target.closest('[data-open]');
    if (open) { e.preventDefault(); openBudget(open.dataset.open); return; }
    const use = e.target.closest('[data-use]');
    if (!use) return;
    const [id, i] = use.dataset.use.split(':');
    const p = db.presupuestos.find((x) => x.id === id);
    const l = p.lineas[+i];
    // Si el editor tiene un presupuesto guardado abierto, empieza uno nuevo.
    if (draft.id && db.presupuestos.some((x) => x.id === draft.id)) newDraft();
    if (!draft.cliente) draft.cliente = p.cliente;
    draft.lineas = draft.lineas.filter((x) => x.concepto || x.precio);
    draft.lineas.push({ concepto: l.concepto, cantidad: l.cantidad, precio: l.precio, descuento: l.descuento });
    renderEditor();
    showTab('editor');
  });

  // ---------- Editor ----------

  let draft;

  function nextNumber(fecha) {
    const year = (fecha || today()).slice(0, 4);
    let max = 0;
    for (const p of db.presupuestos) {
      const m = String(p.numero || '').match(new RegExp(`^${year}[-/](\\d+)$`));
      if (m) max = Math.max(max, +m[1]);
    }
    return `${year}-${String(max + 1).padStart(3, '0')}`;
  }

  function newDraft(base = {}) {
    const fecha = base.fecha || today();
    draft = cleanBudget({
      id: uid(),
      fecha,
      numero: base.numero ?? nextNumber(fecha),
      cliente: base.cliente || '',
      notas: base.notas ?? db.ajustes.condiciones,
      iva: base.iva ?? db.ajustes.iva,
      origen: base.origen || '',
      lineas: base.lineas && base.lineas.length ? base.lineas : [{}],
    });
    draft.textoPdf = base.textoPdf || '';
    renderEditor();
  }

  function openBudget(id) {
    const p = db.presupuestos.find((x) => x.id === id);
    if (!p) return;
    draft = cleanBudget(JSON.parse(JSON.stringify(p)));
    renderEditor();
    showTab('editor');
  }

  // Precio anterior para una línea: primero al mismo cliente, si no a cualquiera.
  function previousPrice(concepto) {
    if (normalize(concepto).length < 3) return null;
    const isSelf = (p) => p.id === draft.id;
    const same = (h) => normalize(h.l.concepto) === normalize(concepto);
    const all = findLines('', concepto).filter((h) => !isSelf(h.p));
    const own = all.filter((h) => normalize(h.p.cliente) === normalize(draft.cliente));
    const pick = own.find(same) || own[0] || all.find(same) || all[0];
    return pick ? { ...pick, mismoCliente: own.includes(pick) } : null;
  }

  function hintHtml(l, i) {
    const h = previousPrice(l.concepto);
    if (!h) return '';
    const quien = h.mismoCliente ? 'a este cliente' : `a ${esc(h.p.cliente)}`;
    const igual = Math.abs(h.l.precio - l.precio) < 0.005;
    return `<div class="hint">Último precio ${quien}: <strong>${fmtMoney(h.l.precio)}</strong>
      (${fmtDate(h.p.fecha)}${h.p.numero ? ', nº ' + esc(h.p.numero) : ''}${normalize(h.l.concepto) !== normalize(l.concepto) ? ' · «' + esc(h.l.concepto) + '»' : ''})
      ${igual ? '' : `<button class="btn small" data-price="${i}" data-value="${h.l.precio}">Usar</button>`}</div>`;
  }

  function renderEditor() {
    const saved = db.presupuestos.some((p) => p.id === draft.id);
    $('edTitulo').textContent = saved ? `Presupuesto ${draft.numero || ''}` : 'Nuevo presupuesto';
    $('edCliente').value = draft.cliente;
    $('edNumero').value = draft.numero;
    $('edFecha').value = draft.fecha;
    $('edNotas').value = draft.notas;
    $('edIva').value = draft.iva;
    $('edOrigen').classList.toggle('hidden', !draft.origen);
    $('edOrigen').textContent = draft.origen ? `Importado de ${draft.origen}. Revisa los datos antes de guardar.` : '';
    $('edTexto').classList.toggle('hidden', !draft.textoPdf);
    $('edTextoPdf').textContent = draft.textoPdf || '';
    $('edMsg').textContent = '';
    renderLines();
  }

  function renderLines() {
    $('edLineas').innerHTML = draft.lineas.map((l, i) => `
      <tr data-i="${i}">
        <td class="concept"><input data-f="concepto" list="conceptos" value="${esc(l.concepto)}" placeholder="Material o servicio">
          <div class="hint-slot">${hintHtml(l, i)}</div></td>
        <td class="num"><input data-f="cantidad" inputmode="decimal" value="${l.cantidad ? fmtNum(l.cantidad) : ''}"></td>
        <td class="num"><input data-f="precio" inputmode="decimal" value="${l.precio ? fmtNum(l.precio) : ''}"></td>
        <td class="num"><input data-f="descuento" inputmode="decimal" value="${l.descuento ? fmtNum(l.descuento) : ''}"></td>
        <td class="num importe">${fmtMoney(importe(l))}</td>
        <td><button class="btn small ghost" data-del="${i}" title="Quitar línea">✕</button></td>
      </tr>`).join('');
    renderTotals();
  }

  function renderTotals() {
    const t = totals(draft);
    $('edBase').textContent = fmtMoney(t.base);
    $('edCuotaIva').textContent = fmtMoney(t.iva);
    $('edTotal').textContent = fmtMoney(t.total);
  }

  $('edLineas').addEventListener('input', (e) => {
    const f = e.target.dataset.f;
    if (!f) return;
    const tr = e.target.closest('tr');
    const l = draft.lineas[+tr.dataset.i];
    l[f] = f === 'concepto' ? e.target.value : (parseNum(e.target.value) || 0);
    tr.querySelector('.importe').textContent = fmtMoney(importe(l));
    if (f !== 'cantidad' && f !== 'descuento') tr.querySelector('.hint-slot').innerHTML = hintHtml(l, +tr.dataset.i);
    renderTotals();
  });

  $('edLineas').addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (del) {
      draft.lineas.splice(+del.dataset.del, 1);
      if (!draft.lineas.length) draft.lineas.push({ concepto: '', cantidad: 0, precio: 0, descuento: 0 });
      renderLines();
      return;
    }
    const price = e.target.closest('[data-price]');
    if (price) {
      draft.lineas[+price.dataset.price].precio = Number(price.dataset.value);
      renderLines();
    }
  });

  $('edAddLinea').addEventListener('click', () => {
    draft.lineas.push({ concepto: '', cantidad: 0, precio: 0, descuento: 0 });
    renderLines();
    const inputs = $('edLineas').querySelectorAll('input[data-f="concepto"]');
    inputs[inputs.length - 1].focus();
  });

  $('edCliente').addEventListener('input', (e) => { draft.cliente = e.target.value; renderLines(); });
  $('edNumero').addEventListener('input', (e) => { draft.numero = e.target.value; });
  $('edFecha').addEventListener('input', (e) => { draft.fecha = e.target.value; });
  $('edNotas').addEventListener('input', (e) => { draft.notas = e.target.value; });
  $('edIva').addEventListener('input', (e) => { draft.iva = parseNum(e.target.value) || 0; renderTotals(); });

  $('edNuevo').addEventListener('click', () => newDraft());

  function saveDraft() {
    if (!draft.cliente.trim()) { $('edMsg').textContent = 'Falta el cliente.'; $('edCliente').focus(); return false; }
    const clean = cleanBudget({ ...draft, lineas: draft.lineas.filter((l) => l.concepto || l.precio) });
    const i = db.presupuestos.findIndex((p) => p.id === clean.id);
    if (i >= 0) db.presupuestos[i] = clean; else db.presupuestos.push(clean);
    draft.lineas = clean.lineas.length ? clean.lineas : [{ concepto: '', cantidad: 0, precio: 0, descuento: 0 }];
    const ok = save();
    refreshAll();
    $('edTitulo').textContent = `Presupuesto ${draft.numero || ''}`;
    $('edMsg').textContent = ok ? 'Guardado.' : 'Guardado solo en esta sesión (el navegador no permite guardar).';
    return true;
  }

  $('edGuardar').addEventListener('click', () => {
    if (!saveDraft()) return;
    if (importQueue.length) setTimeout(nextImport, 400);
  });

  // ---------- Imprimir ----------

  $('edImprimir').addEventListener('click', () => {
    const a = db.ajustes;
    const t = totals(draft);
    const lineas = draft.lineas.filter((l) => l.concepto || l.precio);
    const hayDto = lineas.some((l) => l.descuento);
    $('print').innerHTML = `
      <header class="p-head">
        <div><h1>${esc(a.nombre || 'Presupuesto')}</h1>
          <p>${[a.cif, a.direccion, a.contacto].filter(Boolean).map(esc).join('<br>')}</p></div>
        <div class="p-meta"><h2>PRESUPUESTO</h2>
          <p>Nº <strong>${esc(draft.numero)}</strong><br>Fecha: ${fmtDate(draft.fecha)}</p></div>
      </header>
      <p class="p-client">Cliente: <strong>${esc(draft.cliente)}</strong></p>
      <table class="p-table">
        <thead><tr><th>Concepto</th><th class="num">Cantidad</th><th class="num">Precio</th>${hayDto ? '<th class="num">Dto.</th>' : ''}<th class="num">Importe</th></tr></thead>
        <tbody>${lineas.map((l) => `<tr><td>${esc(l.concepto)}</td><td class="num">${fmtNum(l.cantidad)}</td><td class="num">${fmtMoney(l.precio)}</td>${hayDto ? `<td class="num">${l.descuento ? fmtNum(l.descuento) + '%' : ''}</td>` : ''}<td class="num">${fmtMoney(importe(l))}</td></tr>`).join('')}</tbody>
      </table>
      <table class="p-totals">
        <tr><td>Base imponible</td><td class="num">${fmtMoney(t.base)}</td></tr>
        <tr><td>IVA ${fmtNum(draft.iva)}%</td><td class="num">${fmtMoney(t.iva)}</td></tr>
        <tr class="grand"><td>TOTAL</td><td class="num">${fmtMoney(t.total)}</td></tr>
      </table>
      ${draft.notas ? `<p class="p-notes">${esc(draft.notas).replace(/\n/g, '<br>')}</p>` : ''}
      ${a.validez ? `<p class="p-notes">Validez del presupuesto: ${esc(a.validez)}.</p>` : ''}`;
    const old = document.title;
    document.title = `Presupuesto ${draft.numero} ${draft.cliente}`.trim();
    window.print();
    document.title = old;
  });

  // ---------- Historial ----------

  function renderList() {
    const f = $('lFiltro').value.trim();
    const list = db.presupuestos
      .filter((p) => !f || matches([p.cliente, p.numero, ...p.lineas.map((l) => l.concepto)].join(' '), f))
      .sort(byDateDesc);
    $('lTabla').innerHTML = list.map((p) => `
      <tr>
        <td>${fmtDate(p.fecha)}</td>
        <td>${esc(p.numero)}</td>
        <td>${esc(p.cliente)}</td>
        <td class="num">${p.lineas.length}</td>
        <td class="num">${fmtMoney(totals(p).total)}</td>
        <td class="nowrap">
          <button class="btn small" data-open="${esc(p.id)}">Abrir</button>
          <button class="btn small ghost" data-dup="${esc(p.id)}" title="Nuevo presupuesto con las mismas líneas">Duplicar</button>
          <button class="btn small ghost" data-rm="${esc(p.id)}" title="Borrar">✕</button>
        </td>
      </tr>`).join('') || '<tr><td colspan="6" class="muted">No hay presupuestos.</td></tr>';
  }
  $('lFiltro').addEventListener('input', renderList);

  $('lTabla').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.open) openBudget(b.dataset.open);
    if (b.dataset.dup) {
      const p = db.presupuestos.find((x) => x.id === b.dataset.dup);
      newDraft({ cliente: p.cliente, iva: p.iva, notas: p.notas, lineas: JSON.parse(JSON.stringify(p.lineas)) });
      showTab('editor');
    }
    if (b.dataset.rm) {
      const p = db.presupuestos.find((x) => x.id === b.dataset.rm);
      if (!confirm(`¿Borrar el presupuesto ${p.numero || ''} de ${p.cliente}?`)) return;
      db.presupuestos = db.presupuestos.filter((x) => x.id !== p.id);
      db.borrados.push(p.id);
      save();
      refreshAll();
    }
  });

  // ---------- Importar PDF ----------

  let pdfjs = null;
  async function loadPdfJs() {
    if (pdfjs) return pdfjs;
    const base = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = base + 'pdf.min.js';
      s.onload = resolve;
      s.onerror = () => reject(new Error('No se pudo cargar el lector de PDF (¿sin conexión?)'));
      document.head.appendChild(s);
    });
    pdfjs = window.pdfjsLib;
    pdfjs.GlobalWorkerOptions.workerSrc = base + 'pdf.worker.min.js';
    return pdfjs;
  }

  // Convierte el PDF en líneas de texto, agrupando por altura en la página.
  async function pdfToLines(file) {
    const lib = await loadPdfJs();
    const doc = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
    const out = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const { items } = await page.getTextContent();
      const rows = [];
      for (const it of items) {
        if (!it.str || !it.str.trim()) continue;
        const y = it.transform[5];
        const x = it.transform[4];
        let row = rows.find((r) => Math.abs(r.y - y) < 3);
        if (!row) { row = { y, parts: [] }; rows.push(row); }
        row.parts.push({ x, s: it.str.trim() });
      }
      rows.sort((a, b) => b.y - a.y);
      for (const r of rows) out.push(r.parts.sort((a, b) => a.x - b.x).map((p) => p.s).join(' '));
    }
    return out;
  }

  let importQueue = [];
  async function nextImport() {
    const file = importQueue.shift();
    if (!file) { $('pdfMsg').textContent = 'Importación terminada.'; return; }
    $('pdfMsg').textContent = `Leyendo ${file.name}…`;
    try {
      const lines = await pdfToLines(file);
      const r = parseBudgetText(lines);
      newDraft({
        numero: r.numero,
        fecha: r.fecha || today(),
        cliente: r.cliente,
        lineas: r.lineas,
        origen: file.name + (importQueue.length ? ` (quedan ${importQueue.length} más: pulsa Guardar para pasar al siguiente)` : ''),
        textoPdf: lines.join('\n') || '(El PDF no tiene texto: probablemente sea un escaneo.)',
        notas: '',
      });
      $('pdfMsg').textContent = `${file.name}: ${r.lineas.length} líneas encontradas.`;
      showTab('editor');
    } catch (err) {
      $('pdfMsg').textContent = `${file.name}: ${err.message}`;
      if (importQueue.length) nextImport();
    }
  }

  $('pdfFiles').addEventListener('change', (e) => {
    importQueue = [...e.target.files];
    e.target.value = '';
    nextImport();
  });

  // ---------- Copia de seguridad ----------

  $('bkExport').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ presupuestos: db.presupuestos }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `presupuestos-${today()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  $('bkImport').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const list = data.presupuestos || data;
      // Una copia cargada a mano puede recuperar presupuestos borrados.
      const ids = new Set(list.map((p) => p.id));
      db.borrados = db.borrados.filter((id) => !ids.has(id));
      const n = merge(list);
      save();
      refreshAll();
      $('bkMsg').textContent = `${n} presupuestos añadidos.`;
    } catch {
      $('bkMsg').textContent = 'El archivo no es una copia válida.';
    }
  });

  // ---------- Ajustes ----------

  document.querySelectorAll('[data-ajuste]').forEach((el) => {
    const k = el.dataset.ajuste;
    el.value = db.ajustes[k] ?? '';
    el.addEventListener('input', () => {
      db.ajustes[k] = el.type === 'number' ? (parseNum(el.value) || 0) : el.value;
      save();
    });
  });

  // ---------- Inicio ----------

  load();
  document.querySelectorAll('[data-ajuste]').forEach((el) => { el.value = db.ajustes[el.dataset.ajuste] ?? ''; });
  newDraft();
  refreshAll();
  loadSeed();
})();
