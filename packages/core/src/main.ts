#!/usr/bin/env bun
/**
 * Bungee - 统一入口
 * 根据环境变量 BUNGEE_ROLE 决定运行模式：
 * - master: 主进程，管理 worker 进程
 * - worker: 工作进程，处理实际请求
 */

import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

const role = process.env.BUNGEE_ROLE || 'master';

if (role === 'worker') {
  // Worker 模式：导入并启动 worker
  await import('./worker');
} else {
  // Master 模式（默认）：导入并启动 master
  await import('./master');
}
