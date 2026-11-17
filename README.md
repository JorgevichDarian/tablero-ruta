# Tablero de ruta · Logística Total

Reporte en vivo del estado de cada camión de reparto, con datos de **Nextbyn** (avance, estado de entrega de cada cliente) y **Chess** (planillas, importes, bultos y cajones retornables).

- **Reporte publicado:** https://darianjorgevich.github.io/tablero-ruta/
- **Guía de instalación:** https://darianjorgevich.github.io/tablero-ruta/guia.html

## Cómo funciona

Una página web no puede leer Nextbyn ni Chess por su cuenta: Chrome no deja que otro sitio use las sesiones de esos sistemas. Por eso hay dos partes:

1. **Extensión de Chrome** (`extension/`): cuando el reporte se lo pide, lee el Mapa de entregas de Nextbyn y el Reporte de Repartos de Chess con la sesión de quien la usa. Si esas páginas no están abiertas, las abre un momento en una pestaña de fondo y la cierra al terminar. Solo le responde al reporte publicado en `darianjorgevich.github.io`.
2. **Reporte** (`docs/`, publicado con GitHub Pages): la página con los botones **Actualizar todo**, **Nextbyn** y **Chess**, el semáforo por camión, las alertas y el detalle de clientes. El mismo reporte se abre también desde el ícono de la extensión.

## Horarios de referencia

| | Apertura de ruta | Fin de jornada |
|---|---|---|
| Lunes a viernes | 07:30 a 08:00 | 15:00 |
| Sábados | 08:00 a 08:30 | 13:00 |

## Publicar con GitHub Pages

1. El repositorio tiene que llamarse `tablero-ruta` (las direcciones de la guía y del reporte lo asumen).
2. En GitHub: **Settings → Pages → Build and deployment**: *Deploy from a branch*, rama `main`, carpeta `/docs`.
3. En unos minutos queda en `https://darianjorgevich.github.io/tablero-ruta/`.

Si el repositorio es privado, GitHub Pages requiere un plan pago (Pro, Team o Enterprise).

## Estructura

```
extension/          Extensión de Chrome (se instala con "Cargar descomprimida")
  manifest.json     Permisos: solo Nextbyn y Chess; acepta pedidos solo de darianjorgevich.github.io
  bg.js             Recibe los pedidos del reporte y abre/lee las páginas
  lectores.js       Lectores de Nextbyn (camiones + pestaña Clientes) y de Chess (Reporte de Repartos)
  reporte.*         El reporte (el mismo que se publica)
docs/               Lo que publica GitHub Pages (generado por scripts/build.js)
scripts/build.js    Copia el reporte a docs/ y arma el zip de la extensión
scripts/guia.html   Guía de instalación
marcador/           Versión anterior (marcador sobre Nextbyn, v12), por si se necesita
```

## Hacer cambios

1. Editá los archivos de `extension/`.
2. Si cambiaste la extensión, subí `version` en `extension/manifest.json`.
3. Corré `node scripts/build.js` y subí los cambios.
4. Cada PC descarga la extensión nueva, reemplaza la carpeta y toca **recargar** en `chrome://extensions`. El reporte publicado se actualiza solo.

El campo `key` del manifest fija el ID de la extensión (`npppbmphladglegjkaakkakllgnhmmgn`), que el reporte publicado usa para comunicarse con ella. No lo cambies.

## Datos y privacidad

Los datos se leen con la sesión de cada usuario y se quedan en su navegador: la extensión no los manda a ningún servidor, y el reporte publicado solo los recibe de la extensión instalada en ese mismo Chrome.
