import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import '@/assets/popup.css'
import '@/assets/resume-editor.css'
import { ResumeEditor } from '@/features/resume-editor/ResumeEditor'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ResumeEditor />
  </StrictMode>
)
