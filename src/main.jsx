import { StrictMode, Component } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// Unregister stale service workers that might be serving cached old code
if (navigator.serviceWorker) {
  navigator.serviceWorker.getRegistrations()
    .then(regs => regs.forEach(r => r.unregister()))
    .catch(() => {})
}

// Show any uncaught JS errors on-screen (instead of black screen)
function showError(msg) {
  const root = document.getElementById('root')
  if (root) {
    root.innerHTML = `<div style="padding:24px;color:#ff3864;font-family:monospace;font-size:13px;line-height:1.6;background:#0a0a0a;min-height:100vh">
      <div style="color:#00e5ff;font-size:16px;margin-bottom:12px">App crashed</div>
      <div>${String(msg).slice(0, 600)}</div>
    </div>`
  }
}

window.addEventListener('error', e => showError(e.message || e.error))
window.addEventListener('unhandledrejection', e => showError(e.reason?.message || e.reason))

// Error boundary for React render errors
class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(error) { return { error } }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, color: '#ff3864', fontFamily: 'monospace', fontSize: 13, lineHeight: 1.6, background: '#0a0a0a', minHeight: '100vh' }}>
          <div style={{ color: '#00e5ff', fontSize: 16, marginBottom: 12 }}>App crashed</div>
          <div style={{ marginBottom: 8 }}>{this.state.error.message}</div>
          <div style={{ color: '#6a6a6a', fontSize: 11 }}>{this.state.error.stack?.slice(0, 400)}</div>
        </div>
      )
    }
    return this.props.children
  }
}

try {
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  )
} catch (e) {
  showError(e.message || e)
}
