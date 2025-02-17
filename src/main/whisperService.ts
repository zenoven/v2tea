const transformers = require('@xenova/transformers');
const { pipeline, env } = transformers;
import { ipcMain } from 'electron';
import Store from 'electron-store';
import { VideoDownloader } from './videoDownloader';
import { ProxyAgent, setGlobalDispatcher } from 'undici';
import * as path from 'path';
import { Worker } from 'worker_threads';
import * as fs from 'fs';

// 设置环境变量，强制使用 onnxruntime-node
process.env.TRANSFORMERS_JS_BACKEND = 'onnxruntime-node';

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

class WhisperService {
  private transcriber: any = null;
  private isInitializing: boolean = false;
  private initPromise: Promise<void> | null = null;

  constructor() {
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
          // 验证文件是否存在
          if (!fs.existsSync(audioPath)) {
            throw new Error('下载的音频文件未找到');
          }

          const result = await this.processAudio(event, audioPath);

          // 清理临时文件
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
      // 创建音频处理 Worker
      const audioWorkerPath = path.join(__dirname, 'audioWorker.js');
      const audioWorker = new Worker(audioWorkerPath, {
        workerData: { audioPath }
      });

      // 创建转录 Worker
      const transcriptionWorkerPath = path.join(__dirname, 'transcriptionWorker.js');
      const transcriptionWorker = new Worker(transcriptionWorkerPath);

      audioWorker.on('message', async (message) => {
        switch (message.type) {
          case 'status':
            event.sender.send('transcription-status', message.data);
            break;
          case 'log':
            console.log('Worker log:', message.data);
            break;
          case 'complete':
            transcriptionWorker.postMessage({ audioArray: message.data });
            break;
          case 'error':
            reject(message.data);
            break;
        }
      });

      transcriptionWorker.on('message', (message) => {
        switch (message.type) {
          case 'progress':
            const { progress, currentTime, totalDuration, text } = message.data;
            const progressPercent = typeof progress === 'number' && !isNaN(progress) ? Math.round(progress) : 0;
            event.sender.send('transcription-status', {
              status: 'transcribing',
              message: `正在转录音频... ${progressPercent}%`,
              progress: {
                percent: progressPercent,
                currentTime,
                totalDuration,
                text
              }
            });
            break;
          case 'complete':
            event.sender.send('transcription-status', {
              status: 'completed',
              message: '转录完成'
            });
            resolve({
              success: true,
              text: message.data.text,
              segments: message.data.chunks
            });
            break;
          case 'error':
            reject(message.data);
            break;
        }
      });

      audioWorker.on('error', reject);
      transcriptionWorker.on('error', reject);

      audioWorker.on('exit', (code) => {
        if (code !== 0) {
          reject(new Error(`Audio worker stopped with exit code ${code}`));
        }
      });

      transcriptionWorker.on('exit', (code) => {
        if (code !== 0) {
          reject(new Error(`Transcription worker stopped with exit code ${code}`));
        }
      });
    });
  }

  private async initializeWhisper() {
    if (this.transcriber) {
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

        const pipe = await pipeline(
          'automatic-speech-recognition',
          'Xenova/whisper-medium',
          {
            revision: 'main',
            quantized: true,
            progress_callback: (progress: any) => {
              console.log('模型加载进度:', progress);
            }
          }
        );

        if (typeof pipe !== 'function') {
          throw new Error('Pipeline 初始化失败: 返回值不是函数');
        }

        this.transcriber = pipe;
        console.log('Whisper 模型初始化成功');
      })();

      await this.initPromise;
    } catch (error) {
      console.error('Whisper 初始化失败:', error);
      this.transcriber = null;
      this.initPromise = null;
      throw error;
    } finally {
      this.isInitializing = false;
    }
  }

  private setupIpcHandlers() {
    ipcMain.handle('transcribe-audio', async (event, input: { type: 'file' | 'url', path?: string, url?: string }) => {
      return await this.handleTranscription(event, input);
    });
  }
}

export default WhisperService;