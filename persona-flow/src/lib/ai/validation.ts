import type {
  AnalysisValidation,
  EvidenceVerification,
  Finding,
  Frame,
  MetricProvenance,
  TaskMetrics,
  WalkStep,
} from '@/types'

export interface EvidenceObservation {
  frameId: string
  visibleTexts: string[]
  interactiveElements: Array<{ label: string }>
}

interface ValidationInput {
  frames: Frame[]
  observations: EvidenceObservation[]
  findings: Finding[]
  walkthrough: WalkStep[]
  taskMetrics: TaskMetrics
  metricProvenance?: MetricProvenance
}

interface ValidationOutput {
  findings: Finding[]
  walkthrough: WalkStep[]
  taskMetrics: TaskMetrics
  validation: AnalysisValidation
}

function clamp(value: number, min = 0, max = 100): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, value))
}

function normalizeEvidenceText(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('ko-KR')
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function evidenceCorpus(
  frame: Frame,
  observation: EvidenceObservation | undefined
): string[] {
  return unique([
    ...(frame.designContext?.visibleTexts ?? []),
    ...(frame.designContext?.interactiveLabels ?? []),
    ...(frame.designContext?.componentLabels ?? []),
    ...(observation?.visibleTexts ?? []),
    ...(observation?.interactiveElements.map((element) => element.label) ?? []),
  ]).filter((value) => normalizeEvidenceText(value).length >= 2)
}

function findMatchedEvidence(target: string, corpus: string[]): string[] {
  const normalizedTarget = normalizeEvidenceText(target)
  if (!normalizedTarget) return []

  return corpus
    .filter((candidate) => {
      const normalizedCandidate = normalizeEvidenceText(candidate)
      return normalizedCandidate.length >= 2 && normalizedTarget.includes(normalizedCandidate)
    })
    .slice(0, 5)
}

function verificationFor(
  frameExists: boolean,
  claimEvidence: string,
  matchedEvidence: string[]
): EvidenceVerification {
  if (!frameExists || !claimEvidence.trim()) return 'unverified'
  if (matchedEvidence.length > 0) return 'verified'
  return 'partial'
}

function verifiedConfidence(
  confidence: number | undefined,
  verification: EvidenceVerification
): number {
  const value = Math.round(clamp(confidence ?? 0))
  if (verification === 'verified') return value
  if (verification === 'partial') return Math.min(value, 70)
  return Math.min(value, 30)
}

function roundedEstimate(value: number): number {
  return Math.round(clamp(value) / 5) * 5
}

export function withMetricProvenance(
  metrics: TaskMetrics,
  provenance: MetricProvenance
): TaskMetrics {
  const isEstimate = provenance === 'ai_estimate'
  return {
    completionRate: isEstimate
      ? roundedEstimate(metrics.completionRate)
      : Math.round(clamp(metrics.completionRate)),
    avgClicks: Math.round(Math.max(0, metrics.avgClicks ?? 0) * 10) / 10,
    errorRate: isEstimate
      ? roundedEstimate(metrics.errorRate)
      : Math.round(clamp(metrics.errorRate)),
    dropoffPoint: metrics.dropoffPoint?.trim() || '뚜렷한 이탈 지점 없음',
    provenance,
    disclaimer:
      provenance === 'observed'
        ? '연결된 실제 행동 데이터에서 집계한 값입니다.'
        : provenance === 'simulation_aggregate'
          ? 'AI 페르소나 시뮬레이션 run을 집계한 값이며 실제 사용자 행동 지표가 아닙니다.'
          : '실제 사용자 행동 로그가 아닌 AI 시뮬레이션 추정치입니다.',
  }
}

export function validateAnalysisEvidence(input: ValidationInput): ValidationOutput {
  const frameById = new Map(input.frames.map((frame) => [frame.id, frame]))
  const observationByFrameId = new Map(
    input.observations.map((observation) => [observation.frameId, observation])
  )
  let invalidFrameReferences = 0

  const findings = input.findings.map((finding) => {
    const frame = finding.frameId ? frameById.get(finding.frameId) : undefined
    const frameExists = Boolean(frame)
    if (finding.frameId && !frameExists) invalidFrameReferences += 1
    const claimEvidence = finding.evidence ?? ''
    const matchedEvidence = frame
      ? findMatchedEvidence(
          claimEvidence,
          evidenceCorpus(frame, observationByFrameId.get(frame.id))
        )
      : []
    const verification = verificationFor(frameExists, claimEvidence, matchedEvidence)
    const taskMetric = finding.taskMetric?.trim() || '행동 영향 확인 필요'
    return {
      ...finding,
      frameId: frameExists ? finding.frameId : undefined,
      confidence: verifiedConfidence(finding.confidence, verification),
      verification,
      matchedEvidence,
      taskMetric: taskMetric.startsWith('AI 시뮬레이션 추정')
        ? taskMetric
        : `AI 시뮬레이션 추정 · ${taskMetric}`,
    }
  })

  const walkthrough = input.walkthrough.map((step) => {
    const frame = frameById.get(step.frameId)
    const frameExists = Boolean(frame)
    if (!frameExists) invalidFrameReferences += 1
    const claimEvidence = [step.observedElement, step.evidence].filter(Boolean).join(' ')
    const matchedEvidence = frame
      ? findMatchedEvidence(
          claimEvidence,
          evidenceCorpus(frame, observationByFrameId.get(frame.id))
        )
      : []
    const verification = verificationFor(frameExists, claimEvidence, matchedEvidence)
    return {
      ...step,
      confidence: verifiedConfidence(step.confidence, verification),
      verification,
      matchedEvidence,
    }
  })

  const verifiedFindings = findings.filter((finding) => finding.verification === 'verified').length
  const verifiedWalkthroughSteps = walkthrough.filter(
    (step) => step.verification === 'verified'
  ).length
  const partialClaims =
    findings.filter((finding) => finding.verification === 'partial').length +
    walkthrough.filter((step) => step.verification === 'partial').length
  const totalClaims = findings.length + walkthrough.length
  const groundedRatio =
    totalClaims > 0
      ? (verifiedFindings + verifiedWalkthroughSteps + partialClaims * 0.5) / totalClaims
      : 0
  const imageFrames = input.frames.filter((frame) => Boolean(frame.file || frame.imageUrl)).length
  const metadataFrames = input.frames.filter(
    (frame) => frame.designContext?.source === 'figma_api'
  ).length
  const totalFrames = input.frames.length
  const imageCoverage = totalFrames > 0 ? imageFrames / totalFrames : 0
  const metadataCoverage = totalFrames > 0 ? metadataFrames / totalFrames : 0
  const score = Math.round(
    clamp(groundedRatio * 70 + imageCoverage * 20 + metadataCoverage * 10 - invalidFrameReferences * 5)
  )
  const unverifiedClaims = totalClaims - verifiedFindings - verifiedWalkthroughSteps - partialClaims
  const warnings = [
    ...(metadataFrames === 0
      ? ['Figma 구조 데이터가 없어 이미지 판독 결과만으로 근거를 검증했습니다.']
      : []),
    ...(partialClaims > 0
      ? [`${partialClaims}개 항목은 화면 근거와 의미상 연결되지만 정확한 문구 일치는 확인되지 않았습니다.`]
      : []),
    ...(unverifiedClaims > 0
      ? [`${unverifiedClaims}개 항목은 확인 가능한 화면 근거가 부족합니다.`]
      : []),
    ...(invalidFrameReferences > 0
      ? [`존재하지 않는 화면 참조 ${invalidFrameReferences}건을 결과에서 분리했습니다.`]
      : []),
    '완료율·오류율·클릭 수는 실제 사용자 로그가 아닌 AI 시뮬레이션 값입니다.',
  ]

  return {
    findings,
    walkthrough,
    taskMetrics: withMetricProvenance(
      input.taskMetrics,
      input.metricProvenance ?? 'ai_estimate'
    ),
    validation: {
      score,
      status: score >= 80 ? 'high' : score >= 55 ? 'medium' : 'low',
      verifiedFindings,
      totalFindings: findings.length,
      verifiedWalkthroughSteps,
      totalWalkthroughSteps: walkthrough.length,
      invalidFrameReferences,
      inputCoverage: {
        totalFrames,
        imageFrames,
        metadataFrames,
      },
      warnings,
    },
  }
}
