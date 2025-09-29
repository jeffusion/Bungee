import { DaemonManager } from '../daemon/manager';

export async function statusCommand() {
  const daemonManager = new DaemonManager();

  try {
    const status = await daemonManager.getStatus();

    console.log('📊 Bungee Status');
    console.log('================');

    if (status.running) {
      console.log('✅ Status: Running');
      console.log(`📋 PID: ${status.pid}`);
    } else {
      console.log('❌ Status: Not running');
    }

    console.log(`📁 Config Dir: ${status.configDir}`);
    console.log(`📝 Log File: ${status.logFile}`);
    console.log(`🚨 Error Log: ${status.errorLogFile}`);

    if (status.running) {
      console.log('\n💡 Use "bungee logs" to view logs');
      console.log('💡 Use "bungee stop" to stop the daemon');
    } else {
      console.log('\n💡 Use "bungee start" to start the daemon');
    }

  } catch (error) {
    console.error('❌ Failed to get status:', (error as Error).message);
    process.exit(1);
  }
}