import { getAsset } from './assets';
import { handleAPIRequest } from '../api/router';

export async function handleUIRequest(req: Request): Promise<Response | null> {
  const url = new URL(req.url);

  // 只处理 /__ui 路径
  if (!url.pathname.startsWith('/__ui')) {
    return null;
  }

  // 移除 /__ui 前缀
  const path = url.pathname.replace(/^\/__ui/, '');

  // 处理API请求
  if (path.startsWith('/api')) {
    return await handleAPIRequest(req, path);
  }

  // 根路径或 /index.html
  if (path === '' || path === '/' || path === '/index.html') {
    const html = getAsset('/');
    if (html) {
      return new Response(html, {
        headers: { 'Content-Type': 'text/html' }
      });
    }
  }

  // 静态资源（CSS/JS文件）
  const asset = getAsset(path);
  if (asset) {
    const contentType = getContentType(path);
    return new Response(asset, {
      headers: { 'Content-Type': contentType }
    });
  }

  // SPA路由支持：未匹配的路径返回index.html
  if (!path.includes('.')) {
    const html = getAsset('/');
    if (html) {
      return new Response(html, {
        headers: { 'Content-Type': 'text/html' }
      });
    }
  }

  return new Response('Not Found', { status: 404 });
}

function getContentType(path: string): string {
  if (path === '/' || path.endsWith('.html')) return 'text/html';
  if (path.endsWith('.js')) return 'application/javascript';
  if (path.endsWith('.css')) return 'text/css';
  if (path.endsWith('.json')) return 'application/json';
  if (path.endsWith('.png')) return 'image/png';
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg';
  if (path.endsWith('.svg')) return 'image/svg+xml';
  return 'text/plain';
}