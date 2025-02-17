import React, { useState, useEffect } from 'react';

// 定义 window.electron 的类型
declare global {
  interface Window {
    electron: {
      ipcRenderer: {
        invoke(channel: string, data: any): Promise<any>;
      };
      on(channel: string, callback: (...args: any[]) => void): () => void;
    };
  }
}

// 等待 electron 对象可用
const waitForElectron = (): Promise<typeof window.electron> => {
  return new Promise((resolve) => {
    if (window.electron) {
      resolve(window.electron);
    } else {
      const checkInterval = setInterval(() => {
        if (window.electron) {
          clearInterval(checkInterval);
          resolve(window.electron);
        }
      }, 100);
    }
  });
};

interface TranscriptionResult {
  success: boolean;
  text?: string;
  segments?: Array<{
    text: string;
    start: number;
    end: number;
  }>;
  error?: string;
}

interface TranscriptionProgress {
  percent: number;
  currentTime: number;
  totalDuration: number;
  text: string;
}

interface TranscriptionStatus {
  status: 'initializing' | 'converting' | 'transcribing' | 'completed' | 'error' | 'downloading';
  message: string;
  progress?: TranscriptionProgress;
}

const App: React.FC = () => {
  const [ipcRenderer, setIpcRenderer] = useState<typeof window.electron.ipcRenderer | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState<string>('');
  const [transcription, setTranscription] = useState<string>('');
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [error, setError] = useState<string>('');
  const [status, setStatus] = useState<TranscriptionStatus | null>(null);

  useEffect(() => {
    waitForElectron().then((electron) => {
      setIpcRenderer(electron.ipcRenderer);
    });
  }, []);

  useEffect(() => {
    // 监听转录状态更新
    const cleanup = window.electron.on('transcription-status', (newStatus: TranscriptionStatus) => {
      setStatus(newStatus);
    });

    // 清理监听器
    return () => {
      if (cleanup) cleanup();
    };
  }, []);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      const selectedFile = files[0];
      // 获取文件的真实路径
      const filePath = (selectedFile as any).path || selectedFile.name;
      setFile({
        ...selectedFile,
        path: filePath
      } as File & { path: string });
      setUrl('');
      setError('');
      setTranscription('');
    }
  };

  const handleUrlChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setUrl(event.target.value);
    setFile(null); // 清空文件
    setError('');
    setTranscription('');
  };

  const handleTranscribe = async () => {
    if (!file && !url) return;
    if (!ipcRenderer) {
      setError('Electron IPC 尚未准备好');
      return;
    }

    try {
      setIsTranscribing(true);
      setError('');

      console.log('Sending request with:', file ? {
        type: 'file',
        path: (file as any).path
      } : {
        type: 'url',
        url
      });

      const result: TranscriptionResult = await ipcRenderer.invoke(
        'transcribe-audio',
        file ? {
          type: 'file',
          path: (file as any).path
        } : {
          type: 'url',
          url
        }
      );

      if (result.success && result.text) {
        setTranscription(result.text);
      } else {
        setError(result.error || '转换失败');
      }
    } catch (err: unknown) {
      console.error('转换错误:', err);
      const errorMessage = err instanceof Error ? err.message : '未知错误';
      setError('转换过程发生错误: ' + errorMessage);
    } finally {
      setIsTranscribing(false);
    }
  };

  // 格式化时间
  const formatTime = (seconds: number | null) => {
    if (seconds === null || isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // 渲染进度条和实时文本
  const renderProgress = () => {
    if (!status?.progress) {
      return (
        <div className="progress-container">
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: '0%' }} />
          </div>
          <div className="progress-info">
            <div className="time-info">0:00 / 0:00</div>
          </div>
          <div className="current-text">
            准备转录...
          </div>
        </div>
      );
    }

    const { percent = 0, currentTime = 0, totalDuration = 0, text = '' } = status.progress;

    // 确保所有数值都是有效的
    const progress = !isNaN(percent) ? Math.min(100, Math.max(0, percent)) : 0;
    const current = !isNaN(currentTime) ? Math.max(0, currentTime) : 0;
    const total = !isNaN(totalDuration) ? Math.max(1, totalDuration) : 1;

    return (
      <div className="progress-container">
        <div className="progress-bar">
          <div
            className="progress-fill"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="progress-info">
          <div className="time-info">{formatTime(current)} / {formatTime(total)}</div>
        </div>
        {text && (
          <div className="current-text">
            当前识别文本: {text}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="container">
      <h1>视频转文本</h1>

      <div style={{ marginBottom: '20px' }}>
        <h3>选择一种输入方式：</h3>

        <div style={{ marginBottom: '10px' }}>
          <p>1. 上传本地文件：</p>
          <input
            type="file"
            accept="video/*,audio/*"
            onChange={handleFileSelect}
            disabled={isTranscribing}
          />
        </div>

        <div style={{ marginBottom: '10px' }}>
          <p>2. 输入视频链接：</p>
          <input
            type="text"
            value={url}
            onChange={handleUrlChange}
            placeholder="请输入视频链接"
            style={{ width: '100%', maxWidth: '500px', padding: '5px' }}
            disabled={isTranscribing}
          />
        </div>
      </div>

      {(file || url) && (
        <div style={{ marginBottom: '20px' }}>
          <p>已选择：{file ? file.name : url}</p>
          <button
            onClick={handleTranscribe}
            disabled={isTranscribing}
          >
            {isTranscribing ? '转换中...' : '开始转换'}
          </button>
        </div>
      )}

      {error && (
        <div style={{ color: 'red', marginBottom: '20px' }}>
          {error}
        </div>
      )}

      {status && (
        <div className="status">
          <p>{status.message}</p>
          {status.status === 'transcribing' && renderProgress()}
        </div>
      )}

      {transcription && (
        <div>
          <h2>转换结果：</h2>
          <pre style={{
            whiteSpace: 'pre-wrap',
            backgroundColor: '#f5f5f5',
            padding: '15px',
            borderRadius: '5px'
          }}>
            {transcription}
          </pre>
        </div>
      )}
    </div>
  );
};

export default App;