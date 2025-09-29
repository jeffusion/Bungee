import { DaemonManager } from '../daemon/manager';

interface LogsOptions {
  follow?: boolean;
  lines?: string;
}

export async function logsCommand(options: LogsOptions = {}) {
  const daemonManager = new DaemonManager();

  try {
    const lines = parseInt(options.lines || '50');
    const follow = options.follow || false;

    if (follow) {
      console.log('📝 Following Bungee logs (Press Ctrl+C to exit)...\n');
    } else {
      console.log(`📝 Showing last ${lines} lines of Bungee logs:\n`);
    }

    await daemonManager.getLogs(lines, follow);

  } catch (error) {
    console.error('❌ Failed to get logs:', (error as Error).message);
    process.exit(1);
  }
}