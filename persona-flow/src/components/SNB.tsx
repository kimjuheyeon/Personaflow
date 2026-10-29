import {
  Bot,
  Check,
  FileText,
  History,
  KeyRound,
  Route,
  RotateCcw,
  Settings,
  Upload,
  Users,
  CircleHelp,
  PlayCircle,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { MODEL_OPTIONS } from '@/lib/ai/keyStore'
import { cn } from '@/lib/utils'
import type { AppStep, TestReport } from '@/types'

type StepStatus = 'completed' | 'current' | 'future'

interface NavigationStep {
  id: AppStep
  label: string
  description: string
  icon: LucideIcon
}

interface SNBProps {
  currentStep: AppStep
  onReset: () => void
  hasKey: boolean
  model: string
  onOpenKey: () => void
  history: TestReport[]
  currentReportId?: string
  onOpenReport: (report: TestReport) => void
  onOpenGuide: () => void
  onOpenDemo: () => void
}

const NAVIGATION_STEPS: NavigationStep[] = [
  {
    id: 'upload',
    label: '테스트 소스',
    description: 'Figma 프레임 연결',
    icon: Upload,
  },
  {
    id: 'flow',
    label: '미션과 Flow',
    description: '진입점과 성공 조건',
    icon: Route,
  },
  {
    id: 'persona',
    label: '페르소나 설정',
    description: '대상 사용자 정의',
    icon: Users,
  },
  {
    id: 'running',
    label: 'AI 테스트 실행',
    description: '탐색 흐름 분석',
    icon: Bot,
  },
  {
    id: 'report',
    label: '리포트 확인',
    description: '결과와 피드백',
    icon: FileText,
  },
]

function getStepStatus(currentStep: AppStep, index: number): StepStatus {
  const currentIndex = NAVIGATION_STEPS.findIndex((step) => step.id === currentStep)

  if (currentStep === 'report') return 'completed'
  if (index < currentIndex) return 'completed'
  if (index === currentIndex) return 'current'
  return 'future'
}

function formatCreatedAt(createdAt: Date): string {
  return new Intl.DateTimeFormat('ko-KR', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(createdAt)
}

function getFeedbackCount(report: TestReport): number {
  return (
    report.feedbackThreads?.reduce(
      (count, thread) => count + thread.messages.length,
      0
    ) ?? 0
  )
}

export default function SNB({
  currentStep,
  onReset,
  hasKey,
  model,
  onOpenKey,
  history,
  currentReportId,
  onOpenReport,
  onOpenGuide,
  onOpenDemo,
}: SNBProps) {
  const modelLabel = MODEL_OPTIONS.find((option) => option.id === model)?.label ?? model

  return (
    <aside className="flex min-h-screen w-[264px] flex-shrink-0 flex-col bg-slate-950 text-slate-200">
      <div className="border-b border-white/10 px-5 py-5">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-blue-500/15 text-blue-200">
            <Bot className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold tracking-tight text-white">
              PersonaFlow
            </p>
            <p className="mt-0.5 truncate text-[11px] text-slate-400">
              AI UX test workspace
            </p>
          </div>
        </div>
      </div>

      {currentStep !== 'upload' && (
        <div className="px-4 pt-4">
          <button
            type="button"
            onClick={onReset}
            className="flex h-9 w-full items-center gap-2 rounded-md border border-white/10 bg-white/[0.03] px-3 text-left text-xs font-medium text-slate-300 transition-colors hover:border-white/15 hover:bg-white/[0.06] hover:text-white"
          >
            <RotateCcw className="h-3.5 w-3.5 flex-shrink-0" />
            새 테스트 시작
          </button>
        </div>
      )}

      <nav className="flex-1 overflow-y-auto px-4 py-5" aria-label="서비스 단계">
        <p className="px-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          Progress
        </p>
        <ol className="mt-3 space-y-1">
          {NAVIGATION_STEPS.map((step, index) => {
            const status = getStepStatus(currentStep, index)
            const Icon = step.icon

            return (
              <li key={step.id}>
                <div
                  aria-current={status === 'current' ? 'step' : undefined}
                  className={cn(
                    'grid grid-cols-[24px_1fr] gap-3 rounded-md px-3 py-2.5 transition-colors',
                    status === 'current'
                      ? 'border border-blue-500 bg-blue-500/15 text-white shadow-sm'
                      : 'text-slate-400',
                    status === 'completed' && 'text-slate-300'
                  )}
                >
                  <span
                    className={cn(
                      'mt-0.5 flex h-5 w-5 items-center justify-center rounded-full',
                      status === 'completed' && 'bg-emerald-500/15 text-emerald-300',
                      status === 'current' && 'bg-blue-600 text-white',
                      status === 'future' && 'bg-slate-800 text-slate-300'
                    )}
                  >
                    {status === 'completed' ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : (
                      <Icon className="h-3.5 w-3.5" />
                    )}
                  </span>
                  <span className="min-w-0">
                    <span
                      className={cn(
                        'block truncate text-sm font-semibold',
                        status === 'current' ? 'text-white' : 'text-inherit'
                      )}
                    >
                      {step.label}
                    </span>
                    <span
                      className={cn(
                        'mt-0.5 block truncate text-[11px]',
                        status === 'current' ? 'text-blue-200' : 'text-slate-400'
                      )}
                    >
                      {step.description}
                    </span>
                  </span>
                </div>
                {index < NAVIGATION_STEPS.length - 1 && (
                  <div className="ml-[22px] h-2 w-px bg-white/10" />
                )}
              </li>
            )
          })}
        </ol>

        <div className="mt-7">
          <div className="mb-3 flex items-center gap-2 px-1">
            <History className="h-3.5 w-3.5 text-slate-400" />
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Test history
            </p>
          </div>

          {history.length === 0 ? (
            <div className="rounded-md border border-dashed border-white/10 px-3 py-3">
              <p className="text-xs text-slate-400">저장된 테스트 없음</p>
            </div>
          ) : (
            <ul className="space-y-1.5">
              {history.slice(0, 6).map((report) => {
                const isActive = currentStep === 'report' && currentReportId === report.id
                const feedbackCount = getFeedbackCount(report)

                return (
                  <li key={report.id}>
                    <button
                      type="button"
                      onClick={() => onOpenReport(report)}
                      className={cn(
                        'w-full rounded-md border px-3 py-2 text-left transition-colors',
                        isActive
                          ? 'border-blue-300/30 bg-blue-500/15 text-white'
                          : 'border-transparent text-slate-400 hover:border-white/10 hover:bg-white/[0.04] hover:text-white'
                      )}
                    >
                      <span className="block truncate text-xs font-semibold">
                        {report.projectName}
                      </span>
                      <span className="mt-1 flex items-center gap-1.5 text-[10px] text-slate-400">
                        {report.flowResult && (
                          <span className="rounded-sm bg-blue-400/10 px-1.5 py-0.5 font-semibold text-blue-300">
                            FLOW
                          </span>
                        )}
                        <span className="min-w-0 truncate">
                          {formatCreatedAt(report.createdAt)} · 피드백 {feedbackCount}개
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </nav>

      <div className="space-y-1 px-4 pb-3">
        {/* 키 없이 제품 전체를 볼 수 있는 경로. 처음 온 사람이 가장 먼저 누를 수 있어야 한다. */}
        <button
          type="button"
          onClick={onOpenDemo}
          className="flex h-9 w-full items-center gap-2 rounded-md border border-white/10 bg-white/[0.03] px-3 text-left text-xs font-medium text-slate-300 transition-colors hover:border-white/15 hover:bg-white/[0.06] hover:text-white"
        >
          <PlayCircle className="h-3.5 w-3.5 flex-shrink-0" />
          샘플 리포트 보기
        </button>
        <button
          type="button"
          onClick={onOpenGuide}
          className="flex h-9 w-full items-center gap-2 rounded-md px-3 text-left text-xs font-medium text-slate-400 transition-colors hover:bg-white/[0.04] hover:text-white"
        >
          <CircleHelp className="h-3.5 w-3.5" />
          사용 가이드
        </button>
      </div>

      <div className="border-t border-white/10 px-4 py-3">
        <button
          type="button"
          onClick={onOpenKey}
          className="grid w-full grid-cols-[18px_1fr_16px] items-center gap-2 rounded-md px-3 py-2 text-left text-xs text-slate-300 transition-colors hover:bg-white/[0.04] hover:text-white"
        >
          <KeyRound
            className={cn(
              'h-4 w-4',
              hasKey ? 'text-emerald-300' : 'text-red-300'
            )}
          />
          <span className="min-w-0">
            <span className="block truncate font-medium">
              {hasKey ? '실제 AI 연결됨' : 'Claude 브리지 미연결'}
            </span>
            {hasKey && (
              <span className="mt-0.5 block truncate text-[10px] text-slate-400">
                {modelLabel}
              </span>
            )}
          </span>
          <Settings className="h-3.5 w-3.5 text-slate-400" />
        </button>
      </div>

      <div className="border-t border-white/10 px-5 py-3">
        <p className="text-xs text-slate-400">PersonaFlow v0.2</p>
      </div>
    </aside>
  )
}
