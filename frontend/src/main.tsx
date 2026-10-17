import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Calm type, bundled so the demo works offline: Atkinson Hyperlegible Next (text) and Mono (numbers).
import '@fontsource/atkinson-hyperlegible-next/400.css'
import '@fontsource/atkinson-hyperlegible-next/400-italic.css'
import '@fontsource/atkinson-hyperlegible-next/500.css'
import '@fontsource/atkinson-hyperlegible-next/600.css'
import '@fontsource/atkinson-hyperlegible-next/700.css'
import '@fontsource/atkinson-hyperlegible-mono/400.css'
import '@fontsource/atkinson-hyperlegible-mono/500.css'
import '@fontsource/atkinson-hyperlegible-mono/600.css'
import 'leaflet/dist/leaflet.css'
import './index.css'
import App from './App.tsx'
import { DensityProvider } from './density'
import { ThemeProvider } from './theme'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <DensityProvider>
        <App />
      </DensityProvider>
    </ThemeProvider>
  </StrictMode>,
)
