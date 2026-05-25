import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabaseClient'

export function useAuth() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [authError, setAuthError] = useState(null)

  useEffect(() => {
    let mounted = true
    let subscription = null

    async function initAuth() {
      try {
        if (!supabase?.auth) {
          throw new Error('Client Supabase non disponible')
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
          setAuthError(error)
          setUser(null)
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
    try {
      if (!supabase?.auth) {
        return {
          error: new Error('Supabase n’est pas configuré correctement')
        }
      }

      return await supabase.auth.signInWithPassword({
        email,
        password
      })
    } catch (error) {
      return { error }
    }
  }

  async function signOut() {
    try {
      if (!supabase?.auth) {
        return {
          error: new Error('Supabase n’est pas configuré correctement')
        }
      }

      return await supabase.auth.signOut()
    } catch (error) {
      return { error }
    }
  }

  return {
    user,
    loading,
    authError,
    signIn,
    signOut
  }
}
