import { useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ImageIcon,
  Plus,
  Route,
  Target,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  findShortestPath,
  getFlowFrameLabel,
  validateFlowConfig,
} from '@/lib/flow'
import { getFrameDisplayName } from '@/lib/frameNaming'
import type { FlowEdge, FlowTestConfig, Frame, StudyMode } from '@/types'

interface FlowSetupStepProps {
  frames: Frame[]
  config: FlowTestConfig
  onConfigChange: (config: FlowTestConfig) => void
  onBack: () => void
  onNext: () => void
}

function orderedFrames(frames: Frame[]): Frame[] {
  return [...frames].sort(
    (a, b) => (a.flowOrder ?? Number.MAX_SAFE_INTEGER) - (b.flowOrder ?? Number.MAX_SAFE_INTEGER)
  )
}

export default function FlowSetupStep({
  frames,
  config,
  onConfigChange,
  onBack,
  onNext,
}: FlowSetupStepProps) {
  const manualEdgeCounter = useRef(0)
  // 입력 중에는 자유롭게 지우고 쓰게 두고, 포커스를 벗어날 때 범위를 맞춘다.
  const [maxStepsDraft, setMaxStepsDraft] = useState(String(config.maxSteps))
  const sortedFrames = orderedFrames(frames)
  const issues = validateFlowConfig(config, sortedFrames)
  const shortestPath = findShortestPath(config)
  const canProceed = config.mode === 'screen' || issues.length === 0

  const updateMode = (mode: StudyMode) => {
    onConfigChange({ ...config, mode })
  }

  const updateEdge = (edgeId: string, patch: Partial<FlowEdge>) => {
    onConfigChange({
      ...config,
      edges: config.edges.map((edge) => (edge.id === edgeId ? { ...edge, ...patch } : edge)),
    })
  }

  const removeEdge = (edgeId: string) => {
    onConfigChange({
      ...config,
      edges: config.edges.filter((edge) => edge.id !== edgeId),
    })
  }

  const addEdge = () => {
    manualEdgeCounter.current += 1
    const fromFrameId = config.entryFrameId || sortedFrames[0]?.id || ''
    const toFrameId =
      sortedFrames.find((frame) => frame.id !== fromFrameId)?.id || config.successFrameId
    onConfigChange({
      ...config,
      edges: [
        ...config.edges,
        {
          id: `edge-manual-${manualEdgeCounter.current}`,
          fromFrameId,
          toFrameId,
          actionLabel: '',
        },
      ],
    })
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">
          Flow definition
        </p>
        <h2 className="mt-1 text-xl font-semibold tracking-tight text-gray-950">
          어떤 과업을 검증할까요?
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          화면 평가보다 먼저 사용자의 진입점, 미션, 성공 조건을 정의합니다.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <button
          type="button"
          onClick={() => updateMode('flow')}
          className={`rounded-lg border p-4 text-left transition-colors ${
            config.mode === 'flow'
              ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500'
              : 'border-gray-200 bg-white hover:border-gray-300'
          }`}
        >
          <span className="flex items-start gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-md bg-blue-600 text-white">
              <Route className="h-4.5 w-4.5" />
            </span>
            <span>
              <span className="block text-sm font-semibold text-gray-950">Flow UT</span>
              <span className="mt-1 block text-xs leading-relaxed text-gray-500">
                진입점부터 성공 지점까지 페르소나의 선택과 이탈을 검증합니다.
              </span>
            </span>
          </span>
        </button>
        <button
          type="button"
          onClick={() => updateMode('screen')}
          className={`rounded-lg border p-4 text-left transition-colors ${
            config.mode === 'screen'
              ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500'
              : 'border-gray-200 bg-white hover:border-gray-300'
          }`}
        >
          <span className="flex items-start gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-md bg-slate-900 text-white">
              <ImageIcon className="h-4.5 w-4.5" />
            </span>
            <span>
              <span className="block text-sm font-semibold text-gray-950">빠른 화면 리뷰</span>
              <span className="mt-1 block text-xs leading-relaxed text-gray-500">
                기존 방식으로 화면별 명료성, 카피, 휴리스틱을 빠르게 점검합니다.
              </span>
            </span>
          </span>
        </button>
      </div>

      {config.mode === 'screen' ? (
        <div className="rounded-lg border border-gray-200 bg-white p-6">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-600" />
            <div>
              <h3 className="text-sm font-semibold text-gray-900">빠른 화면 리뷰 준비 완료</h3>
              <p className="mt-1 text-xs leading-relaxed text-gray-500">
                가져온 {frames.length}개 화면을 현재 순서대로 분석합니다. 전체 과업의 성공률이나
                이탈 경로보다 화면별 문제 발견에 적합합니다.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="grid gap-5 rounded-lg border border-gray-200 bg-white p-5 shadow-sm lg:grid-cols-[1.2fr_0.8fr]">
            <section className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="flow-title" className="text-xs font-semibold text-gray-700">
                  테스트명 <span className="font-normal text-gray-400">(선택 · 비우면 미션으로 이름을 정합니다)</span>
                </Label>
                <Input
                  id="flow-title"
                  value={config.title}
                  onChange={(event) => onConfigChange({ ...config, title: event.target.value })}
                  placeholder="예: 첫 사용자 프로젝트 생성 Flow"
                  className="h-10"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="flow-scenario" className="text-xs font-semibold text-gray-700">
                  사용자 시나리오 <span className="font-normal text-gray-400">(선택)</span>
                </Label>
                <Textarea
                  id="flow-scenario"
                  value={config.scenario}
                  onChange={(event) => onConfigChange({ ...config, scenario: event.target.value })}
                  placeholder="예: 처음 서비스를 방문했고 팀의 새 프로젝트를 만들어야 합니다."
                  className="min-h-20 resize-none text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="flow-mission" className="text-xs font-semibold text-gray-700">
                  수행 미션 <span className="text-red-500">*</span>
                </Label>
                <Textarea
                  id="flow-mission"
                  value={config.mission}
                  onChange={(event) => onConfigChange({ ...config, mission: event.target.value })}
                  placeholder="예: 새 프로젝트를 만들고 첫 번째 테스트를 시작해보세요."
                  className="min-h-20 resize-none text-sm"
                />
                <p className="text-[11px] text-gray-400">
                  버튼명이나 정답 경로를 미션에 직접 노출하지 않는 것이 좋습니다.
                </p>
              </div>
            </section>

            <aside className="space-y-4 rounded-md border border-gray-200 bg-gray-50 p-4">
              <div className="space-y-1.5">
                <Label htmlFor="entry-frame" className="text-xs font-semibold text-gray-700">
                  진입 화면
                </Label>
                <select
                  id="entry-frame"
                  value={config.entryFrameId}
                  onChange={(event) =>
                    onConfigChange({ ...config, entryFrameId: event.target.value })
                  }
                  className="h-10 w-full rounded-md border border-gray-200 bg-white px-3 text-sm text-gray-800 outline-none focus:border-blue-500"
                >
                  {sortedFrames.map((frame) => (
                    <option key={frame.id} value={frame.id}>
                      {getFrameDisplayName(frame)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="success-frame" className="text-xs font-semibold text-gray-700">
                  성공 화면
                </Label>
                <select
                  id="success-frame"
                  value={config.successFrameId}
                  onChange={(event) =>
                    onConfigChange({ ...config, successFrameId: event.target.value })
                  }
                  className="h-10 w-full rounded-md border border-gray-200 bg-white px-3 text-sm text-gray-800 outline-none focus:border-blue-500"
                >
                  {sortedFrames.map((frame) => (
                    <option key={frame.id} value={frame.id}>
                      {getFrameDisplayName(frame)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="max-steps" className="text-xs font-semibold text-gray-700">
                  최대 행동 단계
                </Label>
                <Input
                  id="max-steps"
                  type="number"
                  min={2}
                  max={20}
                  value={maxStepsDraft}
                  onChange={(event) => setMaxStepsDraft(event.target.value)}
                  onBlur={() => {
                    const maxSteps = Math.max(2, Math.min(20, Number(maxStepsDraft) || config.maxSteps))
                    setMaxStepsDraft(String(maxSteps))
                    onConfigChange({ ...config, maxSteps })
                  }}
                  className="h-10 bg-white"
                />
              </div>
              <div className="rounded-md border border-blue-100 bg-blue-50 p-3">
                <p className="text-[11px] font-semibold text-blue-900">성공 기준</p>
                <p className="mt-1 text-xs leading-relaxed text-blue-800">
                  테스터가 {getFlowFrameLabel(sortedFrames, config.successFrameId)}에 도달하면
                  과업 성공으로 판정합니다.
                </p>
              </div>
            </aside>
          </div>

          <section className="space-y-4 rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">
                  화면 연결 <span className="text-red-500">*</span>
                </h3>
                <p className="mt-1 text-xs text-gray-500">
                  각 화면에서 무엇을 누르면 다음 화면으로 가는지 적어주세요. AI 페르소나에게는
                  보여주지 않고, 테스트가 끝난 뒤 실제 행동과 비교하는 정답지로만 씁니다.
                </p>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={addEdge}>
                <Plus className="h-3.5 w-3.5" />
                연결 추가
              </Button>
            </div>

            <div className="overflow-x-auto pb-2">
              <div className="flex min-w-max items-center gap-2">
                {sortedFrames.map((frame) => {
                  const isEntry = frame.id === config.entryFrameId
                  const isSuccess = frame.id === config.successFrameId
                  const isOnPath = shortestPath.includes(frame.id)
                  return (
                    <div key={frame.id} className="flex items-center gap-2">
                      <div
                        className={`w-44 overflow-hidden rounded-md border bg-white ${
                          isEntry
                            ? 'border-blue-500 ring-1 ring-blue-500'
                            : isSuccess
                            ? 'border-emerald-500 ring-1 ring-emerald-500'
                            : isOnPath
                            ? 'border-gray-300'
                            : 'border-dashed border-gray-200 opacity-60'
                        }`}
                      >
                        <div className="aspect-[16/10] bg-gray-100">
                          {frame.imageUrl ? (
                            <img
                              src={frame.imageUrl}
                              alt=""
                              className="h-full w-full object-cover object-top"
                            />
                          ) : (
                            <div className="flex h-full items-center justify-center text-gray-300">
                              <ImageIcon className="h-5 w-5" />
                            </div>
                          )}
                        </div>
                        <div className="p-2.5">
                          <div className="flex items-center gap-1.5">
                            {isEntry && (
                              <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">
                                시작
                              </span>
                            )}
                            {isSuccess && (
                              <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                                성공
                              </span>
                            )}
                          </div>
                          <p className="mt-1 truncate text-xs font-semibold text-gray-800">
                            {getFrameDisplayName(frame)}
                          </p>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="space-y-2">
              <div className="hidden grid-cols-[1fr_28px_1fr_1.3fr_36px] gap-2 px-2.5 text-[11px] font-semibold text-gray-400 md:grid">
                <span>이 화면에서</span>
                <span />
                <span>이동하는 화면</span>
                <span>누르는 요소</span>
                <span />
              </div>
              {config.edges.map((edge) => (
                <div
                  key={edge.id}
                  className="grid gap-2 rounded-md border border-gray-200 bg-gray-50 p-2.5 md:grid-cols-[1fr_28px_1fr_1.3fr_36px] md:items-center"
                >
                  <select
                    aria-label="출발 화면"
                    value={edge.fromFrameId}
                    onChange={(event) => updateEdge(edge.id, { fromFrameId: event.target.value })}
                    className="h-9 rounded-md border border-gray-200 bg-white px-2 text-xs"
                  >
                    {sortedFrames.map((frame) => (
                      <option key={frame.id} value={frame.id}>
                        {getFrameDisplayName(frame)}
                      </option>
                    ))}
                  </select>
                  <ArrowRight className="mx-auto hidden h-4 w-4 text-gray-400 md:block" />
                  <select
                    aria-label="도착 화면"
                    value={edge.toFrameId}
                    onChange={(event) => updateEdge(edge.id, { toFrameId: event.target.value })}
                    className="h-9 rounded-md border border-gray-200 bg-white px-2 text-xs"
                  >
                    {sortedFrames.map((frame) => (
                      <option key={frame.id} value={frame.id}>
                        {getFrameDisplayName(frame)}
                      </option>
                    ))}
                  </select>
                  <Input
                    aria-label="누르는 요소"
                    value={edge.actionLabel}
                    onChange={(event) => updateEdge(edge.id, { actionLabel: event.target.value })}
                    placeholder="예: '새 프로젝트' 버튼"
                    className={`h-9 bg-white text-xs ${edge.actionLabel.trim() ? '' : 'border-amber-400'}`}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => removeEdge(edge.id)}
                    className="h-9 w-9 text-gray-400 hover:text-red-600"
                    aria-label="연결 삭제"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          </section>

          <section
            className={`rounded-lg border p-4 ${
              issues.length === 0
                ? 'border-emerald-200 bg-emerald-50'
                : 'border-amber-200 bg-amber-50'
            }`}
          >
            <div className="flex items-start gap-3">
              {issues.length === 0 ? (
                <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-600" />
              ) : (
                <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-600" />
              )}
              <div>
                <p
                  className={`text-sm font-semibold ${
                    issues.length === 0 ? 'text-emerald-900' : 'text-amber-900'
                  }`}
                >
                  {issues.length === 0 ? 'Flow UT 준비 완료' : `확인할 항목 ${issues.length}개`}
                </p>
                {issues.length === 0 ? (
                  <p className="mt-1 text-xs text-emerald-800">
                    시작부터 성공 지점까지 {Math.max(0, shortestPath.length - 1)}단계 경로를
                    확인했습니다.
                  </p>
                ) : (
                  <ul className="mt-2 space-y-1 text-xs text-amber-800">
                    {issues.map((issue) => (
                      <li key={issue}>· {issue}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </section>
        </>
      )}

      <div className="flex items-center justify-between">
        <Button variant="outline" size="sm" onClick={onBack}>
          이전
        </Button>
        <Button size="sm" onClick={onNext} disabled={!canProceed} className="h-10 px-6">
          페르소나 설정
          <Target className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  )
}
