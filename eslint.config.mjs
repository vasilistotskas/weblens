import baseConfig from '@hono/eslint-config'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  // Global ignores (flat config has no .eslintignore).
  { ignores: ["dist/**", "mcp-server/**", "node_modules/**", "coverage/**"] },
  ...baseConfig,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  }
)
