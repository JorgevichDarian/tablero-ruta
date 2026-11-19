// Arma la carpeta docs/ (lo que publica GitHub Pages) a partir de extension/ y scripts/.
// Uso: node scripts/build.js
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const raiz = path.join(__dirname, '..');
const ext = path.join(raiz, 'extension');
const docs = path.join(raiz, 'docs');
fs.mkdirSync(docs, { recursive: true });

// El reporte publicado es el mismo que trae la extensión.
fs.copyFileSync(path.join(ext, 'reporte.html'), path.join(docs, 'index.html'));
fs.copyFileSync(path.join(ext, 'reporte.js'), path.join(docs, 'reporte.js'));
fs.copyFileSync(path.join(ext, 'mapa.js'), path.join(docs, 'mapa.js'));
fs.mkdirSync(path.join(docs, 'vendor', 'leaflet'), { recursive: true });
for (const f of ['leaflet.js', 'leaflet.css', 'LICENSE']) fs.copyFileSync(path.join(ext, 'vendor', 'leaflet', f), path.join(docs, 'vendor', 'leaflet', f));
fs.copyFileSync(path.join(ext, 'reporte.css'), path.join(docs, 'reporte.css'));
fs.copyFileSync(path.join(ext, 'icono128.png'), path.join(docs, 'icono.png'));
fs.copyFileSync(path.join(ext, 'logo-lt.png'), path.join(docs, 'logo-lt.png'));
fs.copyFileSync(path.join(__dirname, 'guia.html'), path.join(docs, 'guia.html'));

// Ícono de la pestaña en la versión publicada.
const idx = path.join(docs, 'index.html');
// Cada archivo lleva la versión en la dirección (?v=…), así el navegador no usa una copia vieja
// guardada en caché (GitHub Pages deja guardar los archivos hasta 10 minutos).
const version = JSON.parse(fs.readFileSync(path.join(ext, 'manifest.json'), 'utf8')).version;
fs.writeFileSync(idx, fs.readFileSync(idx, 'utf8')
  .replace('</title>', '</title>\n<link rel="icon" href="icono.png">')
  .replace(/(src|href)="((?:vendor\/leaflet\/)?[\w-]+\.(?:js|css))"/g, '$1="$2?v=' + version + '"'));

// Zip de la extensión para descargar desde la guía.
const zip = path.join(docs, 'tablero-ruta-extension.zip');
if (fs.existsSync(zip)) fs.unlinkSync(zip);
execFileSync('zip', ['-qrX', zip, '.'], { cwd: ext });
console.log('docs/ listo');
