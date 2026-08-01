import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App.jsx'
import './index.css'
import './animations/index.css'

// HashRouter is used deliberately (not BrowserRouter):
// - The app is a static-hosted SPA served with a relative base ("./"), so
//   hash-based links (e.g. /#/editor/...) work with zero server rewrites and
//   never 404 on refresh or deep-link.
// - App (WorkflowApp) is mounted ONCE here, OUTSIDE of <Routes>, so navigating
//   between routes NEVER remounts it. This preserves its single init(), its
//   autosave/sync subscriptions, and its timers exactly as before. Routing only
//   supplies a "view intent" that the app reads; it never owns the app's data.
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>,
)
