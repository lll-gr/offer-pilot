import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import '@/assets/popup.css'
import { SidepanelApp } from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SidepanelApp />
  </StrictMode>
)
