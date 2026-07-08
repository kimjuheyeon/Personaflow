const FIGMA_TOKEN_STORAGE = 'personaflow_figma_token'

export function getStoredFigmaToken(): string {
  try {
    return localStorage.getItem(FIGMA_TOKEN_STORAGE) ?? ''
  } catch {
    return ''
  }
}

export function storeFigmaToken(token: string): void {
  try {
    localStorage.setItem(FIGMA_TOKEN_STORAGE, token.trim())
  } catch {
    /* localStorage 비활성 환경 무시 */
  }
}

export function clearStoredFigmaToken(): void {
  try {
    localStorage.removeItem(FIGMA_TOKEN_STORAGE)
  } catch {
    /* noop */
  }
}
