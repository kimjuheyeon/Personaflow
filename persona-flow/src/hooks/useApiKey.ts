import { useCallback, useState } from 'react'
import {
  getStoredKey,
  storeKey,
  clearStoredKey,
  getStoredModel,
  storeModel,
  DEFAULT_MODEL,
} from '@/lib/ai/keyStore'

export interface UseApiKey {
  apiKey: string
  model: string
  hasKey: boolean
  setApiKey: (key: string) => void
  clearApiKey: () => void
  setModel: (model: string) => void
}

export function useApiKey(): UseApiKey {
  const [apiKey, setApiKeyState] = useState<string>(() => getStoredKey())
  const [model, setModelState] = useState<string>(() => getStoredModel() || DEFAULT_MODEL)

  const setApiKey = useCallback((key: string) => {
    const trimmed = key.trim()
    storeKey(trimmed)
    setApiKeyState(trimmed)
  }, [])

  const clearApiKey = useCallback(() => {
    clearStoredKey()
    setApiKeyState('')
  }, [])

  const setModel = useCallback((m: string) => {
    storeModel(m)
    setModelState(m)
  }, [])

  return {
    apiKey,
    model,
    hasKey: apiKey.length > 0,
    setApiKey,
    clearApiKey,
    setModel,
  }
}
