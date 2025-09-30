#!/usr/bin/env bun
/**
 * 编译 master.ts 为独立二进制文件
 * 用法: bun scripts/build-binaries.ts
 */

import { $ } from 'bun';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const binDir = join(import.meta.dir, '../bin');
const masterSrc = join(import.meta.dir, '../packages/core/src/master.ts');

// 确保 bin 目录存在
if (!existsSync(binDir)) {
  mkdirSync(binDir, { recursive: true });
}

console.log('🔨 Building binaries...\n');

// 排除 pino 相关依赖，在运行时从 node_modules 加载
const externals = [
  'pino',
  'pino-roll',
  'pino-pretty'
].map(pkg => `--external ${pkg}`).join(' ');

const targets = [
  { name: 'bungee-linux', target: 'bun-linux-x64' },
  { name: 'bungee-macos', target: 'bun-darwin-x64' },
  { name: 'bungee-macos-arm64', target: 'bun-darwin-arm64' },
  // Windows 支持（如果需要）
  // { name: 'bungee-windows.exe', target: 'bun-windows-x64' },
];

for (const { name, target } of targets) {
  const outfile = join(binDir, name);
  console.log(`📦 Building ${name} (${target})...`);

  try {
    await $`bun build --compile --target=${target} ${externals} ${masterSrc} --outfile ${outfile}`;
    console.log(`✓ ${name} built successfully\n`);
  } catch (error) {
    console.error(`❌ Failed to build ${name}:`, error);
    process.exit(1);
  }
}

console.log('✅ All binaries built successfully!');
console.log(`📁 Output directory: ${binDir}\n`);