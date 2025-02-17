const fs = require('fs');
const path = require('path');
const { fetch, ProxyAgent } = require('undici');
const { pipeline } = require('@xenova/transformers');

const MODEL_FILES = [
  {
    name: 'config.json',
    url: 'https://huggingface.co/Xenova/transformers.js-models/resolve/main/whisper-base/config.json'
  },
  {
    name: 'tokenizer.json',
    url: 'https://huggingface.co/Xenova/transformers.js-models/resolve/main/whisper-base/tokenizer.json'
  },
  {
    name: 'tokenizer_config.json',
    url: 'https://huggingface.co/Xenova/transformers.js-models/resolve/main/whisper-base/tokenizer_config.json'
  },
  {
    name: 'preprocessor_config.json',
    url: 'https://huggingface.co/Xenova/transformers.js-models/resolve/main/whisper-base/preprocessor_config.json'
  },
  {
    name: 'model.onnx',
    url: 'https://huggingface.co/Xenova/transformers.js-models/resolve/main/whisper-base/model.onnx'
  },
  {
    name: 'decoder_model.onnx',
    url: 'https://huggingface.co/Xenova/transformers.js-models/resolve/main/whisper-base/decoder_model.onnx'
  },
  {
    name: 'encoder_model.onnx',
    url: 'https://huggingface.co/Xenova/transformers.js-models/resolve/main/whisper-base/encoder_model.onnx'
  }
];

const MODEL_PATH = path.join(process.cwd(), 'models', 'whisper-base');

// 获取系统代理设置
function getSystemProxy() {
  const httpProxy = process.env.HTTP_PROXY || process.env.http_proxy;
  const httpsProxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  return httpsProxy || httpProxy;
}

// 确保目录存在
if (!fs.existsSync(MODEL_PATH)) {
  fs.mkdirSync(MODEL_PATH, { recursive: true });
}

// 下载文件
async function downloadFile(file) {
  const { name, url } = file;
  const filePath = path.join(MODEL_PATH, name);

  const options = {
    dispatcher: undefined
  };

  // 如果有系统代理，使用代理
  const proxyUrl = getSystemProxy();
  if (proxyUrl) {
    console.log(`使用代理: ${proxyUrl}`);
    options.dispatcher = new ProxyAgent(proxyUrl);
  }

  try {
    const response = await fetch(url, options);

    if (!response.ok) {
      throw new Error(`下载失败 ${name}: HTTP ${response.status}`);
    }

    const total = parseInt(response.headers.get('content-length') || '0', 10);
    let current = 0;

    const fileStream = fs.createWriteStream(filePath);
    const body = response.body;

    if (!body) {
      throw new Error('Response body is null');
    }

    for await (const chunk of body) {
      current += chunk.length;
      if (total) {
        const progress = (current / total * 100).toFixed(2);
        process.stdout.write(`\r下载进度 ${name}: ${progress}%`);
      }
      fileStream.write(chunk);
    }

    process.stdout.write('\n');
    fileStream.end();

    return new Promise((resolve, reject) => {
      fileStream.on('finish', () => {
        console.log(`下载完成: ${name}`);
        resolve();
      });
      fileStream.on('error', reject);
    });
  } catch (error) {
    // 删除未完成的文件
    fs.unlink(filePath, () => {});
    throw error;
  }
}

// 下载所有文件
async function downloadModels() {
  console.log('开始下载 Whisper 模型文件...');
  console.log('模型将被保存到:', MODEL_PATH);

  try {
    for (const file of MODEL_FILES) {
      console.log(`\n开始下载 ${file.name}...`);
      await downloadFile(file);
    }
    console.log('\n所有模型文件下载完成！');
  } catch (error) {
    console.error('\n下载失败:', error.message);
    process.exit(1);
  }
}

// 检查是否已下载
function checkExistingFiles() {
  const missing = MODEL_FILES.filter(file => !fs.existsSync(path.join(MODEL_PATH, file.name)));
  if (missing.length === 0) {
    console.log('所有模型文件已存在，无需下载。');
    return true;
  }
  console.log('缺少以下文件:', missing.map(f => f.name).join(', '));
  return false;
}

// 主函数
if (require.main === module) {
  if (!checkExistingFiles()) {
    downloadModels();
  }
}

async function downloadModel(modelName) {
  console.log(`开始下载模型: ${modelName}`);
  await pipeline('automatic-speech-recognition', `Xenova/${modelName}`, {
    revision: 'main',
    cache_dir: './models',
    local: false,
    progress_callback: (progress) => {
      console.log('下载进度:', progress);
    }
  });
  console.log(`模型 ${modelName} 下载完成`);
}

// 下载基础模型
downloadModel('whisper-base')
  .catch(console.error);

module.exports = {
  downloadModels,
  checkExistingFiles,
  MODEL_PATH
};