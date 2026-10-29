/**
 * 로컬 Claude 브리지 주소 / 모델 설정을 브라우저 localStorage에 보관한다.
 * 연결 테스트를 통과한 주소만 저장되므로, 값이 있으면 "연결됨"으로 본다.
 */

const KEY_STORAGE = 'personaflow_bridge_url'
const MODEL_STORAGE = 'personaflow_claude_model'

export const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:8787'
export const DEFAULT_MODEL = 'sonnet'

export interface ModelOption {
  id: string
  label: string
  note: string
}

/** Claude Code 모델 별칭. 항상 해당 등급의 최신 모델로 연결된다. */
export const MODEL_OPTIONS: ModelOption[] = [
  { id: 'sonnet', label: 'Claude Sonnet', note: '균형 · 이미지 판독 우수 (권장)' },
  { id: 'opus', label: 'Claude Opus', note: '가장 꼼꼼함 · 느리고 사용량 많음' },
  { id: 'haiku', label: 'Claude Haiku', note: '가장 빠름 · 사용량 적음' },
]

export function getStoredKey(): string {
  try {
    return localStorage.getItem(KEY_STORAGE) ?? ''
  } catch {
    return ''
  }
}

export function storeKey(key: string): void {
  try {
    localStorage.setItem(KEY_STORAGE, key.trim())
  } catch {
    /* localStorage 비활성 환경 무시 */
  }
}

export function clearStoredKey(): void {
  try {
    localStorage.removeItem(KEY_STORAGE)
  } catch {
    /* noop */
  }
}

export function getStoredModel(): string {
  try {
    const stored = localStorage.getItem(MODEL_STORAGE)
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
