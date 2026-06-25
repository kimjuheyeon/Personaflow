/**
 * Gemini API 키 / 모델 설정을 브라우저 localStorage에 보관한다.
 * (개인용·데모 목적. 추후 유료 전환 시 백엔드 프록시로 이전 권장)
 */

const KEY_STORAGE = 'personaflow_gemini_key'
const MODEL_STORAGE = 'personaflow_gemini_model'

export const DEFAULT_MODEL = 'gemini-2.5-flash'

export interface ModelOption {
  id: string
  label: string
  note: string
}

/** 무료 티어에서 사용 가능한 비전(이미지) 지원 모델 */
export const MODEL_OPTIONS: ModelOption[] = [
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', note: '똑똑함 · 무료 한도 있음 (권장)' },
  { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite', note: '가볍고 무료 한도 넉넉' },
  { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', note: '빠름 · 키에 따라 한도 0일 수 있음' },
  { id: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash-Lite', note: '가장 가벼움' },
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
    return localStorage.getItem(MODEL_STORAGE) || DEFAULT_MODEL
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
