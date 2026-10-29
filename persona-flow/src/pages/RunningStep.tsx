import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Check, Circle, AlertTriangle } from 'lucide-react'
import { Progress } from '@/components/ui/progress'
import { Button } from '@/components/ui/button'
import { analyzeABDesignDemo, analyzeDesignDemo, analyzeFlowDesignDemo } from '@/lib/ai/demo'
import { analyzeABDesign, analyzeDesign, analyzeFlowDesign } from '@/lib/ai/claude'
import { formatWait, isAbortError } from '@/lib/ai/retry'
import { getFrameProjectLabel } from '@/lib/frameNaming'
import type {
  ABTestConfig,
  AIMode,
  AnalysisCheckpoint,
  AnalysisProgress,
  AnalysisRunContext,
  AnalysisStage,
  DesignVariant,
  FigmaSource,
  FlowTestConfig,
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
  flowConfig: FlowTestConfig
  sourceType: SourceType
  figmaSource: FigmaSource | null
  aiMode: AIMode
  accessCode: string
  aiReady: boolean
  model: string
  onComplete: (report: TestReport) => void
  onBack: () => void
  onRequireKey: () => void
}

/**
 * 진행 단계 정의.
 * weight는 전체 진행률에서 이 단계가 차지하는 비중이다.
 * 실제 호출 완료 수로 계산하므로, 화면이 많으면 판독 단계가 길게 머문다 —
 * 그게 사실이기 때문이다.
 */
interface StageSpec {
  stage: AnalysisStage
  label: string
  weight: number
}

const STEPS: StageSpec[] = [
  { stage: 'observe', label: '화면 판독 중', weight: 55 },
  { stage: 'analyze', label: '6축 UX 평가 및 근거 검증 중', weight: 45 },
]

const FLOW_STEPS: StageSpec[] = [
  { stage: 'observe', label: '화면 판독 중 (관찰기)', weight: 42 },
  { stage: 'test', label: '설계 의도를 가린 채 미션 수행 중 (페르소나 테스터)', weight: 33 },
  { stage: 'judge', label: '실제 행동과 설계 의도 대조 중 (판정기)', weight: 3 },
  { stage: 'analyze', label: '판정 결과로 UX 문제 도출 중 (분석기)', weight: 22 },
]

/** 완료된 단계 비중 + 현재 단계의 부분 진행으로 전체 진행률을 만든다. */
function computeProgress(specs: StageSpec[], progress: AnalysisProgress | null): number {
  if (!progress) return 0
  const index = specs.findIndex((spec) => spec.stage === progress.stage)
  if (index < 0) return 0
  const done = specs.slice(0, index).reduce((sum, spec) => sum + spec.weight, 0)
  const ratio = progress.total > 0 ? Math.min(1, progress.completed / progress.total) : 0
  return Math.min(99, Math.round(done + specs[index].weight * ratio))
}

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
  figmaSource: FigmaSource | null,
  flowConfig: FlowTestConfig
): string {
  if (testMode === 'ab') {
    const goal = abConfig.goal.trim()
    if (sourceType === 'figma') {
      const label = goal || figmaSource?.fileName || 'Figma'
      return `Figma A/B 테스트 · ${label}`
    }
    return goal ? `A/B 테스트 · ${goal}` : '화면 A/B 테스트'
  }
  if (flowConfig.mode === 'flow') {
    return flowConfig.title.trim() || `Flow UT · ${flowConfig.mission.trim() || '사용자 미션'}`
  }
  if (sourceType === 'figma') {
    return figmaSource?.fileName
      ? `Figma 플로우 · ${figmaSource.fileName}`
      : 'Figma 플로우 테스트'
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
  flowConfig,
  sourceType,
  figmaSource,
  aiMode,
  accessCode,
  aiReady,
  model,
  onComplete,
  onBack,
  onRequireKey,
}: RunningStepProps) {
  const isFlowTest = testMode === 'single' && flowConfig.mode === 'flow'
  const stageSteps = isFlowTest ? FLOW_STEPS : STEPS
  const [isDone, setIsDone] = useState(false)
  const [progressState, setProgressState] = useState<AnalysisProgress | null>(null)
  const [error, setError] = useState<string | null>(null)

  /**
   * 재시도해도 앞 단계를 다시 호출하지 않도록 체크포인트를 컴포넌트 수명 동안 유지한다.
   * "다시 시도"는 같은 컴포넌트에서 run()을 다시 부르므로 ref가 그대로 살아 있다.
   */
  const checkpointRef = useRef<AnalysisCheckpoint>({})
  const abortRef = useRef<AbortController | null>(null)

  const progress = computeProgress(stageSteps, progressState)
  const currentStep = progressState
    ? Math.max(0, stageSteps.findIndex((spec) => spec.stage === progressState.stage))
    : 0
  const retryNotice = progressState?.retry ?? null
  const resumedFromCheckpoint = Boolean(checkpointRef.current.observations)

  const run = useCallback(async () => {
    if (aiMode === 'claude' && !aiReady) {
      setError('Claude 연결이 필요합니다. 연결 설정을 확인한 뒤 다시 시도하세요.')
      return
    }

    const targetFrames =
      testMode === 'ab' ? variants.flatMap((variant) => variant.frames) : frames
    if (
      aiMode === 'claude' &&
      (targetFrames.length === 0 || !targetFrames.every(hasFrameImage))
    ) {
      setError(
        '실제 AI 분석에는 화면 이미지가 필요합니다. Figma 개인 액세스 토큰으로 화면 이미지를 가져오거나 PNG/JPG 이미지를 업로드한 뒤 다시 실행하세요.'
      )
      return
    }

    setError(null)
    setIsDone(false)
    setProgressState({ stage: stageSteps[0].stage, completed: 0, total: 0 })

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    const context: AnalysisRunContext = {
      signal: controller.signal,
      checkpoint: checkpointRef.current,
      onProgress: (next) => {
        if (controller.signal.aborted) return
        setProgressState(next)
      },
    }

    try {
      const result =
        testMode === 'ab'
          ? aiMode === 'demo'
            ? await analyzeABDesignDemo(variants, personas, abConfig)
            : await analyzeABDesign(accessCode, model, variants, personas, abConfig, context)
          : isFlowTest
          ? aiMode === 'demo'
            ? await analyzeFlowDesignDemo(frames, personas, flowConfig)
            : await analyzeFlowDesign(accessCode, model, frames, personas, flowConfig, context)
          : aiMode === 'demo'
          ? await analyzeDesignDemo(frames, personas, sourceType, figmaSource)
          : await analyzeDesign(accessCode, model, frames, personas, context)
      if (controller.signal.aborted) return

      const reportFrames = targetFrames

      const report: TestReport = {
        id: `report-${Date.now()}`,
        projectName: buildProjectName(
          reportFrames,
          testMode,
          abConfig,
          sourceType,
          figmaSource,
          flowConfig
        ),
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
        flowConfig: testMode === 'single' ? flowConfig : undefined,
        flowResult: result.flowResult,
        flowJudgment: result.flowJudgment,
        axisScores: result.axisScores,
        findings: result.findings,
        taskMetrics: result.taskMetrics,
        overallSummary: result.overallSummary,
        walkthrough: result.walkthrough,
        validation: result.validation,
        frameChats: reportFrames.map((f) => ({ frameId: f.id, messages: [] })),
        feedbackThreads: [],
      }

      setIsDone(true)
      setTimeout(() => {
        if (!controller.signal.aborted) onComplete(report)
      }, 900)
    } catch (e) {
      // 사용자가 화면을 벗어나 중단한 경우는 오류가 아니다.
      if (controller.signal.aborted || isAbortError(e)) return
      setError(e instanceof Error ? e.message : 'AI 분석에 실패했습니다.')
    }
  }, [
    abConfig,
    aiMode,
    accessCode,
    aiReady,
    figmaSource,
    flowConfig,
    frames,
    isFlowTest,
    model,
    personas,
    sourceType,
    testMode,
    variants,
    stageSteps,
    onComplete,
  ])

  useEffect(() => {
    const startTimer = setTimeout(() => {
      void run()
    }, 0)
    return () => {
      clearTimeout(startTimer)
      // 화면을 벗어나면 실제로 요청을 끊는다. 남은 할당량을 낭비하지 않기 위해서다.
      abortRef.current?.abort()
    }
  }, [run])

  /* ── 에러 화면 ── */
  if (error) {
    return (
      <div className="flex min-h-full flex-1 items-center justify-center bg-[#0b0b0c] p-10">
        <div className="w-full max-w-lg rounded-[24px] border border-white/10 bg-[#1c1c1e] p-10 text-center">
          <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto">
            <AlertTriangle className="w-6 h-6 text-red-600" />
          </div>
          <div className="space-y-1">
            <h2 className="text-[21px] font-semibold text-gray-900">분석에 실패했습니다</h2>
            <p className="mt-2 text-sm text-gray-500 leading-relaxed">{error}</p>
          </div>
          {resumedFromCheckpoint && (
            <p className="mt-3 rounded-[14px] bg-[#272729] px-4 py-3 text-xs leading-relaxed text-gray-500">
              이미 끝난 화면 판독 결과는 보관해 두었습니다. 다시 시도하면 그 단계는 건너뛰고
              실패한 지점부터 이어서 진행합니다.
            </p>
          )}
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button variant="outline" size="sm" onClick={onBack}>
              페르소나로 돌아가기
            </Button>
            <Button variant="outline" size="sm" onClick={onRequireKey}>
              연결 설정
            </Button>
            <Button size="sm" onClick={run}>
              {resumedFromCheckpoint ? '이어서 다시 시도' : '다시 시도'}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-full flex-1 items-center justify-center bg-[#0b0b0c] p-10">
      <div className="w-full max-w-2xl space-y-8 rounded-[24px] border border-white/10 bg-[#1c1c1e] p-10">
        {/* 헤더 영역 */}
        <div className="flex items-center gap-3">
          {isDone ? (
            <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-green-500/15">
              <Check className="w-4 h-4 text-green-600" />
            </div>
          ) : (
            <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-blue-500/15">
              <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />
            </div>
          )}
          <div>
            <h2 className="text-[21px] font-semibold text-gray-900">
              {isDone ? '분석 완료' : 'AI 테스트 실행 중'}
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              {isDone
                ? '리포트를 불러오는 중입니다...'
                : isFlowTest
                ? '페르소나가 진입점에서 미션을 수행하며 행동 경로를 기록하고 있습니다'
                : '페르소나가 시안을 직접 사용하며 UX를 분석하고 있습니다'}
            </p>
          </div>
        </div>

        {/* 진행률 — 실제 호출 완료 수로 계산한다 */}
        <div className="space-y-1.5">
          <div className="flex justify-between items-center">
            <span className="text-xs text-gray-500">
              전체 진행률
              {progressState && progressState.total > 1 && (
                <span className="ml-1.5 text-gray-400">
                  · 화면 {progressState.completed}/{progressState.total} 묶음 판독
                </span>
              )}
            </span>
            <span className="text-xs font-semibold text-blue-600">
              {isDone ? 100 : progress}%
            </span>
          </div>
          <Progress value={isDone ? 100 : progress} className="h-2" />
        </div>

        {/* 재시도 대기 — 멈춘 것처럼 보이지 않도록 이유를 밝힌다 */}
        {retryNotice && !isDone && (
          <div className="flex items-start gap-2.5 rounded-[14px] border border-amber-200 bg-amber-50 px-4 py-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-700" />
            <div className="min-w-0">
              <p className="text-xs font-medium text-amber-900">
                {formatWait(retryNotice.waitMs)} 뒤 다시 시도합니다 ({retryNotice.attempt}/
                {retryNotice.maxAttempts})
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-gray-500">
                {retryNotice.reason} 여기까지의 결과는 보관되어 있어 처음부터 다시 하지 않습니다.
              </p>
            </div>
          </div>
        )}

        {/* 단계 리스트 */}
        <div className="overflow-hidden rounded-[18px] border border-white/10 bg-[#272729]">
          {stageSteps.map((step, index) => {
            const isCompleted = index < currentStep || isDone
            const isCurrent = index === currentStep && !isDone
            return (
              <div
                key={index}
                className={`flex items-center gap-3 px-4 py-3 text-sm transition-colors ${
                  index !== 0 ? 'border-t border-white/8' : ''
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
                  {isCurrent && retryNotice && (
                    <span className="ml-1.5 text-amber-700">재시도 대기 중</span>
                  )}
                </span>
              </div>
            )
          })}
        </div>

        {/* 테스트 정보 */}
        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-[18px] border border-white/10 bg-[#272729] p-5">
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

          <div className="rounded-[18px] border border-white/10 bg-[#272729] p-5">
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
            ? 'Claude가 같은 페르소나 기준으로 A안과 B안을 비교 평가합니다'
            : isFlowTest
            ? 'Claude가 설정된 행동 연결 안에서 각 페르소나의 미션 수행 경로를 평가합니다'
            : 'Claude가 각 페르소나 관점에서 6축 UX 기준을 평가합니다'}
        </p>
      </div>
    </div>
  )
}
