import { AXES } from './prompts'
import { judgeFlowRuns } from './judge'
import type { AnalysisResult } from './gemini'
import type {
  FigmaSource,
  Finding,
  FlowRun,
  FlowTestConfig,
  Frame,
  PersonaConfig,
  TaskMetrics,
  TestReport,
  WalkStep,
} from '@/types'
import { createFlowTestResult, getFlowFrameLabel } from '@/lib/flow'
import {
  createDemoFlowConfig,
  createDemoFlowRuns,
  createDemoFrames,
  createDemoPersonas,
} from '@/lib/demoScenario'

function fallbackFrame(frames: Frame[]): Frame {
  return (
    frames[0] ?? {
      id: 'demo-frame',
      name: 'Screen01',
      imageUrl: '',
      flowOrder: 1,
    }
  )
}

function sourceLabel(figmaSource?: FigmaSource | null): string {
  return figmaSource?.fileName ?? figmaSource?.fileKey ?? 'Figma 파일'
}

function buildWalkthrough(frames: Frame[], personas: PersonaConfig[]): WalkStep[] {
  const targetFrames = frames.length > 0 ? frames.slice(0, 3) : [fallbackFrame(frames)]
  return personas.flatMap((persona) =>
    targetFrames.map((frame, index) => ({
      frameId: frame.id,
      personaName: persona.name,
      action:
        index === 0
          ? '첫 화면에서 핵심 CTA와 서비스 목적을 찾는다'
          : '다음 단계로 이동할 수 있는 버튼이나 안내 문구를 확인한다',
      thought:
        index === 0
          ? `${persona.role} 입장에서는 첫 화면에서 무엇을 얻을 수 있는지가 바로 보여야 합니다.`
          : '이전 화면에서 이어지는 맥락이 충분하지 않으면 다음 행동을 망설일 가능성이 있습니다.',
      emotion: index === 0 ? 'neutral' : 'confused',
    }))
  )
}

const demoMetrics: TaskMetrics = {
  completionRate: 68,
  avgClicks: 6.4,
  errorRate: 18,
  dropoffPoint: '첫 CTA 또는 다음 단계 안내가 불명확한 구간',
}

export async function analyzeDesignDemo(
  frames: Frame[],
  personas: PersonaConfig[],
  figmaSource?: FigmaSource | null
): Promise<AnalysisResult> {
  const frame = fallbackFrame(frames)
  const label = sourceLabel(figmaSource)

  return {
    axisScores: AXES.map((axis, index) => ({
      ...axis,
      score: [74, 62, 66, 70, 58, 61][index] ?? 65,
    })),
    findings: [
      {
        id: 'demo-f1',
        severity: 'warning',
        axis: 1,
        axisLabel: '첫인상 & 가치 전달',
        heuristic: '닐슨 #2 실제 세계와의 일치',
        problem: `${label}의 첫 화면에서 사용자가 얻는 결과와 다음 행동이 동시에 명확해야 합니다.`,
        taskMetric: '5초 내 목적 파악 가능성 70% 수준으로 추정',
        suggestion: '첫 화면 상단에 대상 사용자, 얻게 되는 결과, 즉시 실행 CTA를 한 묶음으로 배치하세요.',
        frameId: frame.id,
      },
      {
        id: 'demo-f2',
        severity: 'warning',
        axis: 3,
        axisLabel: '핵심 태스크 완료',
        heuristic: '닐슨 #1 시스템 상태 가시성',
        problem:
          'Figma 연결은 되었지만 실제 prototype reaction 파싱은 아직 연결 전이므로 플로우 확신도가 제한됩니다.',
        taskMetric: '핵심 태스크 완료율 68%, 평균 클릭 6.4회로 추정',
        suggestion:
          '다음 단계에서 Figma versionId, nodeId, prototype connection을 함께 저장하도록 확장하세요.',
        frameId: frame.id,
      },
      {
        id: 'demo-f3',
        severity: 'suggestion',
        axis: 6,
        axisLabel: '전환 & 재방문 유도',
        heuristic: '닐슨 #7 유연성과 효율성',
        problem: '첫 성공 경험 이후 저장, 공유, 재실행 같은 후속 행동이 리포트에서 더 강하게 연결될 필요가 있습니다.',
        taskMetric: '재방문 유도 점수 61점',
        suggestion: '리포트 완료 화면에 다시 테스트, 이전 버전 비교, 팀 공유 액션을 고정 영역으로 제공하세요.',
        frameId: frame.id,
      },
    ],
    taskMetrics: demoMetrics,
    overallSummary:
      '샘플 리포트는 Figma 링크와 화면 메타데이터를 기준으로 빠른 UX 점검 결과를 생성했습니다. 실제 화면 이미지 이해나 프로토타입 연결 자동 탐색은 아직 제한적이므로, 이번 결과는 제품 흐름 검증용 초안으로 보는 것이 적절합니다. 실제 AI 분석을 하려면 개인 액세스 토큰으로 Figma 화면 이미지를 가져온 뒤 Claude 브리지를 연결해 재실행하세요.',
    walkthrough: buildWalkthrough(frames, personas),
  }
}

function buildDemoFlowRuns(
  personas: PersonaConfig[],
  config: FlowTestConfig
): FlowRun[] {
  return personas.map((persona, personaIndex) => {
    let currentFrameId = config.entryFrameId
    const events: FlowRun['events'] = []

    for (let stepIndex = 0; stepIndex < config.maxSteps; stepIndex++) {
      if (currentFrameId === config.successFrameId) break
      const outgoing = config.edges.filter((edge) => edge.fromFrameId === currentFrameId)
      const edge =
        personaIndex === 0 && stepIndex === 0 && outgoing.length > 1
          ? outgoing[outgoing.length - 1]
          : outgoing[0]

      if (!edge) {
        events.push({
          id: `demo-flow-event-${persona.id}-${stepIndex + 1}`,
          step: stepIndex + 1,
          fromFrameId: currentFrameId,
          action: '다음 행동을 찾는다',
          expectation: '미션을 계속 수행할 수 있는 명확한 행동을 기대한다.',
          thought: '여기서 무엇을 해야 할지 모르겠어요.',
          emotion: 'frustrated',
          estimatedDurationSeconds: persona.digitalLevel === 'beginner' ? 18 : 10,
          expectedAction:
            outgoing.length > 0
              ? outgoing.map((item) => item.actionLabel).join(' / ')
              : undefined,
          transitionMatched: false,
          friction: '다음 단계로 이어지는 행동을 찾기 어려움',
          recommendation: '핵심 CTA와 다음 단계의 결과를 더 명확하게 표현하세요.',
        })
        break
      }

      const hasFriction = persona.digitalLevel === 'beginner' && stepIndex === 1
      events.push({
        id: `demo-flow-event-${persona.id}-${stepIndex + 1}`,
        step: stepIndex + 1,
        fromFrameId: currentFrameId,
        toFrameId: edge.toFrameId,
        action: '화면에서 미션과 가장 관련 있어 보이는 요소를 선택한다',
        expectation: '선택한 행동이 미션 완료에 가까워지기를 기대한다.',
        thought: hasFriction
          ? '선택 결과가 바로 설명되지 않아 맞게 진행 중인지 잠시 고민돼요.'
          : '다음 단계가 예상한 흐름과 이어져 계속 진행할 수 있어요.',
        emotion: hasFriction ? 'confused' : 'neutral',
        estimatedDurationSeconds: hasFriction
          ? 16
          : persona.digitalLevel === 'beginner'
          ? 11
          : 7,
        expectedAction: edge.actionLabel,
        transitionMatched: true,
        friction: hasFriction ? '행동 이후의 진행 상태가 충분히 설명되지 않음' : undefined,
        recommendation: hasFriction
          ? '전환 직후 현재 단계와 남은 과정을 명확하게 안내하세요.'
          : undefined,
      })
      currentFrameId = edge.toFrameId
    }

    const success = currentFrameId === config.successFrameId
    return {
      id: `demo-flow-run-${persona.id}`,
      personaId: persona.id,
      personaName: persona.name,
      outcome: success ? 'success' : 'failed',
      events,
      interview: [
        {
          question: '첫 행동을 왜 선택했나요?',
          answer:
            events[0]?.action
              ? `화면에서 미션과 가장 관련 있어 보이는 요소가 그것이라고 생각했기 때문입니다.`
              : '첫 화면에서 무엇을 선택해야 할지 판단하기 어려웠습니다.',
        },
        {
          question: '가장 망설였던 순간은 언제였나요?',
          answer:
            events.find((event) => event.friction)?.thought ??
            '다음 화면으로 이동한 직후 현재 위치가 맞는지 확인할 때 잠시 망설였습니다.',
        },
        {
          question: '이 흐름에서 가장 바꾸고 싶은 점은 무엇인가요?',
          answer: '다음 행동과 선택 결과를 더 분명하게 알려주는 안내를 보강하고 싶습니다.',
        },
      ],
      summary: success
        ? `${persona.name}은(는) ${events.length}단계로 미션을 완료했습니다.`
        : `${persona.name}은(는) 다음 행동을 찾지 못해 미션을 완료하지 못했습니다.`,
    }
  })
}

/**
 * 완성된 샘플 리포트.
 * 판정은 실제 분석과 똑같이 judgeFlowRuns()를 쓴다 — 데모용 가짜 판정을 만들지 않는다.
 * 여기서 본 되묻기 질문은 실제 테스트에서 나오는 것과 같은 방식으로 생성된 것이다.
 */
export function createDemoReport(): TestReport {
  const frames = createDemoFrames()
  const personas = createDemoPersonas()
  const config = createDemoFlowConfig()
  const runs = createDemoFlowRuns(personas)
  const judgment = judgeFlowRuns(runs, config, frames)
  const flowResult = createFlowTestResult(
    config,
    runs,
    '세 페르소나 중 한 명이 대시보드 빈 상태에서 생성 경로를 찾지 못해 미션을 완료하지 못했습니다. 완료한 두 명도 같은 아이콘에서 추측에 의존했고, 한 명은 "생성" 이후 도착 화면을 잘못 예상했습니다. 레이블 없는 아이콘과 결과가 예고되지 않는 버튼이 공통 원인입니다.'
  )

  const findings: Finding[] = [
    {
      id: 'demo-f1',
      severity: 'critical',
      axis: 2,
      axisLabel: '온보딩 흐름',
      heuristic: '닐슨 #6 기억보다 인식',
      problem:
        '대시보드 빈 상태에 생성 동작이 레이블 없는 "+" 아이콘 하나로만 제공됩니다. 초급 페르소나는 이 아이콘의 의미를 알아내지 못해 미션을 중단했고, 완료한 두 명도 관례에 의존해 추측했습니다.',
      taskMetric: 'AI 시뮬레이션 추정 · 3명 중 1명이 이 지점에서 이탈',
      suggestion:
        '빈 상태에 "새 에이전트 만들기" 텍스트 버튼을 배치하고, 아이콘에는 레이블이나 툴팁을 붙이세요.',
      frameId: 'demo-s3',
      evidence: '화면에서 확인된 요소: "내 에이전트", "아직 만든 에이전트가 없습니다", "+"',
      confidence: 88,
    },
    {
      id: 'demo-f2',
      severity: 'warning',
      axis: 3,
      axisLabel: '핵심 태스크 완료',
      heuristic: '닐슨 #1 시스템 상태 가시성',
      problem:
        '"생성" 버튼을 누른 뒤 어디로 이동하는지 화면에서 예고되지 않습니다. 한 페르소나는 목록으로 돌아갈 것으로 예상했으나 실제로는 완료 화면으로 이동했습니다.',
      taskMetric: 'AI 시뮬레이션 추정 · 완료한 2명 중 1명이 도착 화면을 잘못 예상',
      suggestion:
        '버튼 레이블을 "에이전트 생성하고 계속하기"처럼 결과가 드러나게 바꾸거나, 다음 단계를 미리 안내하세요.',
      frameId: 'demo-s5',
      evidence: '화면에서 확인된 요소: "사용할 모델", "생성"',
      confidence: 76,
    },
    {
      id: 'demo-f3',
      severity: 'warning',
      axis: 5,
      axisLabel: '정보 구조 & 용어',
      heuristic: '닐슨 #5 오류 방지',
      problem:
        'Enterprise 모델에 "관리자 승인 필요"라고 적혀 있지만, 현재 사용자가 관리자인지 화면에서 알 수 없습니다. 고급 페르소나가 이 지점에서 판단을 보류했습니다.',
      taskMetric: 'AI 시뮬레이션 추정 · 모델 선택 단계에서 체류 시간 증가',
      suggestion: '선택할 수 없는 옵션은 비활성 상태로 두고 그 이유를 함께 표시하세요.',
      frameId: 'demo-s5',
      evidence: '화면에서 확인된 요소: "Enterprise — 관리자 승인 필요"',
      confidence: 71,
    },
    {
      id: 'demo-f4',
      severity: 'suggestion',
      axis: 1,
      axisLabel: '첫인상 & 가치 전달',
      heuristic: '닐슨 #8 미적이고 최소한의 디자인',
      problem:
        '랜딩에서 세 페르소나 모두 망설임 없이 진입했습니다. 헤드라인과 단일 CTA 구조가 잘 작동하고 있습니다.',
      taskMetric: 'AI 시뮬레이션 추정 · 첫 화면 평균 체류 6초',
      suggestion: '현재 구조를 유지하되, 대시보드 빈 상태에도 같은 수준의 명확성을 적용하세요.',
      frameId: 'demo-s1',
      evidence: '화면에서 확인된 요소: "팀을 위한 AI 워크스페이스", "시작하기"',
      confidence: 80,
    },
  ]

  return {
    id: `demo-report-${Date.now()}`,
    projectName: '샘플 · 신규 에이전트 생성 흐름',
    createdAt: new Date(),
    sourceType: 'image',
    aiMode: 'demo',
    personas,
    frames,
    flowConfig: config,
    flowResult,
    flowJudgment: judgment,
    axisScores: AXES.map((axis, index) => ({
      ...axis,
      score: [78, 41, 55, 68, 59, 64][index] ?? 60,
    })),
    findings,
    taskMetrics: {
      completionRate: flowResult.metrics.successRate,
      avgClicks: flowResult.metrics.avgSteps,
      errorRate: 100 - flowResult.metrics.successRate,
      dropoffPoint: '대시보드 빈 상태 — 생성 경로를 찾지 못함',
      provenance: 'simulation_aggregate',
      disclaimer:
        'AI 페르소나 시뮬레이션 run을 집계한 값이며 실제 사용자 행동 지표가 아닙니다.',
    },
    overallSummary: flowResult.summary,
    walkthrough: runs.flatMap((run) =>
      run.events.map((event) => ({
        frameId: event.fromFrameId,
        personaName: run.personaName,
        action: event.action,
        thought: event.thought,
        emotion: event.emotion,
        observedElement: event.observedElement,
        evidence: event.evidence,
        confidence: event.confidence,
      }))
    ),
    frameChats: frames.map((frame) => ({ frameId: frame.id, messages: [] })),
    feedbackThreads: [],
  }
}

export async function analyzeFlowDesignDemo(
  frames: Frame[],
  personas: PersonaConfig[],
  config: FlowTestConfig
): Promise<AnalysisResult> {
  const runs = buildDemoFlowRuns(personas, config)
  const flowResult = createFlowTestResult(
    config,
    runs,
    '샘플 Flow UT는 진입점에서 성공 지점까지 각 페르소나의 독립 경로를 재생했습니다. 초급 사용자는 중간 전환에서 진행 상태를 이해하는 데 마찰을 경험했으며, 다음 단계 안내를 보강하는 것이 우선입니다.'
  )
  const firstFrame = fallbackFrame(frames)
  const findings = flowResult.frictions.map((friction, index) => ({
    id: `demo-flow-f-${index + 1}`,
    severity: friction.severity,
    axis: 3,
    axisLabel: '핵심 태스크 완료',
    heuristic: '닐슨 #1 시스템 상태 가시성',
    problem: friction.description,
    taskMetric: `${friction.affectedRunCount}개 run에서 발생`,
    suggestion: friction.recommendation,
    frameId: friction.frameId ?? firstFrame.id,
  }))

  return {
    axisScores: AXES.map((axis, index) => ({
      ...axis,
      score: [76, 72, 68, 71, 64, 66][index] ?? 68,
    })),
    findings,
    taskMetrics: {
      completionRate: flowResult.metrics.successRate,
      avgClicks: flowResult.metrics.avgSteps,
      errorRate: 100 - flowResult.metrics.successRate,
      dropoffPoint: flowResult.metrics.dropoffFrameId
        ? getFlowFrameLabel(frames, flowResult.metrics.dropoffFrameId)
        : '뚜렷한 이탈 지점 없음',
    },
    overallSummary: flowResult.summary,
    walkthrough: runs.flatMap((run) =>
      run.events.map((event) => ({
        frameId: event.fromFrameId,
        personaName: run.personaName,
        action: event.action,
        thought: event.thought,
        emotion: event.emotion,
      }))
    ),
    flowResult,
    // 데모 경로도 실제와 같은 판정기를 통과시킨다.
    flowJudgment: judgeFlowRuns(runs, config, frames),
  }
}
