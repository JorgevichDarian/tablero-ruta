// Funciones que se inyectan en las páginas de Nextbyn y de Chess.
// Cada una se ejecuta dentro de la página (con la sesión del usuario) y tiene
// que ser autocontenida: Chrome la serializa, así que no puede usar nada de afuera.

/* global self */

// ---------------------------------------------------------------------------
// Nextbyn · Mapa de entregas
// Devuelve { cams: [...], cli: { n, p: { PATENTE: { idCliente: {nombre, domicilio, estado} } } }, at }
// ---------------------------------------------------------------------------
async function leerNextbyn(opciones) {
  opciones = opciones || {};
  const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

  if (/login|ingreso/i.test(location.pathname)) {
    return { error: 'La sesión de Nextbyn venció. Entrá a Nextbyn con tu usuario y volvé a tocar Actualizar.' };
  }

  // Todos los textos visibles de la página, en orden.
  function textos(doc) {
    const out = [];
    const w = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, null);
    let n;
    while ((n = w.nextNode())) {
      const p = n.parentNode && n.parentNode.nodeName;
      if (p === 'SCRIPT' || p === 'STYLE' || p === 'NOSCRIPT') continue;
      const t = n.nodeValue.replace(/\s+/g, ' ').trim();
      if (t) out.push(t);
    }
    return out;
  }

  function fecha(s) {
    const m = /(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(s || '');
    return m ? new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +(m[6] || 0)).getTime() : null;
  }

  // Camiones del panel del mapa: patente, JORNADA ABIERTA/CERRADA, contadores, %, vehículo, inicio.
  function camiones(t) {
    const out = [];
    const vistos = {};
    for (let n = 1; n < t.length; n++) {
      const r = /^JORNADA\s+(ABIERTA|CERRADA)$/i.exec(t[n]);
      if (!r) continue;
      const o = { patente: t[n - 1], estado: r[1].toUpperCase(), nums: [], pct: null, vehiculo: '', inicio: null };
      for (let s = n + 1; s < Math.min(t.length, n + 25); s++) {
        const x = t[s];
        if (/^JORNADA\s+(ABIERTA|CERRADA)$/i.test(x)) break;
        if (o.pct === null && /^\d+$/.test(x)) o.nums.push(+x);
        else if (o.pct === null && /^\d+(?:[.,]\d+)?\s*%$/.test(x)) o.pct = parseFloat(x.replace(',', '.'));
        else if (/^VEH[IÍ]CULO$/i.test(x)) o.vehiculo = t[s + 1] || '';
        else if (/^INICIO JORNADA$/i.test(x)) { o.inicio = fecha(t[s + 1]); break; }
      }
      if (o.nums.length < 2 || vistos[o.patente]) continue;
      const l = o.nums;
      o.entregados = l[0] || 0;
      o.parciales = l.length >= 4 ? l[1] : 0;
      o.rechazos = l.length >= 4 ? l[2] : l.length === 3 ? l[1] : 0;
      o.pendientes = l[l.length - 1] || 0;
      o.hechos = o.entregados + o.parciales + o.rechazos;
      o.total = o.hechos + o.pendientes;
      delete o.nums;
      vistos[o.patente] = 1;
      out.push(o);
    }
    return out;
  }

  // Pestaña "Clientes" (grilla ag-Grid). Primero intenta leer los datos de la grilla
  // (funciona aunque la pestaña no esté a la vista); si no, lee las filas dibujadas.
  // Hora de entrega/visita: Nextbyn la puede traer como "17/11/2026 10:35", "2026-11-17T10:35:00",
  // "10:35" o "/Date(1731850000000)/". Devuelve milisegundos o null.
  function aHora(v) {
    const s = String(v == null ? '' : v).trim();
    if (!s || s === '0') return null;
    let m = /\/Date\((\d{10,13})/.exec(s);
    if (m) return +m[1];
    m = /(\d{2})\/(\d{2})\/(\d{4})[ T]+(\d{1,2}):(\d{2})/.exec(s);
    if (m) return new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5]).getTime();
    m = /(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})/.exec(s);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime();
    m = /^(\d{1,2}):(\d{2})(:\d{2})?$/.exec(s);
    if (m) { const d = new Date(); d.setHours(+m[1], +m[2], 0, 0); return d.getTime(); }
    return null;
  }
  // Columnas que pueden traer la hora real de la visita (en orden de preferencia).
  const COLS_HORA = [/(hora|fecha|fh|time).*(entreg|visit|llegad|cumpl|cierre|real)/i, /(entreg|visit|llegad|cumpl).*(hora|fecha|fh|time)/i, /^(hora|fecha)(visita|entrega)?$/i];

  function clientes(doc) {
    const out = { n: 0, p: {}, campos: null, colHora: '' };
    const txt = (e) => String((e && e.textContent) || '').replace(/\s+/g, ' ').trim();
    function agregar(o) {
      if (!('estadoentrega' in o) && !('nomcli' in o)) return;
      let pat = '';
      Object.keys(o).forEach((c) => {
        if (pat) return;
        const m = /(\d+)\s*-\s*([A-Z0-9]{5,9})\b/i.exec(o[c]);
        if (m && /auto|grupo|agrup|patente|jornada/i.test(c)) pat = m[2].toUpperCase();
      });
      if (!pat) Object.keys(o).forEach((c) => {
        const m = /^(\d+)\s*-\s*([A-Z0-9]{5,9})$/i.exec(o[c]);
        if (!pat && m) pat = m[2].toUpperCase();
        if (!pat && /patente|dominio/i.test(c) && /^[A-Z]{2,3}\d{3}[A-Z]{0,3}$/i.test(String(o[c]).replace(/\s|-/g, ''))) pat = String(o[c]).replace(/\s|-/g, '').toUpperCase();
      });
      if (!pat) return;
      let id = '';
      Object.keys(o).forEach((c) => { if (!id && /^(id|cod|nro|num)/i.test(c) && /^\d{2,}$/.test(o[c])) id = o[c]; });
      if (!id) Object.keys(o).forEach((c) => { if (!id && !/tel/i.test(c) && /^\d{3,8}$/.test(o[c])) id = o[c]; });
      const nombre = o.nomcli || '';
      if (!id && !nombre) return;
      id = id || 'N:' + nombre;
      const P = (out.p[pat] = out.p[pat] || {});
      if (!P[id]) out.n++;
      let hora = null;
      for (const re of COLS_HORA) {
        for (const c of Object.keys(o)) {
          if (hora == null && re.test(c) && !/estado/i.test(c)) { const h = aHora(o[c]); if (h) { hora = h; if (!out.colHora) out.colHora = c; } }
        }
        if (hora != null) break;
      }
      // Muestra de columnas (sin teléfonos) para poder diagnosticar desde el reporte.
      if (!out.campos) out.campos = Object.keys(o).map((c) => c + '=' + String(o[c]).replace(/\d{6,}/g, '#').slice(0, 30)).join(' | ');
      P[id] = { nombre: nombre, domicilio: o.domicli || '', estado: String(o.estadoentrega || '').toUpperCase(), hora: hora };
    }
    // 1) Datos de la grilla (ag-Grid API guardada en alguna variable global de la página)
    try {
      const W = doc.defaultView;
      const vistos = [];
      Object.keys(W).forEach((k) => {
        if (/^(webkit|on)|^(frames|top|parent|self|window|opener|document|location|history|navigator)$/.test(k)) return;
        let api = null;
        try {
          const v = W[k];
          if (!v || typeof v !== 'object' || v.window === v || v.nodeType) return;
          api = v.api && typeof v.api.forEachNode === 'function' ? v.api
            : typeof v.forEachNode === 'function' && typeof v.getDisplayedRowCount === 'function' ? v : null;
        } catch (e) { return; }
        if (!api || vistos.indexOf(api) >= 0) return;
        vistos.push(api);
        try {
          api.forEachNode((nodo) => {
            const d = nodo && nodo.data;
            if (!d || typeof d !== 'object') return;
            const o = {};
            Object.keys(d).forEach((c) => { const x = d[c]; if (x != null && typeof x !== 'object') o[c.toLowerCase()] = String(x).trim(); });
            agregar(o);
          });
        } catch (e) { /* sigue con la próxima */ }
      });
    } catch (e) { /* sin acceso a las variables */ }
    if (out.n) return out;
    // 2) Filas dibujadas de la grilla (cada celda tiene col-id)
    try {
      const filas = {};
      doc.querySelectorAll('[role=row][row-id]').forEach((row) => {
        const grid = row.closest('[role=grid]');
        const k = ((grid && (grid.closest('[id]') || {}).id) || '') + '|' + row.getAttribute('row-id');
        const o = (filas[k] = filas[k] || {});
        row.querySelectorAll('[col-id]').forEach((c) => { o[c.getAttribute('col-id').toLowerCase()] = txt(c); });
      });
      Object.keys(filas).forEach((k) => agregar(filas[k]));
    } catch (e) { /* nada */ }
    return out;
  }

  // Toca la pestaña "Clientes" del panel del mapa. Nunca un enlace del menú que lleve a
  // otra página (en Nextbyn el menú tiene un "Clientes" que abre Contactos de Clientes).
  function abrirPestanaClientes(doc) {
    try {
      const navegaAfuera = (e) => {
        const a = e.closest('a[href]');
        if (!a) return false;
        const h = (a.getAttribute('href') || '').trim();
        return !(h === '' || h.charAt(0) === '#' || /^javascript:/i.test(h));
      };
      const candidatos = Array.from(doc.querySelectorAll('a,li,span,button,div')).filter(
        (e) => (e.textContent || '').trim() === 'Clientes' && !e.querySelector('a,li,span,button,div') && !navegaAfuera(e)
      );
      // Solo la que está junto a "Transportistas" (la barra de pestañas del panel del mapa).
      const pestana = candidatos.find((e) => {
        for (let p = e.parentElement, i = 0; p && i < 4; p = p.parentElement, i++) {
          if (/Transportistas/.test(p.textContent || '')) return true;
        }
        return false;
      });
      if (pestana) pestana.click();
    } catch (e) { /* nada */ }
  }

  if (opciones.soloClientes) return { cli: clientes(document), at: Date.now() };

  // Espera a que el panel de camiones termine de cargar (3 lecturas iguales seguidas).
  const t0 = Date.now();
  let anterior = -1;
  let iguales = 0;
  let cams = [];
  while (Date.now() - t0 < 90000) {
    cams = camiones(textos(document));
    if (cams.length && cams.length === anterior) iguales++; else iguales = 0;
    anterior = cams.length;
    if (cams.length && iguales >= 3) break;
    await esperar(1000);
  }
  if (!cams.length) return { error: 'Nextbyn no mostró camiones en 90 s. ¿Carga el Mapa de entregas?' };

  // Primero intenta leer sin tocar nada; solo si no hay datos abre la pestaña del panel.
  let cli = clientes(document);
  if (!cli.n) abrirPestanaClientes(document);
  const t1 = Date.now();
  while (!cli.n && Date.now() - t1 < 10000) {
    await esperar(1000);
    cli = clientes(document);
  }
  return { cams: cams, cli: cli, at: Date.now() };
}

// ---------------------------------------------------------------------------
// Chess · Reporte de Repartos detallado (planillas de hoy y, si no hay, días anteriores)
// Devuelve { data: { PATENTE: {...} }, at }
// ---------------------------------------------------------------------------
async function leerChess() {
  const base = (/^\/[^/]+/.exec(location.pathname) || ['/AR1176'])[0];
  const hoy = new Date();
  const dia = (d) => d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  const haceDias = (n) => dia(new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - n));
  const esRetornable = (cod) => /(^|[\s\d*])RET(\b|\d)/i.test(cod || '') && !/\bKEG\b/i.test(cod || '');

  // Usuario de Chess (la pantalla de liquidaciones lo manda en pcusr).
  function usuarioChess() {
    const stores = [];
    try { stores.push(localStorage); } catch (e) { /* nada */ }
    try { stores.push(sessionStorage); } catch (e) { /* nada */ }
    for (const st of stores) {
      for (let i = 0; i < st.length; i++) {
        const k = st.key(i), v = st.getItem(k) || '';
        if (/^(usuario|user|username|login|cusuario)$/i.test(k) && /^[\w.@-]{3,40}$/.test(v)) return v;
        if (v.length < 20000 && /^[{[]/.test(v)) {
          const m = /"(?:usuario|user|username|login|cusuario|nombreUsuario)"\s*:\s*"([\w.@-]{3,40})"/i.exec(v);
          if (m) return m[1];
        }
      }
    }
    // Último recurso: el nombre de usuario que muestra el encabezado de Chess (una palabra en minúsculas).
    try {
      const cand = Array.from(document.querySelectorAll('[class*=user] *, [class*=usuario] *, header *, nav *'))
        .filter((e) => !e.children.length).map((e) => (e.textContent || '').trim())
        .filter((t) => /^[a-z][a-z0-9._-]{2,30}$/.test(t));
      if (cand.length) return cand[0];
    } catch (e) { /* nada */ }
    return '';
  }
  function fechaHora(v) {
    const m = /\/Date\((\d{10,13})/.exec(String(v || ''));
    if (m) return +m[1];
    const t = v ? new Date(v).getTime() : NaN;
    return isNaN(t) ? null : t;
  }

  async function horasDeLiquidacion(porPatente) {
    const fechaHoy = dia(new Date());
    const usuario = usuarioChess();
    const out = { ok: 0, camiones: 0, error: '' };
    const pats = Object.keys(porPatente);
    async function unCamion(pat) {
      const cam = porPatente[pat];
      const idresp = (/^\s*(\d+)\s*-/.exec(cam.transporte || '') || [])[1];
      if (!idresp) return;
      const r = await fetch(base + '/web/api/liquidacion/planillasPendientes?pcusr=' + encodeURIComponent(usuario) + '&pdtfec=&pirep=' + idresp + '&pctiporesp=TRN', { credentials: 'include' });
      if (!r.ok) throw new Error('planillasPendientes ' + r.status);
      const j = await r.json();
      const jornadas = ((j && j.dsPlaPdtes && j.dsPlaPdtes.ttPlaPdtes) || []).filter((x) =>
        x.tipomov === 'JOR' && (x.jornadacerrada === false || String(x.fhinijornada || '').slice(0, 10) === fechaHoy));
      if (!jornadas.length) return;
      const r2 = await fetch(base + '/web/api/liquidacion/estadoLiquidacion', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttplanis: jornadas.map((x) => ({ nromov: x.nromov, seriemov: x.seriemov || 0, tipomov: 'JOR' })) }),
      });
      if (!r2.ok) throw new Error('estadoLiquidacion ' + r2.status);
      const j2 = await r2.json();
      const cbtes = (j2 && j2.dsLiquidacion && j2.dsLiquidacion.ttCbtes) || [];
      const porCli = {};
      cbtes.forEach((c) => {
        if (c.anulado || !c.idcliente) return;
        const k = String(c.idcliente);
        const o = (porCli[k] = porCli[k] || { estados: [], hora: null, prox: null });
        const est = String(c.estado || '').trim().toUpperCase();
        if (est && est !== '-' && o.estados.indexOf(est) < 0) o.estados.push(est);
        const t = fechaHora(c.fhvisita);
        if (t && (o.hora == null || t < o.hora)) { o.hora = t; o.prox = c.proximidad; }
      });
      cam.clientes.forEach((cl) => {
        const cod = (/^\s*(\d+)/.exec(cl.cliente) || [])[1];
        const x = cod && porCli[cod];
        if (!x) return;
        cl.horaChess = x.hora;
        cl.estadoLiq = x.estados.join(' / ');
        cl.proximidad = x.prox;
      });
      cam.jornadaLiq = jornadas.map((x) => x.nromov);
      out.camiones++;
    }
    // De a 4 camiones a la vez.
    for (let i = 0; i < pats.length; i += 4) {
      const res = await Promise.allSettled(pats.slice(i, i + 4).map(unCamion));
      res.forEach((r) => { if (r.status === 'rejected' && !out.error) out.error = String((r.reason && r.reason.message) || r.reason); });
    }
    out.ok = out.camiones;
    return out;
  }

  async function reporte(fecha) {
    const r = await fetch(base + '/web/api/reporteRepartos/obtenerReporte?piDep=1&pdtDes=' + fecha + '&pdtHas=' + fecha + '&pctipo=D', { credentials: 'include' });
    if (!r.ok) throw new Error('Chess respondió ' + r.status + '. ¿Venció la sesión de Chess? Entrá con tu usuario y volvé a tocar Actualizar.');
    const j = await r.json();
    if (j && j.plexcedido) throw new Error('Chess no devolvió el reporte del ' + fecha + ' porque supera el máximo de registros.');
    return (j && j.dsReporteRepartos && j.dsReporteRepartos.eReporteRepartosDet) || [];
  }

  try {
    let filas = await reporte(haceDias(0));
    // Planillas armadas días antes con entrega hoy: busca hasta 4 días atrás.
    for (let d = 1; d <= 4; d++) {
      const f = await reporte(haceDias(d));
      filas = filas.concat(f);
      if (f.length) break;
    }
    const fechaHoy = dia(hoy);
    const porPatente = {};
    filas.forEach((e) => {
      if (e.fecentrecbt && e.fecentrecbt !== fechaHoy) return;
      const pat = String(e.cPatente || '').trim().toUpperCase();
      if (!pat) return;
      const cam = (porPatente[pat] = porPatente[pat] || {
        patente: pat, transporte: e.cTransporte, chofer: e.cChofer, planillas: [], clientes: {}, importe: 0, bultos: 0, cajones: 0,
      });
      if (cam.planillas.indexOf(e.idplanilla) < 0) cam.planillas.push(e.idplanilla);
      const cli = (cam.clientes[e.dscliente] = cam.clientes[e.dscliente] || {
        cliente: e.dscliente, domicilio: e.domicli, localidad: e.dslocalidad, comprobantes: [],
        importe: 0, bultos: 0, cajones: 0, nLin: 0, nRe: 0, nEnt: 0, estados: [], motivos: [], items: [],
      });
      if (cli.comprobantes.indexOf(e.cComprobante) < 0) cli.comprobantes.push(e.cComprobante);
      const bultos = +e.dBultos || 0;
      const importe = +e.dImporte || 0;
      const ret = esRetornable(e.ccodart);
      const estado = String(e.cEstado || '').trim().toUpperCase();
      cli.importe += importe; cli.bultos += bultos; if (ret) cli.cajones += bultos;
      cam.importe += importe; cam.bultos += bultos; if (ret) cam.cajones += bultos;
      cli.nLin++;
      if (estado && cli.estados.indexOf(estado) < 0) cli.estados.push(estado);
      if (/ENTREG|CUMPLID|FINALIZ|RENDID|CONFORM/.test(estado) && !/NO\s*ENTREG|RECHAZ/.test(estado)) cli.nEnt++;
      if (estado === 'RECHAZADO') {
        cli.nRe++;
        if (e.cMotivoRechazo && cli.motivos.indexOf(e.cMotivoRechazo) < 0) cli.motivos.push(e.cMotivoRechazo);
      }
      cli.items.push({ articulo: e.ccodart, bultos: bultos, importe: importe, ret: ret, rechazado: estado === 'RECHAZADO' });
    });
    Object.keys(porPatente).forEach((k) => {
      const cam = porPatente[k];
      cam.clientes = Object.keys(cam.clientes).map((n) => {
        const c = cam.clientes[n];
        c.rechazado = c.nRe > 0 && c.nRe === c.nLin;
        c.parcial = c.nRe > 0 && c.nRe < c.nLin;
        c.entregado = !c.nRe && c.nEnt > 0 && c.nEnt === c.nLin;
        return c;
      });
    });
    // Hora real de entrega: liquidación de cada camión (pantalla "Ver liquidación").
    let liq = { ok: 0, error: '' };
    try { liq = await horasDeLiquidacion(porPatente); } catch (e) { liq.error = String((e && e.message) || e); }
    return { data: porPatente, at: Date.now(), liq: liq };
  } catch (e) {
    return { error: String((e && e.message) || e) };
  }
}

if (typeof self !== 'undefined') { self.leerNextbyn = leerNextbyn; self.leerChess = leerChess; }
