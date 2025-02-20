import { ipcMain } from 'electron';
import Store from 'electron-store';
import { VideoDownloader } from './videoDownloader';
import { ProxyAgent, setGlobalDispatcher } from 'undici';
import * as path from 'path';
import { Worker } from 'worker_threads';
import * as fs from 'fs';
import { Whisper } from 'nodejs-whisper';

// 获取系统代理设置
function getSystemProxy() {
  return process.env.HTTPS_PROXY || process.env.https_proxy ||
         process.env.HTTP_PROXY || process.env.http_proxy;
}

// 配置全局代理
const proxyUrl = getSystemProxy();
if (proxyUrl) {
  console.log('使用代理:', proxyUrl);
  const proxyAgent = new ProxyAgent(proxyUrl);
  setGlobalDispatcher(proxyAgent);
}

const store = new Store();

// 添加类型声明
declare module 'nodejs-whisper' {
  export class Whisper {
    constructor(options: { modelPath: string; threads?: number });
    transcribe(audio: ArrayBuffer, options: {
      language?: string;
      progressCallback?: (progress: number) => void;
    }): Promise<{
      text: string;
      segments: Array<{
        text: string;
        start: number;
        end: number;
      }>;
    }>;
  }
}

class WhisperService {
  private whisperInstance: Whisper | null = null;
  private isInitializing: boolean = false;
  private initPromise: Promise<void> | null = null;
  private readonly modelPath: string;

  constructor() {
    this.modelPath = path.join(process.cwd(), 'models/ggml-medium.bin');
    this.setupIpcHandlers();
  }

  private async handleTranscription(event: Electron.IpcMainInvokeEvent, input: { type: 'file' | 'url', path?: string, url?: string }) {
    try {
      let audioPath: string | null = null;

      if (input.type === 'url' && input.url) {
        event.sender.send('transcription-status', {
          status: 'downloading',
          message: '正在下载音频...'
        });

        const videoDownloader = new VideoDownloader();
        try {
          audioPath = await videoDownloader.downloadAudio(input.url);
          if (!fs.existsSync(audioPath)) {
            throw new Error('下载的音频文件未找到');
          }

          const result = await this.processAudio(event, audioPath);

          await videoDownloader.cleanup(audioPath);
          return result;
        } catch (error) {
          if (audioPath) {
            await videoDownloader.cleanup(audioPath);
          }
          throw error;
        }
      } else if (input.type === 'file' && input.path) {
        return await this.processAudio(event, input.path);
      } else {
        throw new Error('无效的输入');
      }
    } catch (error) {
      console.error('转换失败:', error);
      event.sender.send('transcription-status', {
        status: 'error',
        message: `转换失败: ${error instanceof Error ? error.message : '未知错误'}`
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : '转换失败'
      };
    }
  }

  private async processAudio(event: Electron.IpcMainInvokeEvent, audioPath: string) {
    return new Promise((resolve, reject) => {
      const audioWorker = new Worker(path.join(__dirname, 'audioWorker.js'), {
        workerData: { audioPath }
      });

      let audioData: Float32Array | null = null;

      audioWorker.on('message', async (message) => {
        try {
          switch (message.type) {
            case 'status':
              event.sender.send('transcription-status', message.data);
              break;
            case 'complete':
              audioData = message.data;
              if (!audioData) {
                throw new Error('音频数据为空');
              }
              await this.transcribeAudio(event, audioData, resolve, reject);
              break;
            case 'error':
              reject(message.data);
              break;
          }
        } catch (error) {
          reject(error);
        }
      });

      audioWorker.on('error', reject);
      audioWorker.on('exit', (code) => {
        if (code !== 0) {
          reject(new Error(`Audio worker stopped with exit code ${code}`));
        }
      });
    });
  }

  private async transcribeAudio(
    event: Electron.IpcMainInvokeEvent,
    audioData: Float32Array,
    resolve: (value: any) => void,
    reject: (reason?: any) => void
  ) {
    try {
      await this.initializeWhisper();
      if (!this.whisperInstance) {
        throw new Error('Whisper 实例未初始化');
      }

      event.sender.send('transcription-status', {
        status: 'transcribing',
        message: '正在转录音频...'
      });

      const result = await this.whisperInstance.transcribe(audioData.buffer, {
        language: 'zh',
        progressCallback: (progress: number) => {
          event.sender.send('transcription-status', {
            status: 'transcribing',
            message: `正在转录音频... ${Math.round(progress * 100)}%`,
            progress: {
              percent: Math.round(progress * 100)
            }
          });
        }
      });

      event.sender.send('transcription-status', {
        status: 'completed',
        message: '转录完成'
      });

      resolve({
        success: true,
        text: result.text,
        segments: result.segments
      });
    } catch (error) {
      reject(error);
    }
  }

  private async initializeWhisper() {
    if (this.whisperInstance) {
      return;
    }

    if (this.isInitializing) {
      console.log('等待 Whisper 初始化完成...');
      await this.initPromise;
      return;
    }

    try {
      this.isInitializing = true;
      this.initPromise = (async () => {
        console.log('开始初始化 Whisper 模型...');

        if (!fs.existsSync(this.modelPath)) {
          throw new Error('模型文件不存在，请先运行 npm install 下载模型');
        }

        this.whisperInstance = new Whisper({
          modelPath: this.modelPath,
          threads: 4
        });
        console.log('Whisper 模型初始化成功');
      })();

      await this.initPromise;
    } catch (error) {
      console.error('Whisper 初始化失败:', error);
      this.whisperInstance = null;
      this.initPromise = null;
      throw error;
    } finally {
      this.isInitializing = false;
    }
  }

  private setupIpcHandlers() {
    ipcMain.handle('transcribe-audio', async (event, input) => {
      return await this.handleTranscription(event, input);
    });
  }
}

export default WhisperService;