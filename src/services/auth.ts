import { backend } from './backendAdapter';

class AuthService {
  async register(email: string, password: string, githubToken: string, displayName?: string): Promise<{ token: string; user: { id: number; email: string; username: string; role: string; displayName: string | null } }> {
    const url = backend.backendUrl;
    if (!url) throw new Error('Backend not available');

    const res = await fetch(`${url}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, github_token: githubToken, display_name: displayName }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Registration failed');
    }

    return res.json();
  }

  async login(email: string, password: string): Promise<{ token: string; user: { id: number; email: string; username: string; role: string; displayName: string | null; avatarUrl: string | null; appriseUrl: string | null } }> {
    const url = backend.backendUrl;
    if (!url) throw new Error('Backend not available');

    const res = await fetch(`${url}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Login failed');
    }

    return res.json();
  }

  async updateProfile(data: { 
    apprise_url?: string; 
    password?: string;
    username?: string;
    display_name?: string;
    avatar_url?: string;
  }): Promise<{ 
    id: number; 
    email: string;
    username: string; 
    role: string; 
    displayName: string | null;
    avatarUrl: string | null;
    appriseUrl: string | null;
  }> {
    const url = backend.backendUrl;
    if (!url) throw new Error('Backend not available');

    const storeData = localStorage.getItem('github-stars-manager');
    let secret = '';
    if (storeData) {
      try {
        const parsed = JSON.parse(storeData);
        secret = parsed.state?.backendApiSecret || '';
      } catch { /* ignore */ }
    }

    const res = await fetch(`${url}/auth/profile`, {
      method: 'PATCH',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${secret}`
      },
      body: JSON.stringify(data),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Profile update failed');
    }

    return res.json();
  }

  async getProfile(): Promise<{ 
    id: number; 
    email: string;
    username: string; 
    role: string; 
    displayName: string | null;
    avatarUrl: string | null;
    appriseUrl: string | null;
  }> {
    const url = backend.backendUrl;
    if (!url) throw new Error('Backend not available');

    const storeData = localStorage.getItem('github-stars-manager');
    let secret = '';
    if (storeData) {
      try {
        const parsed = JSON.parse(storeData);
        secret = parsed.state?.backendApiSecret || '';
      } catch { /* ignore */ }
    }

    const res = await fetch(`${url}/auth/profile`, {
      method: 'GET',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${secret}`
      },
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Profile fetch failed');
    }

    return res.json();
  }
}

export const authService = new AuthService();
