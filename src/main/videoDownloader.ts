import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class VideoDownloader {
  private tempDir: string;

  constructor() {
    // 使用系统临时目录下的特定文件夹
    this.tempDir = path.join(os.tmpdir(), 'v2tea-downloads');
    // 确保临时目录存在
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  private isDouyinUrl(url: string): boolean {
    return url.includes('douyin.com');
  }

  async downloadAudio(url: string): Promise<string> {
    try {
      const timestamp = Date.now();
      const audioPath = path.join(this.tempDir, `audio-${timestamp}.mp3`);
      const wavPath = path.join(this.tempDir, `temp_${timestamp}.wav`);

      // 构建下载命令
      let ytDlpCommand = `yt-dlp -x --audio-format mp3`;

      if (this.isDouyinUrl(url)) {
        // 抖音特殊处理
        ytDlpCommand += ` --user-agent "Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1"`;
        ytDlpCommand += ` --referer "https://www.douyin.com/"`;
        ytDlpCommand += ` --add-header "Cookie: passport_csrf_token=1;"`;
      }

      ytDlpCommand += ` -o "${audioPath}" "${url}"`;

      console.log('执行下载命令:', ytDlpCommand);
      const { stdout, stderr } = await execAsync(ytDlpCommand);
      console.log('下载输出:', stdout);
      if (stderr) console.error('下载错误:', stderr);

      // 检查文件是否存在
      if (!fs.existsSync(audioPath)) {
        throw new Error('音频下载失败，请确保视频链接有效且可访问');
      }

      // 转换为 WAV 格式
      const ffmpegCommand = `ffmpeg -i "${audioPath}" -ar 16000 -ac 1 -c:a pcm_s16le -y "${wavPath}"`;
      console.log('执行转换命令:', ffmpegCommand);
      await execAsync(ffmpegCommand);

      // 删除 MP3 文件
      await fs.promises.unlink(audioPath);

      return wavPath;
    } catch (error) {
      console.error('下载或转换过程出错:', error);
      if (error instanceof Error) {
        const errorMsg = error.message.toLowerCase();
        if (errorMsg.includes('unavailable') || errorMsg.includes('not found')) {
          throw new Error('视频不存在或已被删除');
        } else if (errorMsg.includes('private')) {
          throw new Error('该视频为私密视频，无法访问');
        }
      }
      throw error;
    }
  }

  async cleanup(filePath: string): Promise<void> {
    try {
      if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
      }
    } catch (error) {
      console.error('清理文件失败:', error);
    }
  }
}