import React from 'react'
import ReactDOM from 'react-dom/client'
import Router from './Router'
import { CoverageKpiProvider } from './components/CoverageKpis'
import './theme.css'
import './modern.css'
import './management.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <CoverageKpiProvider><Router /></CoverageKpiProvider>
  </React.StrictMode>,
)
