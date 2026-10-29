/**
 * 구독 백엔드. 이 PC에 로그인된 Claude Code CLI(`claude -p`)를 실행해 Claude Pro/Max 구독으로 호출한다.
 *
 * - 로컬 실행 전용이다. 구독은 개인 계정에 묶여 있으므로 서버에 올려 여러 사람이 나눠 쓰면 안 된다.
 * - 도구를 모두 끄고(--tools "") 시스템 프롬프트를 통째로 바꿔, 코딩 에이전트가 아닌 일반 모델 호출로 쓴다.
 * - API 키 환경변수가 있으면 CLI가 구독 대신 그 키를 쓰므로 자식 프로세스에서는 지운다.
 */

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ClaudeBackendError } from './handler.js'

/**
 * 실행할 Claude Code. CLAUDE_CLI_PATH에 .js 진입점을 주면 node로 실행한다
 * (Windows에서 npm으로 설치해 claude.cmd만 있는 경우, .cmd는 셸 없이 실행할 수 없다).
 */
function cliCommand() {
  const cli = process.env.CLAUDE_CLI_PATH || 'claude'
  return /\.[cm]?js$/i.test(cli) ? [process.execPath, [cli]] : [cli, []]
}
const GENERATE_TIMEOUT_MS = 10 * 60 * 1000
const MAX_STORED_IMAGES = 400
const DEFAULT_SYSTEM_PROMPT = '당신은 UX 리서치를 돕는 어시스턴트입니다.'

function childEnv() {
  const env = { ...process.env }
  delete env.ANTHROPIC_API_KEY
  delete env.ANTHROPIC_AUTH_TOKEN
  return env
}

function runCli(args, { input, signal, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const [command, prefixArgs] = cliCommand()
    let child
    try {
      child = spawn(command, [...prefixArgs, ...args], {
        cwd: tmpdir(),
        env: childEnv(),
        windowsHide: true,
      })
    } catch (error) {
      reject(error)
      return
    }

    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (fn, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      fn(value)
    }
    const onAbort = () => {
      child.kill()
      finish(reject, new ClaudeBackendError(499, '요청이 취소되었습니다.'))
    }
    const timer = setTimeout(() => {
      child.kill()
      finish(reject, new ClaudeBackendError(504, 'Claude Code 응답 시간이 초과되었습니다.'))
    }, timeoutMs)
    signal?.addEventListener('abort', onAbort, { once: true })

    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.stderr.on('data', (chunk) => (stderr += chunk))
    child.on('error', (error) => {
      finish(
        reject,
        error.code === 'ENOENT'
          ? new ClaudeBackendError(
              503,
              'Claude Code CLI를 찾지 못했습니다. Claude Code를 설치하고 `claude auth login`으로 구독 계정에 로그인하세요. (다른 경로에 설치했다면 CLAUDE_CLI_PATH 환경변수로 지정)'
            )
          : error
      )
    })
    child.on('close', (code) => finish(resolve, { code, stdout, stderr }))

    if (input !== undefined) child.stdin.end(input)
    else child.stdin.end()
  })
}

async function readAuthStatus() {
  const { stdout } = await runCli(['auth', 'status', '--json'], { timeoutMs: 20_000 })
  try {
    return JSON.parse(stdout)
  } catch {
    return { loggedIn: false }
  }
}

/** CLI 결과에서 사람에게 보여줄 오류를 고른다. 구독 한도는 재시도해도 풀리지 않는다. */
function resultError(result, stderr) {
  const message = String(result?.result ?? result?.errors?.join?.(' ') ?? stderr ?? '').trim()
  if (/usage limit|limit reached|rate limit/i.test(message)) {
    return new ClaudeBackendError(
      429,
      'Claude 구독 사용 한도에 도달했습니다. 한도가 초기화된 뒤 다시 시도하세요.',
      { permanent: true }
    )
  }
  if (/log ?in|authenticat|unauthori[sz]ed|oauth/i.test(message)) {
    return new ClaudeBackendError(
      401,
      'Claude Code 로그인이 필요합니다. 터미널에서 `claude auth login`을 실행하세요.'
    )
  }
  const status = Number(result?.api_error_status)
  if (status === 429 || status === 529 || status >= 500) {
    return new ClaudeBackendError(status, `Claude가 일시적으로 응답하지 못했습니다. (${status})`)
  }
  return new ClaudeBackendError(502, message || 'Claude Code 실행에 실패했습니다.')
}

export function createSubscriptionBackend() {
  /** 업로드된 이미지는 이 프로세스 메모리에만 둔다. 오래된 것부터 버린다. */
  const images = new Map()

  const resolveContent = (content) =>
    content.map((block) => {
      if (block.type !== 'image') return block
      const image = images.get(block.source.file_id)
      if (!image) {
        throw new ClaudeBackendError(
          409,
          '화면 이미지가 만료되었습니다. 다시 시도해주세요.',
          { reason: 'image_expired' }
        )
      }
      return {
        type: 'image',
        source: { type: 'base64', media_type: image.mimeType, data: image.data },
      }
    })

  /**
   * CLI 입력은 사용자 메시지 한 개로 보낸다.
   * 대화 기록(인라인 채팅)은 순서대로 펼쳐 한 메시지 안에 담는다.
   */
  const toUserMessage = (messages) => {
    if (messages.length === 1) return resolveContent(messages[0].content)
    const blocks = []
    messages.forEach((message, index) => {
      const isLast = index === messages.length - 1
      blocks.push({
        type: 'text',
        text: isLast
          ? '--- 지금 받은 질문 (이 질문에 답하세요) ---'
          : message.role === 'user'
            ? '--- 이전 대화: 상대 ---'
            : '--- 이전 대화: 당신의 답변 ---',
      })
      blocks.push(...resolveContent(message.content))
    })
    return blocks
  }

  return {
    name: /** @type {const} */ ('subscription'),

    async status() {
      try {
        const auth = await readAuthStatus()
        if (!auth.loggedIn) {
          return {
            configured: false,
            detail: '이 PC의 Claude Code가 로그인되어 있지 않습니다. `claude auth login`을 실행하세요.',
          }
        }
        return { configured: true, detail: auth.authMethod ?? null }
      } catch (error) {
        return {
          configured: false,
          detail: error instanceof Error ? error.message : 'Claude Code 상태를 확인하지 못했습니다.',
        }
      }
    },

    async verify() {
      const auth = await readAuthStatus()
      if (!auth.loggedIn) {
        throw new ClaudeBackendError(
          401,
          'Claude Code 로그인이 필요합니다. 터미널에서 `claude auth login`을 실행하세요.'
        )
      }
    },

    async upload({ mimeType, data }) {
      const id = `local_${createHash('sha256').update(data).digest('hex').slice(0, 32)}`
      images.delete(id)
      images.set(id, { mimeType, data })
      while (images.size > MAX_STORED_IMAGES) images.delete(images.keys().next().value)
      return id
    },

    async generate({ model, system, messages, schema, effort }, signal) {
      const input = `${JSON.stringify({
        type: 'user',
        message: { role: 'user', content: toUserMessage(messages) },
      })}\n`

      // 긴 시스템 프롬프트를 명령줄 인수로 넘기지 않도록 임시 파일로 전달한다.
      const workDir = await mkdtemp(path.join(tmpdir(), 'personaflow-'))
      const systemPromptFile = path.join(workDir, 'system.txt')
      await writeFile(systemPromptFile, system || DEFAULT_SYSTEM_PROMPT, 'utf8')

      const args = [
        '-p',
        '--input-format', 'stream-json',
        '--output-format', 'stream-json',
        '--verbose',
        '--tools', '',
        '--system-prompt-file', systemPromptFile,
        '--model', model,
        '--effort', effort,
        '--no-session-persistence',
        ...(schema ? ['--json-schema', JSON.stringify(schema)] : []),
      ]

      let run
      try {
        run = await runCli(args, { input, signal, timeoutMs: GENERATE_TIMEOUT_MS })
      } finally {
        await rm(workDir, { recursive: true, force: true })
      }

      const result = run.stdout
        .split('\n')
        .map((line) => {
          try {
            return JSON.parse(line)
          } catch {
            return null
          }
        })
        .filter((event) => event?.type === 'result')
        .pop()

      if (!result || result.is_error || result.subtype !== 'success') {
        throw resultError(result, run.stderr)
      }

      if (schema) {
        if (result.structured_output === undefined) {
          throw new ClaudeBackendError(502, 'Claude가 지정된 형식의 결과를 반환하지 않았습니다.')
        }
        return { text: JSON.stringify(result.structured_output), model }
      }
      return { text: String(result.result ?? '').trim(), model }
    },
  }
}
