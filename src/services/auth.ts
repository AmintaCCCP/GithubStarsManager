import { backend } from './backendAdapter';

class AuthService {
  async register(username: string, password: string, githubToken: string): Promise<{ token: string; user: { id: number; username: string; role: string; apprise_url: string | null } }> {
    const url = backend.backendUrl;
    if (!url) throw new Error('Backend not available');

    const res = await fetch(`${url}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, github_token: githubToken }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Registration failed');
    }

    return res.json();
  }

  async login(username: string, password: string): Promise<{ token: string; user: { id: number; username: string; role: string; apprise_url: string | null } }> {
    const url = backend.backendUrl;
    if (!url) throw new Error('Backend not available');

    const res = await fetch(`${url}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Login failed');
    }

    return res.json();
  }

  async updateProfile(data: { apprise_url?: string; password?: string }): Promise<{ id: number; username: string; role: string; appriseUrl: string | null }> {
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
}

export const authService = new AuthService();
