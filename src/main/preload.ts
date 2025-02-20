import { contextBridge, ipcRenderer } from 'electron';

try {
  const api = {
    ipcRenderer: {
      invoke: (channel: string, data: any) => {
        return ipcRenderer.invoke(channel, data);
      }
    },
    on: (channel: string, callback: (...args: any[]) => void) => {
      ipcRenderer.on(channel, (_, ...args) => callback(...args));
      return () => {
        ipcRenderer.removeListener(channel, callback);
      };
    },
    convertAudio: (audioPath: string) => {
      return ipcRenderer.invoke('convert-audio', audioPath);
    },
    onConversionStatus: (callback: (status: any) => void) => {
      ipcRenderer.on('conversion-status', (_event, status) => callback(status));
      return () => {
        ipcRenderer.removeAllListeners('conversion-status');
      };
    }
  };

  contextBridge.exposeInMainWorld('electron', api);

  contextBridge.exposeInMainWorld('electronAPI', {
    transcribeAudio: (input: { type: 'file' | 'url', path?: string, url?: string }) =>
      ipcRenderer.invoke('transcribe-audio', input),
    onTranscriptionStatus: (callback: (status: any) => void) => {
      ipcRenderer.on('transcription-status', (_event, status) => callback(status));
      return () => {
        ipcRenderer.removeAllListeners('transcription-status');
      };
    }
  });
} catch (error) {
  console.error('Error in preload script:', error);
  throw error;
}