import { useState, useEffect } from 'react'
import { supabase, supabaseReady } from '../lib/supabaseClient'

export function useAuth() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [authError, setAuthError] = useState(null)

  useEffect(() => {
    let mounted = true
    let subscription = null

    async function initAuth() {
      try {
        if (!supabaseReady || !supabase?.auth) {
          if (mounted) {
            setUser(null)
            setLoading(false)
            setAuthError('Supabase non configuré')
          }
          return
        }

        const { data, error } = await supabase.auth.getSession()

        if (error) {
          throw error
        }

        if (mounted) {
          setUser(data?.session?.user ?? null)
          setLoading(false)
        }

        const response = supabase.auth.onAuthStateChange((_event, session) => {
          if (mounted) {
            setUser(session?.user ?? null)
          }
        })

        subscription = response?.data?.subscription
      } catch (error) {
        console.error('Erreur useAuth:', error)

        if (mounted) {
          setUser(null)
          setAuthError(error.message || 'Erreur Supabase')
          setLoading(false)
        }
      }
    }

    initAuth()

    return () => {
      mounted = false

      if (subscription) {
        subscription.unsubscribe()
      }
    }
  }, [])

  async function signIn(email, password) {
    if (!supabaseReady || !supabase?.auth) {
      return {
        error: new Error(
          'Supabase n’est pas encore configuré. Crée la base puis ajoute les variables Vercel.'
        )
      }
    }

    return await supabase.auth.signInWithPassword({
      email,
      password
    })
  }

  async function signOut() {
    if (!supabaseReady || !supabase?.auth) {
      setUser(null)
      return { error: null }
    }

    return await supabase.auth.signOut()
  }

  return {
    user,
    loading,
    authError,
    signIn,
    signOut,
    supabaseReady
  }
}
