// Base de clientes de Chess → hoja "Tablero-de-ruta_Clientes-actualizado".
// Prepara las filas exportadas por Chess igual que la carga a mano:
//  - se queda con la fila de títulos (la 2 del archivo) y los datos (sin la fila 1 de grupos ni la 3 de tipos),
//  - estandariza "Horario Ent." a "hh:mm a hh:mm" (varias franjas separadas por "; "),
//  - las cadenas reciben 07:30 a 11:00.
// Se usa en el service worker (importScripts) y en las pruebas con node.
/* exported estandarizarHorario, prepararBaseClientes */

// Columnas que lee el reporte (por posición): D, F, W, BO, CA.
var COLUMNAS_BASE = { 3: 'Cliente', 5: 'Razón social', 22: 'Comentario', 66: 'Horario Ent.', 78: 'Descripción Sub-línea' };
var COL_HORARIO = 66, COL_RAZON = 5;

// Razón social de las cadenas con ventana fija 07:30 a 11:00 (Coop. Obrera, La Anónima, Carrefour,
// Makro, Vital, Coto, GDN).
var CADENAS = [
  'COOP. OBR. LDA. DE CONS. Y V.',
  'COOP OBRERA AVENIDA CANDOLLE 800',
  'S.A.IMP. Y EXP. PATAGONIA',
  'DORINKA SRL',
  'INC S.A.',
  'SUP. MAYORISTA MAKRO S.A.',
  'VITAL',
  'COTO C.I.C.S.A.',
  'PAINEN S.R.L',
];
var HORARIO_CADENAS = '07:30 a 11:00';

function prepararBaseClientes(filas) {
  if (!filas || !filas.length) throw new Error('El archivo de Chess vino vacío.');
  var norm = function (v) { return String(v == null ? '' : v).trim(); };
  var iTit = -1;
  for (var i = 0; i < Math.min(filas.length, 10); i++) {
    var f = filas[i].map(norm);
    if (f.indexOf('Cliente') >= 0 && f.indexOf('Horario Ent.') >= 0) { iTit = i; break; }
  }
  if (iTit < 0) throw new Error('El archivo de Chess no tiene la fila de títulos esperada (Cliente, Horario Ent.).');
  var titulos = filas[iTit].map(norm);
  Object.keys(COLUMNAS_BASE).forEach(function (c) {
    if (titulos[c] !== COLUMNAS_BASE[c]) {
      throw new Error('Chess cambió las columnas de la exportación: se esperaba "' + COLUMNAS_BASE[c] + '" en la columna ' + letraColumna(+c) + ' y vino "' + (titulos[c] || '') + '". No se actualizó la base.');
    }
  });
  var desde = iTit + 1;
  // Fila de tipos (ENTERO, CARÁCTER, …) debajo de los títulos.
  if (filas[desde] && filas[desde].filter(function (v) { return /^(ENTERO|CAR[AÁ]CTER|DECIMAL|L[OÓ]GICO|FECHA)$/i.test(norm(v)); }).length >= 5) desde++;

  var ancho = titulos.length;
  var cadenas = {};
  CADENAS.forEach(function (c) { cadenas[c] = true; });
  var datos = [], cambiados = 0, enCadena = 0, sinEstandar = 0;
  for (var k = desde; k < filas.length; k++) {
    var fila = filas[k].slice(0, ancho);
    while (fila.length < ancho) fila.push('');
    if (!fila.some(function (v) { return norm(v) !== ''; })) continue;
    var orig = norm(fila[COL_HORARIO]);
    var nuevo;
    if (cadenas[norm(fila[COL_RAZON]).toUpperCase()]) { nuevo = HORARIO_CADENAS; enCadena++; }
    else {
      nuevo = estandarizarHorario(orig)[0];
      if (nuevo == null && orig) sinEstandar++;
    }
    if (nuevo != null && nuevo !== orig) { fila[COL_HORARIO] = nuevo; cambiados++; }
    datos.push(fila);
  }
  if (datos.length < 500) throw new Error('El archivo de Chess trajo solo ' + datos.length + ' clientes: no se actualizó la base por las dudas.');
  return { filas: [titulos].concat(datos), clientes: datos.length, horariosCambiados: cambiados, cadenas: enCadena, notas: sinEstandar };
}

function letraColumna(i) {
  var s = '';
  i++;
  while (i > 0) { var r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); }
  return s;
}

// ---------- Horario Ent. → "hh:mm a hh:mm" ----------
// Mismas reglas que la estandarización hecha a mano en la hoja:
//  "horario corrido" sin horas → 08:00 a 18:00; "X en adelante" → X a 18:00; vacío o notas → sin cambios.
// Devuelve [nuevo | null, motivo]. null = dejar como está.
var HOR_FIN = [18, 0], HOR_INI = [8, 0], HOR_MEDIANOCHE = [23, 59];
var HOR_DIAS = '(LUNES|LUN|LU|MARTES|MAR|MIERCOLES|MIE|JUEVES|JUE|VIERNES|VIER|VIE|VI|SABADOS|SABADO|SAB|SA|DOMINGOS|DOMINGO|DOMICILIO|DOM|LUVI|LUSA|LUJU|LAV)';
var HOR_MANUAL = {
  'XX A 13.30HS': ['08:00 a 13:30', 'sin hora de inicio: se tomó 08:00'],
  '10 A 13.30HS/14HS': ['10:00 a 14:00', 'decía 13:30 o 14: se tomó 14:00'],
  '10 A 12HS -13HS': ['10:00 a 13:00', 'decía 12 o 13: se tomó 13:00'],
  '0': [null, 'sin horario (0)'],
  '12.3': [null, 'no se entiende la hora (12.3)'],
};

function estandarizarHorario(original) {
  var s = String(original == null ? '' : original).trim();
  if (!s) return [null, 'vacío'];
  if (Object.prototype.hasOwnProperty.call(HOR_MANUAL, s)) return HOR_MANUAL[s];
  var t = s.toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  var notas = [];
  var k = function (h, m) { return h * 100 + m; }; // compara (h, m) como tupla
  var fmt = function (h, m) { return ('0' + h).slice(-2) + ':' + ('0' + m).slice(-2); };

  t = t.replace(/\d{6,}/g, ' ');
  t = t.replace(/\d+\s*MIN\w*/g, ' ');
  t = t.replace(/\d+\s+ANTES/g, ' ');
  t = t.replace(/\(ESTAR ANTES[^)]*\)/g, ' ');
  t = t.replace(/\(2DA NO\)/g, ' ');
  t = t.split('MEDIO DIA').join('12').split('MEDIODIA').join('12');

  var m0 = /\d/.exec(t);
  if (m0) {
    var sab = /\b(SABADOS?|SAB|SA)\b/.exec(t.slice(m0.index));
    if (sab) {
      var corte = m0.index + sab.index;
      if (/\d/.test(t.slice(corte))) notas.push('tenía otro horario para el sábado; se tomó el de la semana');
      t = t.slice(0, corte);
    }
  }

  t = t.replace(/\bL A S\b/g, ' ');
  t = t.replace(new RegExp('\\b' + HOR_DIAS + '(?=\\b|\\d)', 'g'), ' ');
  t = t.replace(new RegExp('(?<=\\d)' + HOR_DIAS + '\\b', 'g'), ' ');

  t = t.replace(/\b(\d{1,2})\s*Y\s*(30)\b/g, '$1:$2');
  t = t.replace(/\b(\d{1,2})\s+(30|15|45|40|00)\b/g, '$1:$2');

  var tokRe = /(\d{1,4})(?:\s*[:.']+\s*(\d{1,2}))?\s*(AM|PM|P\b)?/g, mm, toks = [];
  while ((mm = tokRe.exec(t))) {
    var a = mm[1], b = mm[2], ap = mm[3], h, mi;
    if (b === undefined && (a.length === 3 || a.length === 4)) { h = +a.slice(0, -2); mi = +a.slice(-2); }
    else {
      if (b !== undefined && b.length !== 2) return [null, 'no se entiende la hora (' + mm[0].trim() + ')'];
      h = +a; mi = +(b || 0);
    }
    if ((ap === 'PM' || ap === 'P') && h < 12) h += 12;
    toks.push([h, mi, ap || null, mm.index]);
  }

  var adelante = /ADELANT|A PARTIR|APARTIR|DESDE|DES\.|APERTURA|DESPUES|ABRE|RECIBE DESDE/.test(t);
  var corrido = /CORRID/.test(t);
  var hastaPrimero = false;
  var hm = /\b(HASTA|HAS\.)/.exec(t);
  if (hm && (!toks.length || hm.index < toks[0][3])) hastaPrimero = true;

  if (!toks.length) {
    if (corrido) return [fmt(HOR_INI[0], HOR_INI[1]) + ' a ' + fmt(HOR_FIN[0], HOR_FIN[1]), 'horario corrido'];
    return [null, 'sin horas (nota de entrega)'];
  }

  var horas = toks.map(function (x) { return [x[0], x[1], x[2]]; });
  if (horas.length === 1 && horas[0][0] === 24 && horas[0][1] === 0) return ['00:00 a 23:59', '24 horas'];
  if (hastaPrimero) horas = [[HOR_INI[0], HOR_INI[1], null]].concat(horas);
  if (horas.length % 2 === 1) {
    if (horas.length === 1 || adelante || corrido) {
      horas = horas.concat([[HOR_FIN[0], HOR_FIN[1], null]]);
      if (toks.length === 1 && !(adelante || corrido)) notas.push('solo tenía la hora de inicio');
    } else return [null, 'cantidad de horas impar'];
  }

  var franjas = [], FIN = k(HOR_FIN[0], HOR_FIN[1]);
  for (var i = 0; i < horas.length; i += 2) {
    var h1 = horas[i][0], m1 = horas[i][1], h2 = horas[i + 1][0], m2 = horas[i + 1][1], a2 = horas[i + 1][2];
    if (franjas.length && k(h1, m1) < franjas[franjas.length - 1][1] && h1 + 12 < 24) h1 += 12;
    if (k(h2, m2) === FIN && a2 === null && i + 2 === horas.length && k(h1, m1) >= FIN && (adelante || corrido || toks.length === 1)) {
      h2 = HOR_MEDIANOCHE[0]; m2 = HOR_MEDIANOCHE[1];
      notas.push('"en adelante" desde las ' + ('0' + h1).slice(-2) + ': se cerró a las 23:59');
    } else if (k(h2, m2) >= k(24, 0)) {
      h2 = HOR_MEDIANOCHE[0]; m2 = HOR_MEDIANOCHE[1];
    } else if (k(h2, m2) <= k(h1, m1)) {
      if (a2 === 'AM' || h2 <= 3) { h2 = HOR_MEDIANOCHE[0]; m2 = HOR_MEDIANOCHE[1]; }
      else if (h2 + 12 <= 24 && k(h2 + 12, m2) > k(h1, m1)) {
        h2 += 12;
        if (k(h2, m2) >= k(24, 0)) { h2 = HOR_MEDIANOCHE[0]; m2 = HOR_MEDIANOCHE[1]; }
      } else return [null, 'franja inválida'];
    }
    if (k(h1, m1) >= k(24, 0) || m1 > 59 || m2 > 59) return [null, 'hora inválida'];
    if (k(h1, m1) >= k(h2, m2)) {
      if (k(h2, m2) === FIN && h1 >= 18) {
        h2 = HOR_MEDIANOCHE[0]; m2 = HOR_MEDIANOCHE[1];
        notas.push('"en adelante" desde las ' + ('0' + h1).slice(-2) + ': se cerró a las 23:59');
      } else return [null, 'franja inválida'];
    }
    franjas.push([k(h1, m1), k(h2, m2)]);
  }

  var unidas = [];
  franjas.forEach(function (f) {
    var u = unidas[unidas.length - 1];
    if (u && f[0] <= u[1]) u[1] = Math.max(u[1], f[1]);
    else unidas.push([f[0], f[1]]);
  });
  var txt = function (x) { return fmt(Math.floor(x / 100), x % 100); };
  var out = unidas.map(function (u) { return txt(u[0]) + ' a ' + txt(u[1]); }).join('; ');
  if (/AVISAR|LLAMAR|YPF|VIVE|HONDURAS|SINO|ESTAR ANTES/.test(t)) notas.push('tenía una nota además del horario');
  return [out, notas.length ? notas.join('; ') : 'ok'];
}

if (typeof module !== 'undefined') module.exports = { estandarizarHorario: estandarizarHorario, prepararBaseClientes: prepararBaseClientes, CADENAS: CADENAS };
