/* Tablero de ruta — pestaña "Ver en mapa".
   Un marcador por cliente del día, con el color de su ruta y un ícono de estado:
   pendiente (pin con su número de orden de visita), entregado (✓), rechazado (✕).
   Ubicación: columnas Longitud y Latitud de la base de clientes (la misma hoja de las ventanas).
   Mapa: Leaflet (incluido en la extensión) con el fondo de CARTO (datos de OpenStreetMap). */
/* global L */
(function () {
  'use strict';
  var R = window.LTReporte;
  var raiz = document.getElementById('mapa');
  if (!R || !raiz || typeof L === 'undefined') return;
  var esc = R.esc;

  // Colores de ruta: bien distintos entre sí y del rojo de los rechazos.
  var PALETA = ['#1F6FD1', '#2E9E44', '#8E44AD', '#F07F1D', '#0FA3B1', '#8D5524', '#D63384', '#7A8B12',
    '#3F3D99', '#C49000', '#2B7A78', '#B35C9E', '#5B8C2A', '#E05A2B', '#4A90A4', '#6B4E9B'];
  var CLAVE = 'ltReporteMapa';
  var cfg = leer(); // { ocultas: { PAT: 1 }, filtro: 'todos' }
  var mapa = null, capas = {}, capaGrupo = null, visible = false, encuadrado = false;
  var abierto = null; // cliente con el globo abierto: "PAT|codigo"
  var erroresTiles = 0, capaTiles = null, usandoAlternativo = false;
  var ultimo = null; // últimos datos dibujados

  function leer() { try { return Object.assign({ ocultas: {}, filtro: 'todos' }, JSON.parse(localStorage.getItem(CLAVE)) || {}); } catch (e) { return { ocultas: {}, filtro: 'todos' }; } }
  function guardar() { try { localStorage.setItem(CLAVE, JSON.stringify(cfg)); } catch (e) { /* sin almacenamiento */ } }

  raiz.innerHTML =
    '<aside class="mp-lado" aria-label="Rutas en el mapa">' +
      '<div class="mp-cab"><h2>Ver en mapa</h2><p class="mp-sub" id="mp-sub">Esperando los datos del tablero…</p></div>' +
      '<div class="mp-filtro" role="group" aria-label="Qué clientes mostrar">' +
        '<button type="button" data-f="todos">Todos</button><button type="button" data-f="pend">Pendientes</button><button type="button" data-f="vis">Visitados</button>' +
      '</div>' +
      '<div class="mp-acc"><button type="button" id="mp-todas">Mostrar todas</button><button type="button" id="mp-ninguna">Ocultar todas</button><button type="button" id="mp-encuadrar">Encuadrar</button></div>' +
      '<ul class="mp-rutas" id="mp-rutas"></ul>' +
      '<p class="mp-nota" id="mp-nota"></p>' +
    '</aside>' +
    '<div class="mp-mapa"><div id="mp-lienzo" role="region" aria-label="Mapa de clientes"></div>' +
      '<details class="mp-ley"' + (window.matchMedia('(max-width: 820px)').matches ? '' : ' open') + '><summary>Referencias</summary>' +
        '<span><i class="mk mk-pend" style="--r:#5B6573"><b>3</b></i>Pendiente (orden de visita)</span>' +
        '<span><i class="mk mk-pend riesgo" style="--r:#5B6573"><b></b></i>En riesgo de llegar fuera de ventana</span>' +
        '<span><i class="mk mk-ok" style="--r:#5B6573">' + svgCheck() + '</i>Entregado</span>' +
        '<span><i class="mk mk-rech" style="--r:#5B6573">' + svgCruz() + '</i>Rechazado</span>' +
        '<span class="mp-ley-n">El color del marcador es el de la ruta.</span>' +
      '</details>' +
      '<div class="mp-vacio" id="mp-vacio" hidden></div>' +
    '</div>';

  function svgCheck() { return '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.4l2.9 2.9 6.1-6.6" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>'; }
  function svgCruz() { return '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/></svg>'; }

  function crearMapa() {
    if (mapa) return;
    mapa = L.map('mp-lienzo', { zoomControl: true, preferCanvas: false, attributionControl: true }).setView([-38.95, -68.06], 12);
    ponerTiles(false);
    capaGrupo = L.layerGroup().addTo(mapa);
    mapa.on('popupclose', function () { abierto = null; });
  }
  // Fondo: CARTO Voyager (datos de OpenStreetMap). Los servidores de OpenStreetMap no se usan
  // directo porque bloquean los pedidos que vienen de una extensión (error 403 "Access blocked").
  // Si CARTO no carga, se pasa al mapa de calles de Esri.
  function ponerTiles(alternativo) {
    if (capaTiles) mapa.removeLayer(capaTiles);
    usandoAlternativo = alternativo;
    erroresTiles = 0;
    capaTiles = alternativo
      ? L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Mapa &copy; Esri, HERE, Garmin, &copy; colaboradores de OpenStreetMap' })
      : L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', { maxZoom: 19, subdomains: 'abcd', attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">colaboradores de OpenStreetMap</a> &copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>' });
    capaTiles.on('tileerror', function () { if (!usandoAlternativo && ++erroresTiles >= 4) ponerTiles(true); });
    capaTiles.addTo(mapa);
  }

  function colores(rutas) {
    var pats = rutas.map(function (r) { return r.pat; }).sort(), c = {};
    pats.forEach(function (p, i) { c[p] = PALETA[i % PALETA.length]; });
    return c;
  }
  function pasaFiltro(c) {
    if (cfg.filtro === 'pend') return !c.est;
    if (cfg.filtro === 'vis') return !!c.est;
    return true;
  }
  function icono(c, color) {
    var cls, html, tam, anc;
    if (!c.est) {
      cls = 'mk mk-pend' + (c.riesgo === 'riesgo' ? ' riesgo' : '') + (c.st === 'vencido' ? ' vencido' : '');
      html = '<b>' + (c.pos || '') + '</b>';
      tam = [26, 34]; anc = [13, 33];
    } else if (c.est === 'rechazado') {
      cls = 'mk mk-rech'; html = svgCruz(); tam = [20, 20]; anc = [10, 10];
    } else {
      cls = 'mk mk-ok' + (c.est === 'parcial' ? ' parcial' : ''); html = svgCheck(); tam = [20, 20]; anc = [10, 10];
    }
    return L.divIcon({ className: 'mk-envoltura', html: '<i class="' + cls + '" style="--r:' + color + '">' + html + '</i>', iconSize: tam, iconAnchor: anc, popupAnchor: [0, -anc[1] + 2] });
  }
  var TXT = { '': 'Pendiente', entregado: 'Entregado', parcial: 'Entrega parcial', rechazado: 'Rechazado' };
  function globo(c, r, color) {
    var est = c.dev ? (c.est === 'parcial' ? 'Devolución parcial' : 'Devolución') : TXT[c.est] || 'Pendiente';
    var det = c.est
      ? (c.hora ? (c.est === 'rechazado' ? 'Visitado' : 'Entregado') + ' a las ' + c.hora : '')
      : (c.eta ? 'Llegada estimada ~' + c.eta + (c.pos ? ' (' + c.pos + '.º en la secuencia)' : '') : '') + (c.riesgo === 'riesgo' ? ' · en riesgo de llegar fuera de ventana' : c.st === 'vencido' ? ' · ventana vencida' : '');
    return '<div class="mp-globo"><p class="mp-g-ruta"><i style="background:' + color + '"></i>' + esc(r.pat) + (r.chofer ? ' · ' + esc(r.chofer) : '') + '</p>' +
      '<p class="mp-g-cli">' + (c.codigo ? esc(c.codigo) + ' · ' : '') + esc(c.nombre) + '</p>' +
      '<p class="mp-g-dom">' + esc([c.domicilio, c.localidad].filter(Boolean).join(', ')) + '</p>' +
      '<p class="mp-g-est est-' + (c.est || 'pend') + '"><b>' + est + '</b>' + (det ? ' ' + esc(det) : '') + '</p>' +
      '<p class="mp-g-ven">Ventana: ' + esc(c.ventana) + '</p></div>';
  }

  function dibujar() {
    var d = R.datosMapa();
    ultimo = d;
    var sub = document.getElementById('mp-sub'), lista = document.getElementById('mp-rutas'), nota = document.getElementById('mp-nota'), vacio = document.getElementById('mp-vacio');
    Array.prototype.forEach.call(raiz.querySelectorAll('.mp-filtro button'), function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-f') === cfg.filtro)); });
    if (!d || !d.rutas.length) {
      sub.textContent = 'Todavía no hay datos de hoy. Tocá Actualizar todo.';
      lista.innerHTML = ''; nota.textContent = '';
      vacio.hidden = false; vacio.textContent = 'Sin rutas para mostrar.';
      if (capaGrupo) capaGrupo.clearLayers();
      return;
    }
    var col = colores(d.rutas);
    var total = 0, ubicados = 0, sinUbic = [], puntos = [];
    if (capaGrupo) capaGrupo.clearLayers();
    capas = {};
    var reabrir = null;
    // Las rutas sin detalle de clientes (Chess y Nextbyn no trajeron clientes) van al final.
    var orden = d.rutas.filter(function (r) { return r.clientes.length; }).concat(d.rutas.filter(function (r) { return !r.clientes.length; }));
    lista.innerHTML = orden.map(function (r) {
      var color = col[r.pat], oculta = !!cfg.ocultas[r.pat];
      var hechos = r.clientes.filter(function (c) { return !!c.est; }).length;
      var grupo = L.featureGroup();
      r.clientes.forEach(function (c) {
        total++;
        if (!c.ll) { sinUbic.push(r.pat + ': ' + (c.codigo ? c.codigo + ' - ' : '') + c.nombre); return; }
        ubicados++;
        if (!pasaFiltro(c)) return;
        var m = L.marker(c.ll, { icon: icono(c, color), title: c.nombre, riseOnHover: true, zIndexOffset: c.est ? 0 : 500, keyboard: true });
        var clave = r.pat + '|' + (c.codigo || c.nombre);
        m.bindPopup(globo(c, r, color), { maxWidth: 280, closeButton: true });
        m.on('popupopen', function () { abierto = clave; });
        grupo.addLayer(m);
        if (abierto === clave && !oculta) reabrir = m;
      });
      capas[r.pat] = grupo;
      if (!oculta) { capaGrupo.addLayer(grupo); grupo.eachLayer(function (m) { puntos.push(m.getLatLng()); }); }
      var pct = r.clientes.length ? Math.round((hechos / r.clientes.length) * 100) : 0;
      return '<li class="' + (oculta ? 'oculta' : '') + (r.clientes.length ? '' : ' vacia') + '" style="--r:' + color + '">' +
        '<label class="mp-chk"><input type="checkbox" data-pat="' + esc(r.pat) + '"' + (oculta ? '' : ' checked') + '><span class="mp-sw" aria-hidden="true"></span><span class="sr">Mostrar ruta ' + esc(r.pat) + '</span></label>' +
        '<button type="button" class="mp-ruta" data-ir="' + esc(r.pat) + '" title="Acercar el mapa a esta ruta">' +
          '<span class="mp-pat">' + esc(r.pat) + '</span><span class="mp-cho">' + esc(r.chofer || r.vehiculo || r.txt || '') + '</span>' +
          '<span class="mp-av"><i style="width:' + pct + '%"></i></span><span class="mp-n">' + (r.clientes.length ? hechos + '/' + r.clientes.length : 'sin clientes') + '</span>' +
        '</button></li>';
    }).join('');
    sub.textContent = ubicados + ' de ' + total + ' clientes ubicados · datos de las ' + R.hhmm(d.at) + (d.sinVentanas ? ' · cargando la base de clientes…' : '');
    nota.innerHTML = sinUbic.length ? '<span title="' + esc(sinUbic.join('\n')) + '">' + sinUbic.length + (sinUbic.length === 1 ? ' cliente no tiene' : ' clientes no tienen') + ' ubicación en la base de clientes (pasá el mouse para verlos).</span>' : '';
    vacio.hidden = true;
    if (!encuadrado && puntos.length && mapa) { mapa.fitBounds(L.latLngBounds(puntos), { padding: [30, 30], maxZoom: 15 }); encuadrado = true; }
    if (reabrir) reabrir.openPopup();
  }

  function encuadrar(pat) {
    if (!mapa) return;
    var pts = [];
    Object.keys(capas).forEach(function (p) {
      if ((pat && p !== pat) || (!pat && cfg.ocultas[p])) return;
      capas[p].eachLayer(function (m) { pts.push(m.getLatLng()); });
    });
    if (pts.length) mapa.fitBounds(L.latLngBounds(pts), { padding: [30, 30], maxZoom: 16 });
  }

  raiz.addEventListener('change', function (e) {
    var p = e.target.getAttribute && e.target.getAttribute('data-pat');
    if (!p) return;
    if (e.target.checked) delete cfg.ocultas[p]; else cfg.ocultas[p] = 1;
    guardar(); dibujar();
  });
  raiz.addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b || !raiz.contains(b)) return;
    if (b.hasAttribute('data-f')) { cfg.filtro = b.getAttribute('data-f'); guardar(); dibujar(); return; }
    if (b.hasAttribute('data-ir')) {
      var p = b.getAttribute('data-ir');
      if (cfg.ocultas[p]) { delete cfg.ocultas[p]; guardar(); dibujar(); }
      encuadrar(p); return;
    }
    if (b.id === 'mp-todas' || b.id === 'mp-ninguna') {
      cfg.ocultas = {};
      if (b.id === 'mp-ninguna' && ultimo) ultimo.rutas.forEach(function (r) { cfg.ocultas[r.pat] = 1; });
      guardar(); dibujar(); return;
    }
    if (b.id === 'mp-encuadrar') encuadrar(null);
  });

  // Alto del mapa: lo que queda de la ventana debajo de las barras de arriba.
  function ajustarAlto() {
    if (!visible) return;
    var top = raiz.getBoundingClientRect().top + window.scrollY;
    raiz.style.height = Math.max(420, window.innerHeight - top) + 'px';
    if (mapa) mapa.invalidateSize();
  }
  window.addEventListener('resize', ajustarAlto);

  window.LTMapa = {
    visible: function (si) {
      visible = si;
      if (!si) return;
      crearMapa();
      ajustarAlto();
      dibujar();
      setTimeout(ajustarAlto, 50);
    },
    refrescar: function () { if (visible && mapa) dibujar(); },
  };
  if (!raiz.hidden) window.LTMapa.visible(true);
})();
