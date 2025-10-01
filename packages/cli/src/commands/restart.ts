import path from 'path';
import { DaemonManager } from '../daemon/manager';
import { ConfigPaths } from '../config/paths';

interface RestartOptions {
  port?: string;
  workers?: string;
  autoUpgrade?: boolean;
}

export async function restartCommand(configPath?: string, options: RestartOptions = {}) {
  const daemonManager = new DaemonManager();

  try {
    // 如果没有提供配置文件路径，使用默认路径
    const resolvedConfigPath = ConfigPaths.resolveConfigPath(configPath);

    await daemonManager.restart(resolvedConfigPath, {
      workers: options.workers,
      port: options.port,
      autoUpgrade: options.autoUpgrade,
    });

  } catch (error) {
    console.error('❌ Failed to restart Bungee:', (error as Error).message);

    if ((error as Error).message.includes('Configuration file not found')) {
      console.log('💡 Create a configuration file first with: bungee init');
    }

    process.exit(1);
  }
}