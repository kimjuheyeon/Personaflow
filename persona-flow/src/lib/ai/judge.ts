/**
 * 테스트 판정기.
 *
 * AI 페르소나는 설계 의도를 보지 못한 채 행동한다(블라인드 원칙).
 * 이 모듈은 행동이 끝난 뒤, 디자이너가 정의한 의도와 실제 행동을 비교한다.
 *
 * 판정은 의도적으로 LLM을 쓰지 않는다. 모델을 바꿔도 같은 입력이면 같은 판정이
 * 나와야 실제 사용자 테스트와 비교하거나 모델 간 결과를 비교할 수 있기 때문이다.
 *
 * 판정 결과에서 "AI가 막힌 지점"을 뽑아 디자이너에게 되물을 질문을 만든다.
 * 주석을 미리 다 받는 대신, 판정이 실패한 곳만 골라 묻는 방식이다.
 */

import type {
  ClarificationRequest,
  FlowEdge,
  FlowJudgment,
  FlowRun,
  FlowTestConfig,
  Frame,
  StepJudgment,
  StepVerdict,
} from '@/types'
import { getFlowFrameLabel } from '@/lib/flow'

/* ── 행동 문구 비교 ───────────────────────────────────────── */

/** 조사·동사 어미처럼 비교에 방해가 되는 표현을 걷어낸다. */
export function comparableAction(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('ko-KR')
    .replace(
      /(버튼|링크|아이콘|메뉴|클릭|선택|누르기|누른다|탭하기|탭한다|이동하기|이동한다|시도한다|시도하기)/g,
      ''
    )
    .replace(/[^\p{L}\p{N}]/gu, '')
}

function bigrams(value: string): string[] {
  if (value.length < 2) return value ? [value] : []
  return Array.from({ length: value.length - 1 }, (_, index) => value.slice(index, index + 2))
}

/** 0~1. 한국어 표현 차이를 흡수하기 위해 bigram 겹침을 쓴다. */
export function actionSimilarity(left: string, right: string): number {
  const a = comparableAction(left)
  const b = comparableAction(right)
  if (!a || !b) return 0
  if (a === b) return 1
  if (a.includes(b) || b.includes(a)) return 0.9

  const aPairs = bigrams(a)
  const bPairs = [...bigrams(b)]
  let intersection = 0
  for (const pair of aPairs) {
    const index = bPairs.indexOf(pair)
    if (index < 0) continue
    intersection += 1
    bPairs.splice(index, 1)
  }
  return (2 * intersection) / Math.max(1, aPairs.length + bigrams(b).length)
}

export const EDGE_MATCH_THRESHOLD = 0.45

/**
 * AI가 서술한 행동을 현재 화면에서 나가는 연결 중 하나에 대응시킨다.
 * 대응되는 연결이 없으면 undefined — 그 지점이 곧 "AI가 막힌 곳"이다.
 */
export function matchFlowEdge(
  outgoing: FlowEdge[],
  step: { action?: string; observedElement?: string; evidence?: string; targetFrameId?: string }
): FlowEdge | undefined {
  const direct = outgoing.find((edge) => edge.toFrameId === step.targetFrameId)
  if (direct) return direct

  const evidence = [step.observedElement, step.action, step.evidence].filter(
    (value): value is string => Boolean(value)
  )
  if (evidence.length === 0 || outgoing.length === 0) return undefined

  const ranked = outgoing
    .map((edge) => ({
      edge,
      score: Math.max(...evidence.map((value) => actionSimilarity(value, edge.actionLabel)), 0),
    }))
    .sort((a, b) => b.score - a.score)
  return ranked[0] && ranked[0].score >= EDGE_MATCH_THRESHOLD ? ranked[0].edge : undefined
}

/* ── 판정 ─────────────────────────────────────────────────── */

function verdictFor(
  event: FlowRun['events'][number],
  config: FlowTestConfig
): StepVerdict {
  if (event.transitionMatched !== true) return 'blocked'

  // 실제로 연결된 요소를 눌렀지만, 그 결과로 다른 화면을 예상했다.
  // = 요소는 보였으나 의미를 잘못 이해했다.
  if (
    event.aiExpectedFrameId &&
    event.toFrameId &&
    event.aiExpectedFrameId !== event.toFrameId
  ) {
    return 'misread'
  }

  const expectedPath = config.expectedPathFrameIds ?? []
  if (expectedPath.length === 0) return 'intended'
  return event.toFrameId && expectedPath.includes(event.toFrameId)
    ? 'intended'
    : 'alternate_path'
}

function clarificationKey(frameId: string, observedElement: string | undefined): string {
  return `${frameId}::${comparableAction(observedElement ?? '') || '__none__'}`
}

function buildQuestion(
  reason: 'blocked' | 'misread',
  frameLabel: string,
  observedElement: string | undefined,
  personaCount: number
): string {
  const who = personaCount > 1 ? `페르소나 ${personaCount}명이` : '페르소나가'

  if (reason === 'misread') {
    return observedElement
      ? `${frameLabel} — ${who} "${observedElement}"을(를) 선택했지만, 이어질 화면을 다르게 예상했습니다. 이 요소는 실제로 어디로 이동하나요?`
      : `${frameLabel} — ${who} 다음 화면을 잘못 예상했습니다. 이 화면에서 의도한 이동 경로는 무엇인가요?`
  }

  return observedElement
    ? `${frameLabel} — ${who} "${observedElement}"에 주목했지만 이어지는 동작을 찾지 못했습니다. 이 요소는 무엇을 하는 요소인가요?`
    : `${frameLabel} — ${who} 이 화면에서 다음에 할 행동을 찾지 못했습니다. 사용자가 하길 기대한 행동은 무엇인가요?`
}

/**
 * 정규화된 run들을 디자이너 의도와 대조해 단계별 판정과 되묻기 목록을 만든다.
 * 순수 함수 — 같은 입력이면 항상 같은 결과.
 */
export function judgeFlowRuns(
  runs: FlowRun[],
  config: FlowTestConfig,
  frames: Frame[]
): FlowJudgment {
  const steps: StepJudgment[] = []

  for (const run of runs) {
    for (const event of run.events) {
      const verdict = verdictFor(event, config)
      const intendedEdges = config.edges.filter((edge) => edge.fromFrameId === event.fromFrameId)
      const expectedPath = config.expectedPathFrameIds ?? []

      steps.push({
        runId: run.id,
        personaId: run.personaId,
        personaName: run.personaName,
        step: event.step,
        frameId: event.fromFrameId,
        verdict,
        observedElement: event.observedElement,
        aiExpectedFrameId: event.aiExpectedFrameId,
        intendedAction:
          intendedEdges.length > 0
            ? intendedEdges.map((edge) => edge.actionLabel).join(' / ')
            : undefined,
        intendedTargetFrameId: intendedEdges[0]?.toFrameId,
        actualTargetFrameId: event.toFrameId,
        onExpectedPath:
          expectedPath.length === 0
            ? verdict === 'intended'
            : Boolean(event.toFrameId && expectedPath.includes(event.toFrameId)),
      })
    }
  }

  /* 막히거나 잘못 이해한 지점을 화면+요소 단위로 묶어 되묻기를 만든다. */
  const grouped = new Map<
    string,
    { reason: 'blocked' | 'misread'; frameId: string; element?: string; personas: string[]; interpretation?: string }
  >()

  for (const step of steps) {
    if (step.verdict !== 'blocked' && step.verdict !== 'misread') continue
    const key = clarificationKey(step.frameId, step.observedElement)
    const existing = grouped.get(key)
    if (existing) {
      if (!existing.personas.includes(step.personaName)) existing.personas.push(step.personaName)
      // 막힌 것이 잘못 이해한 것보다 우선한다.
      if (step.verdict === 'blocked') existing.reason = 'blocked'
      continue
    }
    grouped.set(key, {
      reason: step.verdict,
      frameId: step.frameId,
      element: step.observedElement,
      personas: [step.personaName],
      interpretation: step.aiExpectedFrameId
        ? `${getFlowFrameLabel(frames, step.aiExpectedFrameId)}(으)로 이동할 것으로 예상함`
        : undefined,
    })
  }

  const clarifications: ClarificationRequest[] = [...grouped.entries()]
    // 많은 페르소나가 걸린 지점을 먼저 묻는다.
    .sort((a, b) => b[1].personas.length - a[1].personas.length)
    .map(([key, group], index) => ({
      id: `clarify-${index + 1}-${key.replace(/[^a-zA-Z0-9]/g, '').slice(0, 24)}`,
      frameId: group.frameId,
      observedElement: group.element,
      aiInterpretation: group.interpretation,
      reason: group.reason,
      affectedPersonas: group.personas,
      question: buildQuestion(
        group.reason,
        getFlowFrameLabel(frames, group.frameId),
        group.element,
        group.personas.length
      ),
    }))

  const runsWithSteps = runs.filter((run) => run.events.length > 0)
  const intendedFirstActions = runsWithSteps.filter((run) => {
    const first = steps.find((step) => step.runId === run.id && step.step === run.events[0].step)
    return first?.verdict === 'intended'
  }).length

  return {
    steps,
    clarifications,
    intendedFirstActionRate:
      runsWithSteps.length > 0
        ? Math.round((intendedFirstActions / runsWithSteps.length) * 100)
        : 0,
    blockedStepCount: steps.filter((step) => step.verdict === 'blocked').length,
    misreadStepCount: steps.filter((step) => step.verdict === 'misread').length,
    judgedStepCount: steps.length,
  }
}

/* ── 판정 결과를 분석기에게 넘길 형태로 정리 ────────────────── */

const VERDICT_LABEL: Record<StepVerdict, string> = {
  intended: '의도한 경로',
  alternate_path: '정의된 대안 경로',
  misread: '요소 의미 오해',
  blocked: '막힘',
}

/**
 * UX 분석기 프롬프트에 넣을 판정 요약.
 * 분석기는 화면을 다시 추측하지 않고 이 사실만 근거로 문제를 작성한다.
 */
export function formatJudgment(judgment: FlowJudgment, frames: Frame[]): string {
  if (judgment.judgedStepCount === 0) {
    return '판정 가능한 행동 단계가 없습니다.'
  }

  const header = [
    `- 판정한 행동 단계: ${judgment.judgedStepCount}개`,
    `- 첫 행동이 의도와 일치한 비율: ${judgment.intendedFirstActionRate}%`,
    `- 막힌 단계: ${judgment.blockedStepCount}개`,
    `- 요소 의미를 오해한 단계: ${judgment.misreadStepCount}개`,
  ].join('\n')

  const notable = judgment.steps
    .filter((step) => step.verdict !== 'intended')
    .slice(0, 20)
    .map((step) => {
      const parts = [
        `[${VERDICT_LABEL[step.verdict]}] ${step.personaName} · ${getFlowFrameLabel(frames, step.frameId)} ${step.step}단계`,
        step.observedElement ? `  - AI가 선택한 요소: "${step.observedElement}"` : '  - AI가 선택할 요소를 찾지 못함',
        step.intendedAction ? `  - 디자이너가 정의한 행동: ${step.intendedAction}` : '  - 이 화면에 정의된 행동 없음',
      ]
      if (step.verdict === 'misread' && step.aiExpectedFrameId) {
        parts.push(
          `  - AI 예상 도착 화면: ${getFlowFrameLabel(frames, step.aiExpectedFrameId)} / 실제 연결: ${
            step.actualTargetFrameId ? getFlowFrameLabel(frames, step.actualTargetFrameId) : '없음'
          }`
        )
      }
      return parts.join('\n')
    })
    .join('\n\n')

  const answered = judgment.clarifications.filter((item) => item.answer)
  const answeredText =
    answered.length > 0
      ? `\n\n## 디자이너가 확인해 준 설계 의도\n${answered
          .map(
            (item) =>
              `- ${getFlowFrameLabel(frames, item.frameId)} "${item.answer?.elementName}" (${item.answer?.elementRole}) — 의도한 행동: ${item.answer?.intendedAction}${
                item.answer?.visibilityCondition ? ` / 표시 조건: ${item.answer.visibilityCondition}` : ''
              }${item.answer?.notes ? ` / 참고: ${item.answer.notes}` : ''}`
          )
          .join('\n')}`
      : ''

  return `${header}${notable ? `\n\n## 의도와 어긋난 단계\n${notable}` : ''}${answeredText}`
}
