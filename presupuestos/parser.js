// Utilidades sin dependencias del navegador: números en formato español, búsqueda
// por texto y lectura de presupuestos a partir del texto de un PDF.
// Se usa en la web y también en Node (pruebas y script de importación).
(function (root) {
  // "1.234,56" -> 1234.56 · "4,5" -> 4.5 · "4.50" -> 4.5 · "1.234" -> 1234
  function parseNum(text) {
    if (text == null) return NaN;
    let s = String(text).replace(/[€\s]/g, '').replace(/^\+/, '');
    if (!s) return NaN;
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
  }

  // Minúsculas, sin acentos ni signos.
  function normalize(text) {
    return String(text || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9ñ]+/g, ' ')
      .trim();
  }

  // Raíz sencilla para que «camisetas» encuentre «camiseta» y «polos» encuentre «polo».
  function stem(word) {
    if (word.length > 4 && word.endsWith('es')) return word.slice(0, -2);
    if (word.length > 3 && word.endsWith('s')) return word.slice(0, -1);
    return word;
  }

  // Todas las palabras de la búsqueda deben aparecer en el texto (en cualquier orden).
  function matches(text, query) {
    const words = normalize(query).split(' ').filter(Boolean).map(stem);
    if (!words.length) return true;
    const hay = normalize(text);
    return words.every((w) => hay.includes(w));
  }

  // ---- Lectura de un PDF ya convertido en líneas de texto ----

  const NUM = String.raw`-?\d{1,3}(?:\.\d{3})*(?:,\d+)?|-?\d+(?:[.,]\d+)?`;
  const SKIP = /\b(sub)?total\b|\biva\b|\bi\.v\.a\b|base imponible|\bimporte total\b|forma de pago|\bvencimiento\b|\bpagina\b|\bpágina\b|\btelefono\b|\bteléfono\b|\bc\.?i\.?f\b|\bn\.?i\.?f\b|\bdescuento total\b|\bportes\b/i;

  function close(a, b) {
    return Math.abs(a - b) <= Math.max(0.02, Math.abs(b) * 0.02);
  }

  // Intenta sacar {concepto, cantidad, precio} de una línea de tabla.
  function parseItemLine(line) {
    const clean = line.replace(/€/g, ' ').replace(/\s+/g, ' ').trim();
    if (!clean || SKIP.test(clean)) return null;

    // Números al final de la línea.
    const tail = new RegExp(String.raw`(?:\s+(?:${NUM})%?)+$`);
    const m = clean.match(tail);
    if (!m) return null;
    let head = clean.slice(0, m.index).trim();
    const tokens = m[0].trim().split(' ');
    const nums = tokens.filter((t) => !t.endsWith('%')).map(parseNum);
    const pct = tokens.find((t) => t.endsWith('%'));
    const desc = pct ? parseNum(pct.slice(0, -1)) : 0;
    if (nums.some(Number.isNaN)) return null;

    // Cantidad al principio: "100 Camiseta blanca 4,50 450,00"
    const lead = head.match(new RegExp(String.raw`^(${NUM})\s+(.*)$`));

    const withDiscount = (q, p) => q * p * (1 - (desc || 0) / 100);
    let cantidad, precio;
    if (nums.length >= 3) {
      const [q, p, t] = nums.slice(-3);
      if (close(withDiscount(q, p), t) || close(q * p, t)) { cantidad = q; precio = p; }
    }
    if (cantidad == null && lead && nums.length >= 2) {
      const q = parseNum(lead[1]);
      const [p, t] = nums.slice(-2);
      if (close(withDiscount(q, p), t) || close(q * p, t)) {
        cantidad = q; precio = p; head = lead[2];
      }
    }
    if (cantidad == null && nums.length >= 3) {
      // Sin cuadrar el total (descuentos raros): cantidad y precio son los dos anteriores al importe.
      const [q, p] = nums.slice(-3);
      if (q > 0 && p > 0) { cantidad = q; precio = p; }
    }
    if (cantidad == null && nums.length === 2 && /[a-z]{3}/i.test(head)) {
      const [q, p] = nums;
      if (q > 0 && p > 0 && Number.isInteger(q)) { cantidad = q; precio = p; }
    }
    if (cantidad == null || !/[a-záéíóúñ]{2}/i.test(head)) return null;

    // Quitar una referencia/código inicial tipo "REF-123" o "0012".
    const concepto = head.replace(/^(?=\S*\d)[A-Z0-9.\-/]{3,}\s+(?=\S)/, '').trim();
    return { concepto, cantidad, precio, descuento: desc || 0 };
  }

  function findDate(text) {
    const m = text.match(/\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})\b/);
    if (!m) return '';
    let [, d, mo, y] = m;
    if (y.length === 2) y = '20' + y;
    if (+mo > 12 || +d > 31) return '';
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  function findNumber(text) {
    const m = text.match(/presupuesto\s*(?:n[º°o.]*|num(?:ero)?\.?|número)?\s*[:#]?\s*([A-Z]{0,4}[-/]?\d[\w\-/]*)/i)
      || text.match(/\bn[º°]\s*(?:de\s+)?(?:presupuesto)?\s*[:#]?\s*([A-Z]{0,4}[-/]?\d[\w\-/]*)/i);
    return m ? m[1] : '';
  }

  function findClient(lines) {
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^\s*(?:cliente|sr\.?\/?a?\.?|señor(?:es)?|razón social|razon social|a la atención de)\s*[:.]?\s*(.*)$/i);
      if (m) {
        const rest = m[1].replace(/\b(fecha|n[º°]).*$/i, '').trim();
        if (rest.length > 1) return rest;
        if (lines[i + 1]) return lines[i + 1].trim();
      }
    }
    return '';
  }

  function parseBudgetText(lines) {
    const text = lines.join('\n');
    const lineas = lines.map(parseItemLine).filter(Boolean);
    return {
      numero: findNumber(text),
      fecha: findDate(text),
      cliente: findClient(lines),
      lineas,
    };
  }

  const api = { parseNum, normalize, stem, matches, parseItemLine, parseBudgetText };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Parser = api;
})(typeof self !== 'undefined' ? self : this);
