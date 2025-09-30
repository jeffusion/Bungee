import { getAsset } from './assets';

export function handleUIRequest(req: Request): Response | null {
  const url = new URL(req.url);

  // 只处理 /__ui 路径
  if (!url.pathname.startsWith('/__ui')) {
    return null;
  }

  // 移除 /__ui 前缀
  const path = url.pathname.replace(/^\/__ui/, '');

  // 根路径或 /index.html
  if (path === '' || path === '/' || path === '/index.html') {
    const html = getAsset('/');
    if (html) {
      return new Response(html, {
        headers: { 'Content-Type': 'text/html' }
      });
    }
  }

  // 静态资源
  const asset = getAsset(path);
  if (asset) {
    const contentType = getContentType(path);
    return new Response(asset, {
      headers: { 'Content-Type': contentType }
    });
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