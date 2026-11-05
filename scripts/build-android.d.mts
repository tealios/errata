export function assembleMobileWww(options?: {
  root?: string
  outputDir?: string
  wwwDir?: string
}): Promise<string[]>

export function productionBuildEnv(env?: NodeJS.ProcessEnv): NodeJS.ProcessEnv & { NODE_ENV: string }
