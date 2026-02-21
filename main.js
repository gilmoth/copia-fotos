const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const exifr = require('exifr');

// Allowed extensions for media (lowercase)
const ALLOWED_EXTENSIONS = new Set([
    '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tif', '.tiff', '.heic', '.heif',
    '.mp4', '.mov', '.m4v', '.avi', '.mkv', '.3gp'
]);

// Config Manager
const CONFIG_FILE = 'organizer-config.json';
let configCache = { lastSource: '', lastDestinationPhotos: '', lastDestinationVideos: '' };

async function loadConfig() {
    const configPath = path.join(app.getPath('userData'), CONFIG_FILE);
    try {
        const data = await fs.readFile(configPath, 'utf8');
        configCache = { ...configCache, ...JSON.parse(data) };
    } catch (err) {
        // File might not exist yet or corrupted, fallback to empty
    }
}

async function saveConfig() {
    const configPath = path.join(app.getPath('userData'), CONFIG_FILE);
    try {
        await fs.writeFile(configPath, JSON.stringify(configCache, null, 2), 'utf8');
    } catch (err) {
        console.error('Failed to save config', err);
    }
}

// Recursive scan function
async function scanDirectory(dirPath, event, stats) {
    try {
        const dirents = await fs.readdir(dirPath, { withFileTypes: true });

        for (const dirent of dirents) {
            if (stats.isCancelled) return;

            const fullPath = path.join(dirPath, dirent.name);

            if (dirent.isDirectory()) {
                // Skip hidden folders or specific ones if needed, otherwise recurse
                await scanDirectory(fullPath, event, stats);
            } else if (dirent.isFile()) {
                const ext = path.extname(dirent.name).toLowerCase();

                if (ALLOWED_EXTENSIONS.has(ext)) {
                    // No need to stat file here, we'll do it during processing if needed
                    const isVideo = ['.mp4', '.mov', '.m4v', '.avi', '.mkv', '.3gp'].includes(ext);
                    stats.files.push({
                        sourcePath: fullPath,
                        fileName: dirent.name,
                        ext: ext,
                        mediaType: isVideo ? 'video' : 'photo'
                    });
                    stats.scannedCount++;

                    // Throttle UI updates (e.g., every 10 files)
                    if (stats.scannedCount % 10 === 0) {
                        event.sender.send('scan-progress', {
                            scannedCount: stats.scannedCount,
                            currentPath: fullPath
                        });
                    }
                }
            }
        }
    } catch (err) {
        console.warn(`Could not read directory: ${dirPath}`, err);
    }
}

// Global processing state for cancellation
let currentProcessingState = { isCancelled: false };

// Helper: Ensure unique destination file name
async function getUniqueDestPath(destPath) {
    let uniquePath = destPath;
    let counter = 1;
    const ext = path.extname(destPath);
    const baseDir = path.dirname(destPath);
    const baseName = path.basename(destPath, ext);

    while (true) {
        try {
            await fs.access(uniquePath);
            // File exists, append suffix
            const suffix = String(counter).padStart(3, '0');
            uniquePath = path.join(baseDir, `${baseName}_${suffix}${ext}`);
            counter++;
        } catch {
            // File does not exist, safe to use
            break;
        }
    }
    return uniquePath;
}

// Helper: format YYYY-MM-DD
function formatDateString(d) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

// Helper: format ISO with local time (like 2026-01-06T12:41:48)
function formatIsoLocal(d) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}T${hh}:${min}:${ss}`;
}

// Global Date Cache to prevent re-parsing on retries or within same session
const globalDateCache = new Map();

// Helper: Extract and validate date
async function extractValidDate(filePath, ext) {
    if (globalDateCache.has(filePath)) {
        return globalDateCache.get(filePath);
    }

    const resolve = (result) => {
        globalDateCache.set(filePath, result);
        return result;
    };

    // 1. Filename prefix pattern: YYYYMMDD_HHMMSS or YYYYMMDD-HHMMSS
    const baseName = path.basename(filePath);
    const regex = /^(\d{4})(\d{2})(\d{2})[_-](\d{2})(\d{2})(\d{2})/;
    const match = baseName.match(regex);

    const currentYear = new Date().getFullYear();
    const minYear = 1990;
    const maxYear = currentYear + 1;

    if (match) {
        const [, yyyy, mm, dd, hh, min, ss] = match;
        const year = parseInt(yyyy, 10);
        if (year >= minYear && year <= maxYear) {
            // Create local date
            const d = new Date(year, parseInt(mm, 10) - 1, parseInt(dd, 10), parseInt(hh, 10), parseInt(min, 10), parseInt(ss, 10));
            if (!isNaN(d.getTime())) {
                return resolve({ date: d, source: 'Filename' });
            }
        }
    }

    // 2. EXIF / Metadata
    const photoExts = ['.jpg', '.jpeg', '.tif', '.tiff', '.heic', '.heif']; // expressly omits PNG/GIF/BMP speedups per rule
    // exifr mainly supports photos, sometimes mp4 depending on the build, but we will try.
    if (photoExts.includes(ext.toLowerCase())) {
        try {
            // Request only what we need for speed
            const tags = await exifr.parse(filePath, {
                pick: ['DateTimeOriginal', 'CreateDate'],
                exif: true
            });

            if (tags) {
                const exifDate = tags.DateTimeOriginal || tags.CreateDate;
                if (exifDate instanceof Date && !isNaN(exifDate.getTime())) {
                    const year = exifDate.getFullYear();
                    if (year >= minYear && year <= maxYear) {
                        return { date: exifDate, source: 'EXIF' };
                    }
                } else if (typeof exifDate === 'string') {
                    const d = new Date(exifDate);
                    if (!isNaN(d.getTime())) {
                        const year = d.getFullYear();
                        if (year >= minYear && year <= maxYear) {
                            return resolve({ date: d, source: 'EXIF' });
                        }
                    }
                }
            }
        } catch (err) {
            // Ignore exifr read errors (no exif or unparseable)
        }
    }

    return resolve({ date: null, source: 'None', errorMsg: 'No reliable date or unreasonable year' });
}

function createWindow() {
    const fsSync = require('fs');
    const preloadPath = path.join(__dirname, 'preload.js');
    console.log('Resolved preload path:', preloadPath);
    console.log('Preload exists?', fsSync.existsSync(preloadPath));

    const win = new BrowserWindow({
        title: 'Copia-fotos',
        width: 800,
        height: 600,
        webPreferences: {
            preload: preloadPath,
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    // Load Vite dev server URL or built HTML
    if (app.isPackaged) {
        win.loadFile(path.join(__dirname, 'dist', 'index.html'));
    } else {
        win.loadURL('http://localhost:5173');
    }
}

app.whenReady().then(async () => {
    await loadConfig();

    // Config IPC Handlers
    ipcMain.handle('get-last-paths', () => {
        return configCache;
    });

    ipcMain.handle('set-last-source', async (event, folderPath) => {
        configCache.lastSource = folderPath;
        await saveConfig();
    });

    ipcMain.handle('set-last-destination-photos', async (event, folderPath) => {
        configCache.lastDestinationPhotos = folderPath;
        await saveConfig();
    });

    ipcMain.handle('set-last-destination-videos', async (event, folderPath) => {
        configCache.lastDestinationVideos = folderPath;
        await saveConfig();
    });

    // Handler for selecting the source folder
    ipcMain.handle('select-source-folder', async () => {
        const result = await dialog.showOpenDialog({
            properties: ['openDirectory'],
            title: 'Select Source Folder'
        });
        if (!result.canceled && result.filePaths.length > 0) {
            return result.filePaths[0];
        }
        return null;
    });

    // Handler for selecting the destination (photos) folder
    ipcMain.handle('select-destination-photos-folder', async () => {
        const result = await dialog.showOpenDialog({
            properties: ['openDirectory'],
            title: 'Select Destination (Photos)'
        });
        if (!result.canceled && result.filePaths.length > 0) {
            return result.filePaths[0];
        }
        return null;
    });

    // Handler for selecting the destination (videos) folder
    ipcMain.handle('select-destination-videos-folder', async () => {
        const result = await dialog.showOpenDialog({
            properties: ['openDirectory'],
            title: 'Select Destination (Videos)'
        });
        if (!result.canceled && result.filePaths.length > 0) {
            return result.filePaths[0];
        }
        return null;
    });

    // Handler for performing the actual scan
    ipcMain.handle('scan-source', async (event, { sourcePath, mode }) => {
        const stats = { scannedCount: 0, files: [], isCancelled: false };
        await scanDirectory(sourcePath, event, stats);
        event.sender.send('scan-progress', {
            scannedCount: stats.scannedCount,
            currentPath: 'Done'
        });

        return { files: stats.files, total: stats.scannedCount };
    });

    // Handler for processing files (copy/move)
    ipcMain.handle('process-files', async (event, { files, destinationPhotosPath, destinationVideosPath, mode }) => {
        currentProcessingState.isCancelled = false;
        const total = files.length;
        if (total === 0) return { success: true };

        // Determine CSV log inside photos destination by default, or videos if photos isn't set
        const baseCsvFolder = destinationPhotosPath || destinationVideosPath;
        const safeTimestamp = formatIsoLocal(new Date()).replace(/:/g, '-'); // safe Windows filename

        let logHandle = null;
        let csvPath = '';

        try {
            if (baseCsvFolder) {
                await fs.mkdir(baseCsvFolder, { recursive: true });
                let suffix = 0;
                while (true) {
                    const suffixStr = suffix === 0 ? '' : `_${String(suffix).padStart(3, '0')}`;
                    csvPath = path.join(baseCsvFolder, `import_log_${safeTimestamp}${suffixStr}.csv`);
                    try {
                        // Exclusive open, will fail instantly if file exists (EEXIST)
                        logHandle = await fs.open(csvPath, 'wx');
                        break;
                    } catch (err) {
                        if (err.code === 'EEXIST') {
                            suffix++; // Try next suffix
                        } else {
                            throw err; // Real error like EBUSY / EPERM
                        }
                    }
                }

                // Set and write header
                const headerArray = ['SourcePath', 'DestinationPath', 'MediaType', 'DateChosen', 'DateSource', 'Mode', 'Status', 'Message'];
                const headerLine = headerArray.map(item => `"${String(item).replace(/"/g, '""')}"`).join(',');
                await logHandle.write(headerLine + '\n', null, 'utf8');
            }
        } catch (err) {
            console.error('Failed to create CSV:', err);
            if (err.code === 'EBUSY' || err.code === 'EPERM') {
                throw new Error('El archivo CSV está en uso o bloqueado. Por favor, ciérralo (ej. en Excel) e inténtalo de nuevo.');
            }
            throw new Error(`Error al crear el archivo CSV: ${err.message}`);
        }

        // --- CONCURRENCY PREFETCH WORKERS ---
        const prefetchCache = new Map();
        let prefetchIndex = 0;

        async function prefetchWorker() {
            while (prefetchIndex < total && !currentProcessingState.isCancelled) {
                const i = prefetchIndex++;
                const file = files[i];
                if (!prefetchCache.has(file.sourcePath)) {
                    const p = extractValidDate(file.sourcePath, file.ext);
                    prefetchCache.set(file.sourcePath, p);
                    await p; // Concurrency throttle limit
                }
            }
        }

        // Start 4 background prefetch workers 
        for (let w = 0; w < 4; w++) prefetchWorker();
        // ------------------------------------

        let uiBatch = [];
        let lastUiUpdate = Date.now();

        try {
            for (let i = 0; i < total; i++) {
                if (currentProcessingState.isCancelled) {
                    console.log('Processing cancelled.');
                    break;
                }

                const file = files[i];
                const isVideo = file.mediaType === 'video';
                const mediaType = isVideo ? 'Video' : 'Photo';

                // Choose the correct base destination from arguments
                const baseDestPath = isVideo ? destinationVideosPath : destinationPhotosPath;
                const errorsDest = `${baseDestPath}- errores de importacion`;

                // Note: Since destination for a media type might be missing (caught in renderer but double check), 
                // the directories are ensured conditionally.
                if (baseDestPath) {
                    await fs.mkdir(baseDestPath, { recursive: true });
                    await fs.mkdir(errorsDest, { recursive: true });
                }

                let status = 'OK';
                let message = '';
                let finalDestPath = '';
                let dateChosenStr = '';
                let dateSourceStr = 'None';
                let targetDir = '';

                try {
                    // Extract Date: Block on cache promise if prefetch caught it, or fetch natively
                    let dateResult;
                    if (prefetchCache.has(file.sourcePath)) {
                        dateResult = await prefetchCache.get(file.sourcePath);
                    } else {
                        const p = extractValidDate(file.sourcePath, file.ext);
                        prefetchCache.set(file.sourcePath, p);
                        dateResult = await p;
                    }

                    if (dateResult.date) {
                        dateSourceStr = dateResult.source;
                        dateChosenStr = formatIsoLocal(dateResult.date);

                        const yearStr = String(dateResult.date.getFullYear());
                        const folderDateStr = formatDateString(dateResult.date);

                        // Route based on mediaType and baseDestPath
                        if (isVideo) {
                            targetDir = path.join(baseDestPath, yearStr);
                        } else {
                            targetDir = path.join(baseDestPath, yearStr, folderDateStr);
                        }
                    } else {
                        // Error routing
                        targetDir = errorsDest;
                        status = 'Error';
                        message = dateResult.errorMsg || 'Unknown date issue';
                    }

                    await fs.mkdir(targetDir, { recursive: true });

                    const plannedDestPath = path.join(targetDir, file.fileName);
                    finalDestPath = await getUniqueDestPath(plannedDestPath);

                    if (finalDestPath !== plannedDestPath) {
                        // Appended unique suffix
                        if (status === 'OK') {
                            status = 'Renamed';
                            message = 'Renamed to avoid overwrite';
                        } else {
                            message += ' (Renamed to avoid overwrite)';
                        }
                    }

                    // Copy or Move
                    if (mode === 'move') {
                        await fs.copyFile(file.sourcePath, finalDestPath);
                        await fs.unlink(file.sourcePath);
                    } else {
                        await fs.copyFile(file.sourcePath, finalDestPath);
                    }

                    // Log result
                    if (logHandle) {
                        const rowArray = [file.sourcePath, finalDestPath, mediaType, dateChosenStr, dateSourceStr, mode, status, message];
                        const logLine = rowArray.map(item => `"${String(item).replace(/"/g, '""')}"`).join(',');
                        await logHandle.write(logLine + '\n', null, 'utf8');
                    }

                    // Push to UI batch
                    uiBatch.push({
                        index: i + 1,
                        total: total,
                        fileName: file.fileName,
                        sourcePath: file.sourcePath,
                        destinationFolder: targetDir,
                        mode: mode,
                        status: status
                    });

                } catch (err) {
                    console.error(`Failed to process ${file.sourcePath}`, err);
                    status = 'Error';
                    message = err.message || 'Processing failed';

                    if (logHandle) {
                        const errRowArray = [file.sourcePath, finalDestPath || 'Unknown', mediaType, dateChosenStr, dateSourceStr, mode, status, message];
                        const errLogLine = errRowArray.map(item => `"${String(item).replace(/"/g, '""')}"`).join(',');
                        await logHandle.write(errLogLine + '\n', null, 'utf8');
                    }

                    uiBatch.push({
                        index: i + 1,
                        total: total,
                        fileName: file.fileName,
                        sourcePath: file.sourcePath,
                        destinationFolder: `ERROR: ${err.message}`,
                        mode: mode,
                        status: 'ERROR'
                    });
                }

                // Flush UI batch periodically to avoid visual freezing
                const now = Date.now();
                if (now - lastUiUpdate >= 100 || i === total - 1) {
                    event.sender.send('process-progress', uiBatch);
                    uiBatch = [];
                    lastUiUpdate = now;
                }
            }
        } finally {
            if (logHandle) {
                await logHandle.close();
            }
        }

        return { success: true, isCancelled: currentProcessingState.isCancelled };
    });

    // Handler to cancel processing
    ipcMain.handle('cancel-processing', () => {
        currentProcessingState.isCancelled = true;
    });

    createWindow();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
