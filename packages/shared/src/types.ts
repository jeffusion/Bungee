// --- Type Definitions for config.json ---

interface PathRule {
  action: 'replace';
  match: string;
  replace: string;
}

export interface ModificationRules {
  headers?: {
    add?: Record<string, string>;
    replace?: Record<string, string>;
    remove?: string[];
  };
  body?: {
    add?: Record<string, any>;
    replace?: Record<string, any>;
    remove?: string[];
    default?: Record<string, any>;
  };
}

export interface StreamTransformRules {
  start?: ModificationRules;
  chunk?: ModificationRules;
  end?: ModificationRules;
}

export interface ResponseRuleSet {
  default?: ModificationRules;
  stream?: ModificationRules | StreamTransformRules;
}

export interface ResponseRule {
  match: {
    status: string;
    headers?: Record<string, string>;
  };
  rules: ResponseRuleSet;
}

export interface TransformerConfig {
  path: PathRule;
  request?: ModificationRules;
  response?: ResponseRule[];
}

export interface Upstream extends ModificationRules {
  target: string;
  weight?: number; // 权重，默认为 100
  priority?: number; // 数字越小优先级越高，默认为 1
  transformer?: string | TransformerConfig | TransformerConfig[];
}

export interface RouteConfig extends ModificationRules {
  path: string;
  pathRewrite?: Record<string, string>;
  transformer?: string | TransformerConfig | TransformerConfig[];
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