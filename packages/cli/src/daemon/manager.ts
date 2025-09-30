import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import { ConfigPaths } from '../config/paths';
import { BinaryManager } from '../binary/manager';

export class DaemonManager {
  private configDir: string;
  private pidFile: string;
  private logFile: string;
  private errorLogFile: string;

  constructor() {
    this.configDir = ConfigPaths.CONFIG_DIR;
    this.pidFile = ConfigPaths.PID_FILE;
    this.logFile = ConfigPaths.LOG_FILE;
    this.errorLogFile = ConfigPaths.ERROR_LOG_FILE;

    // 确保配置目录存在
    ConfigPaths.ensureConfigDir();
  }

  async isRunning(): Promise<boolean> {
    try {
      const pid = await this.getPid();
      if (!pid) return false;

      // 检查进程是否存在
      process.kill(pid, 0);
      return true;
    } catch {
      // PID文件存在但进程不存在，清理PID文件
      if (fs.existsSync(this.pidFile)) {
        fs.unlinkSync(this.pidFile);
      }
      return false;
    }
  }

  async getPid(): Promise<number | null> {
    try {
      if (!fs.existsSync(this.pidFile)) {
        return null;
      }

      const pidContent = await fs.promises.readFile(this.pidFile, 'utf-8');
      const pid = parseInt(pidContent.trim());
      return isNaN(pid) ? null : pid;
    } catch {
      return null;
    }
  }

  async start(configPath: string, options: { workers?: string; port?: string } = {}): Promise<void> {
    if (await this.isRunning()) {
      throw new Error('Bungee is already running. Use "bungee status" to check status.');
    }

    // 验证配置文件
    const resolvedConfigPath = path.resolve(configPath);
    if (!fs.existsSync(resolvedConfigPath)) {
      throw new Error(`Configuration file not found: ${resolvedConfigPath}`);
    }

    // 确保二进制文件存在（如果不存在会自动下载）
    const binaryPath = await BinaryManager.ensureBinary();

    // 打开日志文件（使用文件描述符，因为 detached 进程不能使用流）
    const logFd = fs.openSync(this.logFile, 'a');
    const errorLogFd = fs.openSync(this.errorLogFile, 'a');

    // 设置环境变量
    const env = {
      ...process.env,
      CONFIG_PATH: resolvedConfigPath,
      WORKER_COUNT: options.workers || '2',
      ...(options.port && { PORT: options.port }),
    };

    // 启动守护进程 - 直接运行二进制文件
    const child = spawn(binaryPath, [], {
      detached: true,
      stdio: ['ignore', logFd, errorLogFd],
      env,
      cwd: process.cwd(),
    });

    // 关闭父进程中的文件描述符（子进程会继承）
    fs.closeSync(logFd);
    fs.closeSync(errorLogFd);

    // 让子进程独立运行
    child.unref();

    // 保存PID
    await fs.promises.writeFile(this.pidFile, child.pid!.toString());

    // 等待一小段时间确认启动成功
    await new Promise(resolve => setTimeout(resolve, 1000));

    if (!(await this.isRunning())) {
      // 读取错误日志
      let errorMsg = 'Failed to start daemon';
      try {
        const errorLog = await fs.promises.readFile(this.errorLogFile, 'utf-8');
        const lastError = errorLog.split('\n').filter(line => line.trim()).slice(-5).join('\n');
        if (lastError) {
          errorMsg += `:\n${lastError}`;
        }
      } catch {
        // ignore
      }
      throw new Error(errorMsg);
    }

    console.log('✅ Bungee daemon started successfully');
    console.log(`📋 PID: ${child.pid}`);
    console.log(`📄 Config: ${resolvedConfigPath}`);
    console.log(`📝 Logs: ${this.logFile}`);
  }

  async stop(): Promise<void> {
    const pid = await this.getPid();
    if (!pid) {
      throw new Error('Bungee is not running');
    }

    try {
      // 发送终止信号
      process.kill(pid, 'SIGTERM');

      // 等待进程退出
      let attempts = 0;
      const maxAttempts = 30; // 30秒超时

      while (attempts < maxAttempts) {
        if (!(await this.isRunning())) {
          console.log('✅ Bungee daemon stopped successfully');
          return;
        }

        await new Promise(resolve => setTimeout(resolve, 1000));
        attempts++;

        // 15秒后使用SIGKILL强制终止
        if (attempts === 15) {
          process.kill(pid, 'SIGKILL');
        }
      }

      throw new Error('Failed to stop daemon within timeout period');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
        // 进程不存在，清理PID文件
        if (fs.existsSync(this.pidFile)) {
          fs.unlinkSync(this.pidFile);
        }
        console.log('✅ Bungee daemon was not running');
      } else {
        throw error;
      }
    }
  }

  async restart(configPath: string, options: { workers?: string; port?: string } = {}): Promise<void> {
    console.log('🔄 Restarting Bungee daemon...');

    try {
      await this.stop();
    } catch (error) {
      console.log('ℹ️  Daemon was not running');
    }

    // 等待一下确保完全停止
    await new Promise(resolve => setTimeout(resolve, 1000));

    await this.start(configPath, options);
  }

  async getStatus(): Promise<{
    running: boolean;
    pid?: number;
    configDir: string;
    logFile: string;
    errorLogFile: string;
  }> {
    const running = await this.isRunning();
    const pid = await this.getPid();

    return {
      running,
      ...(pid && { pid }),
      configDir: this.configDir,
      logFile: this.logFile,
      errorLogFile: this.errorLogFile,
    };
  }

  async getLogs(lines: number = 50, follow: boolean = false): Promise<void> {
    if (!fs.existsSync(this.logFile)) {
      console.log('No logs found. Make sure Bungee is running or has been started.');
      return;
    }

    if (follow) {
      // 实现简单的tail -f功能
      const { spawn } = await import('child_process');
      const tail = spawn('tail', ['-f', '-n', lines.toString(), this.logFile], {
        stdio: 'inherit'
      });

      process.on('SIGINT', () => {
        tail.kill();
        process.exit(0);
      });
    } else {
      // 读取最后N行
      const content = await fs.promises.readFile(this.logFile, 'utf-8');
      const allLines = content.split('\n');
      const lastLines = allLines.slice(-lines).join('\n');
      console.log(lastLines);
    }
  }
}