import { readFileSync } from 'node:fs'
import svgr from 'vite-plugin-svgr'
import { defineConfig } from 'wxt'

const pkg = JSON.parse(readFileSync('./package.json', 'utf8'))

// See https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  vite: () => ({
    plugins: [svgr({ include: '**/*.svg' })],
  }),
  manifest: {
    name: 'Offer Pilot · AI 简历填表助手',
    description: '维护一份标准简历，AI 自动映射并填写任意网申表单（不自动提交）',
    version: pkg.version,
    minimum_chrome_version: '114',
    permissions: ['storage', 'sidePanel'],
    host_permissions: ['http://*/*', 'https://*/*'],
    action: {
      default_title: 'Offer Pilot · AI 简历填表助手',
      default_icon: {
        '16': 'icons/icon16.png',
        '48': 'icons/icon48.png',
        '128': 'icons/icon128.png',
      },
    },
    icons: {
      '16': 'icons/icon16.png',
      '48': 'icons/icon48.png',
      '128': 'icons/icon128.png',
    },
    side_panel: {
      default_path: 'sidepanel/index.html',
    },
  },
})
