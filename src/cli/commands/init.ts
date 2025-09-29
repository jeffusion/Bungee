import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { ConfigPaths } from '../config/paths';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface InitOptions {
  force?: boolean;
}

export async function initCommand(configPath?: string, options: InitOptions = {}) {
  try {
    // 如果没有提供路径，使用默认的 ~/.bungee/config.json
    const targetPath = configPath ? path.resolve(configPath) : ConfigPaths.DEFAULT_CONFIG_FILE;

    // 确保配置目录存在
    ConfigPaths.ensureConfigDir();

    // 检查文件是否已存在
    if (fs.existsSync(targetPath) && !options.force) {
      console.log(`❌ Configuration file already exists at: ${targetPath}`);
      console.log('💡 Use --force to overwrite the existing file.');
      process.exit(1);
    }

    // 查找配置模板文件（支持多种可能的位置）
    const possibleTemplatePaths = [
      // 开发环境路径
      path.resolve(__dirname, '../../../config.example.json'),
      // npm包安装后的路径
      path.resolve(__dirname, '../../config.example.json'),
      path.resolve(__dirname, '../config.example.json'),
      // 与二进制文件同目录
      path.resolve(process.execPath, '../config.example.json'),
      path.resolve(path.dirname(process.execPath), '../config.example.json'),
      // 当前工作目录
      path.resolve(process.cwd(), 'config.example.json'),
    ];

    let templatePath: string | null = null;
    for (const possiblePath of possibleTemplatePaths) {
      if (fs.existsSync(possiblePath)) {
        templatePath = possiblePath;
        break;
      }
    }

    if (!templatePath) {
      console.log('❌ Configuration template not found.');
      console.log('💡 Searched locations:');
      possibleTemplatePaths.forEach(path => console.log(`   - ${path}`));
      console.log('💡 Please ensure config.example.json is available.');
      process.exit(1);
    }

    // 如果目标路径的目录不存在，创建它
    const targetDir = path.dirname(targetPath);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    // 复制配置模板
    await fs.promises.copyFile(templatePath, targetPath);

    console.log(`✅ Configuration file created at: ${targetPath}`);
    console.log();

    if (targetPath === ConfigPaths.DEFAULT_CONFIG_FILE) {
      console.log('📝 This is the default configuration location.');
      console.log('🚀 You can now start Bungee with: bungee start');
    } else {
      console.log('📝 You created a custom configuration file.');
      console.log(`🚀 Start Bungee with: bungee start ${targetPath}`);
    }

    console.log();
    console.log('⚙️  Please edit the configuration file before starting the server.');
    console.log('💡 Use "bungee status" to check if the server is running.');

  } catch (error) {
    console.error('❌ Failed to initialize configuration:', error);
    process.exit(1);
  }
}