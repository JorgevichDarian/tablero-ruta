/* Tablero de ruta — pestaña "Ver en mapa".
   Un marcador por cliente del día, con el color de su ruta y un ícono de estado:
   pendiente (pin con su número de orden de visita), entregado (✓), rechazado (✕).
   Ubicación: columnas Longitud y Latitud de la base de clientes (la misma hoja de las ventanas).
   Mapa: Leaflet (incluido en la extensión) con el mapa estándar de OpenStreetMap.
   Recorrido hecho (switch): une los clientes visitados en el orden de su hora de entrega,
   siguiendo las calles con el ruteador público de OSRM (auto: respeta manos y elige el camino
   más rápido entre cada par de clientes). Si OSRM no responde, se dibuja en línea recta. */
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
  var cfg = leer(); // { ocultas: { PAT: 1 }, filtro: 'todos', recorrido: false }
  var mapa = null, capas = {}, capaGrupo = null, visible = false, encuadrado = false;
  var abierto = null; // cliente con el globo abierto: "PAT|codigo"
  var capaTiles = null;
  var ultimo = null; // últimos datos dibujados
  var capaRec = null, colActual = {};
  var OSRM = 'https://router.project-osrm.org/route/v1/driving/';
  var CLAVE_REC = 'ltReporteRecorridos';
  var rec = leerRec(); // { dia, r: { clave: { g: [[lat, lng], …], km, legs: [índice de cada parada en g] } | { error } } }
  var cola = [], enCola = {}, pidiendo = false;

  function leer() { try { return Object.assign({ ocultas: {}, filtro: 'todos' }, JSON.parse(localStorage.getItem(CLAVE)) || {}); } catch (e) { return { ocultas: {}, filtro: 'todos' }; } }
  function guardar() { try { localStorage.setItem(CLAVE, JSON.stringify(cfg)); } catch (e) { /* sin almacenamiento */ } }
  function leerRec() {
    var hoy = new Date().toDateString(), x = null;
    try { x = JSON.parse(localStorage.getItem(CLAVE_REC)); } catch (e) { x = null; }
    return x && x.dia === hoy ? x : { dia: hoy, r: {} };
  }
  function guardarRec() {
    try { localStorage.setItem(CLAVE_REC, JSON.stringify(rec)); } catch (e) { /* si no entra, se vuelve a pedir */ }
  }

  raiz.innerHTML =
    '<aside class="mp-lado" aria-label="Rutas en el mapa">' +
      '<div class="mp-cab"><h2>Ver en mapa</h2><p class="mp-sub" id="mp-sub">Esperando los datos del tablero…</p></div>' +
      '<div class="mp-filtro" role="group" aria-label="Qué clientes mostrar">' +
        '<button type="button" data-f="todos">Todos</button><button type="button" data-f="pend">Pendientes</button><button type="button" data-f="vis">Visitados</button>' +
      '</div>' +
      '<div class="mp-acc"><button type="button" id="mp-todas">Mostrar todas</button><button type="button" id="mp-ninguna">Ocultar todas</button><button type="button" id="mp-encuadrar">Encuadrar</button></div>' +
      '<label class="mp-switch"><input type="checkbox" role="switch" id="mp-rec"><span class="mp-sw2" aria-hidden="true"></span><span>Mostrar recorrido hecho<small>De cliente a cliente, en el orden de la hora de entrega</small></span></label>' +
      '<ul class="mp-rutas" id="mp-rutas"></ul>' +
      '<p class="mp-nota" id="mp-nota"></p>' +
    '</aside>' +
    '<div class="mp-mapa"><div id="mp-lienzo" role="region" aria-label="Mapa de clientes"></div>' +
      '<details class="mp-ley"' + (window.matchMedia('(max-width: 820px)').matches ? '' : ' open') + '><summary>Referencias</summary>' +
        '<span><i class="mk mk-pend" style="--r:#5B6573"><b>3</b></i>Pendiente (orden de visita)</span>' +
        '<span><i class="mk mk-pend riesgo" style="--r:#5B6573"><b></b></i>En riesgo de llegar fuera de ventana</span>' +
        '<span><i class="mk mk-ok" style="--r:#5B6573">' + svgCheck() + '</i>Entregado</span>' +
        '<span><i class="mk mk-rech" style="--r:#5B6573">' + svgCruz() + '</i>Rechazado</span>' +
        '<span class="mp-ley-rec"><i class="mp-ley-linea"></i>Recorrido hecho (flechas: sentido)</span>' +
        '<span class="mp-ley-n">El color del marcador es el de la ruta.</span>' +
      '</details>' +
      '<div class="mp-vacio" id="mp-vacio" hidden></div>' +
    '</div>';

  function svgCheck() { return '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.4l2.9 2.9 6.1-6.6" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>'; }
  function svgCruz() { return '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/></svg>'; }

  function crearMapa() {
    if (mapa) return;
    mapa = L.map('mp-lienzo', { zoomControl: true, preferCanvas: false, attributionControl: true }).setView([-38.95, -68.06], 12);
    ponerTiles();
    capaRec = L.layerGroup().addTo(mapa);
    capaGrupo = L.layerGroup().addTo(mapa);
    mapa.on('popupclose', function () { abierto = null; });
  }
  // Fondo: mapa estándar de OpenStreetMap. Sus servidores (y los de otros mapas gratuitos) no
  // atienden pedidos que salen de una página interna de la extensión, así que ahí el mapa va sin
  // calles y con un enlace a la versión web del reporte, donde sí cargan.
  var WEB = 'https://jorgevichdarian.github.io/tablero-ruta/#mapa';
  function ponerTiles() {
    if (location.protocol === 'chrome-extension:') {
      var av = document.createElement('div');
      av.className = 'mp-web';
      av.innerHTML = 'Las calles del mapa se ven en la versión web del reporte. <a href="' + WEB + '">Abrir el mapa en la web</a>';
      document.querySelector('.mp-mapa').appendChild(av);
      return;
    }
    capaTiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">colaboradores de OpenStreetMap</a>',
    });
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
      '<p class="mp-g-ven">Ventana: ' + esc(c.ventana) + '</p>' +
      (c.nVis ? '<p class="mp-g-ven">' + c.nVis + '.ª visita del día</p>' : '') + '</div>';
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
    colActual = col;
    d.rutas.forEach(function (r) {
      visitados(r).forEach(function (c, i) { c.nVis = i + 1; });
    });
    document.getElementById('mp-rec').checked = !!cfg.recorrido;
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
          (cfg.recorrido && r.clientes.length ? '<span class="mp-km" data-km="' + esc(r.pat) + '">' + textoKm(r) + '</span>' : '') +
        '</button></li>';
    }).join('');
    sub.textContent = ubicados + ' de ' + total + ' clientes ubicados · datos de las ' + R.hhmm(d.at) + (d.sinVentanas ? ' · cargando la base de clientes…' : '');
    nota.innerHTML = sinUbic.length ? '<span title="' + esc(sinUbic.join('\n')) + '">' + sinUbic.length + (sinUbic.length === 1 ? ' cliente no tiene' : ' clientes no tienen') + ' ubicación en la base de clientes (pasá el mouse para verlos).</span>' : '';
    vacio.hidden = true;
    if (!encuadrado && puntos.length && mapa) { mapa.fitBounds(L.latLngBounds(puntos), { padding: [30, 30], maxZoom: 15 }); encuadrado = true; }
    if (reabrir) reabrir.openPopup();
    pintarRecorridos();
  }

  // ---------- recorrido hecho ----------
  // Clientes visitados con ubicación y hora, en el orden en que se visitaron.
  function visitados(r) {
    return r.clientes.filter(function (c) { return c.est && c.ll && c.t; }).sort(function (a, b) { return a.t - b.t; });
  }
  function claveRec(r, v) { return r.pat + '|' + v.map(function (c) { return c.ll[0].toFixed(5) + ',' + c.ll[1].toFixed(5); }).join(';'); }
  function km(a, b) {
    var dLa = (b[0] - a[0]) * Math.PI / 180, dLo = (b[1] - a[1]) * Math.PI / 180;
    var x = Math.sin(dLa / 2) * Math.sin(dLa / 2) + Math.cos(a[0] * Math.PI / 180) * Math.cos(b[0] * Math.PI / 180) * Math.sin(dLo / 2) * Math.sin(dLo / 2);
    return 2 * 6371 * Math.asin(Math.sqrt(x));
  }
  function textoKm(r) {
    var v = visitados(r);
    if (v.length < 2) return v.length ? '1 visita con hora' : 'sin visitas con hora';
    var x = rec.r[claveRec(r, v)];
    if (x && x.km != null) return x.km.toFixed(1).replace('.', ',') + ' km recorridos';
    var recta = 0;
    for (var i = 1; i < v.length; i++) recta += km(v[i - 1].ll, v[i].ll);
    return '~' + recta.toFixed(1).replace('.', ',') + ' km en línea recta' + (x && x.error ? '' : '…');
  }
  function pintarRecorridos() {
    if (!capaRec) return;
    capaRec.clearLayers();
    if (!cfg.recorrido || !ultimo) return;
    ultimo.rutas.forEach(function (r) {
      if (cfg.ocultas[r.pat]) return;
      var v = visitados(r);
      if (v.length < 2) return;
      var color = colActual[r.pat], k = claveRec(r, v), x = rec.r[k];
      var puntos = v.map(function (c) { return c.ll; });
      if (x && x.g) {
        dibujarLinea(x.g, color, false, r);
        flechas(x.g, x.legs || [], color);
      } else {
        dibujarLinea(puntos, color, true, r);
        flechas(puntos, puntos.map(function (p, i) { return i; }), color);
        if (!x || (x.error && Date.now() - (x.at || 0) > 10 * 6e4)) pedirRuta(k, puntos); // si falló, reintenta a los 10 min
      }
    });
  }
  function dibujarLinea(g, color, recta, r) {
    L.polyline(g, { color: '#fff', weight: 7, opacity: 0.85, interactive: false }).addTo(capaRec);
    L.polyline(g, { color: color, weight: 4, opacity: 0.9, dashArray: recta ? '6 8' : null })
      .bindTooltip(esc(r.pat) + (r.chofer ? ' · ' + esc(r.chofer) : '') + ': ' + textoKm(r) + (recta ? ' (línea recta: no se pudo seguir las calles)' : ''), { sticky: true })
      .addTo(capaRec);
  }
  // Una flecha a mitad de cada tramo entre dos clientes, apuntando hacia dónde siguió el camión.
  function flechas(g, legs, color) {
    for (var i = 0; i < legs.length - 1; i++) {
      var a = legs[i], b = legs[i + 1];
      if (b - a < 1) continue;
      var m = Math.min(Math.floor((a + b) / 2), b - 1), p1 = g[m], p2 = g[m + 1];
      if (!p1 || !p2 || (p1[0] === p2[0] && p1[1] === p2[1])) continue;
      // Rumbo en pantalla (corrige la longitud por la latitud): 0° = norte, sentido horario.
      var dx = (p2[1] - p1[1]) * Math.cos(p1[0] * Math.PI / 180), dy = p2[0] - p1[0];
      var ang = Math.atan2(dx, dy) * 180 / Math.PI;
      var medio = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
      L.marker(medio, {
        interactive: false, keyboard: false,
        icon: L.divIcon({ className: 'mp-flecha', iconSize: [16, 16], iconAnchor: [8, 8], html: '<i style="--r:' + color + ';transform:rotate(' + ang.toFixed(0) + 'deg)"></i>' }),
      }).addTo(capaRec);
    }
  }
  // Pedidos a OSRM de a uno, con un segundo entre cada uno (límite del servidor público).
  function pedirRuta(k, puntos) {
    if (enCola[k]) return;
    enCola[k] = 1;
    cola.push({ k: k, p: puntos });
    siguiente();
  }
  function siguiente() {
    if (pidiendo || !cola.length) return;
    var x = cola.shift();
    pidiendo = true;
    var url = OSRM + x.p.map(function (p) { return p[1].toFixed(6) + ',' + p[0].toFixed(6); }).join(';') + '?overview=full&geometries=geojson';
    fetch(url).then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)); }).then(function (j) {
      var ruta = j && j.code === 'Ok' && j.routes && j.routes[0];
      if (!ruta) throw new Error((j && j.code) || 'sin ruta');
      var g = ruta.geometry.coordinates.map(function (c) { return [Math.round(c[1] * 1e5) / 1e5, Math.round(c[0] * 1e5) / 1e5]; });
      // Índice de la geometría de cada parada: el punto más cercano, avanzando en orden.
      var legs = [], desde = 0;
      (j.waypoints || []).forEach(function (w) {
        var ll = [w.location[1], w.location[0]], mejor = desde, dmin = Infinity;
        for (var i = desde; i < g.length; i++) {
          var dd = Math.pow(g[i][0] - ll[0], 2) + Math.pow(g[i][1] - ll[1], 2);
          if (dd < dmin) { dmin = dd; mejor = i; }
          if (dd < 1e-12) break;
        }
        legs.push(mejor); desde = mejor;
      });
      rec.r[x.k] = { g: g, km: ruta.distance / 1000, legs: legs };
    }).catch(function (e) {
      rec.r[x.k] = { error: String((e && e.message) || e), at: Date.now() };
    }).then(function () {
      guardarRec();
      delete enCola[x.k];
      pintarRecorridos();
      actualizarKm();
      setTimeout(function () { pidiendo = false; siguiente(); }, 1100);
    });
  }
  function actualizarKm() {
    if (!ultimo) return;
    ultimo.rutas.forEach(function (r) {
      var el = raiz.querySelector('[data-km="' + r.pat + '"]');
      if (el) el.textContent = textoKm(r);
    });
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
    if (e.target.id === 'mp-rec') { cfg.recorrido = e.target.checked; guardar(); dibujar(); return; }
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
