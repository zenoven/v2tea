import { parentPort, workerData } from 'worker_threads';
import { WaveFile } from 'wavefile';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function processAudio() {
  try {
    const { audioPath } = workerData;

    // 转换为 WAV 格式
    parentPort?.postMessage({ type: 'status', data: { status: 'converting', message: '正在转换音频格式...' } });

    // 使用 FFmpeg 转换为 16kHz, 16位 PCM WAV
    const tempWavPath = path.join(os.tmpdir(), `temp_${Date.now()}.wav`);
    const ffmpegCommand = `ffmpeg -i "${audioPath}" -ar 16000 -ac 1 -c:a pcm_s16le -y "${tempWavPath}"`;

    console.log('执行 FFmpeg 命令:', ffmpegCommand);
    await execAsync(ffmpegCommand);

    // 读取转换后的 WAV 文件
    const audioData = await fs.promises.readFile(tempWavPath);
    const wav = new WaveFile(audioData);

    // 获取音频格式信息
    console.log('音频格式:', {
      sampleRate: wav.fmt.sampleRate,
      bitsPerSample: wav.fmt.bitsPerSample,
      numChannels: wav.fmt.numChannels,
      audioFormat: wav.fmt.audioFormat
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
    parentPort?.postMessage({ type: 'error', data: error });
  }
}

processAudio();