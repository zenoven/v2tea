import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import isDev from 'electron-is-dev';
import * as fs from 'fs';
import WhisperService from './whisperService';
import { VideoDownloader } from './videoDownloader';
import { Worker } from 'worker_threads';

// 添加环境判断
const isDevMode = isDev && process.env.NODE_ENV === 'development';

class MainWindow {
  // 使用 private 修饰符，但不使用 assertWindow
  private _window: BrowserWindow | null = null;
  private whisperService: WhisperService;
  private videoDownloader: VideoDownloader;

  constructor() {
    this.whisperService = new WhisperService();
    this.videoDownloader = new VideoDownloader();
  }

  public createWindow(): void {
    if (this._window) {
      this._window.focus();
      return;
    }

    this._window = new BrowserWindow({
      width: 1200,
      height: 800,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js'),
      },
    });

    // 添加调试信息
    console.log('当前环境:', process.env.NODE_ENV);
    console.log('isDev:', isDevMode);
    console.log('__dirname:', __dirname);

    if (isDevMode) {  // 使用新的判断
      this._window.loadURL('http://localhost:3000').catch((error: Error) => {
        console.error('开发服务器连接失败:', error);
        this.loadLocalFile();
      });
    } else {
      this.loadLocalFile();
    }

    // 在生产环境也打开开发者工具以便调试
    this._window.webContents.openDevTools();

    this.setupEvents();
  }

  private loadLocalFile(): void {
    if (!this._window) return;

    const appPath = app.getAppPath();
    console.log('应用根目录:', appPath);

    // 修改路径检查顺序
    const possiblePaths = [
      path.join(appPath, 'dist/renderer/index.html'),     // 开发环境路径
      path.join(__dirname, '../renderer/index.html'),     // 生产环境路径
      path.join(process.resourcesPath, 'app/dist/renderer/index.html'),  // 打包后路径
    ];

    let htmlPath: string | null = null;
    for (const p of possiblePaths) {
      console.log('检查路径:', p, '是否存在:', fs.existsSync(p));
      if (fs.existsSync(p)) {
        htmlPath = p;
        break;
      }
    }

    if (!htmlPath) {
      console.error('找不到 HTML 文件');
      throw new Error('HTML file not found');
    }

    console.log('使用路径:', htmlPath);
    this._window.loadFile(htmlPath).catch((error: Error) => {
      console.error('加载文件失败:', error);
    });
  }

  private setupEvents(): void {
    if (!this._window) return;

    this._window.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
      console.error('页面加载失败:', errorCode, errorDescription);
    });

    this._window.webContents.on('dom-ready', () => {
      console.log('Window DOM ready');
    });

    this._window.webContents.on('preload-error', (event, preloadPath, error) => {
      console.error('Preload error:', preloadPath, error);
    });

    this._window.webContents.on('did-finish-load', () => {
      console.log('Window finished loading');
    });

    this._window.webContents.on('console-message', (event, level, message) => {
      console.log('渲染进程日志:', message);
    });

    this._window.on('closed', () => {
      this._window = null;
    });

    // 添加音频转换处理
    ipcMain.handle('convert-audio', async (event, audioPath) => {
      return new Promise((resolve, reject) => {
        const worker = new Worker(path.join(__dirname, 'audioWorker.js'), {
          workerData: { audioPath }
        });

        worker.on('message', (message) => {
          if (message.type === 'status') {
            // 转发状态消息到渲染进程
            this._window?.webContents.send('conversion-status', message.data);
          } else if (message.type === 'complete') {
            resolve(message.data);
          } else if (message.type === 'error') {
            reject(message.data);
          }
        });

        worker.on('error', reject);
        worker.on('exit', (code) => {
          if (code !== 0) {
            reject(new Error(`Worker stopped with exit code ${code}`));
          }
        });
      });
    });
  }

  public isWindowCreated(): boolean {
    return this._window !== null;
  }
}

// 创建主窗口实例
const mainWindow = new MainWindow();

// 应用程序生命周期事件
app.whenReady().then(() => {
  mainWindow.createWindow();
}).catch((error: Error) => {
  console.error('应用启动失败:', error);
  app.quit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (!mainWindow.isWindowCreated()) {
    mainWindow.createWindow();
  }
});