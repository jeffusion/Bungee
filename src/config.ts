import { logger } from './logger';

// --- Type Definitions for config.json ---

export interface ModificationRules {
  headers?: {
    add?: Record<string, string>;
    remove?: string[];
  };
  body?: {
    add?: Record<string, any>;
    remove?: string[];
    default?: Record<string, any>;
  };
}

export interface Upstream extends ModificationRules {
  target: string;
  weight: number;
}

export interface RouteConfig extends ModificationRules {
  path: string;
  upstreams: Upstream[];
  failover?: {
    enabled: boolean;
    retryableStatusCodes: number[];
  };
  healthCheck?: {
    enabled: boolean;
    intervalSeconds: number;
  };
}

export interface AppConfig {
  bodyParserLimit?: string;
  routes: RouteConfig[];
}

// --- Configuration Loading ---
async function loadConfig(): Promise<AppConfig> {
  try {
    const config: AppConfig = await Bun.file('config.json').json();

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
        if (typeof upstream.target !== 'string' || typeof upstream.weight !== 'number' || upstream.weight <= 0) {
          logger.error(`Invalid upstream in route for path "${route.path}". Each upstream must have a string "target" and a positive number "weight".`);
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
