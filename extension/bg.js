// Service worker de la extensión: recibe los pedidos del reporte ("nextbyn" o "chess"),
// lee la página correspondiente con la sesión del usuario y devuelve los datos.
/* global importScripts, leerNextbyn, leerChess, descargarClientesChess, prepararBaseClientes, chrome */
importScripts('lectores.js', 'base-clientes.js');

const VERSION = chrome.runtime.getManifest().version;
const PAGINA_PUBLICADA = 'https://darianjorgevich.github.io';

const FUENTES = {
  nextbyn: {
    abiertas: 'https://portal.nextbyn.com/modulos/mapas/MapaEntrego.aspx*',
    url: 'https://portal.nextbyn.com/modulos/mapas/MapaEntrego.aspx?visi=0',
    lector: leerNextbyn,
    nombre: 'Nextbyn',
  },
  chess: {
    abiertas: 'https://logisticatotal.chesserp.com/*',
    url: 'https://logisticatotal.chesserp.com/AR1176/#/distribucion/reportes/repartos',
    lector: leerChess,
    nombre: 'Chess',
  },
  // Exportación de la base de clientes (Ventas → Clientes → Exportar, filtro ACTIVOS).
  chessClientes: {
    abiertas: 'https://logisticatotal.chesserp.com/*',
    url: 'https://logisticatotal.chesserp.com/AR1176/#/ventas/gestion/clientes',
    lector: descargarClientesChess,
    nombre: 'Chess',
  },
};

// Espera a que la pestaña termine de cargar.
function esperarCarga(tabId, ms) {
  return new Promise((resolve, reject) => {
    const fin = setTimeout(() => { chrome.tabs.onUpdated.removeListener(oir); reject(new Error('La página tardó demasiado en cargar.')); }, ms);
    function oir(id, cambio, tab) {
      if (id === tabId && cambio.status === 'complete') {
        clearTimeout(fin);
        chrome.tabs.onUpdated.removeListener(oir);
        resolve(tab);
      }
    }
    chrome.tabs.onUpdated.addListener(oir);
    chrome.tabs.get(tabId).then((t) => { if (t.status === 'complete') { clearTimeout(fin); chrome.tabs.onUpdated.removeListener(oir); resolve(t); } }).catch(() => {});
  });
}

async function ejecutar(tabId, func, args) {
  const [r] = await chrome.scripting.executeScript({ target: { tabId: tabId }, func: func, args: args || [] });
  return r && r.result;
}

// Usa una pestaña de la fuente que ya esté abierta; si no hay, abre una en segundo plano
// y la cierra al terminar.
async function leer(clave) {
  const f = FUENTES[clave];
  let [tab] = await chrome.tabs.query({ url: f.abiertas });
  let creada = false;
  if (!tab) {
    tab = await chrome.tabs.create({ url: f.url, active: false });
    creada = true;
  }
  try {
    tab = await esperarCarga(tab.id, 60000);
    const host = new URL(f.url).host;
    if (!tab.url || new URL(tab.url).host !== host) {
      throw new Error(f.nombre + ' pidió iniciar sesión. Entrá con tu usuario y volvé a tocar Actualizar.');
    }
    let r = await ejecutar(tab.id, f.lector, [{}]);
    // En una pestaña de fondo la grilla de Clientes a veces no se dibuja: la muestra un momento.
    if (clave === 'nextbyn' && r && r.cams && !(r.cli && r.cli.n) && creada) {
      const [actual] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      await chrome.tabs.update(tab.id, { active: true });
      await new Promise((res) => setTimeout(res, 4000));
      const r2 = await ejecutar(tab.id, f.lector, [{ soloClientes: true }]);
      if (r2 && r2.cli) r.cli = r2.cli;
      if (actual) chrome.tabs.update(actual.id, { active: true }).catch(() => {});
    }
    if (!r) throw new Error('No se pudo leer ' + f.nombre + '.');
    if (r.error) throw new Error(r.error);
    return r;
  } finally {
    if (creada) chrome.tabs.remove(tab.id).catch(() => {});
  }
}

// Hoja "PL4.2 Carga ruteo" del Plan de agrupación de clientes (prioridad de cada cliente en el ruteo).
// Se lee como CSV con la sesión de Google del usuario, así funciona aunque la hoja no sea pública.
const HOJA_PRIORIDADES = 'https://docs.google.com/spreadsheets/d/1Qw1O7IAliJQEj-3-ItGP_kYfWcFosSrr90vQHrKuRsg/gviz/tq?tqx=out:csv&headers=0&sheet=' + encodeURIComponent('PL4.2 Carga ruteo');
async function leerPrioridades() {
  try {
    const r = await fetch(HOJA_PRIORIDADES, { credentials: 'include', cache: 'no-store' });
    const texto = await r.text();
    if (!r.ok || /^\s*<(!doctype|html)/i.test(texto)) throw new Error('Google no dejó leer la hoja (' + r.status + '). Revisá que la hoja esté compartida con tu usuario.');
    return { ok: true, data: { csv: texto, at: Date.now() } };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

// Ventanas horarias de entrega: hoja "Tablero-de-ruta_Clientes-actualizado", columnas
// D (Cliente), F (Razón social) y BO (Horario Ent., formato "hh:mm a hh:mm; hh:mm a hh:mm").
const HOJA_VENTANAS = 'https://docs.google.com/spreadsheets/d/1o6Y0is6NK0BTW0z4Gj5coFKQ_3SFc9ZYArQYoaERDio/gviz/tq?tqx=out:csv&headers=1&sheet=' + encodeURIComponent('Hoja 1') + '&tq=' + encodeURIComponent('select D, F, BO, W, CA');
// Seguimiento de clientes suspendidos (Google Sheets, pestaña "Clientes Suspendidos": cliente, inicio, fin, motivo).
const HOJA_SUSPENDIDOS = 'https://docs.google.com/spreadsheets/d/1FBrsS_SAlZC3_GpuWe7L4KoFeaeATls4-BRujjoXSG0/gviz/tq?tqx=out:csv&headers=1&sheet=' + encodeURIComponent('Clientes Suspendidos') + '&tq=' + encodeURIComponent('select A, B, C, D');
async function leerSuspendidos() {
  try {
    const r = await fetch(HOJA_SUSPENDIDOS, { credentials: 'include', cache: 'no-store' });
    const texto = await r.text();
    if (!r.ok || /^\s*<(!doctype|html)/i.test(texto)) throw new Error('Google no dejó leer la planilla de clientes suspendidos (' + r.status + '). Revisá que esté compartida con tu usuario.');
    return { ok: true, data: { csv: texto, at: Date.now() } };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

async function leerVentanas() {
  try {
    const r = await fetch(HOJA_VENTANAS, { credentials: 'include', cache: 'no-store' });
    const texto = await r.text();
    if (!r.ok || /^\s*<(!doctype|html)/i.test(texto)) throw new Error('Google no dejó leer la hoja de ventanas horarias (' + r.status + '). Revisá que esté compartida con tu usuario.');
    return { ok: true, data: { csv: texto, at: Date.now() } };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

// Histórico OT: hoja "Histórico OT" (pestañas Camiones y Clientes). Se escribe a través del
// script publicado en la hoja (aplicación web) y se lee como CSV.
const HOJA_HISTORICO = '1kqOCYxMQEhT1TWf43lYzvaN4Oc0m-2GKAhoh2IaPC7k';
const CLAVE_HISTORICO = 'luqrJYc5_XlqKb8ajEBiteGJ';
async function guardarHistorico(msg) {
  try {
    const url = String(msg.url || '');
    if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url)) throw new Error('La dirección del script no es válida: tiene que ser la de la aplicación web y terminar en /exec.');
    const body = JSON.stringify(Object.assign({}, msg.datos || {}, { clave: CLAVE_HISTORICO }));
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: body, redirect: 'follow' });
    const texto = await r.text();
    let j = null;
    try { j = JSON.parse(texto); } catch (e) { /* no es JSON */ }
    if (!j) throw new Error('El script no respondió como se esperaba (' + r.status + '). Revisá que esté publicado con acceso "Cualquier persona".');
    if (!j.ok) throw new Error(j.error || 'El script rechazó los datos.');
    return { ok: true, data: Object.assign(j, { at: Date.now() }) };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}
async function leerHistorico(msg) {
  try {
    const desde = /^\d{4}-\d{2}-\d{2}$/.test(msg.desde || '') ? msg.desde : '2000-01-01';
    const url = (hoja, q) => 'https://docs.google.com/spreadsheets/d/' + HOJA_HISTORICO + '/gviz/tq?tqx=out:csv&headers=1&sheet=' + encodeURIComponent(hoja) + '&tq=' + encodeURIComponent(q);
    const leer = async (u) => {
      const r = await fetch(u, { credentials: 'include', cache: 'no-store' });
      const t = await r.text();
      if (!r.ok || /^\s*<(!doctype|html)/i.test(t)) throw new Error('Google no dejó leer la hoja Histórico OT (' + r.status + ').');
      return t;
    };
    const filtro = " where A >= date '" + desde + "'";
    const [camiones, clientes] = await Promise.all([
      leer(url('Camiones', 'select A, B, C, F, G, H, I, J, K, L' + filtro)),
      leer(url('Clientes', 'select A, B, C, D, E, G' + filtro)),
    ]);
    return { ok: true, data: { camiones: camiones, clientes: clientes, at: Date.now() } };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

// Base de clientes: una vez por día baja la exportación de Chess, la prepara (títulos, horarios
// estandarizados, cadenas) y la manda al script de la hoja, que reemplaza "Hoja 1".
async function actualizarBaseClientes(msg) {
  try {
    const url = String(msg.url || '');
    if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url)) throw new Error('Falta configurar el script de la hoja (pestaña Histórico).');
    const pedirJSON = async (r) => {
      const t = await r.text();
      try { return JSON.parse(t); } catch (e) { throw new Error('El script de la hoja no respondió como se esperaba (' + r.status + '). Revisá que esté publicada la última versión del código.'); }
    };
    if (!msg.forzar) {
      const est = await pedirJSON(await fetch(url + '?accion=estadoClientes', { cache: 'no-store', redirect: 'follow' }));
      if (est.ok && est.hoy) return { ok: true, data: { yaEstaba: true, at: est.at, clientes: est.clientes } };
      if (!est.ok || est.hoy === undefined) throw new Error('El script de la hoja todavía no sabe actualizar la base de clientes: publicá la versión nueva del código (pestaña Histórico).');
    }
    const r = await leer('chessClientes');
    const prep = prepararBaseClientes(r.filas);
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ clave: CLAVE_HISTORICO, accion: 'clientes', filas: prep.filas }),
      redirect: 'follow',
    });
    const j = await pedirJSON(resp);
    if (!j.ok) throw new Error(j.error || 'El script rechazó la base de clientes.');
    return { ok: true, data: { at: j.at || Date.now(), clientes: j.clientes, horarios: prep.horariosCambiados, cadenas: prep.cadenas, notas: prep.notas, archivo: r.archivo } };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

// Un solo pedido en curso por fuente.
const enCurso = {};
function atender(msg) {
  if (msg && msg.tipo === 'ping') return Promise.resolve({ ok: true, version: VERSION });
  const clave = msg && msg.tipo;
  if (clave === 'prioridades') return leerPrioridades();
  if (clave === 'ventanas') return leerVentanas();
  if (clave === 'suspendidos') return leerSuspendidos();
  if (clave === 'guardarHistorico') return guardarHistorico(msg);
  if (clave === 'historico') return leerHistorico(msg);
  if (clave === 'baseClientes') {
    if (!enCurso.baseClientes) enCurso.baseClientes = actualizarBaseClientes(msg).finally(() => { delete enCurso.baseClientes; });
    return enCurso.baseClientes;
  }
  if (!FUENTES[clave] || clave === 'chessClientes') return Promise.resolve({ ok: false, error: 'Pedido desconocido.' });
  if (!enCurso[clave]) {
    enCurso[clave] = leer(clave)
      .then((data) => ({ ok: true, data: data }))
      .catch((e) => {
        let m = String((e && e.message) || e);
        if (/error page|Cannot access|No tab with id/i.test(m)) m = 'No se pudo abrir ' + FUENTES[clave].nombre + '. Revisá la conexión a internet y volvé a tocar Actualizar.';
        return { ok: false, error: m };
      })
      .finally(() => { delete enCurso[clave]; });
  }
  return enCurso[clave];
}

chrome.runtime.onMessage.addListener((msg, sender, responder) => {
  if (sender.id !== chrome.runtime.id) return false;
  atender(msg).then(responder);
  return true;
});

// Solo la página publicada en GitHub Pages puede pedir datos desde afuera.
chrome.runtime.onMessageExternal.addListener((msg, sender, responder) => {
  const origen = sender.origin || (sender.url && new URL(sender.url).origin);
  if (origen !== PAGINA_PUBLICADA) { responder({ ok: false, error: 'Origen no autorizado.' }); return false; }
  atender(msg).then(responder);
  return true;
});

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('reporte.html') });
});
