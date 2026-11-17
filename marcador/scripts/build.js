// Genera index.html (la guía con el botón del marcador) a partir de src/tablero-ruta.js
// Uso: node scripts/build.js
const fs = require('fs');
const path = require('path');
const raiz = path.join(__dirname, '..');
const codigo = fs.readFileSync(path.join(raiz, 'src', 'tablero-ruta.js'), 'utf8').trim();
new Function(codigo); // falla si el código tiene un error de sintaxis
const marcador = 'javascript:' + encodeURIComponent(codigo);
const plantilla = fs.readFileSync(path.join(__dirname, 'plantilla.html'), 'utf8');
fs.writeFileSync(path.join(raiz, 'index.html'), plantilla.replace('__BOOKMARKLET__', marcador));
console.log('index.html generado (' + marcador.length + ' caracteres de marcador)');
