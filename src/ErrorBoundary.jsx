import React from 'react'

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, info) {
    console.error('Erreur React capturée :', error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh',
          padding: 24,
          fontFamily: 'Arial, sans-serif',
          background: '#F3F4F6'
        }}>
          <div style={{
            background: 'white',
            padding: 20,
            borderRadius: 16,
            border: '1px solid #E5E7EB'
          }}>
            <h1>Erreur dans l’application</h1>
            <p style={{ color: '#B91C1C' }}>
              {this.state.error?.message || 'Erreur inconnue'}
            </p>

            <pre style={{
              whiteSpace: 'pre-wrap',
              background: '#111827',
              color: 'white',
              padding: 12,
              borderRadius: 12,
              overflow: 'auto'
            }}>
              {this.state.error?.stack}
            </pre>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
