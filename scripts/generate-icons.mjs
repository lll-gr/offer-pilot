/**
 * 从 assets/logo.svg 生成扩展图标 PNG（16/48/128）与 README 演示图（512）。
 * 幂等：重复运行覆盖产出。产物进 git，CI 发布前再跑一次保证最新。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Resvg } from '@resvg/resvg-js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const svgSource = await readFile(resolve(root, 'assets/logo.svg'), 'utf8')

const TARGETS = [
  { size: 16, out: 'public/icons/icon16.png' },
  { size: 48, out: 'public/icons/icon48.png' },
  { size: 128, out: 'public/icons/icon128.png' },
  { size: 512, out: 'docs/logo-512.png' },
]

await mkdir(resolve(root, 'public/icons'), { recursive: true })
await mkdir(resolve(root, 'docs'), { recursive: true })

for (const { size, out } of TARGETS) {
  const resvg = new Resvg(svgSource, {
    fitTo: { mode: 'width', value: size },
  })
  const png = resvg.render().asPng()
  const target = resolve(root, out)
  await writeFile(target, png)
  console.log(`generated ${out} (${size}x${size}, ${(png.length / 1024).toFixed(1)} kB)`)
}
