import { existsSync, mkdirSync, chmodSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir, platform, arch } from 'os';
import pkg from '../../package.json';

export class BinaryManager {
  private static BINARY_DIR = join(homedir(), '.bungee', 'bin');
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
   * 获取 GitHub Release 下载 URL
   */
  private static getDownloadUrl(): string {
    const version = pkg.version;
    const binaryName = this.getBinaryName();
    return `https://github.com/${this.GITHUB_REPO}/releases/download/v${version}/${binaryName}`;
  }

  /**
   * 下载二进制文件
   */
  static async downloadBinary(): Promise<void> {
    const url = this.getDownloadUrl();
    const localPath = this.getLocalBinaryPath();

    console.log('📦 Downloading Bungee binary...');
    console.log(`   Platform: ${platform()}-${arch()}`);
    console.log(`   Version: v${pkg.version}`);
    console.log(`   URL: ${url}`);

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
            `Please check if version v${pkg.version} has been released with binaries.\n` +
            `URL: ${url}`
          );
        }
        throw new Error(`Failed to download: ${response.statusText}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // 写入文件（使用 Node.js fs API）
      writeFileSync(localPath, buffer);

      // 添加执行权限
      chmodSync(localPath, 0o755);

      console.log('✅ Binary downloaded successfully');
      console.log(`   Location: ${localPath}`);
    } catch (error) {
      throw new Error(`Failed to download binary: ${(error as Error).message}`);
    }
  }

  /**
   * 确保二进制文件存在，如果不存在则下载
   */
  static async ensureBinary(): Promise<string> {
    const localPath = this.getLocalBinaryPath();

    if (!this.isBinaryInstalled()) {
      console.log('⚠️  Bungee binary not found locally');
      await this.downloadBinary();
    }

    return localPath;
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
  } {
    return {
      platform: platform(),
      arch: arch(),
      binaryName: this.getBinaryName(),
      localPath: this.getLocalBinaryPath(),
      installed: this.isBinaryInstalled(),
    };
  }
}
