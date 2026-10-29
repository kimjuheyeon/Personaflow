import { getFrameDisplayName } from '@/lib/frameNaming'
import type {
  FlowEdge,
  FlowFriction,
  FlowMetrics,
  FlowRun,
  FlowTestConfig,
  FlowTestResult,
  Frame,
} from '@/types'

function orderedFrames(frames: Frame[]): Frame[] {
  return [...frames].sort(
    (a, b) => (a.flowOrder ?? Number.MAX_SAFE_INTEGER) - (b.flowOrder ?? Number.MAX_SAFE_INTEGER)
  )
}

/**
 * 프로토타입 연결이 없을 때의 기본 연결.
 * 판정기는 페르소나가 고른 요소를 이 문구와 비교하므로, 의미 없는 기본 문구를 채우지 않고
 * 디자이너가 직접 입력하게 비워 둔다.
 */
function makeSequentialEdges(frames: Frame[]): FlowEdge[] {
  const ordered = orderedFrames(frames)
  return ordered.slice(0, -1).map((frame, index) => ({
    id: `edge-${frame.id}-${ordered[index + 1].id}`,
    fromFrameId: frame.id,
    toFrameId: ordered[index + 1].id,
    actionLabel: '',
  }))
}

function makePrototypeEdges(frames: Frame[]): FlowEdge[] {
  const frameByNodeId = new Map(
    frames.flatMap((frame) =>
      frame.figmaNodeId ? [[frame.figmaNodeId, frame] as const] : []
    )
  )
  const seen = new Set<string>()
  const edges: FlowEdge[] = []

  for (const frame of frames) {
    for (const transition of frame.designContext?.prototypeTransitions ?? []) {
      const target = transition.destinationNodeId
        ? frameByNodeId.get(transition.destinationNodeId)
        : undefined
      if (!target || target.id === frame.id) continue
      const key = `${frame.id}|${target.id}|${transition.sourceNodeName}`
      if (seen.has(key)) continue
      seen.add(key)
      edges.push({
        id: `prototype-${frame.id}-${target.id}-${edges.length + 1}`,
        fromFrameId: frame.id,
        toFrameId: target.id,
        actionLabel: transition.sourceNodeName || transition.trigger || '다음 화면으로 이동한다',
      })
    }
  }

  return edges
}

function preferredEdges(frames: Frame[]): FlowEdge[] {
  const prototypeEdges = makePrototypeEdges(frames)
  return prototypeEdges.length > 0 ? prototypeEdges : makeSequentialEdges(frames)
}

export function createDefaultFlowConfig(frames: Frame[]): FlowTestConfig {
  const ordered = orderedFrames(frames)
  return {
    mode: 'flow',
    title: '',
    scenario: '',
    mission: '',
    entryFrameId: ordered[0]?.id ?? '',
    successFrameId: ordered[ordered.length - 1]?.id ?? '',
    expectedPathFrameIds: ordered.map((frame) => frame.id),
    edges: preferredEdges(ordered),
    maxSteps: Math.max(6, ordered.length + 2),
  }
}

export function syncFlowConfig(config: FlowTestConfig, frames: Frame[]): FlowTestConfig {
  const ordered = orderedFrames(frames)
  const validIds = new Set(ordered.map((frame) => frame.id))
  const validEdges = config.edges.filter(
    (edge) =>
      validIds.has(edge.fromFrameId) &&
      validIds.has(edge.toFrameId) &&
      edge.fromFrameId !== edge.toFrameId
  )
  const expectedPath = config.expectedPathFrameIds.filter((id) => validIds.has(id))

  return {
    ...config,
    entryFrameId: validIds.has(config.entryFrameId)
      ? config.entryFrameId
      : ordered[0]?.id ?? '',
    successFrameId: validIds.has(config.successFrameId)
      ? config.successFrameId
      : ordered[ordered.length - 1]?.id ?? '',
    expectedPathFrameIds:
      expectedPath.length >= 2 ? expectedPath : ordered.map((frame) => frame.id),
    edges: validEdges.length > 0 ? validEdges : preferredEdges(ordered),
    maxSteps: Math.max(config.maxSteps, ordered.length),
  }
}

/** 판정기가 쓰는 기대 경로를 현재 연결 기준의 최단 경로로 맞춘다. */
export function withExpectedPath(config: FlowTestConfig): FlowTestConfig {
  const path = findShortestPath(config)
  return path.length >= 2 ? { ...config, expectedPathFrameIds: path } : config
}

export function getFlowFrameLabel(frames: Frame[], frameId: string): string {
  const frame = frames.find((item) => item.id === frameId)
  return frame ? getFrameDisplayName(frame) : frameId || '선택 안 됨'
}

export function findShortestPath(config: FlowTestConfig): string[] {
  if (!config.entryFrameId || !config.successFrameId) return []
  if (config.entryFrameId === config.successFrameId) return [config.entryFrameId]

  const queue: string[][] = [[config.entryFrameId]]
  const visited = new Set<string>([config.entryFrameId])

  while (queue.length > 0) {
    const path = queue.shift()
    if (!path) break
    const current = path[path.length - 1]
    for (const edge of config.edges.filter((item) => item.fromFrameId === current)) {
      if (visited.has(edge.toFrameId)) continue
      const nextPath = [...path, edge.toFrameId]
      if (edge.toFrameId === config.successFrameId) return nextPath
      visited.add(edge.toFrameId)
      queue.push(nextPath)
    }
  }

  return []
}

export function validateFlowConfig(config: FlowTestConfig, frames: Frame[]): string[] {
  if (config.mode === 'screen') return []

  const issues: string[] = []
  if (frames.length < 2) issues.push('Flow UT에는 화면이 2개 이상 필요합니다.')
  if (!config.mission.trim()) issues.push('수행 미션을 입력해주세요.')
  if (!config.entryFrameId) issues.push('진입 화면을 선택해주세요.')
  if (!config.successFrameId) issues.push('성공 화면을 선택해주세요.')
  if (config.entryFrameId && config.entryFrameId === config.successFrameId) {
    issues.push('진입 화면과 성공 화면은 달라야 합니다.')
  }
  if (config.entryFrameId && config.successFrameId && findShortestPath(config).length === 0) {
    issues.push('진입 화면에서 성공 화면까지 연결되는 경로가 없습니다.')
  }
  const unlabeledCount = config.edges.filter((edge) => !edge.actionLabel.trim()).length
  if (unlabeledCount > 0) {
    issues.push(`화면 연결 ${unlabeledCount}개에 '무엇을 누르면 이동하는지'를 입력해주세요.`)
  }
  return issues
}

function round(value: number): number {
  return Math.round(value * 10) / 10
}

export function calculateFlowMetrics(
  runs: FlowRun[],
  config: FlowTestConfig
): FlowMetrics {
  if (runs.length === 0) {
    return {
      successRate: 0,
      firstActionAccuracy: 0,
      avgSteps: 0,
      avgTaskDurationSeconds: 0,
      pathEfficiency: 0,
      divergenceRate: 0,
      recoveryRate: 0,
    }
  }

  const shortestPath = findShortestPath(config)
  const optimalSteps = Math.max(1, shortestPath.length - 1)
  const expectedFirstTarget = shortestPath[1]
  const successful = runs.filter((run) => run.outcome === 'success')
  const accurateFirstActions = runs.filter(
    (run) => run.events[0]?.toFrameId === expectedFirstTarget
  ).length
  const divergentRuns = runs.filter((run) =>
    run.events.some((event) => {
      const fromIndex = shortestPath.indexOf(event.fromFrameId)
      return (
        fromIndex < 0 ||
        (event.toFrameId !== undefined && shortestPath[fromIndex + 1] !== event.toFrameId)
      )
    })
  ).length
  const runsWithFriction = runs.filter((run) => run.events.some((event) => event.friction))
  const recoveredRuns = runsWithFriction.filter((run) => run.outcome === 'success').length
  const averageDuration =
    runs.reduce(
      (runSum, run) =>
        runSum +
        run.events.reduce(
          (eventSum, event) => eventSum + (event.estimatedDurationSeconds ?? 0),
          0
        ),
      0
    ) / runs.length
  const efficiency =
    successful.length > 0
      ? successful.reduce(
          (sum, run) => sum + Math.min(1, optimalSteps / Math.max(1, run.events.length)),
          0
        ) / successful.length
      : 0

  const dropoffCounts = new Map<string, number>()
  for (const run of runs.filter((item) => item.outcome !== 'success')) {
    const lastEvent = run.events[run.events.length - 1]
    const frameId = lastEvent?.toFrameId ?? lastEvent?.fromFrameId ?? config.entryFrameId
    if (frameId) dropoffCounts.set(frameId, (dropoffCounts.get(frameId) ?? 0) + 1)
  }
  const dropoffFrameId = [...dropoffCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]

  return {
    successRate: Math.round((successful.length / runs.length) * 100),
    firstActionAccuracy: Math.round((accurateFirstActions / runs.length) * 100),
    avgSteps: round(runs.reduce((sum, run) => sum + run.events.length, 0) / runs.length),
    avgTaskDurationSeconds: round(averageDuration),
    pathEfficiency: Math.round(efficiency * 100),
    divergenceRate: Math.round((divergentRuns / runs.length) * 100),
    recoveryRate:
      runsWithFriction.length > 0
        ? Math.round((recoveredRuns / runsWithFriction.length) * 100)
        : 100,
    dropoffFrameId,
  }
}

export function buildFlowFrictions(runs: FlowRun[]): FlowFriction[] {
  const groups = new Map<
    string,
    {
      title: string
      description: string
      frameId?: string
      runIds: Set<string>
      recommendation: string
      hasFailedRun: boolean
    }
  >()

  for (const run of runs) {
    for (const event of run.events) {
      const friction = event.friction?.trim()
      if (!friction) continue
      const key = friction.toLocaleLowerCase('ko-KR')
      const current = groups.get(key) ?? {
        title: friction,
        description: friction,
        frameId: event.fromFrameId,
        runIds: new Set<string>(),
        recommendation:
          event.recommendation?.trim() ||
          '사용자가 다음 행동과 결과를 예측할 수 있도록 정보와 피드백을 보강하세요.',
        hasFailedRun: false,
      }
      current.runIds.add(run.id)
      current.hasFailedRun ||= run.outcome !== 'success'
      groups.set(key, current)
    }
  }

  return [...groups.values()]
    .map((group, index) => ({
      id: `flow-friction-${index + 1}`,
      title: group.title,
      description: group.description,
      severity:
        group.hasFailedRun && group.runIds.size >= 2
          ? ('critical' as const)
          : group.runIds.size >= 2
          ? ('warning' as const)
          : ('suggestion' as const),
      frameId: group.frameId,
      affectedRunCount: group.runIds.size,
      recommendation: group.recommendation,
    }))
    .sort((a, b) => b.affectedRunCount - a.affectedRunCount)
}

export function createFlowTestResult(
  config: FlowTestConfig,
  runs: FlowRun[],
  summary: string
): FlowTestResult {
  return {
    config,
    runs,
    metrics: calculateFlowMetrics(runs, config),
    frictions: buildFlowFrictions(runs),
    summary,
  }
}
