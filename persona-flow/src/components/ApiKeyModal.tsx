import { useEffect, useState } from 'react'
import { X, Check, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from '@/components/ui/select'
import { MODEL_OPTIONS } from '@/lib/ai/keyStore'
import { testApiKey } from '@/lib/ai/gemini'

interface ApiKeyModalProps {
  open: boolean
  initialKey: string
  currentModel: string
  /** 키가 한 번도 없으면 닫기 금지(필수 입력) */
  dismissable: boolean
  onSave: (key: string, model: string) => void
  onClose: () => void
  onClear?: () => void
}

type TestState = 'idle' | 'testing' | 'ok' | 'error'

export default function ApiKeyModal({
  open,
  initialKey,
  currentModel,
  dismissable,
  onSave,
  onClose,
  onClear,
}: ApiKeyModalProps) {
  const [key, setKey] = useState(initialKey)
  const [model, setModel] = useState(currentModel)
  const [testState, setTestState] = useState<TestState>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    if (open) {
      setKey(initialKey)
      setModel(currentModel)
      setTestState('idle')
      setErrorMsg('')
    }
  }, [open, initialKey, currentModel])

  if (!open) return null

  const handleTest = async () => {
    if (!key.trim()) return
    setTestState('testing')
    setErrorMsg('')
    try {
      await testApiKey(key.trim(), model)
      setTestState('ok')
    } catch (e) {
      setTestState('error')
      setErrorMsg(e instanceof Error ? e.message : '연결 테스트에 실패했습니다.')
    }
  }

  const handleSave = () => {
    if (!key.trim()) return
    onSave(key.trim(), model)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* 배경 */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={dismissable ? onClose : undefined}
      />

      {/* 모달 */}
      <div className="relative w-full max-w-md bg-white rounded-lg shadow-xl border border-gray-200">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <span className="text-lg">🔑</span>
            <h2 className="text-sm font-semibold text-gray-900">Gemini API 키 연결</h2>
          </div>
          {dismissable && (
            <button
              onClick={onClose}
              className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-gray-600 rounded hover:bg-gray-100"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* 본문 */}
        <div className="px-5 py-4 space-y-4">
          <p className="text-xs text-gray-500 leading-relaxed">
            AI 시안 분석에는 Google Gemini API 키가 필요합니다. 키는 이 브라우저에만 저장되며
            서버로 전송되지 않습니다.
          </p>

          <a
            href="https://aistudio.google.com/apikey"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 underline"
          >
            무료 API 키 발급받기 (Google AI Studio) →
          </a>

          <div className="space-y-1.5">
            <Label className="text-xs">API 키</Label>
            <Input
              type="password"
              value={key}
              onChange={(e) => {
                setKey(e.target.value)
                setTestState('idle')
              }}
              placeholder="AIza..."
              className="h-9 text-sm font-mono"
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">모델</Label>
            <Select value={model} onValueChange={setModel}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MODEL_OPTIONS.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.label} — {m.note}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* 테스트 결과 */}
          {testState === 'ok' && (
            <div className="flex items-center gap-2 text-xs text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2">
              <Check className="w-3.5 h-3.5" />
              연결 성공! 키가 정상 동작합니다.
            </div>
          )}
          {testState === 'error' && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2 leading-relaxed">
              {errorMsg}
            </div>
          )}
        </div>

        {/* 푸터 */}
        <div className="flex items-center justify-between gap-2 px-5 py-4 border-t border-gray-100">
          <div>
            {initialKey && onClear && (
              <button
                onClick={onClear}
                className="text-xs text-gray-400 hover:text-red-500 transition-colors"
              >
                키 삭제
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleTest}
              disabled={!key.trim() || testState === 'testing'}
              className="gap-1.5"
            >
              {testState === 'testing' ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  테스트 중
                </>
              ) : (
                '연결 테스트'
              )}
            </Button>
            <Button size="sm" onClick={handleSave} disabled={!key.trim()}>
              저장
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
