import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

// 添加全局错误处理
window.addEventListener('error', (event) => {
  console.error('Global error:', event.error);
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection:', event.reason);
});

const container = document.getElementById('root');
if (!container) {
  throw new Error('找不到 root 元素');
}
const root = createRoot(container);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);