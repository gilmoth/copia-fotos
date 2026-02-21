const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    selectSourceFolder: () => ipcRenderer.invoke('select-source-folder'),
    selectDestinationPhotosFolder: () => ipcRenderer.invoke('select-destination-photos-folder'),
    selectDestinationVideosFolder: () => ipcRenderer.invoke('select-destination-videos-folder'),
    scanSource: (args) => ipcRenderer.invoke('scan-source', args),
    onScanProgress: (callback) => ipcRenderer.on('scan-progress', (_event, payload) => callback(payload)),
    processFiles: (args) => ipcRenderer.invoke('process-files', args),
    cancelProcessing: () => ipcRenderer.invoke('cancel-processing'),
    onProcessProgress: (callback) => ipcRenderer.on('process-progress', (_event, payload) => callback(payload)),
    getLastPaths: () => ipcRenderer.invoke('get-last-paths'),
    setLastSource: (path) => ipcRenderer.invoke('set-last-source', path),
    setLastDestinationPhotos: (path) => ipcRenderer.invoke('set-last-destination-photos', path),
    setLastDestinationVideos: (path) => ipcRenderer.invoke('set-last-destination-videos', path),
    openFolder: (path) => ipcRenderer.invoke('open-folder', path)
});
