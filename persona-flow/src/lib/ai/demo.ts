import { AXES } from './prompts'
import type { AnalysisResult } from './gemini'
import type {
  ABTestConfig,
  ABComparison,
  DesignVariant,
  FigmaSource,
  Frame,
  PersonaConfig,
  SourceType,
  TaskMetrics,
  VariantId,
  WalkStep,
} from '@/types'

const DEFAULT_PERSONAS: PersonaConfig[] = [
  {
    id: 'demo-beginner',
    name: '박민준',
    role: '비전공 팀 리드',
    digitalLevel: 'beginner',
    goal: '제품의 핵심 가치를 빠르게 이해하고 첫 테스트를 시작한다',
    device: 'desktop',
    context: '처음 써보는 유저',
    isAiGenerated: true,
  },
  {
    id: 'demo-intermediate',
    name: '김지수',
    role: '프로덕트 디자이너',
    digitalLevel: 'intermediate',
    goal: 'Figma 시안을 빠르게 검증하고 팀에 공유할 근거를 만든다',
    device: 'desktop',
    context: '새 기능 출시 전 검토 중',
    isAiGenerated: true,
  },
  {
    id: 'demo-expert',
    name: '이수현',
    role: '그로스 마케터',
    digitalLevel: 'expert',
    goal: 'A/B 시안 중 전환 가능성이 높은 안을 고른다',
    device: 'desktop',
    context: '랜딩 개선안을 비교 검토 중',
    isAiGenerated: true,
  },
]

function clonePersona(persona: PersonaConfig, index: number, sourceType: SourceType): PersonaConfig {
  return {
    ...persona,
    id: `${persona.id}-${sourceType}-${index}`,
  }
}

export function suggestDemoPersonas(sourceType: SourceType): PersonaConfig[] {
  return DEFAULT_PERSONAS.map((persona, index) => clonePersona(persona, index, sourceType))
}

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

function sourceLabel(sourceType: SourceType, figmaSource?: FigmaSource | null): string {
  if (sourceType === 'figma') {
    return figmaSource?.fileName ?? figmaSource?.fileKey ?? 'Figma 파일'
  }
  return '업로드된 시안'
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
  sourceType: SourceType,
  figmaSource?: FigmaSource | null
): Promise<AnalysisResult> {
  const frame = fallbackFrame(frames)
  const label = sourceLabel(sourceType, figmaSource)

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
          sourceType === 'figma'
            ? 'Figma 연결은 되었지만 실제 prototype reaction 파싱은 아직 연결 전이므로 플로우 확신도가 제한됩니다.'
            : '업로드된 화면 순서가 실제 사용자 플로우와 다르면 태스크 시뮬레이션 정확도가 떨어집니다.',
        taskMetric: '핵심 태스크 완료율 68%, 평균 클릭 6.4회로 추정',
        suggestion:
          sourceType === 'figma'
            ? '다음 단계에서 Figma versionId, nodeId, prototype connection을 함께 저장하도록 확장하세요.'
            : '화면 이름과 순서를 실제 태스크 흐름에 맞게 정리한 뒤 테스트를 실행하세요.',
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
      sourceType === 'figma'
        ? 'Demo AI Mode는 Figma 링크와 화면 메타데이터를 기준으로 빠른 UX 점검 결과를 생성했습니다. 실제 화면 이미지 이해나 프로토타입 연결 자동 탐색은 아직 제한적이므로, 이번 결과는 제품 흐름 검증용 초안으로 보는 것이 적절합니다. 개인 액세스 토큰을 연결하면 Figma 프레임 이미지를 가져와 분석 정확도를 높일 수 있습니다.'
        : 'Demo AI Mode는 업로드된 화면 순서와 기본 UX 체크리스트를 기준으로 빠른 점검 결과를 생성했습니다. API 키 없이 즉시 제품 흐름을 확인하기 위한 모드이므로, 실제 화면 세부 분석은 Gemini 무료 키 연결 후 재실행하는 것이 좋습니다.',
    walkthrough: buildWalkthrough(frames, personas),
  }
}

function variantFrames(variants: DesignVariant[], variantId: VariantId): Frame[] {
  return variants.find((variant) => variant.id === variantId)?.frames ?? []
}

export async function analyzeABDesignDemo(
  variants: DesignVariant[],
  personas: PersonaConfig[],
  abConfig: ABTestConfig
): Promise<AnalysisResult> {
  const framesA = variantFrames(variants, 'A')
  const framesB = variantFrames(variants, 'B')
  const firstFrame = fallbackFrame([...framesA, ...framesB])
  const winner: VariantId | 'tie' = framesB.length >= framesA.length ? 'B' : 'A'
  const comparison: ABComparison = {
    winner,
    confidence: 64,
    summary: `${winner}안이 현재 입력된 화면 구성 기준으로 태스크 흐름 설명력이 더 높아 보입니다.`,
    recommendation:
      'Demo 결과는 정식 트래픽 실험이 아니라 구조 기반 사전 점검입니다. 실제 적용 전에는 CTA 문구, 첫 화면 가치 전달, 단계 수를 기준으로 한 번 더 비교하세요.',
    keyInsights: [
      abConfig.goal || '테스트 목적을 명확히 쓰면 비교 기준이 더 안정적입니다.',
      'A/B 비교에서는 같은 플로우 지점의 화면을 같은 순서로 넣어야 합니다.',
      '페르소나별 선호 차이를 보면 어떤 타겟에서 승자가 갈리는지 확인할 수 있습니다.',
    ],
    variantScores: [
      {
        variantId: 'A',
        axisScores: AXES.map((axis, index) => ({
          ...axis,
          score: [70, 60, 64, 68, 62, 59][index] ?? 64,
        })),
        taskMetrics: { completionRate: 64, avgClicks: 6.8, errorRate: 20, dropoffPoint: '중간 단계 CTA' },
        strengths: ['정보량이 충분함', '기존 사용자에게 익숙한 구조'],
        weaknesses: ['첫 CTA가 상대적으로 약함', '단계 간 차이가 뚜렷하지 않을 수 있음'],
      },
      {
        variantId: 'B',
        axisScores: AXES.map((axis, index) => ({
          ...axis,
          score: [76, 68, 70, 72, 64, 67][index] ?? 69,
        })),
        taskMetrics: { completionRate: 72, avgClicks: 5.9, errorRate: 15, dropoffPoint: '결과 확인 전환부' },
        strengths: ['전환 경로가 더 직접적임', '처음 보는 사용자에게 행동 유도가 빠름'],
        weaknesses: ['세부 설명이 부족하면 신뢰 형성이 약할 수 있음'],
      },
    ],
    personaPreferences: personas.map((persona) => ({
      personaId: persona.id,
      personaName: persona.name,
      preferredVariant: persona.digitalLevel === 'beginner' ? 'B' : winner,
      reason:
        persona.digitalLevel === 'beginner'
          ? '초급 사용자는 짧고 직접적인 안내와 CTA가 있는 쪽을 더 선호합니다.'
          : '목표 달성까지의 단계가 짧고 비교 기준이 명확한 쪽을 선호합니다.',
    })),
  }

  return {
    axisScores: AXES.map((axis, index) => ({
      ...axis,
      score: [73, 66, 68, 70, 63, 65][index] ?? 67,
    })),
    findings: [
      {
        id: 'demo-ab-f1',
        severity: 'warning',
        axis: 1,
        axisLabel: '첫인상 & 가치 전달',
        heuristic: '닐슨 #8 미적이고 최소한의 디자인',
        problem: 'A/B안 모두 첫 화면에서 비교 가설과 성공 기준이 명확히 반영되어야 합니다.',
        taskMetric: '승자 확신도 64%',
        suggestion: '테스트 목적과 비교 기준을 더 구체적으로 입력한 뒤 재실행하세요.',
        frameId: firstFrame.id,
      },
    ],
    taskMetrics: { completionRate: 70, avgClicks: 6.1, errorRate: 16, dropoffPoint: '전환 CTA' },
    overallSummary:
      'Demo AI Mode가 A/B 화면 구성을 기준으로 사전 비교 리포트를 만들었습니다. 이 결과는 정식 AI 비전 분석이 아니라 구조/체크리스트 기반 판단이므로, 빠른 방향성 확인에 적합합니다.',
    walkthrough: buildWalkthrough([...framesA, ...framesB], personas),
    abComparison: comparison,
  }
}
