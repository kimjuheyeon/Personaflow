/**
 * Gemini에 전달할 프롬프트 모음.
 * PersonaFlow는 "AI 페르소나가 시안을 직접 사용해보며 UX 피드백을 주는" 도구다.
 */

import { getFrameDisplayName } from '@/lib/frameNaming'
import type { ABTestConfig, DesignVariant, Frame, PersonaConfig } from '@/types'

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
   - taskMetric: 그로 인한 정량적 영향 추정 (예: "완료율 34%, 클릭 +3회")
   - suggestion: 개선 제안
   - frameId: 관련 화면 ID

4. **taskMetrics**: 전체 추정 지표
   - completionRate(0~100), avgClicks(소수 가능), errorRate(0~100), dropoffPoint(주요 이탈 지점 문구)

5. **overallSummary**: 3~5문장의 종합 총평 (점수 근거 + 우선 개선 항목).

모든 텍스트는 한국어로, 반드시 지정된 JSON 스키마로만 응답하세요.`
}

/* ── 2-1) 화면 A/B 테스트 분석 ── */

export function abAnalysisPrompt(
  personas: PersonaConfig[],
  variants: DesignVariant[],
  config: ABTestConfig
): string {
  const personaText = personas
    .map(
      (p, i) =>
        `[${i + 1}] ${p.name} (${p.role}) · 디지털:${DIGITAL_LABEL[p.digitalLevel] ?? p.digitalLevel} · 기기:${
          DEVICE_LABEL[p.device] ?? p.device
        } · 목표:"${p.goal}" · 맥락:"${p.context}"`
    )
    .join('\n')

  const variantText = variants
    .map((variant) => {
      const frameText = variant.frames
        .map(
          (frame, i) =>
            `  - ${variant.id}안 ${getFrameDisplayName(frame)} | 순서: ${
              frame.flowOrder ?? i + 1
            } | ID: ${frame.id}`
        )
        .join('\n')
      return `${variant.name} (${variant.id}안)\n${frameText}`
    })
    .join('\n\n')

  return `당신은 UX 리서처이자 실험 설계자입니다. 아래 A안/B안 화면 이미지를 같은 페르소나 기준으로 비교 평가하세요.
이 테스트는 실제 트래픽 실험이 아니라, AI 페르소나가 두 시안을 모두 사용해보는 가상 A/B 테스트입니다.

## 테스트 목적
${config.goal || '두 화면안 중 사용자 이해와 전환 가능성이 더 높은 안을 찾기'}

## A/B 가설
${config.hypothesis || '두 화면안의 정보 구조, 카피, CTA 차이가 사용자의 이해와 행동에 영향을 줄 것이다.'}

## 비교 기준
${config.criteria.length > 0 ? config.criteria.map((item) => `- ${item}`).join('\n') : '- 첫인상\n- 이해도\n- 전환 유도'}

## 비교 대상 화면
${variantText}

A안과 B안의 같은 Screen 번호는 같은 플로우 지점의 대응 화면입니다. 각 안은 Screen01부터 순서대로 사용한다고 가정하세요.

## 테스트 페르소나
${personaText}

## 수행할 작업
1. **walkthrough**: 각 페르소나가 A안과 B안을 사용해보는 과정을 단계별로 시뮬레이션하세요.
   - frameId는 반드시 위 화면 ID 중 하나를 사용하세요.
   - action/thought/emotion을 포함하세요.
   - emotion: "positive" | "neutral" | "confused" | "frustrated"

2. **axisScores**: A/B 전체를 종합한 최종 추천 관점의 6축 점수를 0~100점으로 평가하세요. (반드시 아래 6개 축, 이 순서)
${AXES_TEXT}

3. **findings**: A안/B안/공통 문제를 합쳐 5~10개 도출하세요.
   - problem에는 "A안:", "B안:", "공통:" 중 어느 범위의 문제인지 명시하세요.
   - frameId는 관련 화면 ID를 넣으세요.

4. **taskMetrics**: 추천안 기준의 전체 추정 지표를 작성하세요.

5. **overallSummary**: A/B 테스트의 종합 총평을 3~5문장으로 작성하세요.

6. **abComparison**:
   - winner: "A" | "B" | "tie"
   - confidence: 0~100, 승자 판단 확신도
   - summary: 왜 그 안이 우세한지 요약
   - recommendation: 실제 적용 권고안. 필요하면 "A안 구조 + B안 CTA"처럼 합성 제안
   - keyInsights: 핵심 비교 인사이트 3~5개
   - variantScores: A안과 B안 각각의 6축 점수, taskMetrics, strengths, weaknesses
   - personaPreferences: 각 페르소나가 선호한 안과 이유

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
