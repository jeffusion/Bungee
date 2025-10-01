import path from 'path';
import { DaemonManager } from '../daemon/manager';
import { ConfigPaths } from '../config/paths';

interface StartOptions {
  port?: string;
  workers?: string;
  detach?: boolean;
  autoUpgrade?: boolean;
}

export async function startCommand(configPath?: string, options: StartOptions = {}) {
  const daemonManager = new DaemonManager();

  try {
    // 如果没有提供配置文件路径，使用默认路径
    const resolvedConfigPath = ConfigPaths.resolveConfigPath(configPath);

    console.log('🚀 Starting Bungee daemon...');
    console.log(`📄 Config: ${resolvedConfigPath}`);
    console.log(`👥 Workers: ${options.workers || '2'}`);
    if (options.port) {
      console.log(`🔌 Port override: ${options.port}`);
    }

    await daemonManager.start(resolvedConfigPath, {
      workers: options.workers,
      port: options.port,
      autoUpgrade: options.autoUpgrade,
    });

  } catch (error) {
    console.error('❌ Failed to start Bungee:', (error as Error).message);
    console.log();

    if ((error as Error).message.includes('Configuration file not found')) {
      console.log('💡 Create a configuration file first with: bungee init');
    }

    process.exit(1);
  }
}