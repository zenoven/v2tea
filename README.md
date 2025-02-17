# Video2Text

一个简单易用的视频转文本工具，支持 Mac 和 Windows 平台。

## 功能特点

- 支持多种视频格式转换 (mp4, avi, mov 等)
- 支持语音识别转文本
- 支持多语言识别
- 简洁的桌面端界面
- 批量处理功能
- 实时转换进度显示


## 技术栈

- TypeScript
- Electron
- React
- FFmpeg (视频处理)
- Whisper (语音识别)

## 项目结构

## 开发环境设置

3. 下载 Whisper 模型文件：

```bash
npm run download-models
```

下载脚本会自动：
- 检测系统代理设置
- 显示下载进度
- 处理网络问题和重试
- 验证文件完整性

如果下载失败，可以：
- 检查网络连接
- 确认系统代理设置
- 手动设置代理：
  ```bash
  export HTTPS_PROXY=http://127.0.0.1:7890
  npm run download-models
  ```
