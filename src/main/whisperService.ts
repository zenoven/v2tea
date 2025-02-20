import { ipcMain } from 'electron';
import Store from 'electron-store';
import { VideoDownloader } from './videoDownloader';
import { ProxyAgent, setGlobalDispatcher } from 'undici';
import * as path from 'path';
import { Worker } from 'worker_threads';
import * as fs from 'fs';
import { nodewhisper } from 'nodejs-whisper';
import { app } from 'electron';
import * as process from 'process';
import * as shell from 'shelljs';
import * as os from 'os';
import { WaveFile } from 'wavefile';

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

// 定义接口
interface WhisperResult {
  text: string;
  segments: Array<{
    id: number;
    seek: number;
    start: number;
    end: number;
    text: string;
    tokens: number[];
    temperature: number;
    avg_logprob: number;
    compression_ratio: number;
    no_speech_prob: number;
  }>;
}

interface WhisperOptions {
  outputInText?: boolean;
  outputInVtt?: boolean;
  outputInSrt?: boolean;
  outputInCsv?: boolean;
  translateToEnglish?: boolean;
  language?: string;
  wordTimestamps?: boolean;
  timestamps_length?: number;
  splitOnWord?: boolean;
}

interface IOptions {
  modelName: string;
  verbose?: boolean;
  removeWavFileAfterTranscription?: boolean;
  withCuda?: boolean;
  autoDownloadModelName?: string;
  whisperOptions?: WhisperOptions;
  config?: {
    execPath?: string;
  };
}

class WhisperService {
  private static instance: WhisperService | null = null;
  private readonly modelName: string = 'medium';

  constructor() {
    if (WhisperService.instance) {
      return WhisperService.instance;
    }
    WhisperService.instance = this;
    // 设置 shelljs 的 execPath
    shell.config.execPath = process.execPath;
    this.setupIpcHandlers();
  }

  private async processAudio(event: Electron.IpcMainInvokeEvent, audioPath: string) {
    try {
      event.sender.send('transcription-status', {
        status: 'transcribing',
        message: '正在转录音频...'
      });

      // 先用 audioWorker 转换音频
      const audioData = await new Promise<Float32Array>((resolve, reject) => {
        const audioWorker = new Worker(path.join(__dirname, 'audioWorker.js'), {
          workerData: { audioPath }
        });

        audioWorker.on('message', (message) => {
          if (message.type === 'complete') {
            resolve(message.data);
          } else if (message.type === 'error') {
            reject(message.data);
          }
        });

        audioWorker.on('error', reject);
      });

      // 将 Float32Array 转换为 Int16Array
      const int16Data = new Int16Array(audioData.length);
      for (let i = 0; i < audioData.length; i++) {
        // 将 [-1, 1] 范围转换为 [-32768, 32767]
        const sample = Math.max(-1, Math.min(1, audioData[i]));
        int16Data[i] = Math.round(sample * 32767);
      }

      // 将 Int16Array 保存为临时 WAV 文件
      const tempWavPath = path.join(os.tmpdir(), `temp_${Date.now()}.wav`);
      const wav = new WaveFile();
      wav.fromScratch(1, 16000, '16', int16Data);  // 使用 16 位格式
      await fs.promises.writeFile(tempWavPath, wav.toBuffer());

      try {
        // 使用 nodejs-whisper 处理转换后的 WAV 文件
        const text = await nodewhisper(tempWavPath, {
          modelName: this.modelName,
          whisperOptions: {
            language: 'zh'
          }
        });

        // 直接使用文本输出
        event.sender.send('transcription-status', {
          status: 'completed',
          message: '转录完成'
        });

        return {
          success: true,
          text: text,
          segments: [{
            id: 0,
            seek: 0,
            start: 0,
            end: 0,
            text: text,
            tokens: [],
            temperature: 0,
            avg_logprob: 0,
            compression_ratio: 0,
            no_speech_prob: 0
          }]
        };
      } finally {
        // 清理临时文件
        await fs.promises.unlink(tempWavPath).catch(console.error);
      }
    } catch (error) {
      console.error('转录失败:', error);
      throw error;
    }
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

  private setupIpcHandlers() {
    ipcMain.handle('transcribe-audio', async (event, input) => {
      return await this.handleTranscription(event, input);
    });
  }

  async transcribe(audioPath: string): Promise<string> {
    try {
      const text = await nodewhisper(audioPath, {
        modelName: this.modelName,
        whisperOptions: {
          language: 'zh'
        }
      });
      return text;
    } catch (error) {
      console.error('转录失败:', error);
      throw error;
    }
  }
}

export default WhisperService;