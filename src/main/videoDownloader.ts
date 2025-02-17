import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import youtubeDl from 'youtube-dl-exec';

export class VideoDownloader {
  private tempDir: string;

  constructor() {
    // 在系统临时目录下创建我们的临时文件夹
    this.tempDir = path.join(os.tmpdir(), 'v2tea-downloads');
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  async downloadAudio(url: string): Promise<string> {
    try {
      // 生成唯一的临时文件名
      const timestamp = new Date().getTime();
      const outputPath = path.join(this.tempDir, `audio-${timestamp}.mp3`);

      // 使用 youtube-dl 下载音频
      await youtubeDl(url, {
        extractAudio: true,
        audioFormat: 'mp3',
        output: outputPath,
        noCheckCertificates: true,
        noWarnings: true,
        preferFreeFormats: true,
        retries: 3,
        format: 'bestaudio/best'
      });

      return outputPath;
    } catch (error) {
      console.error('下载失败:', error);
      throw new Error(error instanceof Error ? error.message : '下载失败');
    }
  }

  // 清理临时文件
  async cleanup(filePath: string) {
    try {
      if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
      }
    } catch (error) {
      console.error('清理临时文件失败:', error);
    }
  }
}