import type { ModificationRules, StreamTransformRules } from './config';
import type { ExpressionContext } from './expression-engine';
import { applyBodyRules } from './worker';
import { logger } from './logger';

interface StreamState {
  hasStarted: boolean;
  isFinished: boolean;
  chunkCount: number;
}

// 通用的SSE流转换器，支持任意API格式的转换
export function createSseTransformerStream(
  rules: ModificationRules | StreamTransformRules,
  requestContext: ExpressionContext,
  requestLog: any
): TransformStream<Uint8Array, Uint8Array> {
  let buffer = '';
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  const state: StreamState = {
    hasStarted: false,
    isFinished: false,
    chunkCount: 0
  };

  // 检查是否为新的状态机规则格式
  const isStateMachineRules = (r: any): r is StreamTransformRules => {
    return r && (r.start || r.chunk || r.end);
  };

  const streamRules = isStateMachineRules(rules) ? rules : null;
  const legacyRules = !isStateMachineRules(rules) ? rules as ModificationRules : null;

  const sendEvent = async (controller: TransformStreamDefaultController<Uint8Array>, eventData: any, ruleType: 'start' | 'chunk' | 'end') => {
    let transformedData = eventData;

    if (streamRules) {
      // 使用新的状态机规则
      const ruleForPhase = streamRules[ruleType];
      if (ruleForPhase?.body) {
        const responseContext: ExpressionContext = {
          ...requestContext,
          body: eventData,
          stream: { phase: ruleType, chunkIndex: state.chunkCount }
        };
        transformedData = await applyBodyRules(eventData, ruleForPhase.body, responseContext, requestLog);
      }
    } else if (legacyRules && ruleType === 'chunk') {
      // 向后兼容：使用旧的单一规则格式（仅对chunk应用）
      if (legacyRules.body) {
        const responseContext: ExpressionContext = {
          ...requestContext,
          body: eventData
        };
        transformedData = await applyBodyRules(eventData, legacyRules.body, responseContext, requestLog);
      }
    }

    // 检查transformedData是否为事件数组（用于end阶段的多事件支持）
    const events = Array.isArray(transformedData) ? transformedData : [transformedData];

    // 发送所有事件
    for (const event of events) {
      if (event && typeof event === 'object') {
        const eventString = `data: ${JSON.stringify(event)}\n\n`;
        controller.enqueue(encoder.encode(eventString));
      }
    }
  };

  return new TransformStream({
    async transform(chunk, controller) {
      if (state.isFinished) return;

      buffer += decoder.decode(chunk, { stream: true });

      // 支持两种行结束符：\r\n\r\n 和 \n\n
      let boundary = buffer.indexOf('\r\n\r\n');
      let boundaryLength = 4;
      if (boundary === -1) {
        boundary = buffer.indexOf('\n\n');
        boundaryLength = 2;
      }

      while (boundary !== -1) {
        const eventString = buffer.substring(0, boundary).trim();
        buffer = buffer.substring(boundary + boundaryLength);

        if (eventString.startsWith('data:')) {
          const dataContent = eventString.substring(5).trim();

          if (dataContent === '[DONE]') {
            // 发送结束事件
            if (streamRules?.end) {
              await sendEvent(controller, {}, 'end');
            }
            state.isFinished = true;
            return;
          }

            try {
            const parsedBody = JSON.parse(dataContent);
            logger.debug({ request: requestLog, parsedBody, phase: state.hasStarted ? 'chunk' : 'start' }, "Processing streaming event");

            // 发送开始事件（仅一次）
            if (!state.hasStarted && streamRules?.start) {
              await sendEvent(controller, parsedBody, 'start');
              state.hasStarted = true;
            }

            // 检查是否为最后一个事件（根据具体API格式的结束标志）
            const isLast = isLastChunk(parsedBody);

            // 发送数据块事件（除非是最后一个块）
            if (!isLast && (streamRules?.chunk || legacyRules)) {
              await sendEvent(controller, parsedBody, 'chunk');
              state.chunkCount++;
            }

            // 如果是最后一个事件，发送结束事件
            if (isLast) {
              if (streamRules?.end) {
                await sendEvent(controller, parsedBody, 'end');
              }
              state.isFinished = true;
            }

          } catch (error) {
            logger.error({ error, event: dataContent, request: requestLog }, 'Failed to parse streaming event');
            // 解析失败时，选择性转发原始事件或跳过
            if (!streamRules) {
              // 如果没有转换规则，转发原始事件
              controller.enqueue(encoder.encode(`${eventString}\n\n`));
            }
          }
        } else if (eventString && !streamRules) {
          // 转发非data事件（仅在非状态机模式下）
          controller.enqueue(encoder.encode(`${eventString}\n\n`));
        }

        // 重新检查边界
        boundary = buffer.indexOf('\r\n\r\n');
        if (boundary === -1) {
          boundary = buffer.indexOf('\n\n');
          boundaryLength = 2;
        } else {
          boundaryLength = 4;
        }
      }
    },
    async flush(controller) {
      // 确保流正确结束
      if (!state.isFinished && streamRules?.end) {
        logger.warn({ request: requestLog }, 'Stream ended without proper finish signal, sending default end event');
        await sendEvent(controller, {}, 'end');
      }

      // 处理缓冲区中剩余的数据
      if (buffer.trim() && !streamRules) {
        controller.enqueue(encoder.encode(buffer));
      }
    },
  });
}

// 检查是否为最后一个数据块的辅助函数
// 这个函数可以根据不同的API格式进行扩展
function isLastChunk(data: any): boolean {
  // Gemini API格式检查
  if (data.candidates?.[0]?.finishReason) {
    return true;
  }

  // OpenAI API格式检查
  if (data.choices?.[0]?.finish_reason) {
    return true;
  }

  // 测试格式和其他自定义格式检查
  if (data.finishReason) {
    return true;
  }

  // 其他格式可以在这里添加
  return false;
}