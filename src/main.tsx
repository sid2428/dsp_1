import '@xyflow/react/dist/style.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'
import { warmUpWorker } from './worker/dsp-client'

const root = document.getElementById('root')
if (!root) throw new Error('Root element #root not found')

warmUpWorker()

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
