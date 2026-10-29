import { useState } from 'react'
import UploadStep from './pages/UploadStep'
import FlowSetupStep from './pages/FlowSetupStep'
import PersonaStep from './pages/PersonaStep'
import RunningStep from './pages/RunningStep'
import ReportPage from './pages/ReportPage'
import ApiKeyModal from './components/ApiKeyModal'
import OnboardingModal from './components/OnboardingModal'
import SNB from './components/SNB'
import { useApiKey } from './hooks/useApiKey'
import { createDemoReport } from './lib/ai/demo'
import { createDemoFrames } from './lib/demoScenario'
import { getTestHistory, saveTestReport, updateTestReportFeedback } from './lib/history'
import { imageToBase64 } from './lib/image'
import { createDefaultFlowConfig, syncFlowConfig, withExpectedPath } from './lib/flow'
import type {
  AIMode,
  AppStep,
  ClarificationRequest,
  FeedbackThread,
  FigmaSource,
  FlowTestConfig,
  Frame,
  PersonaConfig,
  TestReport,
} from './types'

const BREADCRUMB: Record<AppStep, string> = {
  upload: '테스트 설정 / 테스트 소스',
  flow: '테스트 설정 / 미션과 Flow',
  persona: '테스트 설정 / 페르소나 설정',
  running: 'AI 테스트 실행',
  report: '결과 / 리포트 확인',
}

async function prepareFrameForHistory(frame: Frame): Promise<Frame> {
  const frameMeta = {
    originalName: frame.originalName,
    userLabel: frame.userLabel,
    flowOrder: frame.flowOrder,
    sourceType: frame.sourceType,
    figmaFileKey: frame.figmaFileKey,
    figmaNodeId: frame.figmaNodeId,
    figmaVersionId: frame.figmaVersionId,
    figmaUrl: frame.figmaUrl,
    designContext: frame.designContext,
  }

  if (frame.imageUrl.startsWith('data:')) {
    return {
      id: frame.id,
      name: frame.name,
      imageUrl: frame.imageUrl,
      ...frameMeta,
    }
  }

  try {
    const image = await imageToBase64(frame.file ?? frame.imageUrl, 960, 0.78)
    return {
      id: frame.id,
      name: frame.name,
      imageUrl: `data:${image.mimeType};base64,${image.data}`,
      ...frameMeta,
    }
  } catch {
    return {
      id: frame.id,
      name: frame.name,
      imageUrl: frame.imageUrl,
      ...frameMeta,
    }
  }
}

async function prepareReportForHistory(report: TestReport): Promise<TestReport> {
  const frames = await Promise.all(report.frames.map(prepareFrameForHistory))
  return { ...report, frames }
}

function App() {
  const [onboardingOpen, setOnboardingOpen] = useState(
    () => window.localStorage.getItem('personaflow:onboarding-complete') !== 'true'
  )
  const [step, setStep] = useState<AppStep>('upload')
  const [figmaUrl, setFigmaUrl] = useState('')
  const [figmaSource, setFigmaSource] = useState<FigmaSource | null>(null)
  const [aiMode, setAiMode] = useState<AIMode>('gemini_free')
  const [frames, setFrames] = useState<Frame[]>([])
  const [flowConfig, setFlowConfig] = useState<FlowTestConfig>(() =>
    createDefaultFlowConfig([])
  )
  const [personas, setPersonas] = useState<PersonaConfig[]>([])
  const [report, setReport] = useState<TestReport | null>(null)
  const [history, setHistory] = useState<TestReport[]>(() => getTestHistory())

  const { apiKey, model, hasKey, setApiKey, clearApiKey, setModel } = useApiKey()
  const [keyModalOpen, setKeyModalOpen] = useState(false)

  const resetAll = () => {
    setStep('upload')
    setFigmaUrl('')
    setFigmaSource(null)
    setAiMode('gemini_free')
    setFrames([])
    setFlowConfig(createDefaultFlowConfig([]))
    setPersonas([])
    setReport(null)
  }

  const handleUploadNext = () => {
    setFlowConfig((current) => syncFlowConfig(current, frames))
    setStep('flow')
  }
  const handleFlowBack = () => setStep('upload')
  const handleFlowNext = () => {
    setFlowConfig((current) => withExpectedPath(current))
    setStep('persona')
  }
  const handlePersonaBack = () => setStep('flow')
  const handlePersonaNext = () => setStep('running')

  const handleAnalysisComplete = (r: TestReport) => {
    setReport(r)
    setHistory(saveTestReport(r))
    setStep('report')

    void prepareReportForHistory(r).then((preparedReport) => {
      const savedReport = getTestHistory().find((item) => item.id === preparedReport.id)
      setHistory(
        saveTestReport({
          ...preparedReport,
          feedbackThreads: savedReport?.feedbackThreads ?? preparedReport.feedbackThreads,
        })
      )
    })
  }

  const handleOpenReport = (savedReport: TestReport) => {
    setFigmaSource(savedReport.figmaSource ?? null)
    setFigmaUrl(savedReport.figmaSource?.url ?? '')
    setAiMode(savedReport.aiMode ?? 'gemini_free')
    setFrames(savedReport.frames)
    setFlowConfig(
      savedReport.flowConfig ??
        savedReport.flowResult?.config ??
        createDefaultFlowConfig(savedReport.frames)
    )
    setPersonas(savedReport.personas)
    setReport(savedReport)
    setStep('report')
  }

  const handleFeedbackThreadsChange = (threads: FeedbackThread[]) => {
    if (!report) return

    const nextReport: TestReport = {
      ...report,
      feedbackThreads: threads,
    }

    setReport(nextReport)

    const updated = updateTestReportFeedback(nextReport.id, threads)
    if (updated.found) {
      setHistory(updated.reports)
      return
    }

    setHistory(saveTestReport(nextReport))
  }

  const handleClarificationsChange = (clarifications: ClarificationRequest[]) => {
    if (!report?.flowJudgment) return

    const nextReport: TestReport = {
      ...report,
      flowJudgment: { ...report.flowJudgment, clarifications },
    }

    setReport(nextReport)
    setHistory(saveTestReport(nextReport))
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

  /**
   * API 키 없이 제품 전체를 보여주는 경로.
   * 미리 만들어진 샘플 흐름을 실제와 같은 판정기에 통과시킨 리포트로 바로 이동한다.
   */
  const handleOpenDemo = () => {
    const demoReport = createDemoReport()
    setOnboardingOpen(false)
    setFigmaSource(null)
    setFigmaUrl('')
    setAiMode('demo')
    setFrames(demoReport.frames)
    if (demoReport.flowConfig) setFlowConfig(demoReport.flowConfig)
    setPersonas(demoReport.personas)
    setReport(demoReport)
    setHistory(saveTestReport(demoReport))
    setStep('report')
  }

  /**
   * 개발 서버 전용: Figma 토큰 없이 샘플 화면으로 설정 흐름 전체를 점검한다.
   * 브리지가 연결돼 있지 않으면 실행 단계는 샘플 분석으로 대신한다.
   */
  const handleUseSampleFrames = () => {
    const sampleFrames = createDemoFrames()
    setFigmaSource(null)
    setFigmaUrl('')
    setAiMode(hasKey ? 'gemini_free' : 'demo')
    setFrames(sampleFrames)
    setFlowConfig(createDefaultFlowConfig(sampleFrames))
    setStep('flow')
  }

  const rememberOnboardingSeen = () => {
    window.localStorage.setItem('personaflow:onboarding-complete', 'true')
    setOnboardingOpen(false)
  }

  return (
    <div className="min-h-screen flex">
      <SNB
        currentStep={step}
        onReset={resetAll}
        hasKey={hasKey}
        model={model}
        onOpenKey={() => setKeyModalOpen(true)}
        history={history}
        currentReportId={report?.id}
        onOpenReport={handleOpenReport}
        onOpenGuide={() => setOnboardingOpen(true)}
        onOpenDemo={handleOpenDemo}
      />

      {/* 메인 영역 */}
      <div className="flex-1 flex flex-col bg-[#0b0b0c] min-w-0">
        {/* 브레드크럼 헤더 */}
        {step !== 'running' && step !== 'report' && (
          <header className="h-13 px-10 flex items-center border-b border-white/10 bg-[#1c1c1e]/85 backdrop-blur-xl">
            <p className="text-xs text-gray-500">{BREADCRUMB[step]}</p>
          </header>
        )}

        {/* 페이지 콘텐츠 */}
        <main className={`flex-1 ${step === 'running' ? '' : step === 'report' ? 'overflow-auto' : 'px-10 py-9'}`}>
          {step === 'upload' && (
            <UploadStep
              frames={frames}
              onFramesChange={setFrames}
              figmaUrl={figmaUrl}
              onFigmaUrlChange={setFigmaUrl}
              figmaSource={figmaSource}
              onFigmaSourceChange={setFigmaSource}
              onNext={handleUploadNext}
              hasApiKey={hasKey}
              apiKey={apiKey}
              model={model}
              onSaveApiKey={handleSaveKey}
              onRequireApiKey={() => setKeyModalOpen(true)}
              onUseSampleFrames={import.meta.env.DEV ? handleUseSampleFrames : undefined}
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
          {step === 'flow' && (
            <FlowSetupStep
              frames={frames}
              config={flowConfig}
              onConfigChange={setFlowConfig}
              onBack={handleFlowBack}
              onNext={handleFlowNext}
            />
          )}
          {step === 'running' && (
            <RunningStep
              personas={personas}
              frames={frames}
              flowConfig={flowConfig}
              figmaSource={figmaSource}
              aiMode={aiMode}
              apiKey={apiKey}
              model={model}
              onComplete={handleAnalysisComplete}
              onBack={handlePersonaBack}
              onRequireKey={() => setKeyModalOpen(true)}
            />
          )}
          {step === 'report' && report && (
            <ReportPage
              key={report.id}
              report={report}
              onNewTest={resetAll}
              apiKey={apiKey}
              model={model}
              onRequireKey={() => setKeyModalOpen(true)}
              onFeedbackThreadsChange={handleFeedbackThreadsChange}
              onClarificationsChange={handleClarificationsChange}
            />
          )}
        </main>
      </div>

      <ApiKeyModal
        open={keyModalOpen}
        initialKey={apiKey}
        currentModel={model}
        dismissable
        onSave={handleSaveKey}
        onClose={() => setKeyModalOpen(false)}
        onClear={handleClearKey}
      />
      <OnboardingModal
        open={onboardingOpen}
        onClose={rememberOnboardingSeen}
        onComplete={rememberOnboardingSeen}
        onOpenDemo={handleOpenDemo}
      />
    </div>
  )
}

export default App
