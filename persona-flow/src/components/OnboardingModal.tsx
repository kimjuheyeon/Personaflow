import { useState } from 'react'
import { ArrowRight, Check, FileImage, Sparkles, Target, Users, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import onboardingImage from '@/assets/onboarding/persona-analysis.jpg'

const STEPS = [
  {
    eyebrow: 'PersonaFlow에 오신 것을 환영합니다',
    title: '디자인을 보여주면,\n사용자의 반응을 먼저 만납니다.',
    description:
      'AI 페르소나가 실제 타깃 사용자의 관점으로 화면을 살펴보고 이해도, 탐색 흐름, 전환 장벽을 분석합니다.',
    features: [
      { icon: Users, label: '다양한 사용자 관점' },
      { icon: Sparkles, label: 'AI 기반 행동 분석' },
      { icon: Target, label: '실행 가능한 UX 인사이트' },
    ],
  },
  {
    eyebrow: '테스트 진행 방식',
    title: '네 단계면 충분합니다.',
    description:
      '분석할 디자인을 준비하고 타깃 페르소나를 설정하세요. PersonaFlow가 테스트를 실행하고 하나의 리포트로 정리합니다.',
    features: [
      { icon: FileImage, label: '1. Figma 또는 이미지 추가' },
      { icon: Users, label: '2. 타깃 페르소나 설정' },
      { icon: Sparkles, label: '3. AI 테스트 실행' },
      { icon: Check, label: '4. UX 리포트 확인' },
    ],
  },
  {
    eyebrow: '시작하기 전에',
    title: '디자인 화면만 준비하세요.',
    description:
      'Figma 링크나 PNG/JPG 화면을 사용할 수 있습니다. 실제 AI 분석을 실행할 때는 무료 Gemini API 키가 필요합니다.',
    features: [
      { icon: FileImage, label: 'Figma 링크 또는 이미지 파일' },
      { icon: Target, label: '확인하고 싶은 테스트 목표' },
      { icon: Sparkles, label: 'Gemini API 키 · 브라우저에만 저장' },
    ],
  },
] as const

interface OnboardingModalProps {
  open: boolean
  onClose: () => void
  onComplete: () => void
}

export default function OnboardingModal({ open, onClose, onComplete }: OnboardingModalProps) {
  const [step, setStep] = useState(0)

  if (!open) return null

  const current = STEPS[step]
  const isLast = step === STEPS.length - 1

  const handleComplete = () => {
    setStep(0)
    onComplete()
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-6">
      <button
        type="button"
        aria-label="온보딩 닫기"
        className="absolute inset-0 cursor-default bg-black/70 backdrop-blur-md"
        onClick={onClose}
      />

      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        className="relative grid w-full max-w-[920px] overflow-hidden rounded-[24px] border border-white/10 bg-[#1c1c1e] shadow-2xl lg:grid-cols-[1.05fr_0.95fr]"
      >
        <button
          type="button"
          aria-label="온보딩 닫기"
          onClick={onClose}
          className="absolute right-5 top-5 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-black/35 text-white/70 backdrop-blur-md transition hover:bg-black/55 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="relative min-h-[560px] overflow-hidden bg-black">
          <img
            src={onboardingImage}
            alt="AI 페르소나가 디자인 화면을 분석하는 모습"
            className="absolute inset-0 h-full w-full object-cover object-center"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/15 to-transparent" />
          <div className="absolute bottom-8 left-8 right-8">
            <p className="max-w-sm text-[13px] leading-relaxed text-white/55">
              디자인 화면에서 발견된 반응과 행동 신호를 한눈에 볼 수 있는 리포트로 정리합니다.
            </p>
          </div>
        </div>

        <div className="flex min-h-[560px] flex-col p-9 lg:p-10">
          <div className="mb-8 flex gap-1.5" aria-label={`${step + 1} / ${STEPS.length} 단계`}>
            {STEPS.map((_, index) => (
              <span
                key={index}
                className={`h-1 rounded-full transition-all ${
                  index === step ? 'w-8 bg-[#2997ff]' : 'w-3 bg-white/15'
                }`}
              />
            ))}
          </div>

          <p className="text-sm font-medium text-[#2997ff]">{current.eyebrow}</p>
          <h2
            id="onboarding-title"
            className="mt-4 whitespace-pre-line text-[34px] font-semibold leading-[1.14] tracking-[-0.03em] text-white"
          >
            {current.title}
          </h2>
          <p className="mt-5 text-[16px] leading-7 text-white/60">{current.description}</p>

          <div className="mt-8 space-y-3">
            {current.features.map(({ icon: Icon, label }) => (
              <div
                key={label}
                className="flex items-center gap-3 rounded-[12px] border border-white/8 bg-white/[0.04] px-4 py-3.5"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#2997ff]/15 text-[#2997ff]">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="text-sm text-white/80">{label}</span>
              </div>
            ))}
          </div>

          <div className="mt-auto flex items-center justify-between pt-8">
            <button
              type="button"
              onClick={handleComplete}
              className="text-sm text-white/40 transition hover:text-white/70"
            >
              건너뛰기
            </button>
            <div className="flex items-center gap-2">
              {step > 0 && (
                <Button variant="outline" onClick={() => setStep((value) => value - 1)}>
                  이전
                </Button>
              )}
              <Button onClick={isLast ? handleComplete : () => setStep((value) => value + 1)}>
                {isLast ? '테스트 시작하기' : '다음'}
                {!isLast && <ArrowRight className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
