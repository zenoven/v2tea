import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import * as isDev from 'electron-is-dev';
import WhisperService from './whisperService';
import { VideoDownloader } from './videoDownloader';

let mainWindow: BrowserWindow | null;
let whisperService: WhisperService;
let videoDownloader: VideoDownloader;

function createWindow() {
  const preloadPath = path.join(__dirname, 'preload.js');

  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: preloadPath
    }
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('Window failed to load:', errorCode, errorDescription);
  });

  mainWindow.webContents.on('dom-ready', () => {
    console.log('Window DOM ready');
  });

  mainWindow.webContents.on('preload-error', (event, preloadPath, error) => {
    console.error('Preload error:', preloadPath, error);
  });

  mainWindow.webContents.on('did-finish-load', () => {
    console.log('Window finished loading');
  });
}

app.whenReady().then(() => {
  createWindow();
  whisperService = new WhisperService();
  videoDownloader = new VideoDownloader();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});