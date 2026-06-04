// ══════════════════════════════════════════════════════════════════
// src/services/supabaseClient.js
// Client Supabase REST + gestion de session + repli localStorage.
// Couche infrastructure (utilise import.meta.env de Vite).
// ══════════════════════════════════════════════════════════════════

// ══ CONFIG ══════════════════════════════════════════════════════
export const SB_URL = import.meta.env.VITE_SUPABASE_URL || "DEMO";
export const SB_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "DEMO";
export const SB_READY = SB_URL !== "DEMO" && SB_KEY !== "DEMO"
              && SB_URL.startsWith("https://") && SB_KEY.length > 20;

// ══ SUPABASE REST WRAPPER ════════════════════════════════════════
let _token = null;
let _refreshToken = null;
let _expiresAt = 0;

export function clearStoredSession() {
  _token = null;
  _refreshToken = null;
  _expiresAt = 0;

  try {
    sessionStorage.removeItem("sb_token");
    sessionStorage.removeItem("sb_refresh");
    sessionStorage.removeItem("sb_expires_at");
    sessionStorage.removeItem("sb_user");
  } catch {}
}

export function storeSession(data) {
  _token = data.access_token;
  _refreshToken = data.refresh_token || _refreshToken;
  _expiresAt = Date.now() + ((data.expires_in || 3600) * 1000);

  try {
    sessionStorage.setItem("sb_token", _token);
    sessionStorage.setItem("sb_refresh", _refreshToken || "");
    sessionStorage.setItem("sb_expires_at", String(_expiresAt));

    if (data.user) {
      sessionStorage.setItem(
        "sb_user",
        JSON.stringify({
          email: data.user?.email,
          id: data.user?.id,
        })
      );
    }
  } catch {}
}

export async function refreshSessionIfNeeded() {
  if (!SB_READY || !_token) return;

  const now = Date.now();

  if (_expiresAt && now < _expiresAt - 60000) return;

  if (!_refreshToken) {
    clearStoredSession();
    throw new Error("Session expirée. Déconnecte-toi puis reconnecte-toi.");
  }

  const r = await fetch(`${SB_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: {
      "apikey": SB_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      refresh_token: _refreshToken,
    }),
  });

  const d = await r.json();

  if (!r.ok) {
    clearStoredSession();
    throw new Error("Session expirée. Déconnecte-toi puis reconnecte-toi.");
  }

  storeSession(d);
}

const authHeaders = async () => {
  await refreshSessionIfNeeded();

  return {
    "apikey": SB_KEY,
    "Authorization": `Bearer ${_token || SB_KEY}`,
    "Content-Type": "application/json",
    "Prefer": "return=representation",
  };
};

export const sbErrors = [];

export const sb = {
  async rpc(path, body) {
    const r = await fetch(`${SB_URL}${path}`, {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify(body),
    });

    const d = await r.json();

    if (!r.ok) {
      sbErrors.push({
        ts: new Date().toISOString(),
        msg: d?.message || r.statusText,
        path,
      });
      throw new Error(d?.message || r.statusText);
    }

    return d;
  },

  async select(table, params = "") {
    const r = await fetch(`${SB_URL}/rest/v1/${table}?${params}`, {
      headers: await authHeaders(),
    });

    if (!r.ok) {
      const t = await r.text();
      sbErrors.push({
        ts: new Date().toISOString(),
        msg: t,
        path: table,
      });
      throw new Error(t);
    }

    return r.json();
  },

  async insert(table, body) {
    const r = await fetch(`${SB_URL}/rest/v1/${table}`, {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify(body),
    });

    if (!r.ok) {
      const t = await r.text();

      if (
        t.includes("unique") ||
        t.includes("duplicate") ||
        t.includes("23505")
      ) {
        throw new Error("DUPLICATE:" + t);
      }

      sbErrors.push({
        ts: new Date().toISOString(),
        msg: t,
        path: table,
      });

      throw new Error(t);
    }

    return r.json();
  },

  async update(table, filter, body) {
    const r = await fetch(`${SB_URL}/rest/v1/${table}?${filter}`, {
      method: "PATCH",
      headers: await authHeaders(),
      body: JSON.stringify(body),
    });

    if (!r.ok) {
      const t = await r.text();
      throw new Error(t);
    }

    return r.json();
  },

  async delete(table, filter) {
    const r = await fetch(`${SB_URL}/rest/v1/${table}?${filter}`, {
      method: "DELETE",
      headers: await authHeaders(),
    });

    if (!r.ok) throw new Error(await r.text());

    return true;
  },

  async signIn(email, pwd) {
    const r = await fetch(`${SB_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: {
        "apikey": SB_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email,
        password: pwd,
      }),
    });

    const d = await r.json();

    if (!r.ok) {
      throw new Error(
        d.error_description ||
        d.message ||
        "Identifiants incorrects"
      );
    }

    storeSession(d);

    return d;
  },

  signOut() {
    clearStoredSession();
  },

  restoreSession() {
    try {
      const t = sessionStorage.getItem("sb_token");
      const r = sessionStorage.getItem("sb_refresh");
      const e = sessionStorage.getItem("sb_expires_at");
      const u = sessionStorage.getItem("sb_user");

      if (t && r && u) {
        _token = t;
        _refreshToken = r;
        _expiresAt = Number(e || 0);
        return JSON.parse(u);
      }

      clearStoredSession();
    } catch {
      clearStoredSession();
    }

    return null;
  },
};

// ══ LOCALSTORAGE (repli hors-ligne) ══════════════════════════════
export const ls = {
  get: k=>{ try { return JSON.parse(localStorage.getItem(k)||"[]"); } catch { return []; } },
  set: (k,v)=>{ try { localStorage.setItem(k,JSON.stringify(v)); } catch {} },
  push: (k,item)=>{ const arr=ls.get(k); ls.set(k,[...arr.filter(x=>x.id!==item.id),item]); },
};
