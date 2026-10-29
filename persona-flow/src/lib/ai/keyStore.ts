/**
 * Claude 연결 설정(접근 코드 / 모델)을 브라우저 localStorage에 보관한다.
 * API 키는 브라우저에 두지 않는다. 구독 로그인이나 회사 API 키는 서버(/api/claude)가 가진다.
 */

const ACCESS_CODE_STORAGE = 'personaflow_access_code'
const MODEL_STORAGE = 'personaflow_claude_model'

export const DEFAULT_MODEL = 'claude-opus-5-5'

export interface ModelOption {
  id: string
  label: string
  note: string
}

export const MODEL_OPTIONS: ModelOption[] = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', note: '가장 정확함 (권장)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', note: '빠르고 균형 잡힘' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', note: '가장 빠르고 가벼움' },
]

/** 서버가 Claude를 호출하는 방식 */
export const BACKEND_LABEL = {
  subscription: '내 Claude 구독',
  api: '회사 API 키',
} as const

export function getStoredAccessCode(): string {
  try {
    return localStorage.getItem(ACCESS_CODE_STORAGE) ?? ''
  } catch {
    return ''
  }
}

export function storeAccessCode(code: string): void {
  try {
    localStorage.setItem(ACCESS_CODE_STORAGE, code.trim())
  } catch {
    /* localStorage 비활성 환경 무시 */
  }
}

export function clearStoredAccessCode(): void {
  try {
    localStorage.removeItem(ACCESS_CODE_STORAGE)
  } catch {
    /* noop */
  }
}

export function getStoredModel(): string {
  try {
    const stored = localStorage.getItem(MODEL_STORAGE)
    // 이전 버전(Gemini)에서 저장한 값은 무시한다.
    return MODEL_OPTIONS.some((option) => option.id === stored) ? (stored as string) : DEFAULT_MODEL
  } catch {
    return DEFAULT_MODEL
  }
}

export function storeModel(model: string): void {
  try {
    localStorage.setItem(MODEL_STORAGE, model)
  } catch {
    /* noop */
  }
}
