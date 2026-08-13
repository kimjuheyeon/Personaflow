import { rm } from 'node:fs/promises'
import path from 'node:path'

const workspaceRoot = process.cwd()
const outputDirectory = path.resolve(workspaceRoot, 'dist')

if (
  path.basename(outputDirectory) !== 'dist' ||
  path.dirname(outputDirectory) !== path.resolve(workspaceRoot)
) {
  throw new Error(`Refusing to clean unexpected build directory: ${outputDirectory}`)
}

await rm(outputDirectory, { recursive: true, force: true })
