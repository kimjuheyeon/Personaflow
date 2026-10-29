/**
 * Claude API 프록시 (Vercel 서버리스 함수) — 회사 API 키 모드.
 *
 * 회사 API 키(ANTHROPIC_API_KEY)는 서버 환경변수에만 두고 브라우저로 내려보내지 않는다.
 * PERSONAFLOW_ACCESS_CODE가 설정되어 있으면 같은 코드를 가진 사람만 호출할 수 있다.
 * 구독 모드는 로컬 실행 전용이며 persona-flow/vite.config.ts에서 연결한다.
 */

import { createApiBackend } from '../server/claude/apiBackend.js'
import { createClaudeHandler } from '../server/claude/handler.js'

export default createClaudeHandler(createApiBackend())
