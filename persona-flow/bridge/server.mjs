/**
 * PersonaFlow 로컬 브리지.
 *
 * 배포된 화면(personaflow.vercel.app)이 이 서버로 분석 요청을 보내면,
 * 이 맥에 로그인된 Claude Code(구독 계정)로 Claude를 호출해 결과를 돌려준다.
 * 구독 인증 정보는 이 컴퓨터 밖으로 나가지 않는다. 개인 사용 전용.
 *
 * 실행: persona-flow 폴더에서 `npm run bridge`
 */

import http from 'node:http'
import os from 'node:os'
import { query } from '@anthropic-ai/claude-agent-sdk'

const PORT = Number(process.env.BRIDGE_PORT ?? 8787)
const HOST = '127.0.0.1'
const MAX_BODY_BYTES = 60 * 1024 * 1024
const ALLOWED_MODELS = new Set(['sonnet', 'opus', 'haiku'])

const ALLOWED_ORIGINS = new Set([
  'https://personaflow.vercel.app',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  ...(process.env.BRIDGE_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
])

function applyCors(req, res) {
  const origin = req.headers.origin
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    // 공개 사이트 → localhost 요청에 대한 Chrome 로컬 네트워크 접근 사전 확인
    if (req.headers['access-control-request-private-network'] === 'true') {
      res.setHeader('Access-Control-Allow-Private-Network', 'true')
    }
  }
}

/** 허용 목록 밖의 웹사이트가 내 구독으로 요청하는 것을 막는다. */
function isAllowedOrigin(req) {
  const origin = req.headers.origin
  // curl 등 브라우저가 아닌 로컬 호출은 Origin이 없다.
  return !origin || ALLOWED_ORIGINS.has(origin)
}

function sendJson(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(body))
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('요청 본문이 너무 큽니다.'), { status: 413 }))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(Object.assign(new Error('JSON 본문을 해석하지 못했습니다.'), { status: 400 }))
      }
    })
    req.on('error', reject)
  })
}

/** 구독 로그인을 쓰도록 API 키·프록시 환경변수는 넘기지 않는다. */
function subscriptionEnv() {
  const env = { ...process.env }
  delete env.ANTHROPIC_API_KEY
  delete env.ANTHROPIC_AUTH_TOKEN
  delete env.ANTHROPIC_BASE_URL
  return env
}

/** 화면이 로그인 만료·사용 한도를 구분해 안내할 수 있도록 상태 코드를 맞춘다. */
function errorStatus(detail, apiStatus) {
  if (/authenticat|oauth|log ?in/i.test(detail)) return 401
  if (/usage limit|rate limit/i.test(detail)) return 429
  return apiStatus ?? 502
}

async function* singleUserMessage(content) {
  yield {
    type: 'user',
    message: { role: 'user', content },
    parent_tool_use_id: null,
  }
}

async function runClaude({ model, system, content, schema }, abortController) {
  const options = {
    model,
    tools: [],
    settingSources: [],
    persistSession: false,
    permissionMode: 'dontAsk',
    cwd: os.tmpdir(),
    env: subscriptionEnv(),
    abortController,
    ...(system ? { systemPrompt: system } : {}),
    ...(schema ? { outputFormat: { type: 'json_schema', schema } } : {}),
  }

  let result = null
  try {
    for await (const message of query({ prompt: singleUserMessage(content), options })) {
      if (message.type === 'result') result = message
    }
  } catch (error) {
    // SDK는 오류 결과를 내보낸 뒤 예외를 던지기도 한다.
    if (abortController.signal.aborted) throw Object.assign(new Error('요청이 취소되었습니다.'), { status: 499 })
    const detail = error instanceof Error ? error.message : String(error)
    throw Object.assign(new Error(detail), { status: errorStatus(detail, result?.api_error_status) })
  }
  if (!result) throw Object.assign(new Error('Claude가 결과 없이 종료했습니다.'), { status: 502 })

  if (result.subtype !== 'success' || result.is_error) {
    const detail = (result.errors ?? []).join(' ') || result.result || result.subtype
    throw Object.assign(new Error(detail), { status: errorStatus(detail, result.api_error_status) })
  }

  if (schema) {
    if (result.structured_output === undefined) {
      throw Object.assign(new Error('Claude가 구조화된 응답을 반환하지 않았습니다.'), { status: 502 })
    }
    return JSON.stringify(result.structured_output)
  }
  return result.result ?? ''
}

async function handleGenerate(req, res) {
  const body = await readJsonBody(req)
  const model = ALLOWED_MODELS.has(body.model) ? body.model : 'sonnet'
  if (!Array.isArray(body.content) || body.content.length === 0) {
    sendJson(res, 400, { error: 'content가 비어 있습니다.' })
    return
  }

  const abortController = new AbortController()
  res.on('close', () => {
    if (!res.writableFinished) abortController.abort()
  })

  const startedAt = Date.now()
  const text = await runClaude(
    {
      model,
      system: typeof body.system === 'string' ? body.system : undefined,
      content: body.content,
      schema: body.schema && typeof body.schema === 'object' ? body.schema : undefined,
    },
    abortController
  )
  console.log(`[bridge] ${model} 응답 완료 (${((Date.now() - startedAt) / 1000).toFixed(1)}초)`)
  sendJson(res, 200, { text })
}

const server = http.createServer(async (req, res) => {
  applyCors(req, res)

  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return
  }

  if (!isAllowedOrigin(req)) {
    sendJson(res, 403, { error: `허용되지 않은 출처입니다: ${req.headers.origin}` })
    return
  }

  try {
    if (req.method === 'GET' && req.url === '/health') {
      sendJson(res, 200, { ok: true, name: 'persona-flow-bridge' })
      return
    }
    if (req.method === 'POST' && req.url === '/generate') {
      await handleGenerate(req, res)
      return
    }
    sendJson(res, 404, { error: 'Not found' })
  } catch (error) {
    const status = Number.isInteger(error?.status) ? error.status : 500
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[bridge] 오류 (${status}): ${message}`)
    if (!res.headersSent) sendJson(res, status, { error: message })
  }
})

server.listen(PORT, HOST, () => {
  console.log(`PersonaFlow 브리지 실행 중: http://localhost:${PORT}`)
  console.log(
    process.env.CLAUDE_CODE_OAUTH_TOKEN
      ? 'bridge/.env의 구독 토큰(claude setup-token)으로 분석합니다. 종료하려면 Ctrl+C'
      : 'Claude Code에 로그인된 구독 계정으로 분석합니다. 종료하려면 Ctrl+C'
  )
})
