import { parentPort, workerData } from 'worker_threads';
import { WaveFile } from 'wavefile';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';

// 添加一个辅助函数来发送日志
function sendLog(message: string, data?: any) {
  parentPort?.postMessage({
    type: 'log',
    data: { message, details: data }
  });
}

// 设置 ffmpeg 路径
if (!ffmpegStatic) {
  throw new Error('找不到 ffmpeg');
}

// 修改 ffmpeg 路径处理
let ffmpegPath = ffmpegStatic;
if (ffmpegPath.includes('app.asar') && !ffmpegPath.includes('unpacked')) {
  // 将 app.asar 替换为 app.asar.unpacked
  ffmpegPath = ffmpegPath.replace('app.asar', 'app.asar.unpacked');
}

sendLog('FFmpeg 路径:', {
  original: ffmpegStatic,
  resolved: ffmpegPath,
  exists: fs.existsSync(ffmpegPath),
  isFile: fs.existsSync(ffmpegPath) && fs.statSync(ffmpegPath).isFile()
});

// 设置 ffmpeg 路径
ffmpeg.setFfmpegPath(ffmpegPath);

// 定义 WAV 格式接口
interface WavFormat {
  sampleRate: number;
  bitsPerSample: number;
  numChannels: number;
  audioFormat: number;
}

async function processAudio() {
  try {
    const { audioPath } = workerData;

    if (!audioPath) {
      throw new Error('未提供音频文件路径');
    }

    if (!fs.existsSync(audioPath)) {
      throw new Error(`音频文件不存在: ${audioPath}`);
    }

    // 转换为 WAV 格式
    parentPort?.postMessage({ type: 'status', data: { status: 'converting', message: '正在转换音频格式...' } });

    // 使用 FFmpeg 转换为 16kHz, 16位 PCM WAV
    const tempWavPath = path.join(os.tmpdir(), `temp_${Date.now()}.wav`);

    await new Promise((resolve, reject) => {
      ffmpeg(audioPath)
        .toFormat('wav')
        .audioFrequency(16000)
        .audioChannels(1)
        .audioCodec('pcm_s16le')
        .on('error', (err) => {
          console.error('FFmpeg 错误:', err);
          reject(err);
        })
        .on('end', () => {
          console.log('FFmpeg 转换完成');
          resolve(null);
        })
        .save(tempWavPath);
    });

    // 读取转换后的 WAV 文件
    const audioData = await fs.promises.readFile(tempWavPath);
    const wav = new WaveFile(audioData);

    // 获取音频格式信息
    const format = wav.fmt as WavFormat;
    console.log('音频格式:', {
      sampleRate: format.sampleRate,
      bitsPerSample: format.bitsPerSample,
      numChannels: format.numChannels,
      audioFormat: format.audioFormat
    });

    // 获取音频样本
    const samples = wav.getSamples();
    const audioArray = Array.isArray(samples) ? samples[0] : samples;

    // 转换为 Float32Array，范围从 [-32768, 32767] 到 [-1, 1]
    const float32Array = new Float32Array(audioArray.length);
    const scale = 1.0 / 32768.0;

    for (let i = 0; i < audioArray.length; i++) {
      float32Array[i] = audioArray[i] * scale;
    }

    // 清理临时文件
    await fs.promises.unlink(tempWavPath).catch(console.error);

    // 保存一个副本用于调试
    const debugWavPath = path.join(os.tmpdir(), `debug_${Date.now()}.wav`);
    const debugWav = new WaveFile();
    debugWav.fromScratch(1, 16000, '32f', float32Array);
    await fs.promises.writeFile(debugWavPath, debugWav.toBuffer());
    console.log('调试文件已保存:', debugWavPath);

    // 返回处理后的音频数据
    parentPort?.postMessage({ type: 'complete', data: float32Array });
  } catch (error) {
    console.error('音频处理失败:', error);
    parentPort?.postMessage({
      type: 'error',
      data: {
        message: error instanceof Error ? error.message : '未知错误',
        details: error
      }
    });
  }
}

processAudio();