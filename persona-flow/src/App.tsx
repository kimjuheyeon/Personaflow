import { useEffect, useState } from 'react'
import { Check, RotateCcw } from 'lucide-react'
import UploadStep from './pages/UploadStep'
import PersonaStep from './pages/PersonaStep'
import RunningStep from './pages/RunningStep'
import ReportPage from './pages/ReportPage'
import ApiKeyModal from './components/ApiKeyModal'
import { useApiKey } from './hooks/useApiKey'
import { MODEL_OPTIONS } from './lib/ai/keyStore'
import type { Frame, PersonaConfig, TestReport } from './types'

type TestStep = 'upload' | 'persona' | 'running' | 'report'

const STEP_ORDER: TestStep[] = ['upload', 'persona', 'running', 'report']

const STEP_LABELS: Record<TestStep, string> = {
  upload: '시안 입력',
  persona: '페르소나 설정',
  running: 'AI 테스트 실행',
  report: '리포트 확인',
}

const BREADCRUMB: Record<TestStep, string> = {
  upload: '테스트 설정 / 시안 입력',
  persona: '테스트 설정 / 페르소나 설정',
  running: 'AI 테스트 실행',
  report: '결과 / 리포트 확인',
}

function Sidebar({
  step,
  onReset,
  hasKey,
  model,
  onOpenKey,
}: {
  step: TestStep
  onReset: () => void
  hasKey: boolean
  model: string
  onOpenKey: () => void
}) {
  const currentIndex = STEP_ORDER.indexOf(step)
  const modelLabel = MODEL_OPTIONS.find((m) => m.id === model)?.label ?? model

  // running: 모두 active처럼 (현재), report: 모두 completed
  const getStepState = (index: number): 'completed' | 'current' | 'future' => {
    if (step === 'report') return 'completed'
    if (step === 'running') {
      if (index < 2) return 'completed'
      if (index === 2) return 'current'
      return 'future'
    }
    if (index < currentIndex) return 'completed'
    if (index === currentIndex) return 'current'
    return 'future'
  }

  return (
    <aside className="w-60 min-h-screen bg-slate-900 flex flex-col flex-shrink-0">
      {/* 로고 */}
      <div className="px-5 py-5 border-b border-slate-700">
        <div className="flex items-center gap-2">
          <span className="text-white font-bold text-base tracking-tight">PersonaFlow</span>
        </div>
      </div>

      {/* 새 테스트 시작 버튼 (upload가 아닐 때만) */}
      {step !== 'upload' && (
        <div className="px-4 pt-4">
          <button
            onClick={onReset}
            className="w-full flex items-center gap-2 px-3 py-2 rounded text-sm text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            새 테스트 시작
          </button>
        </div>
      )}

      {/* 진행 단계 */}
      <nav className="flex-1 px-4 py-5">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3 px-1">
          진행 단계
        </p>
        <ul className="space-y-0.5">
          {STEP_ORDER.map((s, index) => {
            const state = getStepState(index)
            return (
              <li key={s}>
                <div
                  className={`flex items-center gap-3 px-3 py-2 rounded text-sm transition-colors ${
                    state === 'current'
                      ? 'bg-slate-800 text-white'
                      : 'text-slate-400'
                  }`}
                >
                  {/* 아이콘 */}
                  <span className="flex-shrink-0 w-4 h-4 flex items-center justify-center">
                    {state === 'completed' ? (
                      <Check className="w-3.5 h-3.5 text-green-500" />
                    ) : state === 'current' ? (
                      <span className="w-2 h-2 rounded-full bg-blue-400 inline-block" />
                    ) : (
                      <span className="w-2 h-2 rounded-full bg-slate-600 inline-block" />
                    )}
                  </span>
                  <span
                    className={`${
                      state === 'current'
                        ? 'font-semibold text-white'
                        : state === 'completed'
                        ? 'text-slate-400'
                        : 'text-slate-500'
                    }`}
                  >
                    {STEP_LABELS[s]}
                  </span>
                </div>
                {/* 수직 연결선 */}
                {index < STEP_ORDER.length - 1 && (
                  <div className="ml-[22px] w-px h-2 bg-slate-700" />
                )}
              </li>
            )
          })}
        </ul>
      </nav>

      {/* API 키 상태 */}
      <div className="px-4 py-3 border-t border-slate-700">
        <button
          onClick={onOpenKey}
          className="w-full flex items-center gap-2 px-3 py-2 rounded text-xs text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
        >
          <span
            className={`w-2 h-2 rounded-full flex-shrink-0 ${
              hasKey ? 'bg-green-400' : 'bg-red-400'
            }`}
          />
          <span className="flex-1 text-left truncate">
            {hasKey ? `Gemini 연결됨` : 'API 키 미설정'}
          </span>
          <span className="text-slate-500">⚙</span>
        </button>
        {hasKey && (
          <p className="px-3 pt-1 text-[10px] text-slate-600 truncate">{modelLabel}</p>
        )}
      </div>

      {/* 하단 버전 */}
      <div className="px-5 py-3 border-t border-slate-700">
        <p className="text-xs text-slate-600">PersonaFlow v0.2</p>
      </div>
    </aside>
  )
}

function App() {
  const [step, setStep] = useState<TestStep>('upload')
  const [frames, setFrames] = useState<Frame[]>([])
  const [personas, setPersonas] = useState<PersonaConfig[]>([])
  const [report, setReport] = useState<TestReport | null>(null)

  const { apiKey, model, hasKey, setApiKey, clearApiKey, setModel } = useApiKey()
  const [keyModalOpen, setKeyModalOpen] = useState(false)

  // 키가 없으면 최초 진입 시 모달 자동 표시
  useEffect(() => {
    if (!hasKey) setKeyModalOpen(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const resetAll = () => {
    setStep('upload')
    setFrames([])
    setPersonas([])
    setReport(null)
  }

  const handleUploadNext = () => setStep('persona')
  const handlePersonaBack = () => setStep('upload')
  const handlePersonaNext = () => setStep('running')

  const handleAnalysisComplete = (r: TestReport) => {
    setReport(r)
    setStep('report')
  }

  const handleSaveKey = (key: string, m: string) => {
    setApiKey(key)
    setModel(m)
    setKeyModalOpen(false)
  }

  const handleClearKey = () => {
    clearApiKey()
    setKeyModalOpen(true)
  }

  return (
    <div className="min-h-screen flex">
      <Sidebar
        step={step}
        onReset={resetAll}
        hasKey={hasKey}
        model={model}
        onOpenKey={() => setKeyModalOpen(true)}
      />

      {/* 메인 영역 */}
      <div className="flex-1 flex flex-col bg-gray-50 min-w-0">
        {/* 브레드크럼 헤더 */}
        {step !== 'running' && step !== 'report' && (
          <header className="px-8 py-3 border-b border-gray-200 bg-white">
            <p className="text-xs text-gray-500">{BREADCRUMB[step]}</p>
          </header>
        )}

        {/* 페이지 콘텐츠 */}
        <main className={`flex-1 ${step === 'running' ? '' : step === 'report' ? 'overflow-auto' : 'px-8 py-6'}`}>
          {step === 'upload' && (
            <UploadStep
              frames={frames}
              onFramesChange={setFrames}
              onNext={handleUploadNext}
            />
          )}
          {step === 'persona' && (
            <PersonaStep
              personas={personas}
              onPersonasChange={setPersonas}
              onNext={handlePersonaNext}
              onBack={handlePersonaBack}
              frames={frames}
              apiKey={apiKey}
              model={model}
              onRequireKey={() => setKeyModalOpen(true)}
            />
          )}
          {step === 'running' && (
            <RunningStep
              personas={personas}
              frames={frames}
              apiKey={apiKey}
              model={model}
              onComplete={handleAnalysisComplete}
              onBack={handlePersonaBack}
              onRequireKey={() => setKeyModalOpen(true)}
            />
          )}
          {step === 'report' && report && (
            <ReportPage
              report={report}
              onNewTest={resetAll}
              apiKey={apiKey}
              model={model}
              onRequireKey={() => setKeyModalOpen(true)}
            />
          )}
        </main>
      </div>

      <ApiKeyModal
        open={keyModalOpen}
        initialKey={apiKey}
        currentModel={model}
        dismissable={hasKey}
        onSave={handleSaveKey}
        onClose={() => setKeyModalOpen(false)}
        onClear={handleClearKey}
      />
    </div>
  )
}

export default App
