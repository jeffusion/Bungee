#!/usr/bin/env bun
import { program } from 'commander';
import { initCommand } from './commands/init';
import { startCommand } from './commands/start';
import { stopCommand } from './commands/stop';
import { statusCommand } from './commands/status';
import { restartCommand } from './commands/restart';
import { logsCommand } from './commands/logs';

program
  .name('bungee')
  .description('High-performance reverse proxy server built with Bun and TypeScript')
  .version('1.0.0');

program
  .command('init [path]')
  .description('Initialize configuration file (default: ~/.bungee/config.json)')
  .option('-f, --force', 'Overwrite existing config file')
  .action(initCommand);

program
  .command('start [config]')
  .description('Start proxy server as daemon (default config: ~/.bungee/config.json)')
  .option('-p, --port <port>', 'Override default port')
  .option('-w, --workers <count>', 'Number of worker processes', '2')
  .option('-d, --detach', 'Run as daemon (default)', true)
  .action(startCommand);

program
  .command('stop')
  .description('Stop proxy server daemon')
  .action(stopCommand);

program
  .command('restart [config]')
  .description('Restart proxy server daemon (default config: ~/.bungee/config.json)')
  .option('-p, --port <port>', 'Override default port')
  .option('-w, --workers <count>', 'Number of worker processes', '2')
  .action(restartCommand);

program
  .command('status')
  .description('Show daemon status and health')
  .action(statusCommand);

program
  .command('logs')
  .description('Show daemon logs')
  .option('-f, --follow', 'Follow log output')
  .option('-n, --lines <number>', 'Number of lines to show', '50')
  .action(logsCommand);

program.parse();