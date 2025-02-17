import { app, BrowserWindow } from 'electron';
import path from 'path';
import isDev from 'electron-is-dev';
import * as fs from 'fs';
import WhisperService from './whisperService';
import { VideoDownloader } from './videoDownloader';

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
      path.join(process.resourcesPath, 'app/dist/renderer/index.html'),
      path.join(appPath, 'app/dist/renderer/index.html'),
      path.join(appPath, 'dist/renderer/index.html'),
      path.join(__dirname, '../renderer/index.html')
    ];

    // 列出目录内容以便调试
    for (const dir of [process.resourcesPath, appPath, path.dirname(__dirname)]) {
      try {
        console.log(`目录 ${dir} 内容:`, fs.readdirSync(dir));
        // 如果是 app/dist 目录，也列出其子目录
        if (fs.existsSync(path.join(dir, 'app/dist'))) {
          console.log(`目录 ${path.join(dir, 'app/dist')} 内容:`,
            fs.readdirSync(path.join(dir, 'app/dist')));
        }
      } catch (err) {
        console.log(`无法读取目录 ${dir}:`, err);
      }
    }

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
      console.log('当前目录:', __dirname);
      console.log('应用目录:', appPath);
      console.log('资源目录:', process.resourcesPath);
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