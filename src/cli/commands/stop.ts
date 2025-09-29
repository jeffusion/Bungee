import { DaemonManager } from '../daemon/manager';

export async function stopCommand() {
  const daemonManager = new DaemonManager();

  try {
    console.log('⏹️  Stopping Bungee daemon...');
    await daemonManager.stop();

  } catch (error) {
    console.error('❌ Failed to stop Bungee:', (error as Error).message);
    process.exit(1);
  }
}