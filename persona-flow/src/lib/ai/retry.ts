/**
 * 요청 취소와 재시도.
 *
 * 사용량 한도(429)와 서버 과부하(529)는 드물지 않다.
 * 분석 한 번이 여러 번의 순차 호출로 이루어지므로, 마지막 호출에서 한 번 막혔다고
 * 앞의 결과를 전부 버리면 사용자는 같은 비용을 처음부터 다시 치른다.
 */

/** 사용자가 화면을 벗어나 요청을 중단한 경우. 오류 화면을 띄우지 않는다. */
export class AnalysisAbortedError extends Error {
  constructor() {
    super('분석이 취소되었습니다.')
    this.name = 'AnalysisAbortedError'
  }
}

/** 재시도해도 소용없는 오류 (잘못된 키, 안전 필터 차단 등) */
export class PermanentAnalysisError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PermanentAnalysisError'
  }
}

export function isAbortError(error: unknown): boolean {
  if (error instanceof AnalysisAbortedError) return true
  return error instanceof DOMException && error.name === 'AbortError'
}

export interface RetryNotice {
  attempt: number
  maxAttempts: number
  waitMs: number
  reason: string
}

export interface RetryOptions {
  signal?: AbortSignal
  maxAttempts?: number
  onRetry?: (notice: RetryNotice) => void
}

export const DEFAULT_MAX_ATTEMPTS = 4

/**
 * 재시도할 가치가 있는 HTTP 상태. 529는 Claude 서버 과부하.
 * 504(시간 초과)는 같은 긴 요청을 다시 보내도 또 초과하므로 재시도하지 않는다.
 */
export function isRetriableStatus(status: number): boolean {
  return [429, 500, 502, 503, 529].includes(status)
}

/** 서버가 알려준 Retry-After(초 또는 HTTP 날짜)가 있으면 그 시간을 우선한다. */
export function parseRetryAfterMs(value?: string | null): number | null {
  if (!value) return null
  const seconds = Number.parseFloat(value)
  if (Number.isFinite(seconds)) return Math.round(seconds * 1000)
  const date = Date.parse(value)
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now())
  return null
}

const BASE_DELAY_MS = 1500
const MAX_DELAY_MS = 60_000

/** 지수 백오프 + 지터. 동시에 여러 요청이 같은 시점에 몰리는 것을 피한다. */
export function backoffDelayMs(attempt: number): number {
  const exponential = BASE_DELAY_MS * 2 ** (attempt - 1)
  const jitter = Math.random() * BASE_DELAY_MS
  return Math.min(MAX_DELAY_MS, Math.round(exponential + jitter))
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new AnalysisAbortedError()
}

/** 중단 가능한 대기 */
export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AnalysisAbortedError())
      return
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)

    function onAbort() {
      clearTimeout(timer)
      reject(new AnalysisAbortedError())
    }

    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** 재시도 대기 시간을 사람이 읽을 수 있는 문구로 */
export function formatWait(ms: number): string {
  const seconds = Math.ceil(ms / 1000)
  if (seconds < 60) return `${seconds}초`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return rest > 0 ? `${minutes}분 ${rest}초` : `${minutes}분`
}
