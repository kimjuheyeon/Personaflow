import { useState } from 'react'
import UploadStep from './pages/UploadStep'
import FlowSetupStep from './pages/FlowSetupStep'
import PersonaStep from './pages/PersonaStep'
import RunningStep from './pages/RunningStep'
import ReportPage from './pages/ReportPage'
import ClaudeAccessModal from './components/ClaudeAccessModal'
import OnboardingModal from './components/OnboardingModal'
import SNB from './components/SNB'
import { useClaudeAccess } from './hooks/useClaudeAccess'
import { createDemoReport } from './lib/ai/demo'
import { getTestHistory, saveTestReport, updateTestReportFeedback } from './lib/history'
import { imageToBase64 } from './lib/image'
import { createDefaultFlowConfig, syncFlowConfig } from './lib/flow'
import type {
  ABTestConfig,
  AIMode,
  AppStep,
  ClarificationRequest,
  DesignVariant,
  FeedbackThread,
  FigmaSource,
  FlowTestConfig,
  Frame,
  PersonaConfig,
  SourceType,
  TestMode,
  TestReport,
} from './types'

const BREADCRUMB: Record<AppStep, string> = {
  upload: '테스트 설정 / 테스트 소스',
  flow: '테스트 설정 / 미션과 Flow',
  persona: '테스트 설정 / 페르소나 설정',
  running: 'AI 테스트 실행',
  report: '결과 / 리포트 확인',
}

function createDefaultABConfig(): ABTestConfig {
  return {
    goal: '',
    hypothesis: '',
    criteria: ['첫인상', '이해도', '전환 유도'],
  }
}

function createDefaultVariants(): DesignVariant[] {
  return [
    { id: 'A', name: 'A안', frames: [] },
    { id: 'B', name: 'B안', frames: [] },
  ]
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
  const variants = report.variants
    ? await Promise.all(
        report.variants.map(async (variant) => ({
          ...variant,
          frames: await Promise.all(variant.frames.map(prepareFrameForHistory)),
        }))
      )
    : undefined

  return {
    ...report,
    frames,
    variants,
  }
}

function App() {
  const [onboardingOpen, setOnboardingOpen] = useState(
    () => window.localStorage.getItem('personaflow:onboarding-complete') !== 'true'
  )
  const [step, setStep] = useState<AppStep>('upload')
  const [testMode, setTestMode] = useState<TestMode>('single')
  const [sourceType, setSourceType] = useState<SourceType>('figma')
  const [figmaUrl, setFigmaUrl] = useState('')
  const [figmaSource, setFigmaSource] = useState<FigmaSource | null>(null)
  const [aiMode, setAiMode] = useState<AIMode>('claude')
  const [frames, setFrames] = useState<Frame[]>([])
  const [variants, setVariants] = useState<DesignVariant[]>(() => createDefaultVariants())
  const [abConfig, setAbConfig] = useState<ABTestConfig>(() => createDefaultABConfig())
  const [flowConfig, setFlowConfig] = useState<FlowTestConfig>(() =>
    createDefaultFlowConfig([])
  )
  const [personas, setPersonas] = useState<PersonaConfig[]>([])
  const [report, setReport] = useState<TestReport | null>(null)
  const [history, setHistory] = useState<TestReport[]>(() => getTestHistory())

  const claude = useClaudeAccess()
  const { accessCode, model, ready: aiReady } = claude
  const [keyModalOpen, setKeyModalOpen] = useState(false)

  const resetAll = () => {
    setStep('upload')
    setTestMode('single')
    setSourceType('figma')
    setFigmaUrl('')
    setFigmaSource(null)
    setAiMode('claude')
    setFrames([])
    setVariants(createDefaultVariants())
    setAbConfig(createDefaultABConfig())
    setFlowConfig(createDefaultFlowConfig([]))
    setPersonas([])
    setReport(null)
  }

  const handleUploadNext = () => {
    if (testMode === 'ab') {
      setStep('persona')
      return
    }
    setFlowConfig((current) => syncFlowConfig(current, frames))
    setStep('flow')
  }
  const handleFlowBack = () => setStep('upload')
  const handleFlowNext = () => setStep('persona')
  const handlePersonaBack = () => setStep(testMode === 'ab' ? 'upload' : 'flow')
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
    const mode = savedReport.testMode ?? 'single'
    setTestMode(mode)
    setSourceType(savedReport.sourceType ?? 'image')
    setFigmaSource(savedReport.figmaSource ?? null)
    setFigmaUrl(savedReport.figmaSource?.url ?? '')
    // 이전 버전 리포트의 'gemini_free'도 실제 AI 분석으로 본다.
    setAiMode(savedReport.aiMode === 'demo' ? 'demo' : 'claude')
    setFrames(savedReport.frames)
    setVariants(savedReport.variants ?? createDefaultVariants())
    setAbConfig(savedReport.abConfig ?? createDefaultABConfig())
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

  const handleSaveAccess = (code: string, m: string) => {
    claude.setAccessCode(code)
    claude.setModel(m)
    setKeyModalOpen(false)
  }

  /**
   * API 키 없이 제품 전체를 보여주는 경로.
   * 미리 만들어진 샘플 흐름을 실제와 같은 판정기에 통과시킨 리포트로 바로 이동한다.
   */
  const handleOpenDemo = () => {
    const demoReport = createDemoReport()
    setOnboardingOpen(false)
    setTestMode('single')
    setSourceType('image')
    setFigmaSource(null)
    setFigmaUrl('')
    setAiMode('demo')
    setFrames(demoReport.frames)
    setVariants(createDefaultVariants())
    setAbConfig(createDefaultABConfig())
    if (demoReport.flowConfig) setFlowConfig(demoReport.flowConfig)
    setPersonas(demoReport.personas)
    setReport(demoReport)
    setHistory(saveTestReport(demoReport))
    setStep('report')
  }

  const rememberOnboardingSeen = () => {
    window.localStorage.setItem('personaflow:onboarding-complete', 'true')
    setOnboardingOpen(false)
  }

  const activeFrames =
    testMode === 'ab' ? variants.flatMap((variant) => variant.frames) : frames

  return (
    <div className="min-h-screen flex">
      <SNB
        currentStep={step}
        onReset={resetAll}
        hasKey={aiReady}
        backend={claude.status?.backend ?? null}
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
              sourceType={sourceType}
              onSourceTypeChange={setSourceType}
              figmaUrl={figmaUrl}
              onFigmaUrlChange={setFigmaUrl}
              figmaSource={figmaSource}
              onFigmaSourceChange={setFigmaSource}
              testMode={testMode}
              onTestModeChange={setTestMode}
              variants={variants}
              onVariantsChange={setVariants}
              abConfig={abConfig}
              onAbConfigChange={setAbConfig}
              onNext={handleUploadNext}
              aiReady={aiReady}
              aiStatus={claude.status}
              model={model}
              onOpenAiSettings={() => setKeyModalOpen(true)}
            />
          )}
          {step === 'persona' && (
            <PersonaStep
              personas={personas}
              onPersonasChange={setPersonas}
              onNext={handlePersonaNext}
              onBack={handlePersonaBack}
              frames={activeFrames}
              accessCode={accessCode}
              aiReady={aiReady}
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
              testMode={testMode}
              variants={variants}
              abConfig={abConfig}
              flowConfig={flowConfig}
              sourceType={sourceType}
              figmaSource={figmaSource}
              aiMode={aiMode}
              accessCode={accessCode}
              aiReady={aiReady}
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
              accessCode={accessCode}
              aiReady={aiReady}
              model={model}
              onRequireKey={() => setKeyModalOpen(true)}
              onFeedbackThreadsChange={handleFeedbackThreadsChange}
              onClarificationsChange={handleClarificationsChange}
            />
          )}
        </main>
      </div>

      {/* 열 때마다 저장된 값으로 다시 시작하도록 key를 바꾼다 */}
      <ClaudeAccessModal
        key={keyModalOpen ? 'open' : 'closed'}
        open={keyModalOpen}
        status={claude.status}
        statusError={claude.statusError}
        initialAccessCode={accessCode}
        currentModel={model}
        onSave={handleSaveAccess}
        onClose={() => setKeyModalOpen(false)}
        onClear={claude.clearAccessCode}
        onRefreshStatus={claude.refreshStatus}
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
