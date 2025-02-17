const transformers = require('@xenova/transformers');
const { pipeline, env } = transformers;
import { ipcMain } from 'electron';
import Store from 'electron-store';
import { VideoDownloader } from './videoDownloader';
import { ProxyAgent, setGlobalDispatcher } from 'undici';
import * as fs from 'fs';
import { WaveFile } from 'wavefile';
import * as path from 'path';
import * as os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { Worker } from 'worker_threads';

const execAsync = promisify(exec);

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

interface WavFormat {
  sampleRate: number;
  bitsPerSample: number;
  numChannels: number;
  audioFormat: number;
}

class WhisperService {
  private transcriber: any = null;
  private isInitializing: boolean = false;
  private initPromise: Promise<void> | null = null;

  constructor() {
    this.setupIpcHandlers();
  }

  private async convertToWav(inputPath: string): Promise<string> {
    try {
      console.log('开始转换音频文件...');
      const outputPath = path.join(os.tmpdir(), `${Date.now()}.wav`);

      // 使用系统 FFmpeg 命令
      const command = `ffmpeg -i "${inputPath}" -ar 16000 -ac 1 -c:a pcm_s16le "${outputPath}"`;
      console.log('执行命令:', command);

      const { stdout, stderr } = await execAsync(command);
      if (stderr) {
        console.log('FFmpeg 输出:', stderr);
      }

      console.log('音频转换完成');
      return outputPath;
    } catch (error) {
      console.error('音频转换失败:', error);
      throw error;
    }
  }

  private async convertToFloat32Array(audioData: Buffer): Promise<Float32Array> {
    // 使用 wavefile 解析 WAV 文件
    const wav = new WaveFile(audioData);

    // 获取格式信息
    const format = wav.fmt as WavFormat;
    console.log('音频格式:', {
      sampleRate: format.sampleRate,
      bitsPerSample: format.bitsPerSample,
      numChannels: format.numChannels,
      format: format.audioFormat
    });

    // 确保采样率是 16000Hz
    if (format.sampleRate !== 16000) {
      throw new Error('音频采样率必须是 16000Hz');
    }

    // 获取音频数据
    const samples = wav.getSamples();

    if (Array.isArray(samples)) {
      // 如果是多声道，只取第一个声道
      const channelData = samples[0];
      console.log('音频数据范围:', {
        min: Math.min(...channelData),
        max: Math.max(...channelData)
      });

      // 如果数据不是 32 位浮点数，需要进行归一化
      if (format.bitsPerSample !== 32) {
        const maxValue = Math.pow(2, format.bitsPerSample - 1) - 1;
        const float32Data = new Float32Array(channelData.length);
        for (let i = 0; i < channelData.length; i++) {
          float32Data[i] = channelData[i] / maxValue;
        }
        return float32Data;
      }
      return new Float32Array(channelData);
    } else {
      // 单声道
      console.log('音频数据范围:', {
        min: Math.min(...samples),
        max: Math.max(...samples)
      });

      // 如果数据不是 32 位浮点数，需要进行归一化
      if (format.bitsPerSample !== 32) {
        const maxValue = Math.pow(2, format.bitsPerSample - 1) - 1;
        const float32Data = new Float32Array(samples.length);
        for (let i = 0; i < samples.length; i++) {
          float32Data[i] = samples[i] / maxValue;
        }
        return float32Data;
      }
      return new Float32Array(samples);
    }
  }

  private async handleTranscription(event: Electron.IpcMainInvokeEvent, audioPath: string) {
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
            // 发送音频数据到转录 Worker
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
            event.sender.send('transcription-status', {
              status: 'transcribing',
              message: '正在转录音频...',
              progress: message.data
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
      let audioPath: string | null = null;
      let retries = 3;

      while (retries > 0) {
        try {
          if (!this.transcriber) {
            event.sender.send('transcription-status', { status: 'initializing', message: '正在初始化模型...' });
            await this.initializeWhisper();
          }

          if (input.type === 'file' && input.path) {
            audioPath = input.path;
            return await this.handleTranscription(event, audioPath);
          } else if (input.type === 'url' && input.url) {
            event.sender.send('transcription-status', { status: 'downloading', message: '正在下载音频...' });
            const videoDownloader = new VideoDownloader();
            audioPath = await videoDownloader.downloadAudio(input.url);
            const result = await this.handleTranscription(event, audioPath);
            await videoDownloader.cleanup(audioPath);
            return result;
          } else {
            throw new Error('无效的输入');
          }
        } catch (error) {
          console.error(`转换失败 (剩余重试次数: ${retries - 1}):`, error);
          event.sender.send('transcription-status', {
            status: 'error',
            message: `转换失败: ${error instanceof Error ? error.message : '未知错误'}`
          });

          if (audioPath && input.type === 'url') {
            const videoDownloader = new VideoDownloader();
            await videoDownloader.cleanup(audioPath);
          }

          retries--;
          if (retries === 0) {
            return {
              success: false,
              error: error instanceof Error ? error.message : '转换失败'
            };
          }

          // 重置 transcriber，下次重试时重新初始化
          this.transcriber = null;
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    });
  }
}

export default WhisperService;