import { parentPort, workerData } from 'worker_threads';
const transformers = require('@xenova/transformers');
const { pipeline } = transformers;
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { WaveFile } from 'wavefile';

const execAsync = promisify(exec);

let transcriber: any = null;

// 保存音频数据为文件
async function saveAudioData(audioArray: Float32Array) {
  const tempDir = os.tmpdir();
  const wavPath = path.join(tempDir, `debug_audio_${Date.now()}.wav`);

  // 创建 WAV 文件
  const wav = new WaveFile();

  // 设置 WAV 文件格式
  wav.fromScratch(1, 16000, '32f', audioArray);

  // 保存 WAV 文件
  await fs.promises.writeFile(wavPath, wav.toBuffer());
  console.log('保存 WAV 文件到:', wavPath);

  return { wavPath };
}

async function initializeWhisper() {
  console.log('开始初始化 Whisper 模型...');

  const pipe = await pipeline(
    'automatic-speech-recognition',
    'Xenova/whisper-medium',
    {
      revision: 'main',
      quantized: true,
      progress_callback: (progress: any) => {
        parentPort?.postMessage({ type: 'progress', data: progress });
      }
    }
  );

  transcriber = pipe;
  console.log('Whisper 模型初始化成功');
}

async function transcribe(audioArray: Float32Array) {
  if (!transcriber) {
    await initializeWhisper();
  }

  console.log('音频数据长度:', audioArray.length);
  console.log('开始转录...');

  // 检查音频数据
  if (audioArray.length === 0) {
    throw new Error('音频数据为空');
  }

  // 保存音频数据用于调试
  try {
    const { wavPath } = await saveAudioData(audioArray);
    console.log('已保存音频数据，可以检查文件:', wavPath);
  } catch (error) {
    console.error('保存音频数据失败:', error);
  }

  const result = await transcriber(audioArray, {
    language: 'chinese',
    task: 'transcribe',
    // 基本参数
    chunk_length_s: 30,
    stride_length_s: 5,
    return_timestamps: true,
    // 简化解码参数
    temperature: 0,
    no_speech_threshold: 0.3,
    condition_on_previous_text: true,
    // 移除可能导致问题的参数
    beam_size: 5
  });

  console.log('原始转录结果:', result);

  if (!result || !result.text) {
    throw new Error('转录结果为空');
  }

  // 后处理结果
  if (result.text) {
    // 移除重复的文本
    let processedText = result.text
      .trim()
      .replace(/\s+/g, ' ')
      // 移除连续重复的字符
      .replace(/(.)\1{2,}/g, '$1$1')
      // 移除重复的短语
      .replace(/(.{2,})\1+/g, '$1')
      // 规范化标点符号
      .replace(/[，。！？；：、]{2,}/g, (match: string) => match[0]);

    // 更新结果
    result.text = processedText;
  }

  return result;
}

parentPort?.on('message', async (message) => {
  try {
    console.log('开始处理音频数据...');
    if (!message.audioArray) {
      throw new Error('未收到音频数据');
    }

    const result = await transcribe(message.audioArray);
    console.log('转录完成，结果:', {
      textLength: result.text.length,
      hasChunks: !!result.chunks,
      text: result.text
    });

    parentPort?.postMessage({ type: 'complete', data: result });
  } catch (error) {
    console.error('转录失败:', error);
    parentPort?.postMessage({
      type: 'error',
      data: error instanceof Error ? error.message : '转录失败'
    });
  }
});