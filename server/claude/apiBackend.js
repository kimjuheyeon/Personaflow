/**
 * 회사 API 키 백엔드. ANTHROPIC_API_KEY로 Claude API를 직접 호출한다.
 * 이미지는 Files API에 올려 두고 file_id로 참조한다(하루 뒤 자동 만료).
 */

import Anthropic, { toFile } from '@anthropic-ai/sdk'
import { ClaudeBackendError } from './handler.js'

// Haiku는 서버 측 거절 폴백을 지원하지 않는다.
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5'])
const UPLOAD_TTL_SECONDS = 24 * 60 * 60
const MAX_TOKENS = 64000

/** 거절 폴백이 일어나면 앞선 시도의 부분 출력이 남으므로 마지막 fallback 블록 이후만 쓴다. */
function extractText(content) {
  let start = 0
  content.forEach((block, index) => {
    if (block.type === 'fallback') start = index + 1
  })
  return content
    .slice(start)
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim()
}

function toBackendError(error) {
  if (error instanceof Anthropic.APIUserAbortError) return error
  if (error instanceof Anthropic.AuthenticationError) {
    return new ClaudeBackendError(
      401,
      '서버에 설정된 Anthropic API 키가 올바르지 않습니다. 관리자에게 문의하세요.'
    )
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new ClaudeBackendError(429, 'Claude API 사용량 한도에 걸렸습니다.', {
      retryAfter: error.headers?.get('retry-after') ?? null,
    })
  }
  if (error instanceof Anthropic.APIError && typeof error.status === 'number') {
    return new ClaudeBackendError(
      error.status,
      error.status === 529 ? 'Claude 서버가 혼잡합니다.' : error.message,
      { retryAfter: error.headers?.get('retry-after') ?? null }
    )
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new ClaudeBackendError(502, 'Claude API에 연결하지 못했습니다.')
  }
  return error
}

export function createApiBackend() {
  let client = null
  const getClient = () => {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new ClaudeBackendError(
        503,
        '서버에 ANTHROPIC_API_KEY가 설정되지 않았습니다. 관리자에게 문의하세요.'
      )
    }
    client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    return client
  }

  return {
    name: /** @type {const} */ ('api'),

    async status() {
      return process.env.ANTHROPIC_API_KEY
        ? { configured: true }
        : { configured: false, detail: '서버에 ANTHROPIC_API_KEY가 설정되지 않았습니다.' }
    },

    async verify(model) {
      try {
        await getClient().models.retrieve(model)
      } catch (error) {
        throw toBackendError(error)
      }
    },

    async upload({ mimeType, data }) {
      try {
        const uploaded = await getClient().files.upload({
          file: await toFile(Buffer.from(data, 'base64'), `frame.${mimeType.split('/')[1]}`, {
            type: mimeType,
          }),
          expires_in_seconds: UPLOAD_TTL_SECONDS,
        })
        return uploaded.id
      } catch (error) {
        throw toBackendError(error)
      }
    },

    async generate({ model, system, messages, schema, effort, cache }, signal) {
      let message
      try {
        const stream = getClient().beta.messages.stream(
          {
            model,
            max_tokens: MAX_TOKENS,
            ...(system ? { system } : {}),
            messages,
            output_config: {
              effort,
              ...(schema ? { format: { type: 'json_schema', schema } } : {}),
            },
            ...(cache ? { cache_control: { type: 'ephemeral' } } : {}),
            ...(FALLBACK_MODELS.has(model)
              ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }
              : {}),
          },
          { signal }
        )
        message = await stream.finalMessage()
      } catch (error) {
        throw toBackendError(error)
      }

      if (message.stop_reason === 'refusal') {
        throw new ClaudeBackendError(422, '요청이 Claude 안전 정책에 의해 거절되었습니다.')
      }
      if (message.stop_reason === 'max_tokens') {
        throw new ClaudeBackendError(
          422,
          '응답이 너무 길어 중간에 잘렸습니다. 화면 수를 줄여 다시 시도해주세요.'
        )
      }
      return { text: extractText(message.content), model: message.model }
    },
  }
}
