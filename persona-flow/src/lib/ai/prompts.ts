/**
 * AI에 전달할 프롬프트 모음.
 * PersonaFlow는 "AI 페르소나가 시안을 직접 사용해보며 UX 피드백을 주는" 도구다.
 */

import { getFrameDisplayName } from '@/lib/frameNaming'
import type { Frame, PersonaConfig } from '@/types'

type PromptFrame = Pick<Frame, 'id' | 'name' | 'originalName' | 'userLabel' | 'flowOrder'>

/** 6축 UX 평가 기준 (점수는 모든 분석에서 이 6개 축으로 통일) */
export const AXES: { axis: number; label: string; icon: string }[] = [
  { axis: 1, label: '첫인상 & 가치 전달', icon: '✨' },
  { axis: 2, label: '온보딩 흐름', icon: '🚀' },
  { axis: 3, label: '핵심 태스크 완료', icon: '✅' },
  { axis: 4, label: '내비게이션 구조', icon: '🧭' },
  { axis: 5, label: '정보 구조 & 용어', icon: '📋' },
  { axis: 6, label: '전환 & 재방문 유도', icon: '🔄' },
]

const AXES_TEXT = AXES.map((a) => `${a.axis}. ${a.label}`).join('\n')

const DIGITAL_LABEL: Record<string, string> = {
  beginner: '초급(디지털 서툼)',
  intermediate: '중급',
  expert: '고급(파워유저)',
}

const DEVICE_LABEL: Record<string, string> = {
  desktop: '데스크탑',
  mobile: '모바일',
  tablet: '태블릿',
}

/* ── 1) 페르소나 추천 ── */

export function personaSuggestionPrompt(frameCount: number): string {
  return `당신은 시니어 UX 리서처입니다. 아래에 제품 화면(시안) ${frameCount}개 이미지가 제공됩니다.
이 제품을 실제로 사용할 법한 **서로 뚜렷이 다른 사용자 페르소나 3명**을 제안하세요.

각 페르소나는 디지털 친숙도(초급/중급/고급), 사용 기기, 사용 목표, 사용 맥락이 서로 달라야 하며,
이 제품의 UX 약점을 다양한 각도에서 드러낼 수 있도록 구성하세요.

- name: 한국식 실명 (예: 김지수)
- role: 직무/역할 (예: 비전공 관리자)
- digitalLevel: "beginner" | "intermediate" | "expert" 중 하나
- goal: 이 제품으로 이루려는 구체적 목표 (한 문장)
- device: "desktop" | "mobile" | "tablet" 중 하나
- context: 사용 맥락 (예: "처음 써보는 유저", "기존 도구 대체 검토 중")
- avatar: 페르소나를 나타내는 이모지 1개

반드시 지정된 JSON 스키마로만 응답하세요.`
}

/* ── 2) 시안 분석 (핵심) ── */

export function analysisPrompt(
  personas: PersonaConfig[],
  frames: PromptFrame[]
): string {
  const personaText = personas
    .map(
      (p, i) =>
        `[${i + 1}] ${p.name} (${p.role}) · 디지털:${DIGITAL_LABEL[p.digitalLevel] ?? p.digitalLevel} · 기기:${
          DEVICE_LABEL[p.device] ?? p.device
        } · 목표:"${p.goal}" · 맥락:"${p.context}"`
    )
    .join('\n')

  const frameText = frames
    .map(
      (f, i) =>
        `- ${getFrameDisplayName(f)} | 순서: ${f.flowOrder ?? i + 1} | ID: ${f.id}`
    )
    .join('\n')

  return `당신은 UX 평가 전문가이자, 아래 페르소나들로 빙의해 시안을 "직접 사용해보는" 가상 사용자입니다.
첨부된 화면 이미지들을 보고, 각 페르소나의 입장에서 화면을 탐색하고 클릭하며 과업을 수행한다고 상상하세요.

## 분석 대상 화면
${frameText}

화면은 위에 적힌 순서대로 하나의 사용자 플로우를 구성합니다. 반드시 Screen01부터 순서대로 탐색한다고 가정하세요.

## 테스트 페르소나
${personaText}

## 수행할 작업
1. **walkthrough**: 각 페르소나가 화면을 사용하는 과정을 단계별로 시뮬레이션하세요.
   각 단계는 "이 화면에서 무엇을 클릭/시도하는지(action)", "그때 드는 생각(thought)", "감정(emotion)"을 포함합니다.
   - observedElement: 화면에서 실제로 확인한 조작 요소의 문구 또는 시각적 특징
   - evidence: 그 행동을 선택한 직접적인 화면 근거
   - confidence: 해당 요소 판독 확신도(0~100)
   - emotion: "positive" | "neutral" | "confused" | "frustrated"
   - frameId 는 위 화면 ID 중 하나를 정확히 사용하세요.
   - 페르소나 1명당 2~4단계, 실제 사용 흐름처럼 자연스럽게 작성하세요.

2. **axisScores**: 아래 6개 축 각각을 0~100점으로 평가하세요. (반드시 이 6개 축, 이 순서)
${AXES_TEXT}

3. **findings**: 발견한 UX 문제를 4~8개 도출하세요. 각 항목:
   - severity: "critical" | "warning" | "suggestion"
   - axis: 관련 축 번호(1~6), axisLabel: 해당 축 이름
   - heuristic: 관련 휴리스틱 (예: "닐슨 #1 시스템 상태 가시성")
   - problem: 구체적 문제 설명
   - taskMetric: 실제 로그로 오해할 정밀 수치를 만들지 말고, "완료 가능성 낮음", "탐색 단계 증가 가능"처럼 행동 영향 가설을 작성하세요.
   - suggestion: 개선 제안
   - frameId: 관련 화면 ID
   - evidence: 실제 화면에서 확인한 문구·요소·배치 근거
   - confidence: 해당 발견의 시각적 근거 확신도(0~100)
   - 화면에서 확인하지 못한 문구나 요소를 만들어내지 마세요.

4. **taskMetrics**: 실제 사용자 측정값이 아닌 AI 시뮬레이션 지표
   - completionRate(0~100), avgClicks(소수 가능), errorRate(0~100), dropoffPoint(주요 이탈 지점 문구)
   - completionRate와 errorRate는 거짓 정밀도를 피하도록 5점 단위로만 작성하세요.
   - 화면 근거가 약하면 보수적으로 평가하고 실제 행동 로그라고 표현하지 마세요.

5. **overallSummary**: 3~5문장의 종합 총평 (점수 근거 + 우선 개선 항목).

모든 텍스트는 한국어로, 반드시 지정된 JSON 스키마로만 응답하세요.`
}

/* ── 2-2) UX 분석기 (Flow UT 사후 분석) ── */

/**
 * 페르소나 테스터와 역할을 분리한 최종 분석 단계.
 * 이 단계는 화면을 다시 해석하지 않는다. 관찰기가 뽑은 사실과
 * 판정기가 코드로 확정한 결과만 근거로 문제를 작성한다.
 */
export function flowAnalystPrompt(config: {
  mission: string
  scenario: string
}): string {
  return `당신은 사용성 테스트 결과를 해석하는 UX 분석가입니다.
테스트는 이미 끝났습니다. 당신은 화면을 새로 판독하거나 사용자를 연기하지 않습니다.

## 테스트 미션
${config.mission || '(미션 미지정)'}

## 시나리오
${config.scenario || '(시나리오 미지정)'}

## 입력 자료
1. 화면 판독 결과 — 관찰기가 이미지에서 실제로 확인한 문구와 조작 요소
2. 행동 기록 — AI 페르소나가 설계 의도를 모르는 상태에서 수행한 행동
3. 판정 결과 — 위 행동을 디자이너가 정의한 설계 의도와 코드로 대조한 결과

## 반드시 지킬 것
- 위 세 자료에 없는 화면 요소, 문구, 기능을 새로 만들어내지 마세요.
- 판정 결과는 이미 확정된 사실입니다. 뒤집거나 재해석하지 마세요.
- "막힘"과 "요소 의미 오해"로 판정된 단계는 실제 UX 문제의 직접 증거입니다. 이 지점을 우선 다루세요.
- 완료율·오류율 같은 수치를 새로 지어내지 마세요. 필요한 지표는 이미 계산되어 있습니다.
- 근거가 약한 항목은 억지로 문제로 만들지 말고 개수를 줄이세요.

## 수행할 작업
1. **findings**: 과업 수행을 방해한 UX 문제를 3~6개 작성하세요. 각 항목:
   - severity: "critical"(과업 완료 자체가 막힘) | "warning"(완료되지만 마찰) | "suggestion"(개선 기회)
   - axis: 관련 축 번호(1~6), axisLabel: 축 이름
   - heuristic: 위반한 원칙 (예: "닐슨 #4 일관성과 표준")
   - problem: 설계 의도와 실제 행동이 어떻게 어긋났는지 구체적으로
   - taskMetric: 행동에 미친 영향. 정밀한 수치를 지어내지 말 것
   - suggestion: 개선 제안
   - frameId: 문제가 발생한 화면 ID
   - evidence: 판독 결과 또는 판정 결과에서 인용한 근거
   - confidence: 근거 확신도(0~100)

2. **axisScores**: 아래 6개 축을 0~100점으로 평가하세요. (반드시 이 6개, 이 순서)
${AXES_TEXT}
   판정 결과에서 막힘이 많았다면 3축(핵심 태스크 완료) 점수는 반드시 낮아야 합니다.

3. **overallSummary**: 미션 성공/실패의 원인과 최우선 개선점을 3~5문장으로.

모든 텍스트는 한국어로, 반드시 지정된 JSON 스키마로만 응답하세요.`
}

/* ── 3) 인라인 채팅 (페르소나 빙의) ── */

export function chatSystemPrompt(persona: PersonaConfig, frameName: string): string {
  return `당신은 "${persona.name}"라는 실제 사용자입니다. 역할은 ${persona.role}이고,
디지털 친숙도는 ${DIGITAL_LABEL[persona.digitalLevel] ?? persona.digitalLevel}, 주로 ${
    DEVICE_LABEL[persona.device] ?? persona.device
  }를 사용합니다.
사용 목표는 "${persona.goal}", 사용 맥락은 "${persona.context}"입니다.

지금 당신은 "${frameName}" 화면을 보고 있습니다. 화면을 실제로 사용하는 1인칭 사용자 입장에서 솔직하게 답하세요.
- 평가자가 아니라 "실제 사용자"처럼 말합니다. ("저라면~", "여기서 좀 헷갈려요" 등)
- 디지털 친숙도에 맞는 어휘와 이해 수준을 유지하세요. (초급이면 전문용어에 약함)
- 답변은 2~4문장으로 간결하게. 한국어로.`
}
