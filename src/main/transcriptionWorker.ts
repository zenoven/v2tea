import { parentPort } from 'worker_threads';
const transformers = require('@xenova/transformers');
const { pipeline } = transformers;

let transcriber: any = null;

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

  // 计算总时长（秒）
  const totalDuration = Math.max(1, audioArray.length / 16000);
  console.log('音频总时长:', totalDuration, '秒');

  // 发送初始进度
  parentPort?.postMessage({
    type: 'progress',
    data: {
      progress: 0,
      currentTime: 0,
      totalDuration: Math.floor(totalDuration),
      text: '开始转录...'
    }
  });

  // 分块处理音频
  const chunkSize = 16000 * 30; // 30秒一块
  const overlap = 16000 * 5;    // 5秒重叠
  let processedSamples = 0;
  let allSegments: any[] = [];

  while (processedSamples < audioArray.length) {
    // 计算当前块的范围
    const start = Math.max(0, processedSamples - overlap);
    const end = Math.min(audioArray.length, start + chunkSize);
    const chunk = audioArray.slice(start, end);

    // 处理当前块
    const result = await transcriber(chunk, {
      language: 'chinese',
      task: 'transcribe',
      return_timestamps: true,
      temperature: 0,
      no_speech_threshold: 0.3,
      condition_on_previous_text: true,
      beam_size: 5
    });

    if (result.chunks) {
      // 调整时间戳并添加到结果中
      const adjustedChunks = result.chunks.map((c: any) => ({
        ...c,
        time: {
          start: (c.time?.start || 0) + (start / 16000),
          end: (c.time?.end || 0) + (start / 16000)
        }
      }));
      allSegments.push(...adjustedChunks);
    }

    // 更新进度
    processedSamples = end;
    const progress = Math.min(100, (processedSamples / audioArray.length) * 100);

    // 发送进度更新
    parentPort?.postMessage({
      type: 'progress',
      data: {
        progress: Math.floor(progress),
        currentTime: Math.floor(processedSamples / 16000),
        totalDuration: Math.floor(totalDuration),
        text: allSegments
          .sort((a, b) => (a.time.start - b.time.start))
          .map(s => s.text?.trim())
          .filter(Boolean)
          .join(' ')
      }
    });
  }

  // 合并所有片段
  const finalText = allSegments
    .sort((a, b) => (a.time.start - b.time.start))
    .map(s => s.text?.trim())
    .filter(Boolean)
    .join(' ')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/(.)\1{2,}/g, '$1$1')
    .replace(/(.{2,})\1+/g, '$1')
    .replace(/[，。！？；：、]{2,}/g, (match: string) => match[0]);

  return {
    text: finalText,
    chunks: allSegments.sort((a, b) => (a.time.start - b.time.start))
  };
}

parentPort?.on('message', async (message) => {
  try {
    if (!message.audioArray) {
      throw new Error('未收到音频数据');
    }

    const result = await transcribe(message.audioArray);
    parentPort?.postMessage({ type: 'complete', data: result });
  } catch (error) {
    console.error('转录失败:', error);
    parentPort?.postMessage({
      type: 'error',
      data: error instanceof Error ? error.message : '转录失败'
    });
  }
});