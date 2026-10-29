/**
 * /api/claude 요청 처리. 실제 모델 호출은 백엔드가 맡는다.
 *
 * 백엔드
 * - api           회사 API 키(ANTHROPIC_API_KEY)로 Claude API를 호출한다. Vercel 배포용.
 * - subscription  이 PC에 로그인된 Claude Code(구독)로 호출한다. 로컬 실행 전용.
 *
 * op
 * - (GET)       상태 확인: 백엔드 종류, 사용 가능 여부, 접근 코드 필요 여부
 * - verify      연결 확인 (모델 호출 없이)
 * - upload      화면 이미지 1장을 올리고 참조 ID를 돌려준다
 *               (Vercel 요청 본문 4.5MB 제한 때문에 이미지를 분석 요청에 직접 싣지 않는다)
 * - generate    메시지 생성. schema가 있으면 구조화 출력(JSON)으로 받는다
 */

export const ALLOWED_MODELS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'])
const ALLOWED_EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max'])
const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

/** 백엔드가 던지는 오류. status와 함께 브라우저에 그대로 전달된다. */
export class ClaudeBackendError extends Error {
  constructor(status, message, extra = {}) {
    super(message)
    this.name = 'ClaudeBackendError'
    this.status = status
    this.extra = extra
  }
}

function sendJson(res, status, payload) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(payload))
}

async function readBody(req) {
  // Vercel은 JSON 본문을 미리 파싱해 둔다. 로컬 개발 서버(vite)는 그렇지 않다.
  if (req.body !== undefined) {
    if (typeof req.body === 'string') {
      try {
        return JSON.parse(req.body)
      } catch {
        return {}
      }
    }
    return req.body ?? {}
  }
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return {}
  }
}

function hasValidAccessCode(req) {
  const expected = process.env.PERSONAFLOW_ACCESS_CODE
  if (!expected) return true
  return req.headers['x-personaflow-access-code'] === expected
}

/** 브라우저가 보낸 콘텐츠 중 텍스트와 업로드된 이미지 참조만 통과시킨다. */
function sanitizeContent(content) {
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  if (!Array.isArray(content)) return []
  return content.flatMap((block) => {
    if (block?.type === 'text' && typeof block.text === 'string') {
      return [{ type: 'text', text: block.text }]
    }
    if (
      block?.type === 'image' &&
      block.source?.type === 'file' &&
      typeof block.source.file_id === 'string'
    ) {
      return [{ type: 'image', source: { type: 'file', file_id: block.source.file_id } }]
    }
    return []
  })
}

function sanitizeMessages(messages) {
  if (!Array.isArray(messages)) return []
  return messages
    .filter((message) => message?.role === 'user' || message?.role === 'assistant')
    .map((message) => ({ role: message.role, content: sanitizeContent(message.content) }))
}

/**
 * @typedef {{
 *   model: string,
 *   system: string,
 *   messages: Array<{ role: 'user' | 'assistant', content: Array<object> }>,
 *   schema: object | null,
 *   effort: string,
 *   cache: boolean,
 * }} GenerateRequest
 */

/**
 * @param {{
 *   name: 'api' | 'subscription',
 *   status: () => Promise<{ configured: boolean, detail?: string | null }>,
 *   verify: (model: string) => Promise<void>,
 *   upload: (image: { mimeType: string, data: string }) => Promise<string>,
 *   generate: (request: GenerateRequest, signal: AbortSignal) => Promise<{ text: string, model: string }>,
 * }} backend
 */
export function createClaudeHandler(backend) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store')

    if (req.method === 'GET') {
      const status = await backend.status()
      sendJson(res, 200, {
        backend: backend.name,
        configured: status.configured,
        detail: status.detail ?? null,
        accessCodeRequired: Boolean(process.env.PERSONAFLOW_ACCESS_CODE),
      })
      return
    }

    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'Method not allowed' })
      return
    }

    if (!hasValidAccessCode(req)) {
      sendJson(res, 401, { error: '접근 코드가 올바르지 않습니다.', reason: 'access_code' })
      return
    }

    // 사용자가 분석을 취소하면 브라우저 연결이 끊긴다. 진행 중인 모델 호출도 멈춘다.
    const controller = new AbortController()
    res.on('close', () => {
      if (!res.writableEnded) controller.abort()
    })

    const body = await readBody(req)
    try {
      if (body.op === 'verify') {
        await backend.verify(ALLOWED_MODELS.has(body.model) ? body.model : 'claude-opus-5-5')
        sendJson(res, 200, { ok: true })
        return
      }

      if (body.op === 'upload') {
        const mimeType = typeof body.mimeType === 'string' ? body.mimeType : ''
        const data = typeof body.data === 'string' ? body.data : ''
        if (!ALLOWED_IMAGE_TYPES.has(mimeType) || !data) {
          sendJson(res, 400, { error: '지원하지 않는 이미지 형식입니다.' })
          return
        }
        sendJson(res, 200, { fileId: await backend.upload({ mimeType, data }) })
        return
      }

      if (body.op === 'generate') {
        if (!ALLOWED_MODELS.has(body.model)) {
          sendJson(res, 400, { error: '지원하지 않는 모델입니다.' })
          return
        }
        const messages = sanitizeMessages(body.messages)
        if (messages.length === 0 || messages[messages.length - 1].role !== 'user') {
          sendJson(res, 400, { error: '메시지 형식이 올바르지 않습니다.' })
          return
        }
        const result = await backend.generate(
          {
            model: body.model,
            system: typeof body.system === 'string' ? body.system : '',
            messages,
            schema: body.schema && typeof body.schema === 'object' ? body.schema : null,
            effort: ALLOWED_EFFORTS.has(body.effort) ? body.effort : 'medium',
            cache: Boolean(body.cache),
          },
          controller.signal
        )
        sendJson(res, 200, result)
        return
      }

      sendJson(res, 400, { error: 'Unsupported op' })
    } catch (error) {
      if (res.writableEnded || controller.signal.aborted) return
      if (error instanceof ClaudeBackendError) {
        sendJson(res, error.status, { error: error.message, ...error.extra })
        return
      }
      sendJson(res, 500, { error: error instanceof Error ? error.message : 'Claude 요청 실패' })
    }
  }
}
