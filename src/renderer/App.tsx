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
  error?: string;
}

const App: React.FC = () => {
  const [ipcRenderer, setIpcRenderer] = useState<typeof window.electron.ipcRenderer | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState<string>('');
  const [transcription, setTranscription] = useState<string>('');
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    waitForElectron().then((electron) => {
      setIpcRenderer(electron.ipcRenderer);
    });
  }, []);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      const selectedFile = files[0];
      // 获取文件的真实路径
      const filePath = (selectedFile as any).path || selectedFile.name;
      console.log('file:', {
        ...selectedFile,
        path: filePath
      });
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
          <p>已选择：{file ? file.path : url}</p>
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