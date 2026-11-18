// Reporte externo del Tablero de ruta.
// Funciona igual abierto desde la extensión (ícono) o publicado en GitHub Pages:
// en los dos casos le pide los datos a la extensión, que lee Nextbyn y Chess con tu sesión.
/* global chrome */
(function () {
  'use strict';

  var EXT_ID = 'npppbmphladglegjkaakkakllgnhmmgn';
  var GUIA = '#guia';
  var CADA = 5 * 60 * 1000;
  var CLAVE_CFG = 'ltReporteCfg';
  var CLAVE_HIST = 'ltReporteHist';
  var CLAVE_DATOS = 'ltReporteDatos';
  var COLOR = { rojo: 'var(--rojo)', amarillo: 'var(--ambar)', verde: 'var(--verde)', azul: 'var(--azul)', gris: 'var(--gris)' };

  // ---------- utilidades ----------
  function $(id) { return document.getElementById(id); }
  function leerLS(k, def) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch (e) { return def; } }
  function guardarLS(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* sin almacenamiento */ } }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function hhmm(d) { if (!d) return '—'; d = new Date(d); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }
  function horas(h) { if (h == null) return '—'; var m = Math.round(60 * h); return Math.floor(m / 60) + 'h ' + ('0' + (m % 60)).slice(-2) + 'm'; }
  function plata(n) { return '$ ' + Math.round(n || 0).toLocaleString('es-AR'); }
  function num(n) { return Math.round(100 * (n || 0)) / 100; }
  function aHora(base, s) { var m = /^(\d{1,2}):(\d{2})$/.exec(s || '') || [0, 18, 0]; var d = new Date(base); d.setHours(+m[1], +m[2], 0, 0); return d; }
  function sabado(d) { return (d || new Date()).getDay() === 6; }
  function nz(s) { return String(s || '').toUpperCase().normalize('NFD').replace(/[^A-Z0-9]/g, ''); }
  function chapa(p) { return '<span class="chapa"><span>' + esc(p) + '</span></span>'; }

  // ---------- configuración ----------
  var cfg = Object.assign({ objLV: '15:00', objSab: '13:00', sinAvance: 45 }, leerLS(CLAVE_CFG, {}));
  function objetivo(d) { return sabado(d) ? cfg.objSab : cfg.objLV; }
  function ventanaApertura(d) { return sabado(d) ? ['08:00', '08:30'] : ['07:30', '08:00']; }

  // ---------- estado ----------
  var guardado = leerLS(CLAVE_DATOS, {});
  var hoy = new Date().toDateString();
  var nb = guardado.nb && new Date(guardado.nb.at).toDateString() === hoy ? guardado.nb : null; // { cams, cli, at }
  var ch = guardado.ch && new Date(guardado.ch.at).toDateString() === hoy ? guardado.ch : null; // { data, at }
  var errNb = '', errCh = '', errPr = '', sinExtension = false;
  var CLAVE_PRIO = 'ltReportePrio';
  var pr = leerLS(CLAVE_PRIO, null); // { mapa, at }
  var CLAVE_VENT = 'ltReporteVent', CLAVE_OBS = 'ltReporteObs';
  var vt = leerLS(CLAVE_VENT, null); // { mapa: { codigo: { f: [[desde, hasta] en minutos], nota } }, at }
  var errVt = '', leyendoVt = false;
  var abiertos = {}, clientesAbiertos = {};
  var ocupado = { nextbyn: false, chess: false };
  var proxima = 0, timer = null;

  // ---------- conexión con la extensión ----------
  function enExtension() { return location.protocol === 'chrome-extension:'; }
  function pedir(tipo, extra) {
    var msg = Object.assign({ tipo: tipo }, extra || {});
    return new Promise(function (resolve, reject) {
      function cb(r) {
        var le = chrome.runtime && chrome.runtime.lastError;
        if (le || !r) return reject(new Error(le ? 'NOEXT' : 'La extensión no respondió.'));
        r.ok ? resolve(r.data) : reject(new Error(r.error));
      }
      try {
        if (enExtension()) chrome.runtime.sendMessage(msg, cb);
        else if (window.chrome && chrome.runtime && chrome.runtime.sendMessage) chrome.runtime.sendMessage(EXT_ID, msg, cb);
        else reject(new Error('NOEXT'));
      } catch (e) { reject(new Error('NOEXT')); }
    });
  }

  function actualizar(tipo) {
    if (ocupado[tipo]) return Promise.resolve();
    ocupado[tipo] = true;
    pintarBotones();
    return pedir(tipo).then(function (data) {
      sinExtension = false;
      if (tipo === 'nextbyn') { nb = data; errNb = ''; registrarObservaciones(); } else { ch = data; errCh = ''; }
      guardarLS(CLAVE_DATOS, { nb: nb, ch: ch });
    }, function (e) {
      var m = String(e.message || e);
      if (m === 'NOEXT') { sinExtension = true; m = 'Falta la extensión'; }
      if (tipo === 'nextbyn') errNb = m; else errCh = m;
    }).then(function () { ocupado[tipo] = false; pintar(); quizasGuardar(); });
  }

  function actualizarTodo() {
    programar();
    // La hoja de prioridades cambia poco: se vuelve a leer si tiene más de 1 hora.
    if (!pr || Date.now() - pr.at > 36e5) actualizarPrioridades();
    if (!vt || Date.now() - vt.at > 36e5) actualizarVentanas();
    return Promise.all([actualizar('nextbyn'), actualizar('chess')]);
  }

  function actualizarVentanas() {
    if (leyendoVt) return;
    leyendoVt = true;
    pedir('ventanas').then(function (data) {
      vt = { mapa: armarVentanas(data.csv), at: data.at };
      errVt = '';
      guardarLS(CLAVE_VENT, vt);
    }).catch(function (e) {
      var m = String(e.message || e);
      errVt = m === 'NOEXT' ? 'falta la extensión' : m;
    }).then(function () { leyendoVt = false; pintar(); });
  }

  var leyendoPr = false;
  function actualizarPrioridades() {
    if (leyendoPr) return;
    leyendoPr = true;
    pedir('prioridades').then(function (data) {
      pr = { mapa: armarPrioridades(data.csv), at: data.at };
      errPr = '';
      guardarLS(CLAVE_PRIO, pr);
    }).catch(function (e) {
      var m = String(e.message || e);
      errPr = m === 'NOEXT' ? 'falta la extensión' : m;
    }).then(function () { leyendoPr = false; refrescarPopover(); });
  }

  function programar() {
    clearTimeout(timer);
    proxima = 0;
    if (!$('auto').checked) return;
    proxima = Date.now() + CADA;
    timer = setTimeout(actualizarTodo, CADA);
  }

  // ---------- análisis (semáforo) ----------
  function analizar(cams, ahora) {
    var hist = leerLS(CLAVE_HIST, {});
    var fin = aHora(ahora, objetivo(ahora));
    var res = cams.map(function (c) {
      var e = Object.assign({}, c);
      e.alertas = []; e.aviso = ''; e.tarde = 0;
      var ini = e.inicio ? new Date(e.inicio) : null;
      if (ini && ini.getHours() >= 4) {
        var v = ventanaApertura(ini), v0 = aHora(ini, v[0]), v1 = aHora(ini, v[1]);
        if (ini > v1) { e.tarde = Math.round((ini - v1) / 6e4); e.aviso = 'Levantó ruta tarde: ' + hhmm(ini) + ' (' + e.tarde + ' min después de las ' + v[1] + ')'; }
        else if (ini < v0 - 15 * 6e4) e.aviso = 'Levantó ruta antes de horario: ' + hhmm(ini) + ' (ventana ' + v[0] + ' a ' + v[1] + ')';
      }
      var h = ini ? (ahora - ini) / 36e5 : null;
      e.horas = h;
      e.ritmo = h && h > 0.05 ? e.hechos / h : null;
      e.fin = null;
      var o = hist[e.patente];
      if (!(o && o.hechos === e.hechos && o.dia === ahora.toDateString())) o = { hechos: e.hechos, desde: ahora.getTime(), dia: ahora.toDateString() };
      hist[e.patente] = o;
      e.sinAvanceMin = (ahora - o.desde) / 6e4;
      if (e.estado === 'CERRADA') {
        if (e.pendientes > 0) { e.sem = 'rojo'; e.txt = 'Cerró con ' + e.pendientes + ' pendientes'; e.alertas.push('Cerró la jornada con ' + e.pendientes + ' clientes pendientes'); }
        else { e.sem = 'gris'; e.txt = 'Finalizado'; }
      } else if (e.pendientes === 0) { e.sem = 'verde'; e.txt = 'Sin pendientes, falta cerrar'; }
      else if (ini && ini.getHours() < 4) { e.sem = 'amarillo'; e.txt = 'Inicio anómalo'; e.ritmo = null; e.alertas.push('Jornada iniciada a las ' + hhmm(ini) + ': revisar si quedó abierta de antes'); }
      else if (h !== null && h < 0.75) { e.sem = 'azul'; e.txt = 'Recién sale'; }
      else if (e.ritmo) {
        e.fin = new Date(ahora.getTime() + (e.pendientes / e.ritmo) * 36e5);
        var dif = (e.fin - fin) / 6e4;
        if (dif <= 0) { e.sem = 'verde'; e.txt = 'En horario'; }
        else if (dif <= 60) { e.sem = 'amarillo'; e.txt = 'Ajustado'; }
        else { e.sem = 'rojo'; e.txt = 'Demorado'; }
      } else { e.sem = 'rojo'; e.txt = 'Sin entregas'; e.alertas.push('Lleva ' + horas(h) + ' de jornada sin visitas registradas'); }
      if (e.estado === 'ABIERTA' && e.pendientes > 0 && e.sinAvanceMin >= cfg.sinAvance) e.alertas.push('Sin nuevas visitas hace ' + Math.round(e.sinAvanceMin) + ' min');
      if (e.rechazos > 0) e.alertas.push(e.rechazos + (e.rechazos === 1 ? ' rechazo' : ' rechazos'));
      e.orden = 1000 * { rojo: 0, amarillo: 1, azul: 2, verde: 3, gris: 4 }[e.sem] - 10 * e.alertas.length + (e.ritmo || 0);
      return e;
    });
    guardarLS(CLAVE_HIST, hist);
    return res.sort(function (a, b) { return a.orden - b.orden; });
  }

  // ---------- escala de la línea del día ----------
  function escala(cams, ahora) {
    var desde = 6, hasta = Math.max(aHora(ahora, objetivo(ahora)).getHours() + 2, ahora.getHours() + 1);
    cams.forEach(function (e) {
      var i = e.inicio && new Date(e.inicio);
      if (i && i.getHours() >= 4) desde = Math.min(desde, i.getHours());
      if (e.fin && e.fin.toDateString() === ahora.toDateString()) hasta = Math.max(hasta, Math.ceil(e.fin.getHours() + e.fin.getMinutes() / 60));
    });
    hasta = Math.min(Math.max(hasta, desde + 6), 22);
    var a = aHora(ahora, ('0' + desde).slice(-2) + ':00').getTime();
    var b = aHora(ahora, ('0' + hasta).slice(-2) + ':00').getTime();
    return {
      desde: desde, hasta: hasta,
      x: function (t) { t = +new Date(t); return Math.max(0, Math.min(100, ((t - a) / (b - a)) * 100)); },
      fuera: function (t) { return +new Date(t) > b; },
    };
  }

  function lineaDelDia(e, E, ahora) {
    var v = ventanaApertura(ahora), obj = aHora(ahora, objetivo(ahora));
    var c = '<div class="dia" title="' + esc(lineaTitulo(e)) + '"><div class="carril"></div>' +
      '<div class="ventana" style="left:' + E.x(aHora(ahora, v[0])) + '%;width:' + (E.x(aHora(ahora, v[1])) - E.x(aHora(ahora, v[0]))) + '%"></div>';
    var ini = e.inicio ? new Date(e.inicio) : null;
    var xi = ini && ini.getHours() >= 4 ? E.x(ini) : 0;
    var xa = E.x(ahora);
    if (ini) {
      c += '<div class="hecho" style="left:' + xi + '%;width:' + Math.max(0, xa - xi) + '%' + (e.estado === 'CERRADA' ? ';opacity:.35' : '') + '"></div>';
      if (ini.getHours() >= 4) c += '<div class="ini" style="left:' + xi + '%"></div>';
    }
    if (e.fin) {
      var fuera = E.fuera(e.fin), xf = fuera ? 100 : E.x(e.fin);
      c += '<div class="proy" style="left:' + xa + '%;width:' + Math.max(0, xf - xa) + '%"></div>';
      c += '<div class="fin' + (fuera ? ' fuera' : '') + '" style="left:' + xf + '%"></div>';
    }
    c += '<div class="obj" style="left:' + E.x(obj) + '%"></div><div class="ahora" style="left:' + xa + '%"></div></div>';
    return c;
  }
  function lineaTitulo(e) {
    var t = 'Inicio ' + hhmm(e.inicio);
    if (e.fin) t += ', fin estimado ' + hhmm(e.fin);
    return t;
  }

  function eje(E, ahora) {
    var h = '<div class="reloj">';
    var paso = E.hasta - E.desde > 10 ? 2 : 1;
    for (var x = E.desde; x <= E.hasta; x += paso) {
      h += '<span style="left:' + ((x - E.desde) / (E.hasta - E.desde)) * 100 + '%">' + ('0' + x).slice(-2) + ':00</span>';
    }
    var obj = aHora(ahora, objetivo(ahora));
    h += '<span class="tag o" style="left:' + E.x(obj) + '%">Fin ' + objetivo(ahora) + '</span>';
    h += '<span class="tag a" style="left:' + E.x(ahora) + '%">' + hhmm(ahora) + '</span>';
    return h + '</div>';
  }

  // ---------- clientes de un camión ----------
  function estadoNextbyn(s) {
    if (/RECHAZO.*PARCIAL|PARCIAL/.test(s)) return 'parcial';
    if (/^RECHAZO/.test(s)) return 'rechazado';
    if (/^ENTREGA/.test(s)) return 'entregado';
    return '';
  }
  function pillEstado(c) {
    if (c.est === 'rechazado') return '<span class="pill p-re">Rechazado</span>';
    if (c.est === 'parcial') return '<span class="pill p-re">Rechazo parcial</span>';
    if (c.est === 'entregado') return '<span class="pill p-ok">Entregado</span>';
    if (c.nbEstado) return '<span class="pill p-pe">' + esc(c.nbEstado.replace(/_/g, ' ').toLowerCase().replace(/^./, function (x) { return x.toUpperCase(); })) + '</span>';
    return '<span class="pill p-pe">' + (c.leidoNextbyn ? 'Pendiente' : 'En reparto') + '</span>';
  }
  function orden(c) { return { rechazado: 0, parcial: 0, '': 1, entregado: 2 }[c.est || '']; }

  // Cruza cada cliente de Chess con su estado en Nextbyn (por código, o por nombre).
  function cruzar(dc, nbCli) {
    var porNombre = {};
    Object.keys(nbCli).forEach(function (k) { porNombre[nz(nbCli[k].nombre)] = nbCli[k]; });
    return dc.clientes.map(function (c0) {
      var c = Object.assign({}, c0);
      c.codigo = (/^\s*(\d+)/.exec(c.cliente) || [])[1] || '';
      var x = (c.codigo && nbCli[c.codigo]) || porNombre[nz(String(c.cliente).replace(/^\s*\d+\s*-\s*/, ''))];
      c.leidoNextbyn = !!x;
      c.nbEstado = x ? x.estado : '';
      c.horaNb = x && x.hora ? x.hora : null;
      c.est = c.rechazado ? 'rechazado' : c.parcial ? 'parcial' : c.entregado ? 'entregado' : '';
      var s = x && estadoNextbyn(x.estado);
      if (s === 'rechazado' || s === 'parcial') c.est = s;
      else if (s === 'entregado' && !c.est) c.est = 'entregado';
      // Sin dato de Nextbyn: estado de la liquidación de Chess (ENTREGADO, ENTREGA PARCIAL, NO VISITADO).
      if (!s && !c.est && c.estadoLiq) {
        if (/RECHAZ/.test(c.estadoLiq)) c.est = 'rechazado';
        else if (/ENTREGA/.test(c.estadoLiq)) c.est = 'entregado';
      }
      return c;
    });
  }

  // ---------- prioridad de pedidos pendientes (hoja PL4.2 Carga ruteo) ----------
  var NOMBRE_PRIO = { 1: 'Ganador', 2: 'Básico', 3: 'En crecimiento', 4: 'Ventas bajas' };
  function leerCSV(texto) {
    var filas = [], fila = [], campo = '', comillas = false;
    for (var i = 0; i < texto.length; i++) {
      var c = texto[i];
      if (comillas) {
        if (c === '"') { if (texto[i + 1] === '"') { campo += '"'; i++; } else comillas = false; }
        else campo += c;
      } else if (c === '"') comillas = true;
      else if (c === ',') { fila.push(campo); campo = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && texto[i + 1] === '\n') i++;
        fila.push(campo); filas.push(fila); fila = []; campo = '';
      } else campo += c;
    }
    if (campo || fila.length) { fila.push(campo); filas.push(fila); }
    return filas;
  }
  // Devuelve { codigo: { p, cluster, ventana, espera } } o lanza un error si no encuentra las columnas.
  // Ojo: Google, al exportar, deja vacío el título de las columnas numéricas (Cod. Cliente y las
  // prioridades), así que esas columnas se ubican por su posición junto a las que sí tienen título.
  function armarPrioridades(csv) {
    var filas = leerCSV(csv), h = -1;
    var norm = function (x) { return String(x || '').normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase(); };
    for (var i = 0; i < Math.min(filas.length, 40); i++) {
      var t = filas[i].map(norm).join('|');
      if (/(^|\|)nombre(\||$)/.test(t) && /cl[uú]ster vigente/.test(t)) { h = i; break; }
    }
    if (h < 0) throw new Error('No encontré las columnas «Nombre» y «Clúster vigente» en la pestaña PL4.2 Carga ruteo.');
    var cab = filas[h].map(norm);
    function col(re) { for (var k = 0; k < cab.length; k++) if (re.test(cab[k])) return k; return -1; }
    var cNom = col(/^nombre$/), cClu = col(/cl[uú]ster vigente/), cC1 = col(/cl[uú]ster corrida 1/);
    var cCod = col(/cod\.?\s*cliente/);
    if (cCod < 0) cCod = cNom - 1;
    var cPrio = col(/prioridad.*ruteo/);
    if (cPrio < 0 && cC1 >= 0) cPrio = cC1 + 2; // Prioridad stock, Prioridad en el ruteo
    var cVen = col(/ventana/), cEsp = col(/espera/);
    if (cEsp < 0) { var cRe = col(/reintento/); if (cRe >= 0) cEsp = cRe + 1; }
    var porCluster = { ganador: 1, 'básico': 2, basico: 2, 'en crecimiento': 3, 'ventas bajas': 4 };
    var mapa = {}, n = 0;
    for (var j = h + 1; j < filas.length; j++) {
      var f = filas[j], cod = String(f[cCod] || '').trim().replace(/\.0+$/, '');
      if (!/^\d+$/.test(cod)) continue;
      var clu = String(f[cClu] || '').trim();
      var desdeCluster = porCluster[norm(clu)] || 0;
      var p = cPrio >= 0 ? parseInt(f[cPrio], 10) : NaN;
      // Si la columna de prioridad no es la esperada, manda el clúster (la prioridad sale de él).
      if (!(p >= 1 && p <= 4) || (desdeCluster && p !== desdeCluster)) p = desdeCluster;
      var esp = cEsp >= 0 ? String(f[cEsp] || '').trim().replace(/\.0+$/, '') : '';
      mapa[cod] = { p: p, cluster: clu, ventana: cVen >= 0 ? String(f[cVen] || '').trim() : '', espera: /^\d+$/.test(esp) ? esp : '' };
      n++;
    }
    if (!n) throw new Error('La pestaña PL4.2 Carga ruteo no tiene clientes con código.');
    return mapa;
  }

  // Pendientes de un camión, ordenados: prioridad del ruteo (1 primero), después mayor importe.
  function pendientesDe(pat) {
    var nbCli = (nb && nb.cli && nb.cli.p && nb.cli.p[pat]) || {};
    var dc = ch && ch.data && ch.data[pat];
    var lista;
    if (dc) lista = cruzar(dc, nbCli);
    else lista = Object.keys(nbCli).map(function (id) {
      var x = nbCli[id];
      return { codigo: id.indexOf('N:') ? id : '', cliente: (id.indexOf('N:') ? id + ' - ' : '') + x.nombre, domicilio: x.domicilio, est: estadoNextbyn(x.estado), leidoNextbyn: true };
    });
    var mapa = (pr && pr.mapa) || {};
    var pend = lista.filter(function (c) { return !c.est; }).map(function (c) {
      var x = mapa[c.codigo] || null;
      return Object.assign({}, c, { prio: x && x.p ? x.p : 9, plan: x });
    });
    pend.sort(function (a, b) { return a.prio - b.prio || (b.importe || 0) - (a.importe || 0) || String(a.cliente).localeCompare(b.cliente); });
    return { lista: pend, fuente: dc ? 'chess' : lista.length ? 'nextbyn' : '', confirmados: !!(nb && nb.cli && nb.cli.n) };
  }

  // Cantidad para el botón: la lista real de pendientes si ya hay detalle de clientes; si no, el contador de Nextbyn.
  function cantidadPendientes(e) {
    var r = pendientesDe(String(e.patente).toUpperCase());
    return r.fuente ? r.lista.length : e.pendientes;
  }

  function vistaPrioridad(pat) {
    var r = pendientesDe(pat);
    var h = '<div class="pp-cab"><b>Pedidos pendientes de ' + esc(pat) + '</b><span>Orden de visita sugerido por prioridad del ruteo; dentro de cada prioridad, primero el de mayor importe.</span></div>';
    if (!pr) h += '<p class="pp-msg">' + (errPr ? 'No se pudo leer la hoja de prioridades: ' + esc(errPr) : 'Leyendo la hoja de prioridades…') + '</p>';
    if (!r.fuente) return h + '<p class="pp-msg">Todavía no hay detalle de clientes de este camión. Tocá <b>Actualizar todo</b>.</p>';
    if (!r.lista.length) return h + '<p class="pp-msg">No quedan pedidos pendientes.</p>';
    if (r.fuente === 'chess' && !r.confirmados) h += '<p class="pp-msg">Sin estados de Nextbyn: puede incluir clientes ya entregados.</p>';
    h += '<ol class="pp-lista">' + r.lista.map(function (c) {
      var plan = c.plan;
      var nombre = String(c.cliente).replace(/^\s*\d+\s*-\s*/, '');
      return '<li class="p' + c.prio + '"><span class="pp-cli"><b>' + esc(nombre) + '</b><small>' + esc(c.codigo || '') + (c.domicilio ? ', ' + esc(c.domicilio) : '') + '</small></span>' +
        '<span class="pp-plan">' + (plan && plan.p ? '<span class="pp-tag">P' + plan.p + ' ' + esc(plan.cluster || NOMBRE_PRIO[plan.p] || '') + '</span><small>' + esc([plan.ventana, plan.espera ? 'espera máx. ' + plan.espera + ' min' : ''].filter(Boolean).join(', ')) + '</small>' : '<span class="pp-tag sin">' + (plan ? 'Sin prioridad (' + esc(plan.cluster || 'sin clúster') + ')' : 'Sin prioridad en la hoja') + '</span>') + '</span>' +
        (c.importe != null ? '<span class="pp-imp">' + plata(c.importe) + '</span>' : '') + '</li>';
    }).join('') + '</ol>';
    if (pr) h += '<p class="pp-pie">Hoja PL4.2 Carga ruteo leída a las ' + hhmm(pr.at) + '.</p>';
    return h;
  }

  // ---------- OT: entregas dentro de la ventana horaria ----------
  // Hoja de ventanas (select D, F, BO): código de cliente, razón social, "hh:mm a hh:mm; hh:mm a hh:mm".
  function armarVentanas(csv) {
    var filas = leerCSV(csv), mapa = {}, n = 0;
    filas.forEach(function (f) {
      var cod = String(f[0] || '').trim().replace(/\.0+$/, '');
      if (!/^\d+$/.test(cod)) return;
      var txt = String(f[2] || '').trim(), fr = [], re = /(\d{2}):(\d{2}) a (\d{2}):(\d{2})/g, m;
      while ((m = re.exec(txt))) fr.push([+m[1] * 60 + +m[2], +m[3] * 60 + +m[4]]);
      var limpio = /^\d{2}:\d{2} a \d{2}:\d{2}(; \d{2}:\d{2} a \d{2}:\d{2})*$/.test(txt);
      mapa[cod] = { f: limpio ? fr : [], nota: !limpio && txt ? txt : '' };
      n++;
    });
    if (!n) throw new Error('La hoja de ventanas horarias no tiene clientes con código.');
    return mapa;
  }
  function minDelDia(t) { var d = new Date(t); return d.getHours() * 60 + d.getMinutes(); }
  function hm(min) { return ('0' + Math.floor(min / 60)).slice(-2) + ':' + ('0' + (min % 60)).slice(-2); }
  function textoVentana(f) { return f.map(function (x) { return hm(x[0]) + ' a ' + hm(x[1]); }).join('; '); }

  // Si Nextbyn no informa la hora de entrega, se toma la hora en que este reporte vio el cambio
  // de pendiente a entregado (precisión: el intervalo de actualización). Si el cliente ya figuraba
  // entregado la primera vez que el reporte lo vio, la hora queda desconocida.
  function registrarObservaciones() {
    if (!nb) return;
    var hoyS = new Date().toDateString(), obs = leerLS(CLAVE_OBS, {});
    if (obs.dia !== hoyS) obs = { dia: hoyS, c: {} };
    var t = nb.at || Date.now();
    Object.keys((nb.cli && nb.cli.p) || {}).forEach(function (pat) {
      var P = nb.cli.p[pat];
      Object.keys(P).forEach(function (id) {
        var k = pat + '|' + id, o = obs.c[k] || {}, est = estadoNextbyn(P[id].estado);
        if (!est) o.pend = t;
        else if (!o.ent && o.pend) o.ent = t;
        else if (!o.ent && !o.pend) o.antes = 1;
        obs.c[k] = o;
      });
    });
    guardarLS(CLAVE_OBS, obs);
  }
  function horaEntrega(pat, c) {
    if (c.horaChess) return { t: c.horaChess, fuente: 'chess', prox: c.proximidad };
    if (c.horaNb) return { t: c.horaNb, fuente: 'nextbyn' };
    var obs = leerLS(CLAVE_OBS, {});
    var o = obs.dia === new Date().toDateString() && obs.c && obs.c[pat + '|' + (c.codigo || '')];
    if (o && o.ent) return { t: o.ent, fuente: 'reporte' };
    return null;
  }

  // Evalúa un cliente. st: ok (a tiempo), fuera, sinhora, vencido, pend, rech.
  function evaluarOT(pat, c, ahora) {
    var v = vt && vt.mapa && c.codigo ? vt.mapa[c.codigo] : null;
    var f = v ? v.f : [], r = { f: f, nota: v ? v.nota : '', sinVentana: !f.length };
    var entregado = c.est === 'entregado' || c.est === 'parcial';
    if (c.est === 'rechazado') { r.st = 'rech'; return r; }
    if (entregado) {
      if (r.sinVentana) { r.st = 'ok'; r.h = horaEntrega(pat, c); return r; }
      r.h = horaEntrega(pat, c);
      if (!r.h) { r.st = 'sinhora'; return r; }
      var m = minDelDia(r.h.t);
      r.st = f.some(function (x) { return m >= x[0] && m <= x[1]; }) ? 'ok' : 'fuera';
      r.temprano = r.st === 'fuera' && m < f[0][0];
      return r;
    }
    var am = minDelDia(ahora);
    r.st = !r.sinVentana && am > f[f.length - 1][1] ? 'vencido' : 'pend';
    return r;
  }
  // OT del camión: entregados dentro de la ventana sobre el total de pedidos del día.
  function otDeCamion(pat, ahora) {
    var lista = listaClientes(pat);
    var r = { total: lista.length, ok: 0, fuera: 0, vencido: 0, sinhora: 0, rech: 0, pend: 0 };
    lista.forEach(function (c) { r[evaluarOT(pat, c, ahora).st]++; });
    // OT en vivo: a tiempo sobre visitados con resultado conocido (a tiempo, fuera de ventana, rechazado).
    r.visitados = r.ok + r.fuera + r.rech;
    return r;
  }
  function listaClientes(pat) {
    var nbCli = (nb && nb.cli && nb.cli.p && nb.cli.p[pat]) || {};
    var dc = ch && ch.data && ch.data[pat];
    if (dc) return cruzar(dc, nbCli);
    return Object.keys(nbCli).map(function (id) {
      var x = nbCli[id];
      return { codigo: id.indexOf('N:') ? id : '', cliente: (id.indexOf('N:') ? id + ' - ' : '') + x.nombre, domicilio: x.domicilio, nbEstado: x.estado, horaNb: x.hora || null, leidoNextbyn: true, est: estadoNextbyn(x.estado) };
    });
  }
  function pct(a, b) { return b ? Math.round((a / b) * 100) + '%' : '—'; }

  // Mini línea del día de un cliente: ventana(s) sombreada(s) y la hora de entrega.
  var TXT_OT = { ok: 'A tiempo', fuera: 'Fuera de ventana', sinhora: 'Sin hora de entrega', vencido: 'Ventana vencida', pend: 'Pendiente', rech: 'Rechazado' };
  function lineaCliente(r, E, ahora) {
    var h = '<div class="ot-linea" title="' + esc(tituloOT(r)) + '"><div class="carril"></div>';
    r.f.forEach(function (x) {
      var a = aHora(ahora, hm(x[0])), b = aHora(ahora, hm(x[1]));
      h += '<div class="ot-ven" style="left:' + E.x(a) + '%;width:' + Math.max(0.8, E.x(b) - E.x(a)) + '%"></div>';
    });
    if (r.h) h += '<div class="ot-pto ' + r.st + '" style="left:' + E.x(r.h.t) + '%"></div>';
    h += '<div class="ahora" style="left:' + E.x(ahora) + '%"></div></div>';
    var sub = r.f.length ? textoVentana(r.f) : 'Sin ventana';
    if (r.h) sub += (r.h.fuente === 'reporte' ? ', visto entregado ' : ', entregó ') + hhmm(r.h.t);
    return h + '<span class="ot-txt ' + r.st + '"><b>' + TXT_OT[r.st] + (r.temprano ? ' (antes)' : '') + '</b> ' + esc(sub) + '</span>';
  }
  function tituloOT(r) {
    var t = TXT_OT[r.st] + '. Ventana: ' + (r.f.length ? textoVentana(r.f) : 'sin ventana (el OT se da por cumplido)');
    if (r.h) t += '. Entrega: ' + hhmm(r.h.t) + (r.h.fuente === 'reporte' ? ' (hora en que el reporte vio el cambio)' : r.h.fuente === 'chess' ? ' (liquidación de Chess' + (r.h.prox ? ', a ' + Math.round(r.h.prox) + ' m del cliente' : '') + ')' : ' (Nextbyn)');
    if (r.st === 'sinhora') t += '. Ni la liquidación de Chess ni Nextbyn informan la hora de esta entrega.';
    return t;
  }
  function resumenOT(o) {
    return '<span class="ot-res" title="OT en vivo: a tiempo sobre clientes ya visitados (entregados o rechazados; no cuenta los entregados sin hora)">OT en vivo <b>' + pct(o.ok, o.visitados) + '</b> <small>' + o.ok + ' de ' + o.visitados + ' visitados</small></span>' +
      '<span class="ot-res">OT del día <b>' + pct(o.ok, o.total) + '</b> <small>' + o.ok + ' de ' + o.total + ' a tiempo' +
      (o.fuera ? ', ' + o.fuera + ' fuera de ventana' : '') + (o.vencido ? ', ' + o.vencido + ' con ventana vencida' : '') +
      (o.sinhora ? ', ' + o.sinhora + ' sin hora' : '') + '</small></span>';
  }

  // Rechazos primero, después pendientes y al final los entregados en el orden en que se entregaron.
  function ordenarClientes(pat, lista, ahora) {
    lista.forEach(function (c) { var h = horaEntrega(pat, c); c._t = h ? h.t : Infinity; });
    lista.sort(function (a, b) {
      return orden(a) - orden(b) || (orden(a) === 2 ? a._t - b._t : 0) || String(a.cliente).localeCompare(b.cliente);
    });
  }

  function notaVentana(r) { return r.nota ? '<span class="ot-nota" title="Sin ventana horaria: el OT se da por cumplido">⚠ ' + esc(r.nota) + '</span>' : ''; }
  function avisoOT() {
    if (!vt) return '<span class="ot-aviso">' + (errVt ? 'No se pudo leer la hoja de ventanas: ' + esc(errVt) : 'Leyendo ventanas horarias…') + '</span>';
    if (ch && ch.liq && ch.liq.camiones) return ch.liq.error ? '<span class="ot-aviso" title="' + esc(ch.liq.error) + '">Algunas liquidaciones de Chess no se pudieron leer.</span>' : '';
    if (ch && ch.liq && ch.liq.error) return '<span class="ot-aviso" title="' + esc(ch.liq.error) + '">No se pudo leer la liquidación de Chess: la hora de entrega sale de Nextbyn o de cuándo el reporte vio el cambio.</span>';
    if (!ch) return '<span class="ot-aviso">La hora de entrega sale de la liquidación de Chess: tocá Chess arriba.</span>';
    return '';
  }

  function detalle(cam, E, ahora) {
    var pat = String(cam.patente).toUpperCase();
    var nbCli = (nb && nb.cli && nb.cli.p && nb.cli.p[pat]) || {};
    var hayNb = !!(nb && nb.cli && nb.cli.n);
    var dc = ch && ch.data && ch.data[pat];

    // Sin Chess: lista de Nextbyn sola.
    if (!dc) {
      var ids = Object.keys(nbCli);
      var msg = !ch ? (errCh ? 'Chess: ' + esc(errCh) : 'Tocá <b>Chess</b> arriba para sumar importes, bultos y cajones.') : 'Chess no tiene planilla con entrega hoy para ' + esc(pat) + '.';
      if (!ids.length) return '<div class="dres">' + msg + '</div>';
      var lista = listaClientes(pat);
      ordenarClientes(pat, lista, ahora);
      return '<div class="dres"><span>' + msg + '</span><span>Clientes <b>' + lista.length + '</b></span><span>Entregados <b>' + lista.filter(function (c) { return c.est === 'entregado'; }).length + '</b></span>' + resumenOT(otDeCamion(pat, ahora)) + avisoOT() + '</div>' +
        '<div class="tabla-cli"><table class="cli"><thead><tr><th>Estado</th><th>Cliente</th><th class="h-dom">Domicilio</th><th class="h-ot">Ventana y entrega</th></tr></thead><tbody>' +
        lista.map(function (c) { var r = evaluarOT(pat, c, ahora); return '<tr><td>' + pillEstado(c) + '</td><td><b>' + esc(c.cliente) + '</b>' + notaVentana(r) + '</td><td class="h-dom">' + esc(c.domicilio) + '</td><td class="h-ot">' + lineaCliente(r, E, ahora) + '</td></tr>'; }).join('') + '</tbody></table></div>';
    }

    // Con Chess: cruza cada cliente con su estado en Nextbyn.
    var cs = cruzar(dc, nbCli);
    ordenarClientes(pat, cs, ahora);
    var nRe = cs.filter(function (c) { return c.est === 'rechazado' || c.est === 'parcial'; }).length;
    var nEnt = cs.filter(function (c) { return c.est === 'entregado'; }).length;
    var h = '<div class="dres"><span>Chofer <b>' + esc(String(dc.chofer || '').replace(/^\d+\s*-\s*/, '')) + '</b></span>' +
      '<span>Planillas <b>' + esc(dc.planillas.join(', ')) + '</b></span>' +
      '<span>Clientes <b>' + cs.length + '</b></span><span>Entregados <b>' + nEnt + '</b></span>' + (nRe ? '<span>Rechazos <b>' + nRe + '</b></span>' : '') +
      '<span>Importe <b>' + plata(dc.importe) + '</b></span><span>Bultos <b>' + Math.round(dc.bultos) + '</b></span>' +
      '<span>Cajones retornables <b>' + Math.round(dc.cajones) + '</b></span>' +
      (hayNb ? '' : '<span>Sin estados de Nextbyn: el estado sale de Chess.</span>') + resumenOT(otDeCamion(pat, ahora)) + avisoOT() + '</div>' +
      '<div class="tabla-cli"><table class="cli"><thead><tr><th>Estado</th><th>Cliente</th><th class="h-ot">Ventana y entrega</th><th class="h-dom">Domicilio</th><th class="h-loc">Localidad</th><th class="h-comp">Comprobante</th><th class="n">Importe</th><th class="n">Bultos</th><th class="n">Cajones</th></tr></thead><tbody>';
    cs.forEach(function (c) {
      var k = pat + '|' + c.cliente, abierto = !!clientesAbiertos[k], rOT = evaluarOT(pat, c, ahora);
      h += '<tr class="cl" data-cl="' + esc(k) + '"><td>' + pillEstado(c) +
        (c.motivos && c.motivos.length ? '<span class="motivo">' + esc(c.motivos.join(', ')) + '</span>' : '') +
        '</td><td><span class="car' + (abierto ? ' rot' : '') + '">▸</span><b>' + esc(c.cliente) + '</b>' + notaVentana(rOT) + '</td><td class="h-ot">' + lineaCliente(rOT, E, ahora) + '</td><td class="h-dom">' + esc(c.domicilio) + '</td><td class="h-loc">' + esc(c.localidad) +
        '</td><td class="h-comp" style="font-size:13px">' + esc(c.comprobantes.join(', ')) + '</td><td class="n">' + plata(c.importe) + '</td><td class="n">' + num(c.bultos) + '</td><td class="n">' + num(c.cajones) + '</td></tr>';
      if (abierto) {
        h += '<tr class="prod"><td colspan="9"><table>' + c.items.map(function (it) {
          return '<tr><td>' + (it.rechazado ? 'Rechazado: ' : '') + esc(it.articulo) + (it.ret ? ' <span class="pill p-pe">RET</span>' : '') + '</td><td class="n">' + num(it.bultos) + ' bultos</td><td class="n">' + plata(it.importe) + '</td></tr>';
        }).join('') + '</table></td></tr>';
      }
    });
    return h + '</tbody></table></div>';
  }

  // ---------- pintar ----------
  function pintarFuente(btn, hora, ocup, err, datos) {
    btn.disabled = ocup;
    btn.className = 'fuente' + (ocup ? ' leyendo' : err ? ' error' : datos ? ' ok' : '');
    hora.textContent = ocup ? 'leyendo…' : err ? 'error' : datos ? hhmm(datos.at) : 'sin datos';
  }
  function pintarBotones() {
    pintarFuente($('b-nb'), $('t-nb'), ocupado.nextbyn, errNb, nb);
    pintarFuente($('b-ch'), $('t-ch'), ocupado.chess, errCh, ch);
    $('b-todo').disabled = ocupado.nextbyn && ocupado.chess;
    $('b-nb').title = errNb || (nb ? 'Datos de Nextbyn de las ' + hhmm(nb.at) + '. Tocá para volver a leer.' : 'Leer Nextbyn');
    $('b-ch').title = errCh || (ch ? 'Datos de Chess de las ' + hhmm(ch.at) + '. Tocá para volver a leer.' : 'Leer Chess');
  }

  function pintarSub() {
    var t = nb ? 'Datos de Nextbyn de las ' + hhmm(nb.at) + ', ' + ((nb.cli && nb.cli.n) || 0) + ' clientes con estado.' : '';
    if (proxima) { var s = Math.max(0, Math.round((proxima - Date.now()) / 1000)); t += ' Próxima actualización en ' + Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2) + '.'; }
    $('sub').textContent = t.trim();
  }

  function pintar() {
    pintarBotones();
    pintarSub();
    var av = '';
    if (sinExtension) {
      av += '<div class="err">Para traer los datos hace falta la extensión <b>Tablero de ruta</b> en este Chrome. <a href="' + GUIA + '">Cómo instalarla</a>.</div>';
    } else {
      if (errNb) av += '<div class="err">Nextbyn: ' + esc(errNb) + (nb ? ' Se muestran los datos de las ' + hhmm(nb.at) + '.' : '') + '</div>';
      if (errCh) av += '<div class="err">Chess: ' + esc(errCh) + (ch ? ' Se muestran los datos de las ' + hhmm(ch.at) + '.' : '') + '</div>';
    }
    $('aviso').innerHTML = av;
    $('vacio').hidden = !!nb;
    if (!nb) { $('contenido').innerHTML = ''; return; }

    var ahora = new Date();
    var cams = analizar(nb.cams, ahora);
    var E = escala(cams, ahora);
    var cuenta = { rojo: 0, amarillo: 0, azul: 0, verde: 0, gris: 0 }, tot = { h: 0, r: 0, t: 0 };
    cams.forEach(function (e) { cuenta[e.sem]++; tot.h += e.hechos; tot.r += e.rechazos; tot.t += e.total; });
    var enRuta = cams.filter(function (e) { return e.estado === 'ABIERTA'; }).length;
    // OT de la flota: suma de los camiones con detalle de clientes.
    var otF = { ok: 0, total: 0, vis: 0 }, otCam = {};
    cams.forEach(function (e) {
      var o = otDeCamion(String(e.patente).toUpperCase(), ahora);
      otCam[e.patente] = o;
      otF.ok += o.ok; otF.total += o.total; otF.vis += o.visitados;
    });

    // Resumen de la flota
    var nombres = { rojo: 'Demorados', amarillo: 'Ajustados', azul: 'Recién salen', verde: 'En horario', gris: 'Finalizados' };
    var h = '<section class="flota"><div><div class="comp-barra">' +
      Object.keys(cuenta).map(function (k) { return cuenta[k] ? '<i class="' + k + '" style="width:' + (cuenta[k] / cams.length) * 100 + '%"></i>' : ''; }).join('') +
      '</div><div class="comp-ley">' +
      Object.keys(cuenta).map(function (k) { return '<span><i class="' + k + '"></i><b>' + cuenta[k] + '</b>' + nombres[k] + '</span>'; }).join('') +
      '</div></div><div class="cifras">' +
      '<div class="cifra"><b>' + enRuta + '</b><span>en ruta de ' + cams.length + '</span></div>' +
      '<div class="cifra"><b>' + tot.h + '<small style="font-size:18px;color:var(--tenue)"> / ' + tot.t + '</small></b><span>clientes visitados</span></div>' +
      '<div class="cifra"><b>' + (tot.t ? Math.round((tot.h / tot.t) * 100) : 0) + '%</b><span>avance general</span></div>' +
      '<div class="cifra" title="A tiempo sobre clientes ya visitados (entregados o rechazados)"><b>' + pct(otF.ok, otF.vis) + '</b><span>OT en vivo, ' + otF.ok + ' de ' + otF.vis + ' visitados</span></div>' +
      '<div class="cifra" title="Pedidos entregados dentro de su ventana horaria sobre el total de pedidos del día (clientes sin ventana: cumplido al entregar)"><b>' + pct(otF.ok, otF.total) + '</b><span>OT del día, sobre ' + otF.total + ' pedidos</span></div>' +
      '<div class="cifra' + (tot.r ? ' mal' : '') + '"><b>' + tot.r + '</b><span>rechazos</span></div>' +
      '</div></section>';

    // Rutas con su línea del día
    h += '<div class="layout"><section class="rutas" aria-label="Rutas de hoy"><div class="eje"><span>Camión</span><span>Estado</span>' + eje(E, ahora) +
      '<span class="n">Clientes</span><span class="n">Ritmo</span><span class="n">Fin est.</span></div>';
    cams.forEach(function (e) {
      var abierto = !!abiertos[e.patente];
      var ancho = function (x) { return e.total ? (x / e.total) * 100 : 0; };
      h += '<div class="fila' + (abierto ? ' open' : '') + '" data-p="' + esc(e.patente) + '" style="--c:' + COLOR[e.sem] + '" tabindex="0" role="button" aria-expanded="' + abierto + '">' +
        '<div class="c-chapa">' + chapa(e.patente) + '<span class="veh">' + esc(e.vehiculo) + '</span></div>' +
        '<div class="estado"><b><i></i>' + esc(e.txt) + '</b>' +
        e.alertas.filter(function (a) { return a.indexOf('Cerró la jornada') !== 0; }).map(function (a) { return '<span class="al">' + esc(a) + '</span>'; }).join('') +
        (e.aviso ? '<span class="al sec">' + esc(e.aviso) + '</span>' : '') +
        (e.estado === 'ABIERTA' && e.pendientes ? '<button type="button" class="prio" data-prio="' + esc(e.patente) + '" aria-haspopup="dialog">Prioridad pedidos pendientes <span>' + cantidadPendientes(e) + '</span></button>' : '') + '</div>' +
        lineaDelDia(e, E, ahora) +
        '<div class="c-cli n"><span class="big">' + e.hechos + '</span><span style="color:var(--tenue)">/' + e.total + '</span>' +
        '<div class="avance" title="' + e.entregados + ' entregados, ' + e.parciales + ' parciales, ' + e.rechazos + ' rechazos, ' + e.pendientes + ' pendientes"><i class="e" style="width:' + ancho(e.entregados) + '%"></i><i class="p" style="width:' + ancho(e.parciales) + '%"></i><i class="r" style="width:' + ancho(e.rechazos) + '%"></i></div>' +
        (otCam[e.patente] && otCam[e.patente].total ? '<span class="mini" title="OT en vivo: a tiempo sobre visitados (' + otCam[e.patente].ok + ' de ' + otCam[e.patente].visitados + '). OT del día: ' + pct(otCam[e.patente].ok, otCam[e.patente].total) + ' sobre ' + otCam[e.patente].total + ' pedidos.">OT vivo ' + pct(otCam[e.patente].ok, otCam[e.patente].visitados) + '</span>' : '') + '</div>' +
        '<div class="c-ritmo n"><span class="big">' + (e.ritmo ? e.ritmo.toFixed(1) : '—') + '</span><span class="mini">cli/h</span></div>' +
        '<div class="c-fin n"><span class="big">' + (e.fin ? hhmm(e.fin) : '—') + '</span><span class="mini">' +
        (e.fin && e.fin.toDateString() !== ahora.toDateString() ? 'mañana' : e.estado === 'ABIERTA' && e.pendientes ? (e.sinAvanceMin < 1 ? 'visita hace <1 min' : 'visita hace ' + Math.round(e.sinAvanceMin) + ' min') : e.estado === 'CERRADA' ? 'cerrada' : '') +
        '</span></div></div>';
      if (abierto) h += '<div class="det">' + detalle(e, E, ahora) + '</div>';
    });
    h += '</section>';

    // Columna de alertas, agrupadas por camión
    var conAlertas = cams.filter(function (e) { return e.alertas.length; });
    var nAl = conAlertas.reduce(function (s, e) { return s + e.alertas.length; }, 0);
    h += '<aside class="alertas"><h2>Alertas <small>' + nAl + '</small></h2>' +
      (conAlertas.length ? '<ul>' + conAlertas.map(function (e) {
        return '<li data-ir="' + esc(e.patente) + '" style="--c:' + COLOR[e.sem] + '">' + chapa(e.patente) + '<div>' + e.alertas.map(function (a) { return '<p>' + esc(a) + '</p>'; }).join('') + '</div></li>';
      }).join('') + '</ul>' : '<p class="sinalertas">Sin alertas por ahora.</p>') + '</aside></div>';

    h += '<p class="nota">La línea de cada camión va desde que levantó ruta hasta ahora; la parte punteada es la proyección al ritmo actual. ' +
      'Línea punteada vertical: fin objetivo. Franja rayada: ventana de apertura (' + ventanaApertura(ahora).join(' a ') + '). ' +
      'Ritmo = clientes visitados por hora desde el inicio de jornada. "Visita hace" se mide desde que este reporte vio el último cambio.</p>';
    $('contenido').innerHTML = h;
    if (popPat) refrescarPopover();
  }

  // ---------- histórico OT ----------
  var HOJA_HIST_URL = 'https://docs.google.com/spreadsheets/d/1kqOCYxMQEhT1TWf43lYzvaN4Oc0m-2GKAhoh2IaPC7k/edit';
  var CLAVE_HIST_CFG = 'ltReporteHistCfg';
  var hcfg = Object.assign({ url: '', dias: 30, ultimo: 0, cerrados: '', foto18: '' }, leerLS(CLAVE_HIST_CFG, {}));
  var hdat = null, herr = '', hleyendo = false, hguardando = false, hmsg = '';
  function guardarCfgHist() { guardarLS(CLAVE_HIST_CFG, hcfg); }
  function fechaISO(d) { d = d || new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }

  // Arma lo que se guarda: una fila por camión con detalle de clientes y una por cliente.
  function datosHistorico() {
    if (!nb) return null;
    var ahora = new Date(), fecha = fechaISO(ahora), camiones = [], clientes = [];
    nb.cams.forEach(function (cam) {
      var pat = String(cam.patente).toUpperCase(), lista = listaClientes(pat);
      if (!lista.length) return;
      var o = otDeCamion(pat, ahora), dc = ch && ch.data && ch.data[pat];
      camiones.push({ fecha: fecha, patente: pat, chofer: dc ? String(dc.chofer || '').replace(/^\d+\s*-\s*/, '') : '',
        jornada: dc && dc.jornadaLiq ? dc.jornadaLiq.join(', ') : '', estado: cam.estado === 'CERRADA' ? 'Cerrada' : 'Abierta',
        pedidos: o.total, ok: o.ok, fuera: o.fuera, sinhora: o.sinhora, vencido: o.vencido, pend: o.pend, rech: o.rech });
      lista.forEach(function (c) {
        var r = evaluarOT(pat, c, ahora);
        clientes.push({ fecha: fecha, patente: pat, codigo: c.codigo || '', cliente: String(c.cliente).replace(/^\s*\d+\s*-\s*/, ''),
          ventana: r.f.length ? textoVentana(r.f) : r.nota || 'Sin ventana', hora: r.h ? hhmm(r.h.t) : '',
          resultado: TXT_OT[r.st], fuente: r.h ? ({ chess: 'Liquidación Chess', nextbyn: 'Nextbyn', reporte: 'Visto por el reporte' })[r.h.fuente] : '',
          prox: r.h && r.h.prox != null ? Math.round(r.h.prox) : '' });
      });
    });
    return camiones.length ? { camiones: camiones, clientes: clientes } : null;
  }

  // Guarda cada 30 minutos, cuando un camión cierra la jornada y una vez después de las 18:00.
  function quizasGuardar() {
    if (!hcfg.url || !nb || !ch || hguardando) return;
    var ahora = new Date(), hoyS = fechaISO(ahora);
    var cerrados = nb.cams.filter(function (c) { return c.estado === 'CERRADA'; }).map(function (c) { return c.patente; }).sort().join(',');
    var motivo = '';
    if (Date.now() - hcfg.ultimo > 30 * 6e4) motivo = 'periódico';
    else if (cerrados !== hcfg.cerrados) motivo = 'cierre de jornada';
    else if (ahora.getHours() >= 18 && hcfg.foto18 !== hoyS) motivo = 'cierre del día';
    if (motivo) guardarHistorico();
  }
  function guardarHistorico() {
    var datos = datosHistorico();
    if (!hcfg.url) { hmsg = 'Falta pegar la dirección del script (paso 2).'; pintarHistorico(); return Promise.resolve(); }
    if (!datos) { hmsg = 'Todavía no hay datos de hoy para guardar: tocá Actualizar todo en el Tablero.'; pintarHistorico(); return Promise.resolve(); }
    hguardando = true; pintarHistorico();
    return pedir('guardarHistorico', { url: hcfg.url, datos: datos }).then(function (r) {
      var ahora = new Date();
      hcfg.ultimo = Date.now();
      hcfg.cerrados = nb.cams.filter(function (c) { return c.estado === 'CERRADA'; }).map(function (c) { return c.patente; }).sort().join(',');
      if (ahora.getHours() >= 18) hcfg.foto18 = fechaISO(ahora);
      guardarCfgHist();
      hmsg = 'Guardado a las ' + hhmm(ahora) + ': ' + r.camiones + (r.camiones === 1 ? ' camión' : ' camiones') + ' y ' + r.clientes + (r.clientes === 1 ? ' cliente.' : ' clientes.');
      herr = '';
    }).catch(function (e) {
      hmsg = '';
      herr = String(e.message || e) === 'NOEXT' ? 'Falta la extensión.' : 'No se pudo guardar: ' + (e.message || e);
    }).then(function () { hguardando = false; pintarHistorico(); });
  }

  function abrirHistorico() { if (!hdat && !hleyendo) leerHistorico(); else pintarHistorico(); }
  function leerHistorico() {
    hleyendo = true; pintarHistorico();
    var d = new Date(); d.setDate(d.getDate() - hcfg.dias + 1);
    return pedir('historico', { desde: fechaISO(d) }).then(function (r) {
      hdat = { camiones: filasHist(r.camiones, ['fecha', 'patente', 'chofer', 'pedidos', 'ok', 'fuera', 'sinhora', 'vencido', 'pend', 'rech']),
        clientes: filasHist(r.clientes, ['fecha', 'patente', 'codigo', 'cliente', 'ventana', 'resultado']), at: r.at };
      herr = '';
    }).catch(function (e) { herr = String(e.message || e) === 'NOEXT' ? 'Falta la extensión.' : String(e.message || e); })
      .then(function () { hleyendo = false; pintarHistorico(); });
  }
  function filasHist(csv, campos) {
    return leerCSV(csv || '').slice(1).filter(function (f) { return f[0]; }).map(function (f) {
      var o = {};
      campos.forEach(function (c, i) { o[c] = f[i] == null ? '' : String(f[i]).trim(); });
      var m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(o.fecha);
      if (m) o.fecha = m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
      o.fecha = o.fecha.slice(0, 10);
      ['pedidos', 'ok', 'fuera', 'sinhora', 'vencido', 'pend', 'rech'].forEach(function (k) { if (k in o) o[k] = +o[k] || 0; });
      return o;
    });
  }

  // Gráfico de barras del OT diario de la flota (SVG).
  function graficoOT(dias) {
    if (!dias.length) return '<p class="h-vacio">Todavía no hay días guardados en este rango.</p>';
    var W = Math.max(640, dias.length * 34), H = 220, pad = { l: 40, r: 10, t: 22, b: 34 };
    var bw = (W - pad.l - pad.r) / dias.length, y = function (v) { return pad.t + (1 - v) * (H - pad.t - pad.b); };
    var g = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" class="h-graf" role="img" aria-label="OT diario de la flota">';
    [0, 0.25, 0.5, 0.75, 1].forEach(function (v) {
      g += '<line x1="' + pad.l + '" x2="' + (W - pad.r) + '" y1="' + y(v) + '" y2="' + y(v) + '" class="h-grid"/><text x="' + (pad.l - 6) + '" y="' + (y(v) + 4) + '" class="h-eje" text-anchor="end">' + Math.round(v * 100) + '%</text>';
    });
    dias.forEach(function (d, i) {
      var v = d.pedidos ? d.ok / d.pedidos : 0, x = pad.l + i * bw + bw * 0.18, w = bw * 0.64;
      var cls = v >= 0.9 ? 'b-ok' : v >= 0.75 ? 'b-med' : 'b-mal';
      g += '<rect x="' + x + '" y="' + y(v) + '" width="' + w + '" height="' + (y(0) - y(v)) + '" class="' + cls + '" rx="2"><title>' + d.fecha + ': OT ' + Math.round(v * 100) + '% (' + d.ok + ' de ' + d.pedidos + ' a tiempo, ' + d.camiones + ' camiones)</title></rect>';
      if (dias.length <= 31) g += '<text x="' + (x + w / 2) + '" y="' + (y(v) - 5) + '" class="h-val" text-anchor="middle">' + Math.round(v * 100) + '</text>';
      if (dias.length <= 16 || i % Math.ceil(dias.length / 16) === 0) g += '<text x="' + (x + w / 2) + '" y="' + (H - 12) + '" class="h-eje" text-anchor="middle">' + d.fecha.slice(8, 10) + '/' + d.fecha.slice(5, 7) + '</text>';
    });
    return g + '</svg>';
  }

  function pintarHistorico() {
    var el = $('historico');
    if (!el) return;
    var h = '<div class="h-cab"><div><h2>Histórico de OT</h2><p>Pedidos entregados dentro de su ventana horaria sobre el total de pedidos de cada día. Los datos quedan en la hoja <a href="' + HOJA_HIST_URL + '" target="_blank" rel="noopener">Histórico OT</a>.</p></div>' +
      '<div class="h-ctrl"><label>Período <select id="h-dias">' + [7, 30, 90, 365].map(function (n) { return '<option value="' + n + '"' + (hcfg.dias === n ? ' selected' : '') + '>Últimos ' + n + ' días</option>'; }).join('') + '</select></label>' +
      '<button type="button" id="h-leer"' + (hleyendo ? ' disabled' : '') + '>' + (hleyendo ? 'Leyendo…' : 'Actualizar histórico') + '</button>' +
      '<button type="button" id="h-guardar"' + (hguardando ? ' disabled' : '') + '>' + (hguardando ? 'Guardando…' : 'Guardar el día ahora') + '</button></div></div>';
    if (herr) h += '<div class="err">' + esc(herr) + '</div>';
    if (hmsg) h += '<p class="h-msg">' + esc(hmsg) + '</p>';
    if (!hcfg.url) h += '<div class="h-setup"><h3>Configurar el guardado (una sola vez)</h3><ol>' +
      '<li>Abrí la hoja <a href="' + HOJA_HIST_URL + '" target="_blank" rel="noopener">Histórico OT</a> y entrá a <b>Extensiones → Apps Script</b>.</li>' +
      '<li>Borrá lo que aparece y pegá todo el código del archivo <a href="https://drive.google.com/file/d/1CSH4LK8JvPP7ZpJo2nDoAmPu5cHTcE_Q/view" target="_blank" rel="noopener">Codigo.gs</a> (está en la misma carpeta de Drive). Guardá con el ícono del disquete.</li>' +
      '<li>Tocá <b>Implementar → Nueva implementación</b>, elegí el tipo <b>Aplicación web</b>, con <b>Ejecutar como: Yo</b> y <b>Quién tiene acceso: Cualquier persona</b>. Autorizá los permisos que pide Google.</li>' +
      '<li>Copiá la <b>URL de la aplicación web</b> (termina en /exec) y pegala acá:</li></ol>' +
      '<div class="h-url"><input id="h-url" placeholder="https://script.google.com/macros/s/…/exec"><button type="button" id="h-url-ok">Guardar dirección</button></div>' +
      '<p class="h-nota">La dirección queda guardada en este Chrome. Cada PC que tenga el reporte abierto guarda los datos del día; si varias lo tienen abierto, queda el último envío.</p></div>';
    else h += '<p class="h-estado">Guardado automático activo en este Chrome' + (hcfg.ultimo ? ', último envío a las ' + hhmm(hcfg.ultimo) : '') + '. <button type="button" class="h-link" id="h-url-cambiar">Cambiar dirección del script</button></p>';

    if (hdat) {
      var porDia = {}, porCam = {}, porCli = {};
      hdat.camiones.forEach(function (r) {
        var d = (porDia[r.fecha] = porDia[r.fecha] || { fecha: r.fecha, pedidos: 0, ok: 0, camiones: 0 });
        d.pedidos += r.pedidos; d.ok += r.ok; d.camiones++;
        var c = (porCam[r.patente] = porCam[r.patente] || { patente: r.patente, chofer: r.chofer, dias: 0, pedidos: 0, ok: 0, fuera: 0, vencido: 0 });
        c.dias++; c.pedidos += r.pedidos; c.ok += r.ok; c.fuera += r.fuera; c.vencido += r.vencido; if (r.chofer) c.chofer = r.chofer;
      });
      hdat.clientes.forEach(function (r) {
        var k = r.codigo || r.cliente;
        var c = (porCli[k] = porCli[k] || { codigo: r.codigo, cliente: r.cliente, ventana: r.ventana, pedidos: 0, ok: 0, fuera: 0 });
        c.pedidos++; if (r.resultado === 'A tiempo') c.ok++; if (r.resultado === 'Fuera de ventana' || r.resultado === 'Ventana vencida') c.fuera++;
        c.ventana = r.ventana || c.ventana;
      });
      var dias = Object.keys(porDia).sort().map(function (k) { return porDia[k]; });
      var tot = dias.reduce(function (a, d) { a.p += d.pedidos; a.o += d.ok; return a; }, { p: 0, o: 0 });
      var ult = dias[dias.length - 1];
      h += '<section class="h-bloque"><div class="h-kpis"><div class="cifra"><b>' + pct(tot.o, tot.p) + '</b><span>OT del período, ' + tot.o + ' de ' + tot.p + ' pedidos</span></div>' +
        (ult ? '<div class="cifra"><b>' + pct(ult.ok, ult.pedidos) + '</b><span>último día guardado (' + ult.fecha.slice(8, 10) + '/' + ult.fecha.slice(5, 7) + ')</span></div>' : '') +
        '<div class="cifra"><b>' + dias.length + '</b><span>días con datos</span></div></div>' +
        '<h3>OT diario de la flota</h3><div class="h-scroll">' + graficoOT(dias) + '</div><p class="h-nota">Verde: 90% o más. Ámbar: de 75% a 89%. Rojo: menos de 75%.</p></section>';
      var cams = Object.keys(porCam).map(function (k) { return porCam[k]; }).sort(function (a, b) { return (a.pedidos ? a.ok / a.pedidos : 0) - (b.pedidos ? b.ok / b.pedidos : 0); });
      h += '<div class="h-dos"><section class="h-bloque"><h3>OT por camión</h3><table class="cli"><thead><tr><th>Camión</th><th>Chofer</th><th class="n">Días</th><th class="n">Pedidos</th><th class="n">Fuera de ventana</th><th class="n">OT</th></tr></thead><tbody>' +
        cams.map(function (c) { return '<tr><td>' + chapa(c.patente) + '</td><td>' + esc(c.chofer) + '</td><td class="n">' + c.dias + '</td><td class="n">' + c.pedidos + '</td><td class="n">' + (c.fuera + c.vencido) + '</td><td class="n"><b>' + pct(c.ok, c.pedidos) + '</b></td></tr>'; }).join('') +
        '</tbody></table></section>';
      var clis = Object.keys(porCli).map(function (k) { return porCli[k]; }).filter(function (c) { return c.fuera; })
        .sort(function (a, b) { return b.fuera - a.fuera || a.cliente.localeCompare(b.cliente); }).slice(0, 20);
      h += '<section class="h-bloque"><h3>Clientes con más entregas fuera de ventana</h3>' + (clis.length ? '<table class="cli"><thead><tr><th>Cliente</th><th>Ventana</th><th class="n">Fuera</th><th class="n">Pedidos</th><th class="n">OT</th></tr></thead><tbody>' +
        clis.map(function (c) { return '<tr><td><b>' + esc(c.codigo ? c.codigo + ' - ' : '') + esc(c.cliente) + '</b></td><td>' + esc(c.ventana) + '</td><td class="n">' + c.fuera + '</td><td class="n">' + c.pedidos + '</td><td class="n">' + pct(c.ok, c.pedidos) + '</td></tr>'; }).join('') +
        '</tbody></table>' : '<p class="h-vacio">Ningún cliente quedó fuera de ventana en este período.</p>') + '</section></div>';
    } else if (!hleyendo && !herr) h += '<p class="h-vacio">Tocá <b>Actualizar histórico</b> para ver los datos guardados.</p>';
    el.innerHTML = h;
  }
  $('historico').addEventListener('click', function (ev) {
    var t = ev.target;
    if (t.id === 'h-leer') leerHistorico();
    else if (t.id === 'h-guardar') guardarHistorico();
    else if (t.id === 'h-url-cambiar') { hcfg.url = ''; guardarCfgHist(); pintarHistorico(); }
    else if (t.id === 'h-url-ok') {
      var u = $('h-url').value.trim();
      if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(u)) { herr = 'La dirección tiene que ser la de la aplicación web y terminar en /exec.'; pintarHistorico(); return; }
      hcfg.url = u; herr = ''; guardarCfgHist(); guardarHistorico();
    }
  });
  $('historico').addEventListener('change', function (ev) {
    if (ev.target.id === 'h-dias') { hcfg.dias = +ev.target.value; guardarCfgHist(); leerHistorico(); }
  });

  // ---------- eventos ----------
  function alternar(p) { abiertos[p] = !abiertos[p]; pintar(); }
  $('b-todo').addEventListener('click', actualizarTodo);
  $('b-nb').addEventListener('click', function () { actualizar('nextbyn'); });
  $('b-ch').addEventListener('click', function () { actualizar('chess'); });
  $('auto').addEventListener('change', function () { programar(); pintarSub(); });
  // ---------- vista previa de prioridad (hover, foco o toque) ----------
  var pop = document.createElement('div');
  pop.className = 'pp';
  pop.setAttribute('role', 'dialog');
  pop.hidden = true;
  document.body.appendChild(pop);
  var popPat = '', popBtn = null, popFijo = false, popCierre = null;
  function abrirPopover(btn, fijo) {
    clearTimeout(popCierre);
    popBtn = btn; popPat = btn.getAttribute('data-prio'); popFijo = !!fijo;
    pop.innerHTML = vistaPrioridad(popPat);
    pop.setAttribute('aria-label', 'Prioridad de pedidos pendientes de ' + popPat);
    pop.hidden = false;
    var r = btn.getBoundingClientRect(), w = pop.offsetWidth, hgt = pop.offsetHeight;
    var x = Math.min(Math.max(8, r.left), window.innerWidth - w - 8);
    var y = r.bottom + 6;
    if (y + hgt > window.innerHeight - 8 && r.top - hgt - 6 > 8) y = r.top - hgt - 6;
    pop.style.left = x + window.scrollX + 'px';
    pop.style.top = y + window.scrollY + 'px';
  }
  function cerrarPopover() { pop.hidden = true; popPat = ''; popBtn = null; popFijo = false; }
  function cerrarLuego() { clearTimeout(popCierre); popCierre = setTimeout(function () { if (!popFijo) cerrarPopover(); }, 180); }
  function refrescarPopover() {
    if (!popPat) return;
    var b = document.querySelector('button.prio[data-prio="' + popPat.replace(/"/g, '') + '"]');
    if (b) abrirPopover(b, popFijo); else cerrarPopover();
  }
  $('contenido').addEventListener('mouseover', function (ev) {
    var b = ev.target.closest && ev.target.closest('button.prio');
    if (b && !popFijo && b !== popBtn) abrirPopover(b, false);
    else if (b) clearTimeout(popCierre);
  });
  $('contenido').addEventListener('mouseout', function (ev) {
    var b = ev.target.closest && ev.target.closest('button.prio');
    if (b && !b.contains(ev.relatedTarget) && !pop.contains(ev.relatedTarget)) cerrarLuego();
  });
  pop.addEventListener('mouseenter', function () { clearTimeout(popCierre); });
  pop.addEventListener('mouseleave', cerrarLuego);
  $('contenido').addEventListener('focusin', function (ev) {
    var b = ev.target.closest && ev.target.closest('button.prio');
    if (b && !popFijo) abrirPopover(b, false);
  });
  $('contenido').addEventListener('focusout', function (ev) {
    var b = ev.target.closest && ev.target.closest('button.prio');
    if (b && !popFijo) cerrarLuego();
  });
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && popPat) { var b = popBtn; cerrarPopover(); if (b) b.focus(); } });
  document.addEventListener('click', function (ev) {
    if (popPat && !pop.contains(ev.target) && !(ev.target.closest && ev.target.closest('button.prio'))) cerrarPopover();
  });
  window.addEventListener('resize', function () { if (popPat) cerrarPopover(); });

  $('contenido').addEventListener('click', function (ev) {
    var bp = ev.target.closest('button.prio');
    if (bp) {
      ev.stopPropagation();
      // Clic o toque: deja la vista fija (en el celular no hay hover). Otro clic la cierra.
      if (popFijo && popBtn === bp) cerrarPopover(); else abrirPopover(bp, true);
      return;
    }
    var cl = ev.target.closest('tr.cl');
    if (cl) { var k = cl.getAttribute('data-cl'); clientesAbiertos[k] = !clientesAbiertos[k]; pintar(); return; }
    var ir = ev.target.closest('li[data-ir]');
    if (ir) {
      var p0 = ir.getAttribute('data-ir');
      abiertos[p0] = true; pintar();
      var f = document.querySelector('.fila[data-p="' + p0.replace(/"/g, '') + '"]');
      if (f) f.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    var fila = ev.target.closest('.fila');
    if (fila) alternar(fila.getAttribute('data-p'));
  });
  $('contenido').addEventListener('keydown', function (ev) {
    if (ev.target.closest && ev.target.closest('button.prio')) return;
    var fila = ev.target.closest && ev.target.closest('.fila');
    if (fila && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); alternar(fila.getAttribute('data-p')); }
  });
  $('l-obj').firstChild.textContent = 'Fin objetivo ' + (sabado() ? '(sábados)' : '(lun a vie)');
  $('obj').value = objetivo(new Date());
  $('sin').value = cfg.sinAvance;
  $('obj').addEventListener('change', function (e) {
    if (!/^\d{1,2}:\d{2}$/.test(e.target.value)) { e.target.value = objetivo(new Date()); return; }
    if (sabado()) cfg.objSab = e.target.value; else cfg.objLV = e.target.value;
    guardarLS(CLAVE_CFG, cfg); pintar();
  });
  $('sin').addEventListener('change', function (e) {
    if (!(+e.target.value > 0)) { e.target.value = cfg.sinAvance; return; }
    cfg.sinAvance = +e.target.value; guardarLS(CLAVE_CFG, cfg); pintar();
  });
  var dias = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  var meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  var d0 = new Date();
  $('hoy').textContent = 'CD Neuquén, ' + dias[d0.getDay()] + ' ' + d0.getDate() + ' de ' + meses[d0.getMonth()];
  setInterval(pintarSub, 1000);
  // Redibuja cada minuto para que la línea de "ahora" avance aunque no haya datos nuevos.
  setInterval(function () { if (nb && location.hash !== '#guia') pintar(); }, 60000);

  // ---------- pestañas: Tablero / Guía instalación extensión ----------
  function mostrarVista() {
    var v = location.hash === '#guia' ? 'guia' : location.hash === '#historico' ? 'historico' : 'tablero';
    $('main').hidden = v !== 'tablero';
    $('guia').hidden = v !== 'guia';
    $('historico').hidden = v !== 'historico';
    document.body.classList.toggle('ver-guia', v !== 'tablero');
    ['tablero', 'historico', 'guia'].forEach(function (k) {
      $('tab-' + k).classList.toggle('act', v === k);
      $('tab-' + k).setAttribute('aria-selected', String(v === k));
    });
    if (v === 'historico') abrirHistorico();
  }
  window.addEventListener('hashchange', function () { mostrarVista(); window.scrollTo(0, 0); });
  mostrarVista();

  pintar();
  actualizarTodo();
})();
