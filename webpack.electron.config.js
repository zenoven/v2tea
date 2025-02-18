const path = require('path');
const { spawn } = require('child_process');

const isDevelopment = process.env.NODE_ENV === 'development';

module.exports = {
  mode: process.env.NODE_ENV || 'production',
  entry: {
    main: './src/main/main.ts',
    preload: './src/main/preload.ts',
    audioWorker: './src/main/audioWorker.ts',
    transcriptionWorker: './src/main/transcriptionWorker.ts'
  },
  target: 'electron-main',
  output: {
    path: path.resolve(__dirname, 'dist/main'),
    filename: '[name].js',
    globalObject: 'this',
    chunkFormat: 'commonjs'
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: {
          loader: 'ts-loader'
        }
      }
    ]
  },
  resolve: {
    extensions: ['.ts', '.js'],
    fallback: {
      fs: false,
      path: false,
      crypto: false,
      os: false,
      util: false,
      stream: false,
      buffer: false,
    }
  },
  externals: {
    '@ffmpeg/ffmpeg': 'commonjs @ffmpeg/ffmpeg',
    '@ffmpeg/util': 'commonjs @ffmpeg/util',
    'onnxruntime-node': 'commonjs2 onnxruntime-node',
    'sharp': 'commonjs2 sharp'
  },
  node: {
    __dirname: false,
    __filename: false,
  },
  optimization: {
    minimize: false
  },
  experiments: {
    topLevelAwait: true
  },
  plugins: [
    ...(isDevelopment ? [{
      apply: (compiler) => {
        let electronProcess = null;
        compiler.hooks.afterEmit.tap('AfterEmitPlugin', () => {
          if (electronProcess) {
            electronProcess.kill();
          }
          electronProcess = spawn('electron', ['.'], {
            stdio: 'inherit'
          });
        });
        process.on('exit', () => {
          if (electronProcess) {
            electronProcess.kill();
          }
        });
      }
    }] : [])
  ]
};