import { existsSync, mkdirSync, chmodSync, writeFileSync, readFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir, platform, arch } from 'os';
import pkg from '../../package.json';
import cliProgress from 'cli-progress';
import { createInterface } from 'readline';

export class BinaryManager {
  private static BINARY_DIR = join(homedir(), '.bungee', 'bin');
  private static VERSION_FILE = join(homedir(), '.bungee', 'version.txt');
  private static GITHUB_REPO = 'jeffusion/bungee';

  /**
   * 获取当前平台的二进制文件名
   */
  static getBinaryName(): string {
    const platformName = platform();
    const archName = arch();

    if (platformName === 'darwin') {
      return archName === 'arm64' ? 'bungee-macos-arm64' : 'bungee-macos';
    } else if (platformName === 'linux') {
      return 'bungee-linux';
    } else if (platformName === 'win32') {
      return 'bungee-windows.exe';
    }

    throw new Error(`Unsupported platform: ${platformName}-${archName}`);
  }

  /**
   * 获取本地二进制文件路径
   */
  static getLocalBinaryPath(): string {
    return join(this.BINARY_DIR, this.getBinaryName());
  }

  /**
   * 检查二进制文件是否存在
   */
  static isBinaryInstalled(): boolean {
    return existsSync(this.getLocalBinaryPath());
  }

  /**
   * 获取已安装的二进制版本
   */
  static getInstalledVersion(): string | null {
    try {
      if (!existsSync(this.VERSION_FILE)) {
        return null;
      }
      return readFileSync(this.VERSION_FILE, 'utf-8').trim();
    } catch {
      return null;
    }
  }

  /**
   * 保存版本号到文件
   */
  private static saveVersion(version: string): void {
    const dir = join(homedir(), '.bungee');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(this.VERSION_FILE, version);
  }

  /**
   * 检查版本是否匹配
   */
  static checkVersion(): boolean {
    const installedVersion = this.getInstalledVersion();
    const currentVersion = pkg.version;

    if (!installedVersion) {
      return false;
    }

    return installedVersion === currentVersion;
  }

  /**
   * 获取 GitHub Release 下载 URL
   */
  private static getDownloadUrl(): string {
    const version = pkg.version;
    const binaryName = this.getBinaryName();
    return `https://github.com/${this.GITHUB_REPO}/releases/download/v${version}/${binaryName}`;
  }

  /**
   * 询问用户确认
   */
  private static async promptConfirm(message: string): Promise<boolean> {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    return new Promise((resolve) => {
      rl.question(`${message} (y/N): `, (answer) => {
        rl.close();
        resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
      });
    });
  }

  /**
   * 下载二进制文件（带进度条）
   */
  static async downloadBinary(options: { force?: boolean; silent?: boolean } = {}): Promise<void> {
    const url = this.getDownloadUrl();
    const localPath = this.getLocalBinaryPath();
    const version = pkg.version;

    if (!options.silent) {
      console.log('📦 Downloading Bungee binary...');
      console.log(`   Platform: ${platform()}-${arch()}`);
      console.log(`   Version: v${version}`);
      console.log(`   URL: ${url}\n`);
    }

    // 确保目录存在
    if (!existsSync(this.BINARY_DIR)) {
      mkdirSync(this.BINARY_DIR, { recursive: true });
    }

    try {
      const response = await fetch(url);

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(
            `Binary not found for ${platform()}-${arch()}.\n` +
            `Please check if version v${version} has been released with binaries.\n` +
            `URL: ${url}`
          );
        }
        throw new Error(`Failed to download: ${response.statusText}`);
      }

      const contentLength = parseInt(response.headers.get('content-length') || '0');

      if (!options.silent && contentLength > 0) {
        // 创建进度条
        const progressBar = new cliProgress.SingleBar({
          format: '   Downloading |{bar}| {percentage}% | {value}/{total} MB | Speed: {speed} MB/s | ETA: {eta}s',
          barCompleteChar: '\u2588',
          barIncompleteChar: '\u2591',
          hideCursor: true,
        });

        progressBar.start(Math.ceil(contentLength / 1024 / 1024), 0, {
          speed: '0.00',
        });

        const reader = response.body!.getReader();
        const chunks: Uint8Array[] = [];
        let receivedLength = 0;
        const startTime = Date.now();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          chunks.push(value);
          receivedLength += value.length;

          // 更新进度条
          const receivedMB = receivedLength / 1024 / 1024;
          const elapsedSeconds = (Date.now() - startTime) / 1000;
          const speed = (receivedMB / elapsedSeconds).toFixed(2);

          progressBar.update(Math.ceil(receivedMB), {
            speed,
          });
        }

        progressBar.stop();

        // 合并所有块
        const buffer = Buffer.concat(chunks);
        writeFileSync(localPath, buffer);
      } else {
        // 无进度条，直接下载
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        writeFileSync(localPath, buffer);
      }

      // 添加执行权限
      chmodSync(localPath, 0o755);

      // 保存版本号
      this.saveVersion(version);

      if (!options.silent) {
        console.log('\n✅ Binary downloaded successfully');
        console.log(`   Location: ${localPath}`);
        console.log(`   Version: v${version}\n`);
      }
    } catch (error) {
      throw new Error(`Failed to download binary: ${(error as Error).message}`);
    }
  }

  /**
   * 确保二进制文件存在且版本正确
   */
  static async ensureBinary(options: { force?: boolean; autoUpgrade?: boolean } = {}): Promise<string> {
    const localPath = this.getLocalBinaryPath();
    const isInstalled = this.isBinaryInstalled();
    const versionMatches = this.checkVersion();

    // 情况1: 未安装
    if (!isInstalled) {
      console.log('⚠️  Bungee binary not found locally\n');

      if (!options.force) {
        const confirmed = await this.promptConfirm('📥 Download binary now?');
        if (!confirmed) {
          throw new Error('Binary download cancelled by user');
        }
      }

      await this.downloadBinary({ force: options.force });
      return localPath;
    }

    // 情况2: 已安装但版本不匹配
    if (!versionMatches) {
      const installedVersion = this.getInstalledVersion();
      const currentVersion = pkg.version;

      console.log('⚠️  Binary version mismatch detected');
      console.log(`   Installed: v${installedVersion || 'unknown'}`);
      console.log(`   Required:  v${currentVersion}\n`);

      // 如果启用了自动升级
      if (options.autoUpgrade) {
        console.log('🔄 Auto-upgrading binary...\n');
        await this.downloadBinary({ force: true });
        return localPath;
      }

      // 否则询问用户
      if (!options.force) {
        const confirmed = await this.promptConfirm('📥 Upgrade binary now?');
        if (!confirmed) {
          console.log('\n⚠️  Using outdated binary. Run "bungee upgrade" to update.\n');
          return localPath;
        }
      }

      await this.downloadBinary({ force: options.force });
      return localPath;
    }

    // 情况3: 已安装且版本匹配
    return localPath;
  }

  /**
   * 强制升级二进制文件
   */
  static async upgrade(options: { force?: boolean } = {}): Promise<void> {
    const isInstalled = this.isBinaryInstalled();
    const versionMatches = this.checkVersion();

    if (!isInstalled) {
      console.log('⚠️  Binary not installed. Installing...\n');
      await this.downloadBinary({ force: options.force });
      return;
    }

    if (versionMatches) {
      console.log('✅ Binary is already up to date');
      console.log(`   Version: v${pkg.version}\n`);

      if (!options.force) {
        return;
      }

      console.log('🔄 Force re-downloading...\n');
    } else {
      const installedVersion = this.getInstalledVersion();
      console.log('🔄 Upgrading binary...');
      console.log(`   From: v${installedVersion || 'unknown'}`);
      console.log(`   To:   v${pkg.version}\n`);
    }

    // 删除旧文件
    const localPath = this.getLocalBinaryPath();
    if (existsSync(localPath)) {
      unlinkSync(localPath);
    }

    await this.downloadBinary({ force: true });
  }

  /**
   * 获取二进制信息
   */
  static getBinaryInfo(): {
    platform: string;
    arch: string;
    binaryName: string;
    localPath: string;
    installed: boolean;
    installedVersion: string | null;
    requiredVersion: string;
    versionMatches: boolean;
  } {
    return {
      platform: platform(),
      arch: arch(),
      binaryName: this.getBinaryName(),
      localPath: this.getLocalBinaryPath(),
      installed: this.isBinaryInstalled(),
      installedVersion: this.getInstalledVersion(),
      requiredVersion: pkg.version,
      versionMatches: this.checkVersion(),
    };
  }
}