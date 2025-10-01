import { BinaryManager } from '../binary/manager';

export async function upgradeCommand(options: { force?: boolean }) {
  console.log('🚀 Checking for binary updates...\n');

  try {
    const info = BinaryManager.getBinaryInfo();

    if (!info.installed) {
      console.log('⚠️  Binary not installed. Installing for the first time...\n');
    } else if (info.versionMatches && !options.force) {
      console.log('✅ Binary is already up to date');
      console.log(`   Version: v${info.requiredVersion}`);
      console.log(`   Location: ${info.localPath}\n`);
      console.log('💡 Use --force to re-download\n');
      return;
    }

    await BinaryManager.upgrade({ force: options.force });

    console.log('✅ Upgrade completed successfully!\n');
  } catch (error) {
    console.error('❌ Upgrade failed:', (error as Error).message);
    process.exit(1);
  }
}