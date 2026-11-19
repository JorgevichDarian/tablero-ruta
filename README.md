# Tablero de ruta · Logística Total

Reporte en vivo del estado de cada camión de reparto, con datos de **Nextbyn** (avance, estado de entrega de cada cliente) y **Chess** (planillas, importes, bultos y cajones retornables).

- **Reporte publicado:** https://darianjorgevich.github.io/tablero-ruta/
- **Guía de instalación:** pestaña "Guía instalación extensión" del reporte (https://darianjorgevich.github.io/tablero-ruta/#guia)

## Cómo funciona

Una página web no puede leer Nextbyn ni Chess por su cuenta: Chrome no deja que otro sitio use las sesiones de esos sistemas. Por eso hay dos partes:

1. **Extensión de Chrome** (`extension/`): cuando el reporte se lo pide, lee el Mapa de entregas de Nextbyn y el Reporte de Repartos de Chess con la sesión de quien la usa. Si esas páginas no están abiertas, las abre un momento en una pestaña de fondo y la cierra al terminar. Solo le responde al reporte publicado en `darianjorgevich.github.io`.
2. **Reporte** (`docs/`, publicado con GitHub Pages): la página con los botones **Actualizar todo**, **Nextbyn** y **Chess**, el semáforo por camión, las alertas y el detalle de clientes. El mismo reporte se abre también desde el ícono de la extensión.

## Prioridad de pedidos pendientes

Cada camión en ruta tiene el botón **Prioridad pedidos pendientes**. Al pasar el mouse muestra sus pendientes ordenados por la **Prioridad en el ruteo** de la pestaña `PL4.2 Carga ruteo` de la hoja *4.2 Plan de agrupación de clientes* (1 Ganador, 2 Básico, 3 En crecimiento, 4 Ventas bajas) y, dentro de cada prioridad, por importe. La extensión lee la hoja con la sesión de Google del usuario (cada 1 hora como máximo); el cruce es por código de cliente.

## OT (entregas dentro de la ventana horaria)

OT = pedidos entregados dentro de su ventana horaria ÷ total de pedidos del día. La ventana de cada cliente sale de la columna `Horario Ent.` (BO) de la hoja *Tablero-de-ruta_Clientes-actualizado*, con formato `hh:mm a hh:mm; hh:mm a hh:mm`. Los clientes sin ventana o con una nota en lugar de horario ("AVISAR", "LLAMAR ANTES") cuentan como a tiempo al entregarse; la nota se muestra en gris debajo del cliente.

La hora de entrega sale de la liquidación de Chess de cada camión (`liquidacion/planillasPendientes` para encontrar la jornada abierta y `liquidacion/estadoLiquidacion` para los comprobantes, campo `fhvisita`); es la misma consulta que hace la pantalla "Ver liquidación". Si no está, se toma de Nextbyn cuando la grilla de Clientes la trae, y si tampoco, el reporte registra la hora en que vio al cliente pasar de pendiente a entregado; los clientes que ya figuraban entregados al abrir el reporte quedan "sin hora".

## Clientes en riesgo

Para cada pendiente se estima la llegada: los pendientes se ordenan por la secuencia de Nextbyn (columna de orden de la grilla de Clientes si existe; si no, el orden de la lista) y se les suma, uno tras otro, el tiempo por cliente del camión (promedio de las últimas 6 entregas de hoy con hora; si hay menos de 3, el ritmo desde el inicio de la jornada; entre 5 y 90 minutos). La primera llegada es la más tardía entre "ahora" y "última entrega + tiempo por cliente". Si la llegada estimada cae después del cierre de la ventana, el cliente queda **En riesgo**; con menos de un cliente de margen, **Justo**; antes de que abra, **Llega antes**.

## Histórico de OT

La pestaña **Histórico** del reporte guarda y muestra el OT de cada día. Los datos quedan en la hoja [Histórico OT](https://docs.google.com/spreadsheets/d/1kqOCYxMQEhT1TWf43lYzvaN4Oc0m-2GKAhoh2IaPC7k/edit) (pestañas Flota, Camiones y Clientes).

- **Guardado:** el reporte manda el OT del día por camión y por cliente cada 30 minutos, cuando un camión cierra la jornada y una vez después de las 18:00. Cada envío reemplaza las filas del mismo día y patente.
- **Cómo escribe:** a través del script `apps-script/Codigo.gs`, publicado como aplicación web desde la propia hoja (Extensiones → Apps Script → Implementar → Aplicación web, ejecutar como "Yo", acceso "Cualquier persona"). La URL `/exec` se pega una vez en la pestaña Histórico de cada PC. El script solo acepta envíos con la clave que trae la extensión.
- **Lectura:** la extensión lee las pestañas Camiones y Clientes como CSV con la sesión de Google del usuario.

## Base de clientes (actualización diaria)

Una vez por día (la primera lectura de Chess desde las 6:00) la extensión pide a Chess la misma exportación que Ventas → Clientes → Exportar con el filtro ACTIVOS (`/web/api/clientes/exportarClientes`), descarga el .xlsx con la sesión del usuario y lo abre en la pestaña de Chess. `extension/base-clientes.js` deja la fila de títulos y los datos, estandariza "Horario Ent." (mismas reglas que la carga a mano) y pone 07:30 a 11:00 a las cadenas. El script de la hoja (`apps-script/Codigo.gs`, acción `clientes`) reemplaza "Hoja 1" de Tablero-de-ruta_Clientes-actualizado. Si Chess cambia las columnas D, F, W, BO o CA, o trae menos de 500 clientes, no se toca la hoja. El botón **Base clientes** muestra el estado y fuerza una actualización.

## Ver en mapa

Pestaña con un marcador por cliente del día (`extension/mapa.js`): color por ruta, pin con el número de orden de visita para los pendientes (borde rojo si están en riesgo), ✓ para entregados y ✕ para rechazados. La ubicación sale de las columnas T (Longitud) y U (Latitud) de la base de clientes. El mapa usa Leaflet 1.9.4 (BSD-2, en `extension/vendor/leaflet`, compilado del código fuente oficial) con el mapa estándar de OpenStreetMap. Los servidores de mapas gratuitos bloquean los pedidos que salen de una página interna de la extensión; por eso el ícono abre la versión web (GitHub Pages) y la página interna muestra el mapa sin calles con un enlace a la web.

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
scripts/guia.html   Redirige a la pestaña de la guía (para enlaces viejos)
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
