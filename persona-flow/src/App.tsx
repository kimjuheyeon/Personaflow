import { useState } from 'react'
import { Check, RotateCcw } from 'lucide-react'
import UploadStep from './pages/UploadStep'
import PersonaStep from './pages/PersonaStep'
import RunningStep from './pages/RunningStep'
import ReportPage from './pages/ReportPage'
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
}: {
  step: TestStep
  onReset: () => void
}) {
  const currentIndex = STEP_ORDER.indexOf(step)

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

      {/* 하단 버전 */}
      <div className="px-5 py-4 border-t border-slate-700">
        <p className="text-xs text-slate-600">PersonaFlow v0.1 MVP</p>
      </div>
    </aside>
  )
}

function App() {
  const [step, setStep] = useState<TestStep>('upload')
  const [frames, setFrames] = useState<Frame[]>([])
  const [personas, setPersonas] = useState<PersonaConfig[]>([])
  const [report, setReport] = useState<TestReport | null>(null)

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

  return (
    <div className="min-h-screen flex">
      <Sidebar step={step} onReset={resetAll} />

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
            />
          )}
          {step === 'running' && (
            <RunningStep
              personas={personas}
              frames={frames}
              onComplete={handleAnalysisComplete}
            />
          )}
          {step === 'report' && report && (
            <ReportPage report={report} onNewTest={resetAll} />
          )}
        </main>
      </div>
    </div>
  )
}

export default App
