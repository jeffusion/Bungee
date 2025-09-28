import pino from 'pino';
import path from 'path';
import fs from 'fs';

// 确保 logs 目录存在
const logsDir = path.resolve(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    targets: [
      // 文件输出 - 使用 pino-roll 进行日志滚动和归档
      {
        target: 'pino-roll',
        level: 'info',
        options: {
          file: path.join(logsDir, 'app.log'),
          frequency: 'daily', // 按天归档
          size: '10m', // 单个日志文件最大 10MB
          limit: {
            count: 5 // 最多保留 5 个归档文件（约 50MB）
          },
          dateFormat: 'yyyy-MM-dd', // 归档文件名日期格式
        }
      },
      // 控制台输出 - 开发环境使用 pino-pretty
      ...(process.env.NODE_ENV !== 'production' ? [{
        target: 'pino-pretty',
        level: 'info',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss.l',
          ignore: 'pid,hostname',
        }
      }] : [])
    ]
  }
});