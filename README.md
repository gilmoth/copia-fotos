# Copia-fotos (Organizador multimedia con Electron + Vite)

## Requisitos previos
- Node.js (>= 18)
- npm (incluido con Node)

## Desarrollo

```bash
# Iniciar Vite y Electron simultáneamente
npm run dev
```

## Compilación para producción

Para crear un ejecutable de Windows independiente y portable (`.exe`):

1. **Compilar el frontend (renderizador de Vite)** (genera archivos estáticos en `dist/`):
   ```bash
   npm run build
   ```
2. **Empaquetar la aplicación de Electron** (genera el ASAR y el `.exe` en `release/`):
   ```bash
   npm run dist
   ```

La aplicación portátil independiente final se ubicará dentro de la carpeta `release` (por ejemplo, `release/Copia-fotos Portable.exe`).

Esto iniciará Vite (`http://localhost:5173`) y ejecutará la aplicación de Electron.

### Funcionalidades incluidas:
1. **Interfaz del organizador multimedia (localizada en español)**:
   - Utiliza `dialog.showOpenDialog` a través de IPC para seleccionar las carpetas de Origen, Destino (fotos) y Destino (vídeos) de forma nativa.
   - **Configuración persistente**: Recuerda las tres últimas carpetas seleccionadas (Origen, Fotos, Vídeos) entre ejecuciones de la aplicación. La configuración se guarda correctamente en la carpeta estándar de datos de usuario de Electron (`userData/organizer-config.json`).
   - **Escaneo real de la carpeta de origen**: Al hacer clic en **Escanear**, se inicia un proceso de lectura recursiva del sistema de archivos en el proceso principal de Electron a través de `fs/promises`.
     - El proceso principal filtra los archivos por extensión multimedia (fotos vs. vídeos) y los etiqueta internamente, luego envía eventos asíncronos `scan-progress` de vuelta al renderizador (`ipcMain.handle` + `event.sender.send`).
     - El renderizador de Vite recibe las actualizaciones en tiempo real a través de IPC (`onScanProgress`), manteniendo la interfaz receptiva mientras actualiza la cantidad escaneada y el nombre del archivo actual sin congelar la aplicación.
   - **Procesamiento de archivos real (Copiar/Mover) con extracción de fecha**: Al hacer clic en **Iniciar**, se calculan los requisitos en función de las extensiones escaneadas. Si hay fotos, debe configurarse Destino (fotos). Si hay vídeos, debe configurarse Destino (vídeos).
     - Los nombres de archivo y los metadatos se analizan mediante `exifr` para extraer la fecha de creación. Prioridad: 1. `YYYYMMDD_HHMMSS` en el nombre del archivo, 2. `DateTimeOriginal` o `CreateDate` del EXIF.
     - Las fechas válidas (desde 1990 hasta el próximo año) se enrutan de manera diferente según el tipo de medio:
       - Fotos: `Destino Fotos/YYYY/YYYY-MM-DD/`
       - Vídeos: `Destino Vídeos/YYYY/` (sin subcarpetas diarias)
     - Las fechas faltantes o poco razonables se envían a un directorio hermano junto a sus respectivos destinos (por ejemplo, `Destino Fotos- errores de importacion/`).
     - Los archivos existentes en el destino no se sobrescribirán; se les asignan sufijos únicos (por ejemplo, `_001`).
     - El progreso se transmite continuamente al renderizador a través de IPC (`onProcessProgress`).
     - Una lista desplazable que se actualiza en vivo dentro del renderizador muestra acciones y errores de `COPY`/`MOVE` en tiempo real, manteniendo las últimas 200 entradas.
     - Se puede cancelar limpiamente en cualquier momento haciendo clic en **Cancelar**.
     - Genera un rico registro de importación en CSV (por ejemplo, `DEST/import_log_...csv`) que detalla lo que se copió o movió, marcas de tiempo exactas, destino y cualquier error de extracción o renombrado. El escritor de registros cuenta con sólidas garantías de desbloqueo de recursos y manejadores de apertura exclusivos (`wx`) para protegerse de forma nativa contra errores de ejecución `EBUSY` de Windows.
     - **Apertura automática de destinos**: Al finalizar con éxito, inicia de forma nativa la o las carpetas de destino directamente en el Explorador de Windows si el usuario deja marcada la casilla "Abrir carpetas". También ofrece botones manuales para abrir los destinos individualmente al final del resumen.
   - Actualiza una barra de progreso real, información de seguimiento de archivos y un cuadro de registro de estado que refleja las operaciones reales.
     - **Diseño de alto rendimiento**: La extracción de fechas aprovecha heurísticas ultrarrápidas de salida temprana basadas en expresiones regulares antes de recurrir a la lectura de metadatos binarios de `exifr`. Para evitar la congelación de la interfaz de usuario durante la ingesta de grandes archivos, utiliza una matriz de cola asíncrona en segundo plano que se ejecuta de manera simultánea, almacena en caché las referencias de salida por mapeo de ruta de archivo de forma agresiva y agrupa en microlotes las matrices de carga útil enviadas a la capa de Vite para garantizar un ancho de banda IPC fluido de `100ms`.

## Estructura del proyecto
```
electron-vite/
├─ package.json
├─ vite.config.js
├─ index.html
├─ src/
│   └─ renderer.js
├─ main.js
├─ preload.js
└─ README.md
```

---
*Generado por Antigravity*
