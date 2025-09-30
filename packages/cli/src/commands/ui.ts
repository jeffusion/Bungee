export async function uiCommand(options: { port?: string; host?: string }) {
  const port = parseInt(options.port || '8088');
  const host = options.host || 'localhost';
  const url = `http://${host}:${port}/__ui/`;

  console.log(`\n🚀 Opening Bungee Dashboard at ${url}\n`);

  // 根据平台打开浏览器
  const command = process.platform === 'darwin' ? 'open' :
                  process.platform === 'win32' ? 'start' : 'xdg-open';

  try {
    await Bun.spawn([command, url]);
  } catch (error) {
    console.error(`Failed to open browser automatically.`);
    console.log(`Please open ${url} manually in your browser.\n`);
  }
}