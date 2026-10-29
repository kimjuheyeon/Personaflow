import { useCallback, useEffect, useState } from 'react'
import {
  getStoredAccessCode,
  storeAccessCode,
  clearStoredAccessCode,
  getStoredModel,
  storeModel,
} from '@/lib/ai/keyStore'
import { getClaudeServerStatus, type ClaudeServerStatus } from '@/lib/ai/claude'

export interface UseClaudeAccess {
  /** 서버 상태. 확인 중이면 null */
  status: ClaudeServerStatus | null
  /** 서버에 연결하지 못한 경우의 안내 문구 */
  statusError: string | null
  accessCode: string
  model: string
  /** 지금 바로 AI 분석을 실행할 수 있는지 */
  ready: boolean
  setAccessCode: (code: string) => void
  clearAccessCode: () => void
  setModel: (model: string) => void
  refreshStatus: () => void
}

export function useClaudeAccess(): UseClaudeAccess {
  const [status, setStatus] = useState<ClaudeServerStatus | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [accessCode, setAccessCodeState] = useState<string>(() => getStoredAccessCode())
  const [model, setModelState] = useState<string>(() => getStoredModel())
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    getClaudeServerStatus(controller.signal)
      .then((next) => {
        setStatus(next)
        setStatusError(null)
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setStatus(null)
        setStatusError(error instanceof Error ? error.message : 'AI 서버 상태를 확인하지 못했습니다.')
      })
    return () => controller.abort()
  }, [refreshKey])

  const setAccessCode = useCallback((code: string) => {
    const trimmed = code.trim()
    storeAccessCode(trimmed)
    setAccessCodeState(trimmed)
  }, [])

  const clearAccessCode = useCallback(() => {
    clearStoredAccessCode()
    setAccessCodeState('')
  }, [])

  const setModel = useCallback((m: string) => {
    storeModel(m)
    setModelState(m)
  }, [])

  const refreshStatus = useCallback(() => setRefreshKey((key) => key + 1), [])

  const ready = Boolean(
    status?.configured && (!status.accessCodeRequired || accessCode.length > 0)
  )

  return {
    status,
    statusError,
    accessCode,
    model,
    ready,
    setAccessCode,
    clearAccessCode,
    setModel,
    refreshStatus,
  }
}
