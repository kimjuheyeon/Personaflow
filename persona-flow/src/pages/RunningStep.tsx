import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Check, Circle, AlertTriangle } from 'lucide-react'
import { Progress } from '@/components/ui/progress'
import { Button } from '@/components/ui/button'
import { analyzeABDesignDemo, analyzeDesignDemo } from '@/lib/ai/demo'
import { analyzeABDesign, analyzeDesign } from '@/lib/ai/gemini'
import { getFrameProjectLabel } from '@/lib/frameNaming'
import type {
  ABTestConfig,
  AIMode,
  DesignVariant,
  FigmaSource,
  PersonaConfig,
  Frame,
  SourceType,
  TestMode,
  TestReport,
} from '@/types'

interface RunningStepProps {
  personas: PersonaConfig[]
  frames: Frame[]
  testMode: TestMode
  variants: DesignVariant[]
  abConfig: ABTestConfig
  sourceType: SourceType
  figmaSource: FigmaSource | null
  aiMode: AIMode
  apiKey: string
  model: string
  onComplete: (report: TestReport) => void
  onBack: () => void
  onRequireKey: () => void
}

const STEPS = [
  { label: '화면 구조 분석 중', progress: 25 },
  { label: '페르소나 시뮬레이션 실행 중', progress: 55 },
  { label: '6축 UX 평가 생성 중', progress: 80 },
  { label: '리포트 작성 중', progress: 95 },
]

const DEVICE_LABEL: Record<string, string> = {
  desktop: '데스크탑',
  mobile: '모바일',
  tablet: '태블릿',
}

function hasFrameImage(frame: Frame): boolean {
  return Boolean(frame.file || frame.imageUrl)
}

function buildProjectName(
  frames: Frame[],
  testMode: TestMode,
  abConfig: ABTestConfig,
  sourceType: SourceType,
  figmaSource: FigmaSource | null
): string {
  if (sourceType === 'figma') {
    return figmaSource?.fileName
      ? `Figma 플로우 · ${figmaSource.fileName}`
      : 'Figma 플로우 테스트'
  }
  if (testMode === 'ab') {
    const goal = abConfig.goal.trim()
    return goal ? `A/B 테스트 · ${goal}` : '화면 A/B 테스트'
  }
  if (frames.length === 0) return '시안 분석'
  if (frames.length === 1) return getFrameProjectLabel(frames[0])
  return `${getFrameProjectLabel(frames[0])} 외 ${frames.length - 1}건`
}

export default function RunningStep({
  personas,
  frames,
  testMode,
  variants,
  abConfig,
  sourceType,
  figmaSource,
  aiMode,
  apiKey,
  model,
  onComplete,
  onBack,
  onRequireKey,
}: RunningStepProps) {
  const [currentStep, setCurrentStep] = useState(0)
  const [isDone, setIsDone] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const cancelledRef = useRef(false)
  const stageTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopStageAnimation = () => {
    if (stageTimerRef.current) {
      clearInterval(stageTimerRef.current)
      stageTimerRef.current = null
    }
  }

  const run = useCallback(async () => {
    if (aiMode === 'gemini_free' && !apiKey) {
      setError('Gemini API 키가 필요합니다. 키를 설정한 뒤 다시 시도하세요.')
      return
    }

    const targetFrames =
      testMode === 'ab' ? variants.flatMap((variant) => variant.frames) : frames
    if (aiMode === 'gemini_free' && !targetFrames.some(hasFrameImage)) {
      setError(
        '실제 AI 분석에는 화면 이미지가 필요합니다. Figma 개인 액세스 토큰으로 화면 이미지를 가져오거나 PNG/JPG 이미지를 업로드한 뒤 다시 실행하세요.'
      )
      return
    }

    setError(null)
    setIsDone(false)
    setCurrentStep(0)
    setProgress(STEPS[0].progress)

    // 응답 대기 동안 단계 애니메이션 (마지막 단계에서 대기)
    stopStageAnimation()
    let idx = 0
    stageTimerRef.current = setInterval(() => {
      idx = Math.min(idx + 1, STEPS.length - 1)
      setCurrentStep(idx)
      setProgress(STEPS[idx].progress)
    }, 1800)

    try {
      const result =
        aiMode === 'demo'
          ? testMode === 'ab'
            ? await analyzeABDesignDemo(variants, personas, abConfig)
            : await analyzeDesignDemo(frames, personas, sourceType, figmaSource)
          : testMode === 'ab'
          ? await analyzeABDesign(apiKey, model, variants, personas, abConfig)
          : await analyzeDesign(apiKey, model, frames, personas)
      if (cancelledRef.current) return
      stopStageAnimation()

      const reportFrames = targetFrames

      const report: TestReport = {
        id: `report-${Date.now()}`,
        projectName: buildProjectName(reportFrames, testMode, abConfig, sourceType, figmaSource),
        createdAt: new Date(),
        sourceType,
        figmaSource: figmaSource ?? undefined,
        aiMode,
        testMode,
        personas,
        frames: reportFrames,
        variants: testMode === 'ab' ? variants : undefined,
        abConfig: testMode === 'ab' ? abConfig : undefined,
        abComparison: result.abComparison,
        axisScores: result.axisScores,
        findings: result.findings,
        taskMetrics: result.taskMetrics,
        overallSummary: result.overallSummary,
        walkthrough: result.walkthrough,
        frameChats: reportFrames.map((f) => ({ frameId: f.id, messages: [] })),
        feedbackThreads: [],
      }

      setProgress(100)
      setIsDone(true)
      setTimeout(() => {
        if (!cancelledRef.current) onComplete(report)
      }, 900)
    } catch (e) {
      if (cancelledRef.current) return
      stopStageAnimation()
      setError(e instanceof Error ? e.message : 'AI 분석에 실패했습니다.')
    }
  }, [
    abConfig,
    aiMode,
    apiKey,
    figmaSource,
    frames,
    model,
    personas,
    sourceType,
    testMode,
    variants,
    onComplete,
  ])

  useEffect(() => {
    cancelledRef.current = false
    const startTimer = setTimeout(() => {
      void run()
    }, 0)
    return () => {
      cancelledRef.current = true
      clearTimeout(startTimer)
      stopStageAnimation()
    }
  }, [run])

  /* ── 에러 화면 ── */
  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center p-8 bg-gray-50 min-h-full">
        <div className="w-full max-w-md space-y-5 text-center">
          <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto">
            <AlertTriangle className="w-6 h-6 text-red-600" />
          </div>
          <div className="space-y-1">
            <h2 className="text-sm font-semibold text-gray-900">분석에 실패했습니다</h2>
            <p className="text-xs text-gray-500 leading-relaxed">{error}</p>
          </div>
          <div className="flex items-center justify-center gap-2">
            <Button variant="outline" size="sm" onClick={onBack}>
              페르소나로 돌아가기
            </Button>
            <Button variant="outline" size="sm" onClick={onRequireKey}>
              키 변경
            </Button>
            <Button size="sm" onClick={run}>
              다시 시도
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex items-center justify-center p-8 bg-gray-50 min-h-full">
      <div className="w-full max-w-lg space-y-6">
        {/* 헤더 영역 */}
        <div className="flex items-center gap-3">
          {isDone ? (
            <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
              <Check className="w-4 h-4 text-green-600" />
            </div>
          ) : (
            <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
              <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />
            </div>
          )}
          <div>
            <h2 className="text-sm font-semibold text-gray-900">
              {isDone ? '분석 완료' : 'AI 테스트 실행 중'}
            </h2>
            <p className="text-xs text-gray-500">
              {isDone
                ? '리포트를 불러오는 중입니다...'
                : aiMode === 'demo'
                ? '샘플 리포트를 생성하고 있습니다'
                : '페르소나가 시안을 직접 사용하며 UX를 분석하고 있습니다'}
            </p>
          </div>
        </div>

        {/* 진행률 */}
        <div className="space-y-1.5">
          <div className="flex justify-between items-center">
            <span className="text-xs text-gray-500">전체 진행률</span>
            <span className="text-xs font-semibold text-blue-600">{progress}%</span>
          </div>
          <Progress value={progress} className="h-2" />
        </div>

        {/* 단계 리스트 */}
        <div className="border border-gray-200 rounded-md bg-white overflow-hidden">
          {STEPS.map((step, index) => {
            const isCompleted = index < currentStep || isDone
            const isCurrent = index === currentStep && !isDone
            return (
              <div
                key={index}
                className={`flex items-center gap-3 px-4 py-3 text-sm transition-colors ${
                  index !== 0 ? 'border-t border-gray-100' : ''
                } ${isCurrent ? 'bg-blue-50' : ''}`}
              >
                <span className="flex-shrink-0">
                  {isCompleted ? (
                    <div className="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center">
                      <Check className="w-3 h-3 text-white" />
                    </div>
                  ) : isCurrent ? (
                    <div className="w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center">
                      <Loader2 className="w-3 h-3 text-white animate-spin" />
                    </div>
                  ) : (
                    <div className="w-5 h-5 rounded-full bg-gray-100 flex items-center justify-center">
                      <Circle className="w-3 h-3 text-gray-300" />
                    </div>
                  )}
                </span>
                <span
                  className={`text-sm ${
                    isCompleted
                      ? 'text-green-700'
                      : isCurrent
                      ? 'text-blue-700 font-medium'
                      : 'text-gray-400'
                  }`}
                >
                  {isCompleted && !isCurrent
                    ? step.label.replace('중', '') + ' 완료'
                    : step.label + (isCurrent ? '...' : '')}
                </span>
              </div>
            )
          })}
        </div>

        {/* 테스트 정보 */}
        <div className="grid grid-cols-2 gap-4">
          <div className="border border-gray-200 rounded-md bg-white p-3">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
              테스트 페르소나
            </p>
            <div className="space-y-1.5">
              {personas.length > 0 ? (
                personas.map((p) => (
                  <div key={p.id} className="flex items-center gap-2">
                    <span className="text-xs font-medium text-gray-700">{p.name}</span>
                    <span className="text-xs text-gray-400">{p.role}</span>
                    <span className="text-xs text-gray-400">· {DEVICE_LABEL[p.device] ?? p.device}</span>
                  </div>
                ))
              ) : (
                <p className="text-xs text-gray-400">페르소나 없음</p>
              )}
            </div>
          </div>

          <div className="border border-gray-200 rounded-md bg-white p-3">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
              분석 대상 화면
            </p>
            <div className="flex items-center gap-2">
              <span className="text-2xl font-bold text-blue-600">
                {testMode === 'ab'
                  ? variants.reduce((sum, variant) => sum + variant.frames.length, 0)
                  : frames.length}
              </span>
              <span className="text-xs text-gray-500">개 화면</span>
            </div>
            {testMode === 'ab' && (
              <p className="text-xs text-gray-400 mt-1">
                A안 {variants.find((variant) => variant.id === 'A')?.frames.length ?? 0}개 · B안{' '}
                {variants.find((variant) => variant.id === 'B')?.frames.length ?? 0}개
              </p>
            )}
          </div>
        </div>

        <p className="text-xs text-gray-400 text-center">
          {testMode === 'ab'
            ? `${aiMode === 'demo' ? '샘플 모드' : 'Gemini'}가 같은 페르소나 기준으로 A안과 B안을 비교 평가합니다`
            : `${aiMode === 'demo' ? '샘플 모드' : 'Gemini'}가 각 페르소나 관점에서 6축 UX 기준을 평가합니다`}
        </p>
      </div>
    </div>
  )
}
