// --- Media Organizer UI Logic ---

// UI Elements
const sourceInput = document.getElementById('source-path');
const btnSelectSource = document.getElementById('btn-select-source');
const destPhotosInput = document.getElementById('dest-photos-path');
const btnSelectDestPhotos = document.getElementById('btn-select-dest-photos');
const destVideosInput = document.getElementById('dest-videos-path');
const btnSelectDestVideos = document.getElementById('btn-select-dest-videos');
const btnScan = document.getElementById('btn-scan');
const btnStart = document.getElementById('btn-start');
const btnCancel = document.getElementById('btn-cancel');

const chkAutoOpen = document.getElementById('chk-auto-open');
const actionsPostProcess = document.getElementById('actions-post-process');
const btnOpenPhotos = document.getElementById('btn-open-photos');
const btnOpenVideos = document.getElementById('btn-open-videos');

const progressBar = document.getElementById('progress-bar');
const progressText = document.getElementById('progress-text');
const currentFileLabel = document.getElementById('current-file');
const processList = document.getElementById('process-list');
const logBox = document.getElementById('log');

// Helper to append logs
function addLog(msg) {
    logBox.value += msg + '\n';
    logBox.scrollTop = logBox.scrollHeight;
}

function resetRunUI(stage) {
    if (stage === 'scan') {
        logBox.value = ''; // Clean completely for scan
        actionsPostProcess.style.display = 'none';
        btnOpenPhotos.disabled = true;
        btnOpenVideos.disabled = true;
        btnOpenPhotos.onclick = null;
        btnOpenVideos.onclick = null;
    }

    processList.innerHTML = '';
    progressBar.value = 0;
    progressBar.max = 100;
    progressText.textContent = 'Procesados 0 / 0';
    currentFileLabel.textContent = 'Archivo: --';
}

// State
let isProcessing = false;
let currentProgress = 0;
let scannedFiles = []; // Store the real scan results
let isScanning = false;

// Initialization
window.addEventListener('DOMContentLoaded', async () => {
    if (!window.electronAPI) {
        addLog('Error: El puente de comunicación (preload) no está cargado. No se podrán seleccionar carpetas.');
        return;
    }

    const config = await window.electronAPI.getLastPaths();
    if (config.lastSource) {
        sourceInput.value = config.lastSource;
        addLog(`Origen restaurado: ${config.lastSource}`);
    }
    if (config.lastDestinationPhotos) {
        destPhotosInput.value = config.lastDestinationPhotos;
        addLog(`Destino (fotos) restaurado: ${config.lastDestinationPhotos}`);
    }
    if (config.lastDestinationVideos) {
        destVideosInput.value = config.lastDestinationVideos;
        addLog(`Destino (vídeos) restaurado: ${config.lastDestinationVideos}`);
    }
});

// 1. Select Source Folder
btnSelectSource.addEventListener('click', async () => {
    if (!window.electronAPI || !window.electronAPI.selectSourceFolder) {
        addLog('Error crítico: El puente de comunicación falló. No se encuentra window.electronAPI.');
        return;
    }
    const folder = await window.electronAPI.selectSourceFolder();
    if (folder) {
        sourceInput.value = folder;
        addLog(`Origen establecido a: ${folder}`);
        await window.electronAPI.setLastSource(folder);
    }
});

// 2. Select Destination (Photos) Folder
btnSelectDestPhotos.addEventListener('click', async () => {
    if (!window.electronAPI) return;
    const folder = await window.electronAPI.selectDestinationPhotosFolder();
    if (folder) {
        destPhotosInput.value = folder;
        addLog(`Destino (fotos) establecido a: ${folder}`);
        await window.electronAPI.setLastDestinationPhotos(folder);
    }
});

// 2b. Select Destination (Videos) Folder
btnSelectDestVideos.addEventListener('click', async () => {
    if (!window.electronAPI) return;
    const folder = await window.electronAPI.selectDestinationVideosFolder();
    if (folder) {
        destVideosInput.value = folder;
        addLog(`Destino (vídeos) establecido a: ${folder}`);
        await window.electronAPI.setLastDestinationVideos(folder);
    }
});

// 3. Scan Button
btnScan.addEventListener('click', async () => {
    if (isScanning || isProcessing) return;

    if (!window.electronAPI) {
        addLog('Error: window.electronAPI no encontrado. La función de escanear está desactivada.');
        return;
    }

    const sourceFolder = sourceInput.value;
    if (!sourceFolder) {
        addLog('Carpeta de origen no establecida. Selecciona un origen primero.');
        return;
    }

    isScanning = true;
    btnScan.disabled = true;
    btnStart.disabled = true;

    resetRunUI('scan');
    addLog('Escaneando...');

    // Reset progress UI for scan stage
    progressBar.removeAttribute('max'); // Indeterminate for now
    progressText.textContent = `Procesados 0 / ?`;

    try {
        const mode = document.querySelector('input[name="mode"]:checked').value;
        const result = await window.electronAPI.scanSource({ sourcePath: sourceFolder, mode });

        scannedFiles = result.files;
        addLog(`Escaneo completo: ${result.total} archivos encontrados`);

        // Setup ready for Start
        progressBar.max = result.total;
        progressBar.value = 0;
        progressText.textContent = `Procesados 0 / ${result.total}`;
        currentFileLabel.textContent = 'Archivo: --';
    } catch (err) {
        addLog(`Escaneo fallido: ${err.message || err}`);
    } finally {
        isScanning = false;
        btnScan.disabled = false;
        btnStart.disabled = false;
    }
});

// Callbacks
window.electronAPI.onScanProgress((data) => {
    const isDone = data.currentPath === 'Done';
    let pathLabel = isDone ? 'Escaneo completado' : `Escaneando: ${data.currentPath}`;

    // Force English labels mostly for code simplicity, but truncate path if desired
    if (pathLabel.length > 60 && !isDone) {
        pathLabel = 'Escaneando: ...' + pathLabel.slice(-55);
    }
    currentFileLabel.textContent = pathLabel;
    progressText.textContent = `Escaneados: ${data.scannedCount}`;
});

window.electronAPI.onProcessProgress((payload) => {
    // Check if batched array or fallback to single object for backwards compatibility
    const items = Array.isArray(payload) ? payload : [payload];

    for (const data of items) {
        progressText.textContent = `Procesados ${data.index} / ${data.total}`;
        progressBar.value = data.index;
        currentFileLabel.textContent = `Archivo: ${data.fileName}`;

        const li = document.createElement('div');
        li.textContent = `[${data.mode.toUpperCase()}] ${data.status === 'OK' || data.status === 'Renamed' ? '✔️' : '❌'} ${data.fileName} -> ${data.destinationFolder}`;

        if (data.status === 'ERROR' || data.status === 'Error') {
            li.style.color = 'red';
        } else if (data.status === 'Renamed') {
            li.style.color = 'orange';
        }

        processList.appendChild(li);
    }

    // Keep only last 200 elements
    while (processList.children.length > 200) {
        processList.removeChild(processList.firstChild);
    }

    // Auto scroll bottom
    processList.scrollTop = processList.scrollHeight;
});

// 4. Start Button (Real processing)
btnStart.addEventListener('click', async () => {
    if (isProcessing || isScanning) return;

    if (!window.electronAPI) {
        addLog('Error: window.electronAPI no encontrado.');
        return;
    }

    if (scannedFiles.length === 0) {
        addLog('Nada que procesar. Ejecuta primero Escanear.');
        return;
    }

    const destPhotos = destPhotosInput.value;
    const destVideos = destVideosInput.value;

    // Check requirements
    const hasPhotos = scannedFiles.some(f => f.mediaType === 'photo');
    const hasVideos = scannedFiles.some(f => f.mediaType === 'video');

    if (hasPhotos && !destPhotos) {
        addLog('Error: Se encontraron fotos, pero falta el Destino (fotos). Por favor, configúrelo antes de Iniciar.');
        return;
    }
    if (hasVideos && !destVideos) {
        addLog('Error: Se encontraron vídeos, pero falta el Destino (vídeos). Por favor, configúrelo antes de Iniciar.');
        return;
    }

    isProcessing = true;
    btnScan.disabled = true;
    btnStart.disabled = true;

    resetRunUI('start');

    addLog('Iniciando procesamiento...');
    const totalItems = scannedFiles.length;
    progressBar.max = totalItems;
    progressText.textContent = `Procesados 0 / ${totalItems}`;

    try {
        const mode = document.querySelector('input[name="mode"]:checked').value;
        const result = await window.electronAPI.processFiles({
            files: scannedFiles,
            destinationPhotosPath: destPhotos,
            destinationVideosPath: destVideos,
            mode: mode
        });

        if (result && result.isCancelled) {
            addLog('Procesamiento cancelado limpiamente.');
        } else {
            addLog('Procesamiento completo.');

            let processedPhotos = false;
            let processedVideos = false;

            // Simple heuristic based on what was in the list
            Array.from(processList.children).forEach(el => {
                const text = el.textContent || '';
                if (!text.includes('ERROR:')) {
                    if (text.includes(destPhotos)) processedPhotos = true;
                    if (text.includes(destVideos)) processedVideos = true;
                }
            });

            actionsPostProcess.style.display = 'flex';

            if (processedPhotos && destPhotos) {
                btnOpenPhotos.disabled = false;
                btnOpenPhotos.onclick = () => window.electronAPI.openFolder(destPhotos);
                if (chkAutoOpen.checked) window.electronAPI.openFolder(destPhotos);
            }
            if (processedVideos && destVideos) {
                btnOpenVideos.disabled = false;
                btnOpenVideos.onclick = () => window.electronAPI.openFolder(destVideos);
                if (chkAutoOpen.checked) window.electronAPI.openFolder(destVideos);
            }
        }
    } catch (err) {
        addLog(`Procesamiento fallido: ${err.message || err}`);
    } finally {
        isProcessing = false;
        btnScan.disabled = false;
        btnStart.disabled = false;

        currentFileLabel.textContent = 'Archivo: --';
    }
});

// 5. Cancel Button
btnCancel.addEventListener('click', async () => {
    if (isProcessing) {
        addLog('Cancelando procesamiento... terminando archivo actual.');
        await window.electronAPI.cancelProcessing();
    } else {
        addLog('Nada que cancelar.');
    }
});
