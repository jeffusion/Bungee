#!/usr/bin/env bun
/**
 * 上传二进制文件到 GitHub Release
 * 用法: bun scripts/upload-binaries.ts <version>
 *
 * 需要设置 GITHUB_TOKEN 环境变量
 */

import { existsSync, readdirSync, statSync, readFileSync } from 'fs';
import { join } from 'path';

const version = process.argv[2];

if (!version) {
  console.error('❌ Usage: bun scripts/upload-binaries.ts <version>');
  console.error('   Example: bun scripts/upload-binaries.ts 1.0.1');
  process.exit(1);
}

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
if (!GITHUB_TOKEN) {
  console.error('❌ GITHUB_TOKEN environment variable is required');
  console.error('   Set it with: export GITHUB_TOKEN=your_token');
  process.exit(1);
}

const binDir = join(import.meta.dir, '../bin');
const tag = `v${version}`;
const REPO_OWNER = 'jeffusion';
const REPO_NAME = 'bungee';
const GITHUB_API = 'https://api.github.com';

// 检查 bin 目录
if (!existsSync(binDir)) {
  console.error(`❌ Binary directory not found: ${binDir}`);
  console.error('   Run "npm run build:binaries" first');
  process.exit(1);
}

// 获取所有二进制文件
const binaries = readdirSync(binDir).filter(file => {
  const fullPath = join(binDir, file);
  return (
    statSync(fullPath).isFile() &&
    (file.startsWith('bungee-') && !file.endsWith('.map'))
  );
});

if (binaries.length === 0) {
  console.error('❌ No binary files found in bin/');
  process.exit(1);
}

console.log(`📦 Uploading binaries for ${tag}...\n`);
console.log(`   Found ${binaries.length} binaries:`);
binaries.forEach(name => {
  const size = (statSync(join(binDir, name)).size / 1024 / 1024).toFixed(2);
  console.log(`   - ${name} (${size} MB)`);
});
console.log();

/**
 * GitHub API 请求封装
 */
async function githubAPI(endpoint: string, options: RequestInit = {}) {
  const url = `${GITHUB_API}${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`GitHub API error (${response.status}): ${error}`);
  }

  return response.json();
}

/**
 * 检查 Release 是否存在
 */
async function getReleaseByTag(tag: string) {
  try {
    return await githubAPI(`/repos/${REPO_OWNER}/${REPO_NAME}/releases/tags/${tag}`);
  } catch (error) {
    if ((error as Error).message.includes('404')) {
      return null;
    }
    throw error;
  }
}

/**
 * 创建 Release
 */
async function createRelease(tag: string, version: string) {
  console.log(`📝 Creating release ${tag}...`);

  const release = await githubAPI(`/repos/${REPO_OWNER}/${REPO_NAME}/releases`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tag_name: tag,
      name: `v${version}`,
      body: `Release v${version}`,
      draft: false,
      prerelease: false,
    }),
  });

  console.log(`✓ Release ${tag} created\n`);
  return release;
}

/**
 * 删除已存在的资产
 */
async function deleteAssetIfExists(releaseId: number, assetName: string) {
  try {
    const assets = await githubAPI(`/repos/${REPO_OWNER}/${REPO_NAME}/releases/${releaseId}/assets`);
    const existingAsset = assets.find((a: any) => a.name === assetName);

    if (existingAsset) {
      await fetch(`${GITHUB_API}/repos/${REPO_OWNER}/${REPO_NAME}/releases/assets/${existingAsset.id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${GITHUB_TOKEN}`,
        },
      });
      console.log(`   Deleted existing ${assetName}`);
    }
  } catch (error) {
    // 忽略错误，继续上传
  }
}

/**
 * 上传资产到 Release
 */
async function uploadAsset(uploadUrl: string, filePath: string, fileName: string) {
  const fileContent = readFileSync(filePath);
  const fileSize = statSync(filePath).size;

  console.log(`📤 Uploading ${fileName} (${(fileSize / 1024 / 1024).toFixed(2)} MB)...`);

  // GitHub 的 upload URL 格式为: https://uploads.github.com/repos/:owner/:repo/releases/:id/assets{?name,label}
  const url = uploadUrl.replace('{?name,label}', `?name=${fileName}`);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${GITHUB_TOKEN}`,
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(fileSize),
    },
    body: fileContent,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to upload ${fileName}: ${error}`);
  }

  console.log(`✓ ${fileName} uploaded successfully\n`);
}

/**
 * 主函数
 */
async function main() {
  try {
    // 检查或创建 Release
    console.log(`🔍 Checking if release ${tag} exists...`);
    let release = await getReleaseByTag(tag);

    if (!release) {
      console.log(`⚠️  Release ${tag} not found`);
      release = await createRelease(tag, version);
    } else {
      console.log(`✓ Release ${tag} exists\n`);
    }

    const releaseId = release.id;
    const uploadUrl = release.upload_url;

    // 上传每个二进制文件
    for (const binary of binaries) {
      const binaryPath = join(binDir, binary);

      // 删除已存在的资产
      await deleteAssetIfExists(releaseId, binary);

      // 上传新资产
      await uploadAsset(uploadUrl, binaryPath, binary);
    }

    console.log('✅ All binaries uploaded successfully!');
    console.log(`\n🔗 View release: https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/tag/${tag}`);
  } catch (error) {
    console.error('❌ Upload failed:', (error as Error).message);
    process.exit(1);
  }
}

main();