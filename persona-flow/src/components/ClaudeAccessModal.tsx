import { useState } from 'react'
import { X, Check, Loader2, RefreshCw } from 'lucide-react'
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
import { BACKEND_LABEL, MODEL_OPTIONS } from '@/lib/ai/keyStore'
import { verifyClaudeAccess, type ClaudeServerStatus } from '@/lib/ai/claude'

interface ClaudeAccessModalProps {
  open: boolean
  status: ClaudeServerStatus | null
  statusError: string | null
  initialAccessCode: string
  currentModel: string
  onSave: (accessCode: string, model: string) => void
  onClose: () => void
  onClear?: () => void
  onRefreshStatus: () => void
}

type TestState = 'idle' | 'testing' | 'ok' | 'error'

export default function ClaudeAccessModal({
  open,
  status,
  statusError,
  initialAccessCode,
  currentModel,
  onSave,
  onClose,
  onClear,
  onRefreshStatus,
}: ClaudeAccessModalProps) {
  const [accessCode, setAccessCode] = useState(initialAccessCode)
  const [model, setModel] = useState(currentModel)
  const [testState, setTestState] = useState<TestState>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  if (!open) return null

  const needsCode = Boolean(status?.accessCodeRequired)
  const canSave = Boolean(status?.configured) && (!needsCode || accessCode.trim().length > 0)

  const handleTest = async () => {
    setTestState('testing')
    setErrorMsg('')
    try {
      await verifyClaudeAccess(accessCode.trim(), model)
      setTestState('ok')
    } catch (e) {
      setTestState('error')
      setErrorMsg(e instanceof Error ? e.message : '연결 확인에 실패했습니다.')
    }
  }

  const handleClear = () => {
    setAccessCode('')
    setTestState('idle')
    setErrorMsg('')
    onClear?.()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* 배경 */}
      <div className="absolute inset-0 bg-black/35 backdrop-blur-sm" onClick={onClose} />

      {/* 모달 */}
      <div className="relative w-full max-w-md overflow-hidden rounded-[18px] bg-white shadow-2xl">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <span className="text-lg">✳️</span>
            <h2 className="text-[17px] font-semibold text-gray-900">Claude 연결</h2>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-gray-600 rounded hover:bg-gray-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 본문 */}
        <div className="px-6 py-5 space-y-5">
          <div className="rounded-[12px] border border-gray-200 px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-gray-500">연결 방식</p>
              <button
                type="button"
                onClick={onRefreshStatus}
                className="inline-flex items-center gap-1 text-[11px] text-gray-400 hover:text-gray-600"
              >
                <RefreshCw className="h-3 w-3" />
                다시 확인
              </button>
            </div>
            {status ? (
              <>
                <p className="mt-1 text-sm font-medium text-gray-900">
                  {BACKEND_LABEL[status.backend]}
                  <span
                    className={`ml-2 text-xs font-normal ${status.configured ? 'text-green-700' : 'text-red-600'}`}
                  >
                    {status.configured ? '사용 가능' : '설정 필요'}
                  </span>
                </p>
                <p className="mt-1 text-xs leading-relaxed text-gray-500">
                  {status.backend === 'subscription'
                    ? '이 PC에 로그인된 Claude Code의 구독(Pro/Max) 사용량으로 분석합니다. 로컬 실행 전용입니다.'
                    : '배포 서버에 등록된 회사 Anthropic API 키로 분석합니다. 키는 브라우저로 전송되지 않습니다.'}
                </p>
                {!status.configured && status.detail && (
                  <p className="mt-2 text-xs leading-relaxed text-red-600">{status.detail}</p>
                )}
              </>
            ) : statusError ? (
              <p className="mt-1 text-xs leading-relaxed text-red-600">{statusError}</p>
            ) : (
              <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-gray-500">
                <Loader2 className="h-3 w-3 animate-spin" />
                확인 중
              </p>
            )}
          </div>

          {needsCode && (
            <div className="space-y-1.5">
              <Label className="text-xs">접근 코드</Label>
              <Input
                type="password"
                value={accessCode}
                onChange={(e) => {
                  setAccessCode(e.target.value)
                  setTestState('idle')
                }}
                placeholder="관리자에게 받은 접근 코드"
                className="h-9 text-sm font-mono"
                autoFocus
              />
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs">모델</Label>
            <Select
              value={model}
              onValueChange={(value) => {
                setModel(value)
                setTestState('idle')
              }}
            >
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
              연결 성공! 바로 분석할 수 있습니다.
            </div>
          )}
          {testState === 'error' && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2 leading-relaxed">
              {errorMsg}
            </div>
          )}
        </div>

        {/* 푸터 */}
        <div className="flex items-center justify-between gap-2 px-6 py-5 border-t border-gray-100">
          <div>
            {needsCode && initialAccessCode && onClear && (
              <button
                onClick={handleClear}
                className="text-xs text-gray-400 hover:text-red-500 transition-colors"
              >
                접근 코드 삭제
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleTest}
              disabled={!canSave || testState === 'testing'}
              className="gap-1.5"
            >
              {testState === 'testing' ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  확인 중
                </>
              ) : (
                '연결 확인'
              )}
            </Button>
            <Button size="sm" onClick={() => onSave(accessCode.trim(), model)} disabled={!canSave}>
              저장
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
