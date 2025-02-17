import { parentPort, workerData } from 'worker_threads';
import { WaveFile } from 'wavefile';
import * as fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as os from 'os';

const execAsync = promisify(exec);

async function convertToWav(inputPath: string): Promise<string> {
  const outputPath = path.join(os.tmpdir(), `${Date.now()}.wav`);
  const command = `ffmpeg -i "${inputPath}" -ar 16000 -ac 1 -c:a pcm_s16le "${outputPath}"`;

  const { stderr } = await execAsync(command);
  if (stderr) {
    parentPort?.postMessage({ type: 'log', data: stderr });
  }

  return outputPath;
}

async function convertToFloat32Array(audioData: Buffer): Promise<Float32Array> {
  const wav = new WaveFile(audioData);
  const format = wav.fmt as { sampleRate: number };

  if (format.sampleRate !== 16000) {
    throw new Error('音频采样率必须是 16000Hz');
  }

  const samples = wav.getSamples();
  if (Array.isArray(samples)) {
    return new Float32Array(samples[0]);
  } else {
    return new Float32Array(samples);
  }
}

async function processAudio() {
  try {
    const { audioPath } = workerData;

    // 转换为 WAV
    parentPort?.postMessage({ type: 'status', data: { status: 'converting', message: '正在转换音频格式...' } });
    const wavPath = await convertToWav(audioPath);

    // 读取并处理音频
    parentPort?.postMessage({ type: 'status', data: { status: 'processing', message: '正在处理音频...' } });
    const audioData = await fs.promises.readFile(wavPath);
    const audioArray = await convertToFloat32Array(audioData);

    // 清理临时文件
    await fs.promises.unlink(wavPath).catch(console.error);

    // 返回处理结果
    parentPort?.postMessage({ type: 'complete', data: audioArray });
  } catch (error) {
    parentPort?.postMessage({ type: 'error', data: error });
  }
}

processAudio();