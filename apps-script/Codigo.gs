/**
 * Histórico OT y base de clientes · Tablero de ruta
 *
 * 1) Recibe del reporte (a través de la extensión) el OT del día por camión y por cliente
 *    y lo guarda en las pestañas "Camiones" y "Clientes" de esta hoja.
 *    Cada envío reemplaza las filas del mismo día y la misma patente, así el último
 *    envío del día es el que queda.
 * 2) Una vez por día recibe la base de clientes exportada de Chess (ya con los horarios
 *    estandarizados) y reemplaza "Hoja 1" de la hoja Tablero-de-ruta_Clientes-actualizado.
 *
 * Publicar: Implementar → Nueva implementación → Aplicación web
 *   Ejecutar como: Yo · Quién tiene acceso: Cualquier persona
 * y copiar la URL que termina en /exec en la pestaña Histórico del reporte.
 */

// Tiene que coincidir con la clave que usa la extensión. Sin ella, la hoja rechaza el envío.
const CLAVE = 'luqrJYc5_XlqKb8ajEBiteGJ';

// Filas recientes que se revisan para reemplazar las del mismo día (la historia vieja no se toca).
const VENTANA_FILAS = 4000;

// Base de clientes que lee el reporte (ventanas horarias y pago pendiente).
const HOJA_CLIENTES = '1o6Y0is6NK0BTW0z4Gj5coFKQ_3SFc9ZYArQYoaERDio';
const PESTANA_CLIENTES = 'Hoja 1';
// Columnas que lee el reporte, por posición (A = 0): D, F, W, BO, CA.
const COLUMNAS_CLIENTES = { 3: 'Cliente', 5: 'Razón social', 22: 'Comentario', 66: 'Horario Ent.', 78: 'Descripción Sub-línea' };

function doGet(e) {
  if (e && e.parameter && e.parameter.accion === 'estadoClientes') return salida(estadoClientes());
  return salida({ ok: true, hoja: SpreadsheetApp.getActiveSpreadsheet().getName() });
}

function estadoClientes() {
  const p = PropertiesService.getScriptProperties();
  const at = Number(p.getProperty('clientesAt') || 0);
  const tz = Session.getScriptTimeZone();
  const dia = function (t) { return Utilities.formatDate(new Date(t), tz, 'yyyy-MM-dd'); };
  return { ok: true, at: at, clientes: Number(p.getProperty('clientesN') || 0), hoy: !!at && dia(at) === dia(Date.now()) };
}

// Reemplaza toda la pestaña de clientes con lo que exportó Chess.
function guardarClientes(d) {
  const filas = d.filas || [];
  if (filas.length < 500) throw new Error('Llegaron solo ' + filas.length + ' filas: no se reemplazó la base.');
  const tit = filas[0];
  Object.keys(COLUMNAS_CLIENTES).forEach(function (c) {
    if (String(tit[c] || '').trim() !== COLUMNAS_CLIENTES[c]) throw new Error('La columna ' + c + ' no es "' + COLUMNAS_CLIENTES[c] + '": no se reemplazó la base.');
  });
  const ancho = tit.length;
  // Igual que importar el Excel: los textos quedan como texto (el apóstrofo evita que Sheets
  // los convierta en números, fechas o fórmulas), los números como números y las fechas como fechas.
  const valores = filas.map(function (f) {
    const out = new Array(ancho);
    for (let c = 0; c < ancho; c++) {
      const v = f[c];
      if (v === null || v === undefined || v === '') out[c] = '';
      else if (typeof v === 'number' || typeof v === 'boolean') out[c] = v;
      else if (typeof v === 'object' && v.fecha) { const p = String(v.fecha).split('-'); out[c] = new Date(+p[0], +p[1] - 1, +p[2]); }
      else out[c] = "'" + String(v);
    }
    return out;
  });
  const sh = SpreadsheetApp.openById(HOJA_CLIENTES).getSheetByName(PESTANA_CLIENTES);
  if (!sh) throw new Error('La hoja de clientes no tiene la pestaña "' + PESTANA_CLIENTES + '".');
  if (sh.getMaxRows() < valores.length) sh.insertRowsAfter(sh.getMaxRows(), valores.length - sh.getMaxRows());
  if (sh.getMaxColumns() < ancho) sh.insertColumnsAfter(sh.getMaxColumns(), ancho - sh.getMaxColumns());
  const alto = Math.max(sh.getLastRow(), 1), anchoViejo = Math.max(sh.getLastColumn(), 1);
  sh.getRange(1, 1, alto, anchoViejo).clearContent();
  sh.getRange(1, 1, valores.length, ancho).setValues(valores);
  SpreadsheetApp.flush();
  const p = PropertiesService.getScriptProperties();
  const at = Date.now();
  p.setProperties({ clientesAt: String(at), clientesN: String(valores.length - 1) });
  return { ok: true, clientes: valores.length - 1, at: at };
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const d = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (d.clave !== CLAVE) return salida({ ok: false, error: 'Clave incorrecta.' });
    if (d.accion === 'clientes') return salida(guardarClientes(d));
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const ahora = new Date();

    const camiones = (d.camiones || []).map(function (r) {
      return [r.fecha, r.patente, r.chofer || '', r.jornada || '', r.estado || '', n(r.pedidos), n(r.ok), n(r.fuera),
        n(r.sinhora), n(r.vencido), n(r.pend), n(r.rech), null, ahora];
    });
    const clientes = (d.clientes || []).map(function (r) {
      return [r.fecha, r.patente, String(r.codigo || ''), r.cliente || '', r.ventana || '', r.hora || '',
        r.resultado || '', r.fuente || '', r.prox == null || r.prox === '' ? '' : n(r.prox), ahora];
    });

    const n1 = reemplazar(ss.getSheetByName('Camiones'), camiones, 14, function (fila, i) {
      // OT = A tiempo / Pedidos, como fórmula para que se pueda seguir.
      fila[12] = '=IF(F' + i + '=0,0,G' + i + '/F' + i + ')';
    });
    const n2 = reemplazar(ss.getSheetByName('Clientes'), clientes, 10, null);
    return salida({ ok: true, camiones: n1, clientes: n2 });
  } catch (err) {
    return salida({ ok: false, error: String(err && err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

function n(v) { const x = Number(v); return isNaN(x) ? 0 : x; }

function salida(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// Reemplaza las filas con la misma fecha y patente que las nuevas, y agrega las nuevas.
function reemplazar(sh, nuevas, ncols, ajustar) {
  if (!nuevas.length) return 0;
  const tz = sh.getParent().getSpreadsheetTimeZone();
  const claves = {};
  nuevas.forEach(function (f) { claves[f[0] + '|' + f[1]] = true; });

  const ultima = sh.getLastRow();
  const desde = Math.max(2, ultima - VENTANA_FILAS + 1);
  let viejas = ultima >= desde ? sh.getRange(desde, 1, ultima - desde + 1, ncols).getValues() : [];
  const formulas = ultima >= desde ? sh.getRange(desde, 1, ultima - desde + 1, ncols).getFormulas() : [];
  const fechaTxt = function (v) { return v instanceof Date ? Utilities.formatDate(v, tz, 'yyyy-MM-dd') : String(v); };

  // Primera fila afectada: desde ahí se reescribe todo.
  let primera = viejas.length;
  for (let i = 0; i < viejas.length; i++) {
    if (claves[fechaTxt(viejas[i][0]) + '|' + viejas[i][1]]) { primera = i; break; }
  }
  const resto = [];
  for (let i = primera; i < viejas.length; i++) {
    if (claves[fechaTxt(viejas[i][0]) + '|' + viejas[i][1]]) continue;
    const fila = viejas[i].slice();
    fila[0] = fechaTxt(fila[0]);
    // Conserva las fórmulas de las filas que se mueven.
    for (let c = 0; c < ncols; c++) if (formulas[i][c]) fila[c] = formulas[i][c];
    resto.push(fila);
  }
  const salidaFilas = resto.concat(nuevas);
  const inicio = desde + primera;
  const alto = Math.max(viejas.length - primera, salidaFilas.length);
  if (alto > 0) sh.getRange(inicio, 1, alto, ncols).clearContent();
  salidaFilas.forEach(function (fila, k) {
    const filaHoja = inicio + k;
    if (ajustar) ajustar(fila, filaHoja);
    // Las fórmulas de OT se recalculan con el número de fila nuevo.
    for (let c = 0; c < ncols; c++) {
      if (typeof fila[c] === 'string' && /^=IF\(F\d+=0,0,G\d+\/F\d+\)$/.test(fila[c])) fila[c] = '=IF(F' + filaHoja + '=0,0,G' + filaHoja + '/F' + filaHoja + ')';
      if (fila[c] === null) fila[c] = '';
    }
  });
  if (salidaFilas.length) sh.getRange(inicio, 1, salidaFilas.length, ncols).setValues(salidaFilas);
  return nuevas.length;
}
