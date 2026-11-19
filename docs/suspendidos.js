/* Tablero de ruta — sección "Clientes suspendidos".
   Lee la planilla de seguimiento (Google Sheets "Seguimiento_Clientes_Suspendidos", pestaña
   "Clientes Suspendidos": cliente, inicio, fin, motivo) a través de la extensión y muestra
   la escalera de sanciones, el historial por cliente, el registro completo y el criterio.
   Regla: el escalón sale solo de la cantidad de suspensiones registradas (no vencen). */
(function () {
  'use strict';
  var R = window.LTReporte;
  if (!R) return;
  var raiz = document.getElementById('suspendidos');
  var PLANILLA = 'https://docs.google.com/spreadsheets/d/1FBrsS_SAlZC3_GpuWe7L4KoFeaeATls4-BRujjoXSG0/edit#gid=642664049';
  var CLAVE = 'ltReporteSusp';
  var ESCALA = [7, 14, 20, null]; // null = bloqueo
  var ORD = ['1.ª', '2.ª', '3.ª', '4.ª'];
  var DIA = 864e5;
  var esc = R.esc;

  var datos = leer(); // { filas, at }
  var cargando = false, error = '';
  var st = { filtro: 'todos', esc: null, q: '', abiertos: {} };
  var CLIENTES = [], EVENTOS = [], OBS = [];
  var armado = false;

  function leer() { try { return JSON.parse(localStorage.getItem(CLAVE)) || null; } catch (e) { return null; } }
  function guardar() { try { localStorage.setItem(CLAVE, JSON.stringify(datos)); } catch (e) { /* sin almacenamiento */ } }
  function norm(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim(); }
  function fecha(s) {
    s = String(s || '').trim();
    if (!s) return null;
    var m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/.exec(s);
    if (m) { var y = +m[3]; if (y < 100) y += 2000; return new Date(y, +m[2] - 1, +m[1]); }
    m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    return null;
  }
  function hoy() { var t = new Date(); return new Date(t.getFullYear(), t.getMonth(), t.getDate()); }
  function fmt(d) { return d ? d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'; }
  function fmtC(d) { return d ? d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' }) : '—'; }
  function hhmm(t) { return new Date(t).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false }); }
  function dif(a, b) { return Math.round((b - a) / DIA); }
  function escalaTxt(i) { return i >= 3 ? 'Bloqueo' : ESCALA[i] + ' días'; }

  // "397953 - 407229 WU LIFENG" → códigos [397953, 407229], nombre "WU LIFENG"
  function separar(crudo) {
    var partes = crudo.split(/\s*-\s*/), codigos = [], resto = [];
    partes.forEach(function (p) {
      var m = /^(\d+)\s*(.*)$/.exec(p);
      if (m && !resto.length) { codigos.push(m[1]); if (m[2]) resto.push(m[2]); } else resto.push(p);
    });
    return { codigos: codigos, nombre: resto.join(' - ').trim() || crudo.trim() };
  }

  function armar(filas) {
    var mapa = {}, H = hoy();
    OBS = [];
    filas.forEach(function (r, idx) {
      var crudo = String(r[0] || '').trim();
      var ini = fecha(r[1]), fin = fecha(r[2]);
      if (!crudo || /^nota/i.test(crudo) || !ini) return;
      var s = separar(crudo), k = norm(s.nombre);
      var c = mapa[k] || (mapa[k] = { k: k, nombre: s.nombre, codigos: {}, ev: [] });
      s.codigos.forEach(function (x) { c.codigos[x] = 1; });
      var e = c.ev.filter(function (x) { return +x.ini === +ini; })[0];
      if (e) { s.codigos.forEach(function (x) { e.codigos[x] = 1; }); e.dup++; return; }
      var cods = {};
      s.codigos.forEach(function (x) { cods[x] = 1; });
      c.ev.push({ ini: ini, fin: fin, mot: String(r[3] || '').trim(), codigos: cods, dup: 1, fila: idx + 2 });
    });
    CLIENTES = Object.keys(mapa).map(function (k) {
      var c = mapa[k];
      c.ev.sort(function (a, b) { return a.ini - b.ini; });
      c.ev.forEach(function (e, i) {
        e.dias = e.fin ? dif(e.ini, e.fin) : null;
        e.mal = !!(e.fin && e.fin < e.ini);
        e.n = Math.min(i, 3);
        e.esc = ESCALA[e.n];
        e.cli = c;
        if (e.mal) OBS.push('<b>' + esc(c.nombre) + '</b>: la fecha de finalización (' + fmt(e.fin) + ') es anterior al inicio (' + fmt(e.ini) + '). Fila ' + e.fila + '.');
        if (e.dup > 1) OBS.push('<b>' + esc(c.nombre) + '</b>: ' + e.dup + ' filas con distinto código y el mismo inicio (' + fmt(e.ini) + ') se contaron como una sola suspensión (códigos ' + Object.keys(e.codigos).join(', ') + ').');
      });
      var u = c.ev[c.ev.length - 1];
      c.n = c.ev.length;
      c.ult = u;
      c.escalon = Math.min(c.n, 4);
      c.estado = u.mal ? 'ok' : (!u.fin || H < u.fin) ? 'sus' : +H === +u.fin ? 'hoy' : 'ok';
      c.revisar = c.ev.filter(function (e) { return e.mal; }).length;
      c.codigos = Object.keys(c.codigos);
      c.busca = norm(c.nombre + ' ' + c.codigos.join(' '));
      return c;
    });
    var ord = { sus: 0, hoy: 1, ok: 2 };
    CLIENTES.sort(function (a, b) { return b.n - a.n || ord[a.estado] - ord[b.estado] || b.ult.ini - a.ult.ini; });
    EVENTOS = [];
    CLIENTES.forEach(function (c) { EVENTOS = EVENTOS.concat(c.ev); });
    EVENTOS.sort(function (a, b) { return b.ini - a.ini; });
  }

  function cargar(forzar) {
    if (cargando) return;
    if (!forzar && datos && Date.now() - datos.at < 5 * 6e4) return;
    cargando = true; pintarEstado();
    R.pedir('suspendidos').then(function (d) {
      var filas = R.leerCSV(d.csv);
      var iTit = filas.findIndex(function (r) { return /cliente/i.test(String(r[0] || '')); });
      datos = { filas: filas.slice(iTit + 1), at: d.at || Date.now() };
      guardar();
      error = '';
    }, function (e) {
      var m = String((e && e.message) || e);
      error = m === 'NOEXT' ? 'Para leer la planilla hace falta la extensión Tablero de ruta en este Chrome.' : m;
    }).then(function () { cargando = false; pintar(); });
  }

  // ---------- dibujo ----------
  function vistaActual() {
    var v = location.hash.split('/')[1] || 'resumen';
    return ['resumen', 'registro', 'criterio'].indexOf(v) >= 0 ? v : 'resumen';
  }
  function esqueleto() {
    raiz.innerHTML =
      '<div class="sp-cab">' +
        '<div><h2 class="sp-tit">Clientes suspendidos</h2><p class="sp-sub" id="sp-estado"></p></div>' +
        '<div class="sp-acc"><button type="button" class="sp-btn" id="sp-act">Actualizar</button>' +
        '<a class="sp-btn sp-sec" href="' + PLANILLA + '" target="_blank" rel="noopener">Abrir planilla</a></div>' +
      '</div>' +
      '<nav class="sp-sub-nav" aria-label="Vistas de clientes suspendidos">' +
        '<a href="#suspendidos" data-v="resumen">Escalera y clientes</a>' +
        '<a href="#suspendidos/registro" data-v="registro">Registro completo</a>' +
        '<a href="#suspendidos/criterio" data-v="criterio">Criterio y observaciones</a>' +
      '</nav>' +
      '<div id="sp-aviso"></div>' +
      '<div data-sp="resumen">' +
        '<div class="sp-escalera">' +
          '<div class="sp-intro"><div><h3>Cada reincidencia sube un escalón</h3>' +
          '<p class="sp-sub">La sanción se define por la cantidad de suspensiones que el cliente ya tiene registradas. Tocá un escalón para ver quiénes están en él.</p></div>' +
          '<div class="sp-hoy" id="sp-hoy"></div></div>' +
          '<div class="sp-esc" id="sp-esc" role="group" aria-label="Escala de suspensiones"></div><div class="sp-suelo"></div>' +
        '</div>' +
        '<div class="sp-bloque"><h3>Historial por cliente</h3><p class="sp-sub" id="sp-lsub"></p>' +
          '<div class="sp-herr"><label class="sp-busca"><span class="sr">Buscar cliente</span>' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>' +
          '<input id="sp-q" type="search" placeholder="Buscar por nombre o código de cliente"></label>' +
          '<div class="sp-filtros" id="sp-filtros" role="group" aria-label="Filtros"></div></div>' +
          '<div class="sp-lista" id="sp-lista"></div>' +
        '</div>' +
      '</div>' +
      '<div data-sp="registro" hidden><h3>Registro completo de suspensiones</h3>' +
        '<p class="sp-sub">Una fila por suspensión, de la más reciente a la más antigua. “Según escala” muestra los días que corresponden por el número de suspensión.</p>' +
        '<div class="sp-tabla"><table><thead><tr><th>Inicio</th><th>Fin</th><th>Cliente</th><th>Código</th><th>N.º</th><th class="r">Días aplicados</th><th class="r">Según escala</th><th>Motivo</th></tr></thead><tbody id="sp-reg"></tbody></table></div>' +
      '</div>' +
      '<div data-sp="criterio" hidden><div class="sp-dos">' +
        '<div class="sp-card"><h3>Escala de suspensiones</h3><ol>' +
          '<li><b>1.ª suspensión:</b> 7 días.</li><li><b>2.ª suspensión:</b> 14 días.</li><li><b>3.ª suspensión:</b> 20 días.</li>' +
          '<li><b>4.ª suspensión:</b> bloqueo indefinido y reevaluación de la atención al cliente en conjunto con Gerente, Jefe de ventas, Jefa de administración y Jefe de operaciones.</li></ol>' +
          '<h3>Cómo se lee la planilla</h3><ul>' +
          '<li>Las suspensiones se agrupan por cliente usando el nombre. Si un mismo cliente tiene varios códigos, se muestran todos juntos.</li>' +
          '<li>Varias filas del mismo cliente con la misma fecha de inicio cuentan como una sola suspensión.</li>' +
          '<li>El cliente vuelve a recibir pedidos en la fecha de finalización. Si está vacía, se considera suspendido hasta que se complete.</li>' +
          '<li>Las suspensiones no vencen: cuentan siempre para el escalón del cliente.</li>' +
          '<li>El escalón se define solo por la cantidad de suspensiones registradas, sin importar cuántos días se aplicaron en cada una. Un cliente con una sola suspensión de 14 días pasa a 14 días si reincide, por ser la 2.ª vez.</li>' +
          '<li>“Si reincide” indica la sanción que corresponde a la próxima suspensión.</li></ul></div>' +
        '<div class="sp-card"><h3>Observaciones sobre los datos</h3><p class="sp-sub">Casos para revisar en la planilla.</p><ul id="sp-obs"></ul></div>' +
      '</div></div>';
    armado = true;
    raiz.querySelector('#sp-act').addEventListener('click', function () { cargar(true); });
    raiz.querySelector('#sp-q').addEventListener('input', function (e) { st.q = e.target.value; pintarLista(); });
    raiz.querySelector('#sp-esc').addEventListener('click', function (e) {
      var b = e.target.closest('.sp-paso');
      if (!b) return;
      var s = +b.getAttribute('data-paso');
      st.esc = st.esc === s ? null : s;
      pintarEscalera(); pintarFiltros(); pintarLista();
    });
    raiz.querySelector('#sp-filtros').addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      if (b.hasAttribute('data-sin-esc')) st.esc = null; else st.filtro = b.getAttribute('data-f');
      pintarEscalera(); pintarFiltros(); pintarLista();
    });
    raiz.querySelector('#sp-lista').addEventListener('click', function (e) {
      var r = e.target.closest('.sp-fila');
      if (!r) return;
      var k = r.getAttribute('data-k');
      if (st.abiertos[k]) delete st.abiertos[k]; else st.abiertos[k] = 1;
      pintarLista();
      var otra = Array.prototype.filter.call(raiz.querySelectorAll('.sp-fila'), function (x) { return x.getAttribute('data-k') === k; })[0];
      if (otra) otra.focus();
    });
  }

  function pintarEstado() {
    var e = raiz.querySelector('#sp-estado');
    if (!e) return;
    var b = raiz.querySelector('#sp-act');
    b.disabled = cargando;
    b.textContent = cargando ? 'Leyendo…' : 'Actualizar';
    e.textContent = cargando && !datos ? 'Leyendo la planilla de seguimiento…'
      : datos ? 'Planilla de seguimiento leída a las ' + hhmm(datos.at) + (new Date(datos.at).toDateString() !== new Date().toDateString() ? ' del ' + fmtC(new Date(datos.at)) : '') + '. Hoy es ' + fmt(hoy()) + '.'
      : 'Sin datos todavía.';
    raiz.querySelector('#sp-aviso').innerHTML = error ? '<div class="err">' + esc(error) + (datos ? ' Se muestran los últimos datos leídos.' : '') + '</div>' : '';
  }

  function pintarHoy() {
    var sus = CLIENTES.filter(function (c) { return c.estado === 'sus'; });
    var hh = CLIENTES.filter(function (c) { return c.estado === 'hoy'; }).length;
    var en7 = new Date(+hoy() + 7 * DIA);
    var pronto = sus.filter(function (c) { return c.ult.fin && c.ult.fin <= en7; }).length;
    var rein = CLIENTES.filter(function (c) { return c.n > 1; }).length;
    raiz.querySelector('#sp-hoy').innerHTML =
      '<div class="' + (sus.length ? 'mal' : '') + '"><b>' + sus.length + '</b><span>suspendidos hoy</span></div>' +
      '<div class="' + (hh ? 'aviso' : '') + '"><b>' + hh + '</b><span>se habilitan hoy</span></div>' +
      '<div><b>' + pronto + '</b><span>vuelven en 7 días</span></div>' +
      '<div><b>' + rein + '</b><span>reincidentes</span></div>';
  }

  function pintarEscalera() {
    var n = [0, 0, 0, 0];
    CLIENTES.forEach(function (c) { n[c.escalon - 1]++; });
    raiz.querySelector('#sp-esc').innerHTML = [0, 1, 2, 3].map(function (i) {
      var quien = '<span class="sp-quien"><b>' + n[i] + '</b><span>' + (n[i] === 1 ? 'cliente' : 'clientes') + ' con ' + (i < 3 ? (i + 1) + (i === 0 ? ' suspensión' : ' suspensiones') : '4 o más') + '</span></span>';
      var d = i < 3 ? '<span class="sp-d">' + ESCALA[i] + '<small>días</small></span>'
        : '<span class="sp-b4"><span class="sp-d">Bloqueo<br>indefinido</span><span class="sp-nota4">Reevaluación con Gerente, Jefe de ventas, Jefa de administración y Jefe de operaciones</span></span>';
      return '<button type="button" class="sp-paso s' + (i + 1) + '" data-paso="' + (i + 1) + '" aria-pressed="' + (st.esc === i + 1) + '" aria-label="' + ORD[i] + ' suspensión: ' + escalaTxt(i) + '. ' + n[i] + ' clientes">' + quien +
        '<span class="sp-bloq"><span class="sp-n">' + ORD[i] + ' suspensión</span>' + d + '</span></button>';
    }).join('');
  }

  var FILTROS = [
    ['todos', 'Todos', function () { return true; }],
    ['sus', 'Suspendidos hoy', function (c) { return c.estado === 'sus' || c.estado === 'hoy'; }],
    ['rein', 'Reincidentes', function (c) { return c.n > 1; }],
    ['obs', 'Para revisar', function (c) { return c.revisar > 0; }],
  ];
  function pintarFiltros() {
    raiz.querySelector('#sp-filtros').innerHTML = FILTROS.map(function (f) {
      return '<button type="button" class="sp-chip" data-f="' + f[0] + '" aria-pressed="' + (st.filtro === f[0]) + '">' + f[1] + '<i>' + CLIENTES.filter(f[2]).length + '</i></button>';
    }).join('') + (st.esc ? '<button type="button" class="sp-chip" data-sin-esc aria-pressed="true">' + ORD[st.esc - 1] + ' suspensión ✕</button>' : '');
  }

  function estadoHTML(c) {
    var u = c.ult;
    if (c.estado === 'sus') return '<span class="sp-st sus">Suspendido</span><span class="sp-stx">' + (u.fin ? 'Vuelve el ' + fmtC(u.fin) + ' · faltan ' + dif(hoy(), u.fin) + ' d' : 'Sin fecha de fin') + '</span>';
    if (c.estado === 'hoy') return '<span class="sp-st hoy">Se habilita hoy</span><span class="sp-stx">Suspendido desde el ' + fmtC(u.ini) + '</span>';
    return '<span class="sp-st ok">Habilitado</span><span class="sp-stx">' + (u.mal ? 'Última suspensión: ' + fmtC(u.ini) : 'Desde el ' + fmtC(u.fin)) + '</span>';
  }
  function proxHTML(c) {
    if (c.n >= 4) return '<b class="blq">Bloqueado</b><span>Reevaluación pendiente</span>';
    if (c.n === 3) return '<b class="blq">Bloqueo</b><span>' + ORD[3] + ' suspensión</span>';
    return '<b>' + ESCALA[c.n] + ' días</b><span>' + ORD[c.n] + ' suspensión</span>';
  }
  function detalleHTML(c) {
    return '<ol class="sp-tl">' + c.ev.map(function (e) {
      var k = e.n + 1;
      var dias = e.mal ? '<span class="sp-warn">Fechas a revisar</span>' : e.dias === null ? 'En curso' : e.dias + ' días aplicados';
      var cods = Object.keys(e.codigos);
      return '<li><span class="sp-k k' + k + '">' + k + '</span><div><b>' + ORD[k - 1] + ' suspensión</b> <span class="sp-meta">· ' + fmt(e.ini) + ' al ' + fmt(e.fin) + ' · ' + dias + '</span>' +
        '<p>' + esc(e.mot || 'Sin motivo cargado') + '</p>' + (cods.length ? '<span class="sp-meta">Código ' + cods.join(', ') + '</span>' : '') + '</div></li>';
    }).join('') + '</ol>';
  }
  function pintarLista() {
    var f = FILTROS.filter(function (x) { return x[0] === st.filtro; })[0][2];
    var q = norm(st.q);
    var vis = CLIENTES.filter(function (c) { return f(c) && (!st.esc || c.escalon === st.esc) && (!q || c.busca.indexOf(q) >= 0); });
    raiz.querySelector('#sp-lsub').textContent = CLIENTES.length + ' clientes · ' + EVENTOS.length + ' suspensiones registradas. Tocá un cliente para ver sus suspensiones y motivos.';
    var L = raiz.querySelector('#sp-lista');
    if (!vis.length) { L.innerHTML = '<div class="sp-vacio">' + (CLIENTES.length ? 'Ningún cliente coincide con la búsqueda o el filtro. Probá con otro nombre o código, o elegí “Todos”.' : 'No hay suspensiones cargadas en la planilla.') + '</div>'; return; }
    L.innerHTML = '<div class="sp-lcab"><span>Cliente</span><span>Suspensiones</span><span>Estado</span><span>Si reincide</span><span></span></div>' + vis.map(function (c) {
      var ab = !!st.abiertos[c.k];
      var barras = [0, 1, 2, 3].map(function (i) { return '<i class="' + (i < c.n ? 'on' : '') + '"></i>'; }).join('');
      return '<div class="sp-item"><button type="button" class="sp-fila" data-k="' + esc(c.k) + '" aria-expanded="' + ab + '">' +
        '<span class="sp-cli"><b>' + esc(c.nombre) + (c.revisar ? '<span class="sp-flag">Revisar</span>' : '') + '</b><span>' + (c.codigos.length ? 'Cód. ' + c.codigos.join(' · ') : 'Sin código') + '</span></span>' +
        '<span class="sp-tr"><span class="sp-track" aria-hidden="true">' + barras + '</span><span class="sp-trl">' + c.n + ' ' + (c.n === 1 ? 'suspensión' : 'suspensiones') + ' · última ' + fmtC(c.ult.ini) + '</span></span>' +
        '<span class="sp-sx">' + estadoHTML(c) + '</span>' +
        '<span class="sp-prox">' + proxHTML(c) + '</span>' +
        '<svg class="sp-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>' +
        '</button>' + (ab ? '<div class="sp-det">' + detalleHTML(c) + '</div>' : '') + '</div>';
    }).join('');
  }
  function pintarRegistro() {
    raiz.querySelector('#sp-reg').innerHTML = EVENTOS.map(function (e) {
      return '<tr><td>' + fmt(e.ini) + '</td><td>' + fmt(e.fin) + '</td><td>' + esc(e.cli.nombre) + '</td><td>' + Object.keys(e.codigos).join(', ') + '</td>' +
        '<td><span class="sp-pill p' + (e.n + 1) + '">' + ORD[e.n] + '</span></td><td class="r' + (e.mal ? ' dif' : '') + '">' + (e.mal ? 'Revisar' : e.dias === null ? 'En curso' : e.dias) + '</td>' +
        '<td class="r">' + (e.esc === null ? 'Bloqueo' : e.esc) + '</td><td class="wrap">' + esc(e.mot) + '</td></tr>';
    }).join('');
  }
  function pintarObs() {
    raiz.querySelector('#sp-obs').innerHTML = OBS.length ? OBS.map(function (o) { return '<li>' + o + '</li>'; }).join('') : '<li>No hay observaciones sobre los datos.</li>';
  }
  function pintarVista() {
    var v = vistaActual();
    Array.prototype.forEach.call(raiz.querySelectorAll('[data-sp]'), function (s) { s.hidden = s.getAttribute('data-sp') !== v; });
    Array.prototype.forEach.call(raiz.querySelectorAll('.sp-sub-nav a'), function (a) {
      if (a.getAttribute('data-v') === v) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
  }
  function pintar() {
    if (!armado) esqueleto();
    pintarEstado();
    armar(datos ? datos.filas : []);
    pintarHoy(); pintarEscalera(); pintarFiltros(); pintarLista(); pintarRegistro(); pintarObs(); pintarVista();
  }

  window.addEventListener('hashchange', function () { if (armado && location.hash.split('/')[0] === '#suspendidos') pintarVista(); });
  window.LTSuspendidos = { abrir: function () { pintar(); cargar(false); } };
  if (location.hash.split('/')[0] === '#suspendidos') window.LTSuspendidos.abrir();
})();
