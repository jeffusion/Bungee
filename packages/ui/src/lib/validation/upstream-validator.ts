import type { Upstream } from '../api/routes';
import type { ValidationError } from './route-validator';

/**
 * 验证上游配置
 */
export function validateUpstream(upstream: Partial<Upstream>, index: number): ValidationError[] {
  const errors: ValidationError[] = [];
  const prefix = `upstreams[${index}]`;

  // 验证 target
  if (!upstream.target) {
    errors.push({
      field: `${prefix}.target`,
      message: 'Target URL is required'
    });
  } else {
    try {
      const url = new URL(upstream.target);
      if (!['http:', 'https:'].includes(url.protocol)) {
        errors.push({
          field: `${prefix}.target`,
          message: 'Target must use http or https protocol'
        });
      }
    } catch {
      errors.push({
        field: `${prefix}.target`,
        message: 'Invalid URL format'
      });
    }
  }

  // 验证 weight
  if (upstream.weight !== undefined) {
    if (typeof upstream.weight !== 'number' || upstream.weight <= 0) {
      errors.push({
        field: `${prefix}.weight`,
        message: 'Weight must be a positive number'
      });
    }
  }

  // 验证 priority
  if (upstream.priority !== undefined) {
    if (typeof upstream.priority !== 'number' || upstream.priority < 0) {
      errors.push({
        field: `${prefix}.priority`,
        message: 'Priority must be a non-negative number'
      });
    }
  }

  // 验证 transformer
  if (upstream.transformer) {
    if (typeof upstream.transformer === 'string') {
      const validTransformers = ['anthropic-to-gemini', 'anthropic-to-openai'];
      if (!validTransformers.includes(upstream.transformer)) {
        errors.push({
          field: `${prefix}.transformer`,
          message: `Unknown transformer: ${upstream.transformer}. Valid options: ${validTransformers.join(', ')}`
        });
      }
    }
    // 如果是对象，这里可以添加更详细的验证
  }

  return errors;
}

/**
 * 验证负载均衡权重总和
 */
export function validateWeights(upstreams: Upstream[]): ValidationError[] {
  const errors: ValidationError[] = [];

  const hasWeights = upstreams.some(u => u.weight !== undefined);
  if (hasWeights) {
    const totalWeight = upstreams.reduce((sum, u) => sum + (u.weight || 0), 0);
    if (totalWeight === 0) {
      errors.push({
        field: 'upstreams',
        message: 'Total weight must be greater than 0'
      });
    }
  }

  return errors;
}
