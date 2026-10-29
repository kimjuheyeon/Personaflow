import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

/** 서버 쪽 설정. 셸 환경변수가 없으면 persona-flow/.env.local 값을 쓴다 (Windows에서도 동일하게 동작) */
const SERVER_ENV_KEYS = [
  'CLAUDE_BACKEND',
  'CLAUDE_CLI_PATH',
  'ANTHROPIC_API_KEY',
  'PERSONAFLOW_ACCESS_CODE',
]

/**
 * 로컬 실행(npm run dev)에서 /api/claude를 제공한다.
 * 기본은 이 PC의 Claude Code 로그인(구독)을 쓰고,
 * CLAUDE_BACKEND=api이면 ANTHROPIC_API_KEY(회사 키)로 호출한다.
 */
function claudeApiPlugin(): Plugin {
  return {
    name: 'personaflow-claude-api',
    apply: 'serve',
    async configureServer(server) {
      const fileEnv = loadEnv(server.config.mode, server.config.envDir || process.cwd(), '')
      for (const key of SERVER_ENV_KEYS) {
        if (!process.env[key] && fileEnv[key]) process.env[key] = fileEnv[key]
      }
      const { createClaudeHandler } = await import('../server/claude/handler.js')
      const backend =
        process.env.CLAUDE_BACKEND === 'api'
          ? (await import('../server/claude/apiBackend.js')).createApiBackend()
          : (await import('../server/claude/subscriptionBackend.js')).createSubscriptionBackend()
      const handler = createClaudeHandler(backend)
      server.config.logger.info(
        `  ➜  Claude: ${backend.name === 'api' ? '회사 API 키 (ANTHROPIC_API_KEY)' : '내 Claude 구독 (Claude Code 로그인)'}`
      )
      server.middlewares.use('/api/claude', (req, res) => {
        void handler(req, res)
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), claudeApiPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
