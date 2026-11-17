// Reporte externo del Tablero de ruta.
// Funciona igual abierto desde la extensión (ícono) o publicado en GitHub Pages:
// en los dos casos le pide los datos a la extensión, que lee Nextbyn y Chess con tu sesión.
/* global chrome */
(function () {
  'use strict';

  var EXT_ID = 'npppbmphladglegjkaakkakllgnhmmgn';
  var GUIA = 'https://darianjorgevich.github.io/tablero-ruta/guia.html';
  var CADA = 5 * 60 * 1000;
  var CLAVE_CFG = 'ltReporteCfg';
  var CLAVE_HIST = 'ltReporteHist';
  var CLAVE_DATOS = 'ltReporteDatos';

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

  // ---------- configuración ----------
  var cfg = Object.assign({ objLV: '15:00', objSab: '13:00', sinAvance: 45 }, leerLS(CLAVE_CFG, {}));
  function objetivo(d) { return sabado(d) ? cfg.objSab : cfg.objLV; }
  function ventanaApertura(d) { return sabado(d) ? ['08:00', '08:30'] : ['07:30', '08:00']; }

  // ---------- estado ----------
  var guardado = leerLS(CLAVE_DATOS, {});
  var hoy = new Date().toDateString();
  var nb = guardado.nb && new Date(guardado.nb.at).toDateString() === hoy ? guardado.nb : null; // { cams, cli, at }
  var ch = guardado.ch && new Date(guardado.ch.at).toDateString() === hoy ? guardado.ch : null; // { data, at }
  var errNb = '', errCh = '', sinExtension = false;
  var abiertos = {}, clientesAbiertos = {};
  var ocupado = { nextbyn: false, chess: false };
  var proxima = 0, timer = null;

  // ---------- conexión con la extensión ----------
  function enExtension() { return location.protocol === 'chrome-extension:'; }
  function pedir(tipo) {
    return new Promise(function (resolve, reject) {
      function cb(r) {
        var le = chrome.runtime && chrome.runtime.lastError;
        if (le || !r) return reject(new Error(le ? 'NOEXT' : 'La extensión no respondió.'));
        r.ok ? resolve(r.data) : reject(new Error(r.error));
      }
      try {
        if (enExtension()) chrome.runtime.sendMessage({ tipo: tipo }, cb);
        else if (window.chrome && chrome.runtime && chrome.runtime.sendMessage) chrome.runtime.sendMessage(EXT_ID, { tipo: tipo }, cb);
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
      if (tipo === 'nextbyn') { nb = data; errNb = ''; } else { ch = data; errCh = ''; }
      guardarLS(CLAVE_DATOS, { nb: nb, ch: ch });
    }, function (e) {
      var m = String(e.message || e);
      if (m === 'NOEXT') { sinExtension = true; m = 'Falta la extensión'; }
      if (tipo === 'nextbyn') errNb = m; else errCh = m;
    }).then(function () { ocupado[tipo] = false; pintar(); });
  }

  function actualizarTodo() {
    programar();
    return Promise.all([actualizar('nextbyn'), actualizar('chess')]);
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
      } else if (e.pendientes === 0) { e.sem = 'verde'; e.txt = 'Sin pendientes · falta cerrar'; }
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

  // ---------- clientes de un camión ----------
  function estadoNextbyn(s) {
    if (/RECHAZO.*PARCIAL|PARCIAL/.test(s)) return 'parcial';
    if (/^RECHAZO/.test(s)) return 'rechazado';
    if (/^ENTREGA/.test(s)) return 'entregado';
    return '';
  }
  function pillEstado(c) {
    if (c.est === 'rechazado') return '<span class="pill p-re">✕ Rechazado</span>';
    if (c.est === 'parcial') return '<span class="pill p-re">◐ Rechazo parcial</span>';
    if (c.est === 'entregado') return '<span class="pill p-ok">✓ Entregado</span>';
    if (c.nbEstado) return '<span class="pill p-pe">' + esc(c.nbEstado.replace(/_/g, ' ').toLowerCase().replace(/^./, function (x) { return x.toUpperCase(); })) + '</span>';
    return '<span class="pill p-pe">' + (c.leidoNextbyn ? 'Pendiente' : 'En reparto') + '</span>';
  }

  function detalle(cam) {
    var pat = String(cam.patente).toUpperCase();
    var nbCli = (nb && nb.cli && nb.cli.p && nb.cli.p[pat]) || {};
    var hayNb = !!(nb && nb.cli && nb.cli.n);
    var dc = ch && ch.data && ch.data[pat];

    // Sin Chess: lista de Nextbyn sola.
    if (!dc) {
      var ids = Object.keys(nbCli);
      var msg = !ch ? (errCh ? 'Chess: ' + esc(errCh) : 'Tocá <b>Chess</b> arriba para sumar importes, bultos y cajones.') : 'Chess no tiene planilla con entrega hoy para ' + esc(pat) + '.';
      if (!ids.length) return '<div class="dres">' + msg + '</div>';
      var lista = ids.map(function (id) { var x = nbCli[id]; return { cliente: (id.indexOf('N:') ? id + ' - ' : '') + x.nombre, domicilio: x.domicilio, nbEstado: x.estado, leidoNextbyn: true, est: estadoNextbyn(x.estado) }; });
      lista.sort(function (a, b) { return orden(a) - orden(b) || a.cliente.localeCompare(b.cliente); });
      return '<div class="dres"><span>' + msg + '</span><span>Clientes: <b>' + lista.length + '</b> · entregados: <b>' + lista.filter(function (c) { return c.est === 'entregado'; }).length + '</b></span></div>' +
        '<table class="cli"><thead><tr><th>Estado</th><th>Cliente</th><th>Domicilio</th></tr></thead><tbody>' +
        lista.map(function (c) { return '<tr><td>' + pillEstado(c) + '</td><td><b>' + esc(c.cliente) + '</b></td><td>' + esc(c.domicilio) + '</td></tr>'; }).join('') + '</tbody></table>';
    }

    // Con Chess: cruza cada cliente con su estado en Nextbyn (por código, o por nombre).
    var porNombre = {};
    Object.keys(nbCli).forEach(function (k) { porNombre[nz(nbCli[k].nombre)] = nbCli[k]; });
    var cs = dc.clientes.map(function (c0) {
      var c = Object.assign({}, c0);
      var id = (/^\s*(\d+)/.exec(c.cliente) || [])[1];
      var x = (id && nbCli[id]) || porNombre[nz(String(c.cliente).replace(/^\s*\d+\s*-\s*/, ''))];
      c.leidoNextbyn = !!x;
      c.nbEstado = x ? x.estado : '';
      c.est = c.rechazado ? 'rechazado' : c.parcial ? 'parcial' : c.entregado ? 'entregado' : '';
      var s = x && estadoNextbyn(x.estado);
      if (s === 'rechazado' || s === 'parcial') c.est = s;
      else if (s === 'entregado' && !c.est) c.est = 'entregado';
      return c;
    });
    cs.sort(function (a, b) { return orden(a) - orden(b) || String(a.cliente).localeCompare(b.cliente); });
    var nRe = cs.filter(function (c) { return c.est === 'rechazado' || c.est === 'parcial'; }).length;
    var nEnt = cs.filter(function (c) { return c.est === 'entregado'; }).length;
    var h = '<div class="dres"><span>Chofer: <b>' + esc(String(dc.chofer || '').replace(/^\d+\s*-\s*/, '')) + '</b></span>' +
      '<span>Planillas: <b>' + esc(dc.planillas.join(', ')) + '</b></span>' +
      '<span>Clientes: <b>' + cs.length + '</b> · entregados: <b>' + nEnt + '</b>' + (nRe ? ' · rechazos: <b>' + nRe + '</b>' : '') + '</span>' +
      '<span>Importe: <b>' + plata(dc.importe) + '</b></span><span>Bultos: <b>' + Math.round(dc.bultos) + '</b></span>' +
      '<span>Cajones retornables: <b>' + Math.round(dc.cajones) + '</b></span>' +
      (hayNb ? '' : '<span>⚠ Sin estados de Nextbyn: el estado sale de Chess.</span>') + '</div>' +
      '<table class="cli"><thead><tr><th>Estado</th><th>Cliente</th><th>Domicilio</th><th>Localidad</th><th>Comprobante</th><th class="n">Importe</th><th class="n">Bultos</th><th class="n">Cajones RET</th></tr></thead><tbody>';
    cs.forEach(function (c) {
      var k = pat + '|' + c.cliente, abierto = !!clientesAbiertos[k];
      h += '<tr class="cl" data-cl="' + esc(k) + '"><td>' + pillEstado(c) +
        (c.motivos && c.motivos.length ? '<span class="al" style="margin-left:0">' + esc(c.motivos.join(', ')) + '</span>' : '') +
        '</td><td><span class="car' + (abierto ? ' rot' : '') + '">▸</span><b>' + esc(c.cliente) + '</b></td><td>' + esc(c.domicilio) + '</td><td>' + esc(c.localidad) +
        '</td><td style="font-size:11.5px">' + esc(c.comprobantes.join(' · ')) + '</td><td class="n">' + plata(c.importe) + '</td><td class="n">' + num(c.bultos) + '</td><td class="n">' + num(c.cajones) + '</td></tr>';
      if (abierto) {
        h += '<tr class="prod"><td colspan="8"><table>' + c.items.map(function (it) {
          return '<tr><td>' + (it.rechazado ? '✕ ' : '') + esc(it.articulo) + (it.ret ? ' <span class="pill p-pe">RET</span>' : '') + '</td><td class="n">' + num(it.bultos) + ' bultos</td><td class="n">' + plata(it.importe) + '</td></tr>';
        }).join('') + '</table></td></tr>';
      }
    });
    return h + '</tbody></table>';
  }
  function orden(c) { return { rechazado: 0, parcial: 0, '': 1, entregado: 2 }[c.est || ''] ; }

  // ---------- pintar ----------
  function pintarBotones() {
    $('b-nb').disabled = ocupado.nextbyn;
    $('b-ch').disabled = ocupado.chess;
    $('b-todo').disabled = ocupado.nextbyn && ocupado.chess;
    var tn = $('t-nb'), tc = $('t-ch');
    tn.textContent = ocupado.nextbyn ? 'leyendo…' : errNb ? '⚠' : nb ? hhmm(nb.at) : '—';
    tc.textContent = ocupado.chess ? 'leyendo…' : errCh ? '⚠' : ch ? hhmm(ch.at) : '—';
    tn.className = 'hora' + (errNb && !ocupado.nextbyn ? ' err' : '');
    tc.className = 'hora' + (errCh && !ocupado.chess ? ' err' : '');
    $('b-nb').title = errNb || (nb ? 'Datos de Nextbyn de las ' + hhmm(nb.at) + '. Tocá para volver a leer.' : 'Leer Nextbyn');
    $('b-ch').title = errCh || (ch ? 'Datos de Chess de las ' + hhmm(ch.at) + '. Tocá para volver a leer.' : 'Leer Chess');
  }

  function pintarSub() {
    var t = nb ? 'Datos de Nextbyn de las ' + hhmm(nb.at) + ' · ' + ((nb.cli && nb.cli.n) || 0) + ' clientes con estado' : 'Sin datos de Nextbyn todavía';
    if (proxima) { var s = Math.max(0, Math.round((proxima - Date.now()) / 1000)); t += ' · próxima actualización en ' + Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }
    $('sub').textContent = t;
  }

  function kpi(t, v) { return '<div class="kpi"><span>' + t + '</span><b>' + v + '</b></div>'; }

  function pintar() {
    pintarBotones();
    pintarSub();
    var av = '';
    if (sinExtension) {
      av += '<div class="err">Para traer los datos hace falta la extensión <b>Tablero de ruta</b> en este Chrome. <a href="' + GUIA + '" target="_blank" rel="noopener">Cómo instalarla</a>.</div>';
    } else {
      if (errNb) av += '<div class="err">Nextbyn: ' + esc(errNb) + (nb ? ' Se muestran los datos de las ' + hhmm(nb.at) + '.' : '') + '</div>';
      if (errCh) av += '<div class="err">Chess: ' + esc(errCh) + (ch ? ' Se muestran los datos de las ' + hhmm(ch.at) + '.' : '') + '</div>';
    }
    $('aviso').innerHTML = av;
    $('vacio').hidden = !!nb;
    if (!nb) { $('contenido').innerHTML = ''; return; }

    var ahora = new Date();
    var cams = analizar(nb.cams, ahora);
    var cuenta = { rojo: 0, amarillo: 0, verde: 0, azul: 0, gris: 0 }, tot = { h: 0, r: 0, t: 0 };
    var alertas = [];
    cams.forEach(function (e) {
      cuenta[e.sem]++; tot.h += e.hechos; tot.r += e.rechazos; tot.t += e.total;
      e.alertas.forEach(function (a) { alertas.push({ p: e.patente, a: a, s: e.sem }); });
    });
    var enRuta = cams.filter(function (e) { return e.estado === 'ABIERTA'; }).length;
    var h = '<div class="kpis">' + kpi('Camiones en ruta', enRuta) + kpi('Jornadas cerradas', cams.length - enRuta) +
      kpi('<span class="dot rojo"></span> Demorados / alerta', cuenta.rojo) + kpi('<span class="dot amarillo"></span> Ajustados / revisar', cuenta.amarillo) +
      kpi('<span class="dot verde"></span> En horario', cuenta.verde) + kpi('Clientes visitados', tot.h + ' / ' + tot.t) +
      kpi('Avance general', (tot.t ? Math.round((tot.h / tot.t) * 100) : 0) + '%') + kpi('Rechazos', tot.r) + '</div>';
    if (alertas.length) {
      h += '<div class="box"><h2>Alertas (' + alertas.length + ')</h2><ul class="alerts">' + alertas.map(function (a) {
        return '<li><span class="dot ' + a.s + '"></span> <b>' + esc(a.p) + '</b> — ' + esc(a.a) + '</li>';
      }).join('') + '</ul></div>';
    }
    h += '<div class="box"><h2>Estado por camión <small>· tocá un camión para ver sus clientes</small></h2><div class="scroll"><table><thead><tr>' +
      '<th>Estado</th><th>Patente</th><th>Vehículo</th><th>Inicio</th><th class="n">En ruta</th><th>Avance</th><th class="n">Entreg.</th><th class="n">Parc.</th><th class="n">Rech.</th><th class="n">Pend.</th><th class="n">% Nextbyn</th><th class="n">Ritmo (cli/h)</th><th class="n">Fin estimado</th><th class="n">Últ. visita hace</th></tr></thead><tbody>';
    cams.forEach(function (e) {
      var ancho = function (x) { return e.total ? ((x / e.total) * 110).toFixed(1) : 0; };
      var abierto = !!abiertos[e.patente];
      h += '<tr class="cam' + (abierto ? ' open' : '') + '" data-p="' + esc(e.patente) + '"><td class="est"><span class="sem"><span class="dot ' + e.sem + '"></span>' + esc(e.txt) + '</span>' +
        e.alertas.filter(function (a) { return a.indexOf('Cerró la jornada') !== 0; }).map(function (a) { return '<span class="al">⚠ ' + esc(a) + '</span>'; }).join('') +
        (e.aviso ? '<span class="al sec">⚠ ' + esc(e.aviso) + '</span>' : '') +
        '</td><td><span class="car">▸</span><b>' + esc(e.patente) + '</b></td><td>' + esc(e.vehiculo) + '</td>' +
        '<td' + (e.tarde ? ' style="color:var(--aviso)" title="Levantó ruta ' + e.tarde + ' min después de la ventana esperada"' : '') + '>' + hhmm(e.inicio) + '</td>' +
        '<td class="n">' + (e.estado === 'ABIERTA' ? horas(e.horas) : '—') + '</td>' +
        '<td><div class="bar" title="' + e.hechos + ' de ' + e.total + ' clientes"><i class="e" style="width:' + ancho(e.entregados) + 'px"></i><i class="p" style="width:' + ancho(e.parciales) + 'px"></i><i class="r" style="width:' + ancho(e.rechazos) + 'px"></i></div></td>' +
        '<td class="n">' + e.entregados + '</td><td class="n">' + e.parciales + '</td><td class="n">' + e.rechazos + '</td><td class="n">' + e.pendientes + '</td>' +
        '<td class="n">' + (e.pct == null ? '—' : e.pct + '%') + '</td><td class="n">' + (e.ritmo ? e.ritmo.toFixed(1) : '—') + '</td>' +
        '<td class="n">' + (e.fin ? (e.fin.toDateString() !== ahora.toDateString() ? 'mañana ' : '') + hhmm(e.fin) : '—') + '</td>' +
        '<td class="n">' + (e.estado === 'ABIERTA' && e.pendientes ? (e.sinAvanceMin < 1 ? '<1 min' : Math.round(e.sinAvanceMin) + ' min') : '—') + '</td></tr>';
      if (abierto) h += '<tr class="det"><td colspan="14">' + detalle(e) + '</td></tr>';
    });
    h += '</tbody></table></div></div><div class="nota">Ritmo = clientes visitados por hora desde el inicio de jornada (incluye la salida del CD). Fin estimado = ahora + pendientes ÷ ritmo. ' +
      'Verde: termina antes de la hora objetivo · Amarillo: hasta 1 h después · Rojo: más de 1 h después, sin visitas o cerró con pendientes. ' +
      'Horarios de referencia: apertura 07:30 a 08:00 (sábados 08:00 a 08:30) · fin 15:00 (sábados 13:00). "Últ. visita hace" se mide desde que este reporte vio el último cambio.</div>';
    $('contenido').innerHTML = h;
  }

  // ---------- eventos ----------
  $('b-todo').addEventListener('click', actualizarTodo);
  $('b-nb').addEventListener('click', function () { actualizar('nextbyn'); });
  $('b-ch').addEventListener('click', function () { actualizar('chess'); });
  $('auto').addEventListener('change', function () { programar(); pintarSub(); });
  $('contenido').addEventListener('click', function (ev) {
    var cl = ev.target.closest('tr.cl');
    if (cl) { var k = cl.getAttribute('data-cl'); clientesAbiertos[k] = !clientesAbiertos[k]; pintar(); return; }
    var tr = ev.target.closest('tr.cam');
    if (tr) { var p = tr.getAttribute('data-p'); abiertos[p] = !abiertos[p]; pintar(); }
  });
  $('l-obj').firstChild.textContent = 'Fin objetivo ' + (sabado() ? '(sáb)' : '(lun-vie)');
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
  setInterval(pintarSub, 1000);

  pintar();
  actualizarTodo();
})();
