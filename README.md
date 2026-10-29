# PersonaFlow

AI 페르소나가 Figma 시안을 직접 탐색하고 UX 리포트를 만들어 주는 자동 유저테스트 도구입니다.
AI는 Claude를 사용하며, 연결 방식은 두 가지입니다.

| | 내 Claude 구독 | 회사 API 키 |
|---|---|---|
| 쓰는 곳 | 내 PC에서 로컬 실행 | Vercel 배포 사이트 (전사 공유) |
| 비용 | Claude Pro/Max 구독 사용량 | Anthropic API 사용량만큼 별도 과금 |
| 필요한 것 | Claude Code 설치 + 구독 계정 로그인 | console.anthropic.com에서 발급한 API 키 |
| 다른 사람과 공유 | 불가 (구독은 개인 계정) | 가능 (접근 코드로 제한) |

브라우저는 모델을 직접 호출하지 않고 항상 `/api/claude`를 거칩니다. 키나 로그인 정보는 브라우저로 내려가지 않습니다.

---

## 1. 내 Claude 구독으로 실행 (로컬)

Claude 구독은 claude.ai와 Claude Code에서만 쓸 수 있으므로, 이 PC의 Claude Code 로그인을 빌려 씁니다.

1. Node.js 20 이상과 [Claude Code](https://code.claude.com/docs/en/setup)를 설치합니다.
2. 구독 계정으로 로그인합니다.
   ```bash
   claude auth login
   ```
3. 의존성을 설치하고 실행합니다.
   ```bash
   npm run setup
   npm run dev
   ```
4. 터미널에 `Claude: 내 Claude 구독 (Claude Code 로그인)`이 보이면 http://localhost:5173 을 엽니다.

- 분석 한 번에 여러 번의 모델 호출이 일어나므로 구독 사용 한도가 빨리 줄 수 있습니다. 한도에 걸리면 초기화 후 다시 시도하세요.
- 셸에 `ANTHROPIC_API_KEY`가 있어도 구독 모드에서는 무시합니다(구독 사용량으로만 호출).
- `claude` 명령을 PATH에서 찾지 못하면 `persona-flow/.env.local`에 `CLAUDE_CLI_PATH`로 실행 파일 경로를 지정하세요.
  Windows는 공식 설치 프로그램(claude.exe)을 권장합니다. npm으로 설치해 `claude.cmd`만 있다면
  `CLAUDE_CLI_PATH`에 패키지의 `cli.js` 경로(예: `%APPDATA%\npm\node_modules\@anthropic-ai\claude-code\cli.js`)를 지정하세요.

## 2. 회사 API 키로 전사 배포 (Vercel)

1. [Anthropic Console](https://console.anthropic.com)에서 회사(또는 팀) 워크스페이스를 만들고 API 키를 발급합니다.
   워크스페이스에 **월 사용 한도(spend limit)**를 걸어 두면 비용 사고를 막을 수 있습니다.
2. Vercel 프로젝트 → Settings → Environment Variables에 다음을 등록합니다.

   | 이름 | 값 | 설명 |
   |---|---|---|
   | `ANTHROPIC_API_KEY` | `sk-ant-...` | 회사 API 키. 서버에만 저장됩니다 |
   | `PERSONAFLOW_ACCESS_CODE` | 임의의 문자열 | 접근 코드(필수). 없으면 배포 사이트에서 AI 호출이 막힙니다 |

3. 재배포한 뒤 팀원에게 **사이트 주소와 접근 코드**를 공유합니다. 팀원은 첫 화면의 "Claude 연결 → 연결 설정"에서 코드를 한 번 입력하면 됩니다.
4. 접근 코드를 바꾸면 기존 코드는 즉시 막힙니다(환경변수 수정 후 재배포).

참고
- Vercel 함수 실행 시간은 300초로 설정되어 있습니다(`vercel.json`). 화면이 많아 시간이 부족하면 Pro 플랜에서 늘리거나 Sonnet 모델을 쓰세요.
- 화면 이미지는 Anthropic Files API에 올려 분석하며 24시간 뒤 자동 삭제됩니다.
- 사내 SSO(Google Workspace 등)로 접근을 제한하려면 Vercel의 Deployment Protection이나 Cloudflare Access를 앞에 두는 방식을 추가로 고려하세요.
- Figma 화면은 각자 자신의 Figma 개인 액세스 토큰으로 가져옵니다(본인이 볼 수 있는 파일만 접근).

로컬에서 회사 키 모드를 시험하려면 `persona-flow/.env.local` 파일을 만들고(깃에 올라가지 않음) 다시 `npm run dev` 하세요.
```
CLAUDE_BACKEND=api
ANTHROPIC_API_KEY=sk-ant-...
# PERSONAFLOW_ACCESS_CODE=원하는-코드
```

---

## 사용 흐름

1. **Claude 연결** 확인 (구독 또는 회사 키, 필요하면 접근 코드)
2. **Figma 프레임 링크** 붙여넣기 — 화면마다 프레임을 선택한 링크(`...?node-id=...`)
3. **Figma 접근 권한** — Figma 개인 액세스 토큰 입력 후 화면 이미지 가져오기
4. 미션·Flow 설정 → 페르소나 설정 → AI 테스트 실행 → 리포트

## 구조

```
api/claude.js                      Vercel 함수 (회사 API 키 모드)
api/figma.js                       Figma API 프록시
server/claude/handler.js           /api/claude 공통 처리 (접근 코드, 요청 검증)
server/claude/apiBackend.js        회사 API 키 → Claude API
server/claude/subscriptionBackend.js  내 구독 → 로컬 Claude Code CLI
persona-flow/                      React 앱 (vite.config.ts가 로컬에서 /api/claude 제공)
```
