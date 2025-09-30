import { logger } from './logger';
import type { AppConfig } from '@jeffusion/bungee-shared';

// --- Configuration Loading ---
async function loadConfig(configPath?: string): Promise<AppConfig> {
  try {
    const path = configPath || process.env.CONFIG_PATH || 'config.json';
    const config: AppConfig = await Bun.file(path).json();

    // Validate config
    if (!config.routes || !Array.isArray(config.routes)) {
      logger.error('Error: "routes" is not defined or not an array in config.json.');
      process.exit(1);
    }

    // Validate each route
    for (const route of config.routes) {
      if (!route.upstreams || route.upstreams.length === 0) {
        logger.error(`Route for path "${route.path}" must have a non-empty "upstreams" array.`);
        process.exit(1);
      }
      if (route.upstreams.length < 2 && route.failover?.enabled) {
          logger.warn(`Route for path "${route.path}" has failover enabled but less than 2 upstreams. Failover will not be active.`);
      }
      let totalWeight = 0;
      for (const upstream of route.upstreams) {
        if (typeof upstream.target !== 'string') {
          logger.error(`Invalid upstream in route for path "${route.path}". Each upstream must have a string "target".`);
          process.exit(1);
        }

        // 设置默认 weight 为 100，验证 weight 值
        if (upstream.weight === undefined) {
          upstream.weight = 100;
        } else if (typeof upstream.weight !== 'number' || upstream.weight <= 0) {
          logger.error(`Invalid weight in route for path "${route.path}". Weight must be a positive number.`);
          process.exit(1);
        }

        // 设置默认 priority 为 1，验证 priority 值
        if (upstream.priority === undefined) {
          upstream.priority = 1;
        } else if (typeof upstream.priority !== 'number' || upstream.priority <= 0) {
          logger.error(`Invalid priority in route for path "${route.path}". Priority must be a positive number.`);
          process.exit(1);
        }
        totalWeight += upstream.weight;
      }
      if (totalWeight === 0) {
          logger.error(`Total weight for upstreams in route "${route.path}" cannot be zero.`);
          process.exit(1);
      }
    }

    return config;
  } catch (error) {
    logger.fatal({ error }, 'Failed to load or parse config.json. Please ensure it exists and is valid JSON.');
    process.exit(1);
  }
}

export { loadConfig };