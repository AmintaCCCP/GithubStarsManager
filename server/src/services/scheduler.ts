import cron from 'node-cron';
import { getDb } from '../db/connection.js';
import { config } from '../config.js';
import { decrypt } from './crypto.js';
import { sendNotification } from './notification.js';

interface ScheduledTask {
  id: string;
  user_id: number;
  task_type: 'sync_stars' | 'check_releases';
  enabled: number;
  cron_expression: string;
  last_run: string | null;
  next_run: string | null;
}

interface NotificationPreferences {
  user_id: number;
  notify_new_release: number;
  notify_star_added: number;
  notify_star_removed: number;
}

const scheduledJobs: Map<string, cron.ScheduledTask> = new Map();

export function startScheduler(): void {
  console.log('⏰ Starting scheduler...');
  
  const db = getDb();
  const tasks = db.prepare('SELECT * FROM scheduled_tasks WHERE enabled = 1 AND task_type IN (?, ?)').all('sync_stars', 'check_releases') as ScheduledTask[];
  
  for (const task of tasks) {
    scheduleTask(task);
  }
  
  console.log(`✅ Scheduler started with ${scheduledJobs.size} active jobs`);
}

export function stopScheduler(): void {
  for (const [id, job] of scheduledJobs) {
    job.stop();
    console.log(`Stopped job: ${id}`);
  }
  scheduledJobs.clear();
}

export function scheduleTask(task: ScheduledTask): void {
  const jobId = task.id;
  
  if (scheduledJobs.has(jobId)) {
    scheduledJobs.get(jobId)?.stop();
  }
  
  if (!task.enabled) {
    return;
  }
  
  if (!cron.validate(task.cron_expression)) {
    console.error(`Invalid cron expression for task ${jobId}: ${task.cron_expression}`);
    return;
  }
  
  const job = cron.schedule(task.cron_expression, async () => {
    await executeTask(task);
  });
  
  scheduledJobs.set(jobId, job);
  
  const nextRun = getNextRunTime(task.cron_expression);
  updateNextRun(task.id, nextRun);
  
  console.log(`Scheduled task ${task.task_type} for user ${task.user_id} with cron: ${task.cron_expression}`);
}

function getNextRunTime(cronExpression: string): string {
  try {
    const now = new Date();
    const interval = cronExpression.split(' ');
    
    if (interval.length === 5) {
      const nextHour = new Date(now);
      nextHour.setHours(nextHour.getHours() + 1, 0, 0, 0);
      return nextHour.toISOString();
    }
    
    return new Date(Date.now() + 3600000).toISOString();
  } catch {
    return new Date(Date.now() + 3600000).toISOString();
  }
}

function updateNextRun(taskId: string, nextRun: string): void {
  const db = getDb();
  db.prepare('UPDATE scheduled_tasks SET next_run = ? WHERE id = ?').run(nextRun, taskId);
}

function updateLastRun(taskId: string): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare('UPDATE scheduled_tasks SET last_run = ? WHERE id = ?').run(now, taskId);
}

async function executeTask(task: ScheduledTask): Promise<void> {
  console.log(`🔄 Executing task: ${task.task_type} for user ${task.user_id}`);
  
  try {
    switch (task.task_type) {
      case 'sync_stars':
        await syncStars(task.user_id);
        break;
      case 'check_releases':
        await checkReleases(task.user_id);
        break;
    }
    
    updateLastRun(task.id);
    const nextRun = getNextRunTime(task.cron_expression);
    updateNextRun(task.id, nextRun);
  } catch (err) {
    console.error(`Error executing task ${task.task_type}:`, err);
  }
}

async function syncStars(userId: number): Promise<void> {
  const db = getDb();
  
  const tokenRow = db.prepare('SELECT value FROM settings WHERE user_id = ? AND key = ?').get(userId, 'github_token') as { value: string } | undefined;
  if (!tokenRow) {
    console.log(`No GitHub token for user ${userId}, skipping sync_stars`);
    return;
  }
  
  const githubToken = decrypt(tokenRow.value, config.encryptionKey);
  
  const allStars: any[] = [];
  let page = 1;
  const perPage = 100;
  
  while (true) {
    const response = await fetch(`https://api.github.com/user/starred?per_page=${perPage}&page=${page}&sort=updated`, {
      headers: {
        'Authorization': `token ${githubToken}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'GithubStarsManager'
      }
    });
    
    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status}`);
    }
    
    const stars = await response.json() as any[];
    
    if (stars.length === 0) break;
    
    allStars.push(...stars);
    
    if (stars.length < perPage) break;
    
    page++;
    
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  console.log(`Fetched ${allStars.length} starred repos for user ${userId}`);
  
  const existingRepos = db.prepare('SELECT id, full_name FROM repositories WHERE user_id = ?').all(userId) as { id: number; full_name: string }[];
  const existingMap = new Map(existingRepos.map(r => [r.full_name, r.id]));
  const newStars: any[] = [];
  const removedStars: string[] = [];
  
  for (const star of allStars) {
    if (!existingMap.has(star.full_name)) {
      newStars.push(star);
    }
    existingMap.delete(star.full_name);
  }
  
  for (const [fullName] of existingMap) {
    removedStars.push(fullName);
  }
  
  const insertRepo = db.prepare(`
    INSERT INTO repositories (
      id, user_id, name, full_name, description, html_url, stargazers_count,
      language, created_at, updated_at, pushed_at, starred_at, owner_login, owner_avatar_url, topics
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  for (const repo of newStars) {
    insertRepo.run(
      repo.id,
      userId,
      repo.name,
      repo.full_name,
      repo.description,
      repo.html_url,
      repo.stargazers_count,
      repo.language,
      repo.created_at,
      repo.updated_at,
      repo.pushed_at,
      new Date().toISOString(),
      repo.owner?.login,
      repo.owner?.avatar_url,
      JSON.stringify(repo.topics || [])
    );
  }
  
  for (const fullName of removedStars) {
    db.prepare('DELETE FROM repositories WHERE user_id = ? AND full_name = ?').run(userId, fullName);
  }
  
  console.log(`Synced stars for user ${userId}: ${newStars.length} added, ${removedStars.length} removed`);
  
  if (newStars.length > 0) {
    const analyzedRepos = await analyzeNewStars(userId, newStars);
    await sendStarNotification(userId, newStars.length, removedStars.length, analyzedRepos);
  } else if (removedStars.length > 0) {
    await sendStarNotification(userId, 0, removedStars.length, []);
  }
}

async function analyzeNewStars(userId: number, newStars: any[]): Promise<Array<{ fullName: string; summary: string | null; success: boolean }>> {
  const db = getDb();
  
  const activeAIConfig = db.prepare(`
    SELECT * FROM ai_configs WHERE user_id = ? AND is_active = 1
  `).get(userId) as any;
  
  if (!activeAIConfig) {
    console.log(`No active AI config for user ${userId}, skipping AI analysis`);
    return newStars.map(star => ({ fullName: star.full_name, summary: null, success: false }));
  }
  
  const decryptedKey = decrypt(activeAIConfig.api_key_encrypted, config.encryptionKey);
  const results: Array<{ fullName: string; summary: string | null; success: boolean }> = [];
  
  for (const repo of newStars) {
    try {
      const analysis = await analyzeRepo(repo, activeAIConfig, decryptedKey);
      
      if (analysis) {
        db.prepare(`
          UPDATE repositories 
          SET ai_summary = ?, ai_tags = ?, ai_platforms = ?, analyzed_at = ?
          WHERE id = ? AND user_id = ?
        `).run(
          analysis.summary,
          JSON.stringify(analysis.tags),
          JSON.stringify(analysis.platforms),
          new Date().toISOString(),
          repo.id,
          userId
        );
        
        results.push({ fullName: repo.full_name, summary: analysis.summary, success: true });
        console.log(`✅ AI analysis completed for ${repo.full_name}`);
      } else {
        db.prepare(`UPDATE repositories SET analysis_failed = 1 WHERE id = ? AND user_id = ?`).run(repo.id, userId);
        results.push({ fullName: repo.full_name, summary: null, success: false });
        console.warn(`⚠️ AI analysis failed for ${repo.full_name}`);
      }
    } catch (err) {
      console.error(`Error analyzing ${repo.full_name}:`, err);
      db.prepare(`UPDATE repositories SET analysis_failed = 1 WHERE id = ? AND user_id = ?`).run(repo.id, userId);
      results.push({ fullName: repo.full_name, summary: null, success: false });
    }
  }
  
  return results;
}

async function analyzeRepo(repo: any, aiConfig: any, apiKey: string): Promise<{ summary: string; tags: string[]; platforms: string[] } | null> {
  const prompt = `Please analyze this GitHub repository and provide:

1. A concise English overview (no more than 50 words) explaining the main functionality and purpose
2. 3-5 relevant application type tags (e.g., development tools, web apps, mobile apps, database, AI tools)
3. Supported platform types (choose from: mac, windows, linux, ios, android, docker, web, cli)

Please reply in JSON format:
{
  "summary": "Your overview",
  "tags": ["tag1", "tag2", "tag3"],
  "platforms": ["platform1", "platform2"]
}

Repository information:
- Name: ${repo.full_name}
- Description: ${repo.description || 'No description'}
- Language: ${repo.language || 'Unknown'}
- URL: ${repo.html_url}`;

  try {
    let response: Response;
    let result: any;
    
    const baseUrl = aiConfig.base_url.replace(/\/$/, '');
    
    if (aiConfig.api_type === 'gemini') {
      const geminiUrl = `${baseUrl}/models/${aiConfig.model}:generateContent?key=${apiKey}`;
      response = await fetch(geminiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 500 }
        })
      });
      
      if (!response.ok) return null;
      
      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      result = parseAIResponse(text);
    } else {
      const endpoint = aiConfig.api_type === 'claude' ? '/messages' : '/chat/completions';
      const url = `${baseUrl}${endpoint}`;
      
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      
      if (aiConfig.api_type === 'claude') {
        headers['x-api-key'] = apiKey;
        headers['anthropic-version'] = '2023-06-01';
      } else {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }
      
      const body: any = {
        model: aiConfig.model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 500,
        temperature: 0.7
      };
      
      if (aiConfig.api_type === 'claude') {
        body.max_tokens = 500;
      }
      
      response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
      });
      
      if (!response.ok) return null;
      
      const data = await response.json();
      const text = aiConfig.api_type === 'claude' 
        ? data.content?.[0]?.text || ''
        : data.choices?.[0]?.message?.content || '';
      result = parseAIResponse(text);
    }
    
    return result;
  } catch (err) {
    console.error('AI analysis error:', err);
    return null;
  }
}

function parseAIResponse(text: string): { summary: string; tags: string[]; platforms: string[] } | null {
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    
    const parsed = JSON.parse(jsonMatch[0]);
    
    return {
      summary: parsed.summary || '',
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
      platforms: Array.isArray(parsed.platforms) ? parsed.platforms : []
    };
  } catch {
    return null;
  }
}

async function sendStarNotification(
  userId: number, 
  added: number, 
  removed: number,
  analyzedRepos: Array<{ fullName: string; summary: string | null; success: boolean }>
): Promise<void> {
  const db = getDb();
  
  const prefs = db.prepare('SELECT * FROM notification_preferences WHERE user_id = ?').get(userId) as NotificationPreferences | undefined;
  if (!prefs) return;
  
  if ((added > 0 && !prefs.notify_star_added) && (removed > 0 && !prefs.notify_star_removed)) {
    return;
  }
  
  const user = db.prepare('SELECT apprise_url FROM users WHERE id = ?').get(userId) as { apprise_url: string | null } | undefined;
  if (!user?.apprise_url) return;
  
  const parts: string[] = [];
  
  if (added > 0 && prefs.notify_star_added) {
    parts.push(`⭐ ${added} new star(s) added:`);
    
    for (const repo of analyzedRepos) {
      if (repo.summary) {
        const shortSummary = repo.summary.length > 100 ? repo.summary.substring(0, 100) + '...' : repo.summary;
        parts.push(`\n📦 ${repo.fullName}`);
        parts.push(`   ${shortSummary}`);
      } else {
        parts.push(`\n📦 ${repo.fullName}`);
        parts.push(`   (AI analysis unavailable)`);
      }
    }
  }
  
  if (removed > 0 && prefs.notify_star_removed) {
    parts.push(`\n❌ ${removed} star(s) removed`);
  }
  
  if (parts.length === 0) return;
  
  const title = '📊 GitHub Stars Update';
  const message = parts.join('\n');
  
  await sendNotification(user.apprise_url, title, message);
}

async function checkReleases(userId: number): Promise<void> {
  const db = getDb();
  
  const tokenRow = db.prepare('SELECT value FROM settings WHERE user_id = ? AND key = ?').get(userId, 'github_token') as { value: string } | undefined;
  if (!tokenRow) return;
  
  const githubToken = decrypt(tokenRow.value, config.encryptionKey);
  
  const user = db.prepare('SELECT apprise_url FROM users WHERE id = ?').get(userId) as { apprise_url: string | null } | undefined;
  const prefs = db.prepare('SELECT notify_new_release FROM notification_preferences WHERE user_id = ?').get(userId) as { notify_new_release: number } | undefined;
  
  const repos = db.prepare('SELECT id, full_name, name FROM repositories WHERE user_id = ? AND subscribed_to_releases = 1').all(userId) as { id: number; full_name: string; name: string }[];
  
  for (const repo of repos) {
    try {
      const response = await fetch(`https://api.github.com/repos/${repo.full_name}/releases?per_page=5`, {
        headers: {
          'Authorization': `token ${githubToken}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'GithubStarsManager'
        }
      });
      
      if (!response.ok) continue;
      
      const releases = await response.json() as any[];
      
      for (const release of releases) {
        const existing = db.prepare('SELECT id FROM releases WHERE user_id = ? AND repo_id = ? AND tag_name = ?').get(userId, repo.id, release.tag_name);
        
        if (!existing) {
          console.log(`✨ New release found for ${repo.full_name}: ${release.tag_name}`);
          
          db.prepare(`
            INSERT INTO releases (
              id, user_id, tag_name, name, body, published_at, html_url,
              assets, repo_id, repo_full_name, repo_name, prerelease, draft, is_read
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
          `).run(
            release.id,
            userId,
            release.tag_name,
            release.name || release.tag_name,
            release.body,
            release.published_at,
            release.html_url,
            JSON.stringify(release.assets),
            repo.id,
            repo.full_name,
            repo.name,
            release.prerelease ? 1 : 0,
            release.draft ? 1 : 0
          );
          
          if (user?.apprise_url && prefs?.notify_new_release) {
            const title = `🚀 New Release: ${repo.full_name}`;
            const message = `Tag: ${release.tag_name}\nName: ${release.name || release.tag_name}\nURL: ${release.html_url}`;
            await sendNotification(user.apprise_url, title, message);
          }
        }
      }
    } catch (err) {
      console.error(`Error checking releases for ${repo.full_name}:`, err);
    }
  }
}

export function getUserTasks(userId: number): ScheduledTask[] {
  const db = getDb();
  return db.prepare('SELECT * FROM scheduled_tasks WHERE user_id = ? AND task_type IN (?, ?)').all(userId, 'sync_stars', 'check_releases') as ScheduledTask[];
}

export function updateUserTask(userId: number, taskType: string, updates: { enabled?: number; cron_expression?: string }): ScheduledTask | null {
  const db = getDb();
  
  const existing = db.prepare('SELECT * FROM scheduled_tasks WHERE user_id = ? AND task_type = ?').get(userId, taskType) as ScheduledTask | undefined;
  if (!existing) return null;
  
  if (updates.enabled !== undefined) {
    db.prepare('UPDATE scheduled_tasks SET enabled = ? WHERE user_id = ? AND task_type = ?').run(updates.enabled, userId, taskType);
    existing.enabled = updates.enabled;
  }
  
  if (updates.cron_expression !== undefined) {
    if (!cron.validate(updates.cron_expression)) {
      throw new Error('Invalid cron expression');
    }
    db.prepare('UPDATE scheduled_tasks SET cron_expression = ? WHERE user_id = ? AND task_type = ?').run(updates.cron_expression, userId, taskType);
    existing.cron_expression = updates.cron_expression;
  }
  
  scheduleTask(existing);
  
  return existing;
}

export function getNotificationPreferences(userId: number): NotificationPreferences | null {
  const db = getDb();
  let prefs = db.prepare('SELECT * FROM notification_preferences WHERE user_id = ?').get(userId) as NotificationPreferences | undefined;
  
  if (!prefs) {
    db.prepare('INSERT INTO notification_preferences (user_id) VALUES (?)').run(userId);
    prefs = db.prepare('SELECT * FROM notification_preferences WHERE user_id = ?').get(userId) as NotificationPreferences;
  }
  
  return prefs || null;
}

export function updateNotificationPreferences(userId: number, updates: Partial<NotificationPreferences>): NotificationPreferences | null {
  const db = getDb();
  
  db.prepare(`
    UPDATE notification_preferences 
    SET notify_new_release = ?, notify_star_added = ?, notify_star_removed = ?
    WHERE user_id = ?
  `).run(
    updates.notify_new_release ?? 1,
    updates.notify_star_added ?? 1,
    updates.notify_star_removed ?? 1,
    userId
  );
  
  return getNotificationPreferences(userId);
}

export async function syncStarsManually(userId: number): Promise<{ added: number; removed: number; message: string }> {
  const db = getDb();
  
  const tokenRow = db.prepare('SELECT value FROM settings WHERE user_id = ? AND key = ?').get(userId, 'github_token') as { value: string } | undefined;
  if (!tokenRow) {
    return { added: 0, removed: 0, message: 'No GitHub token configured' };
  }
  
  const githubToken = decrypt(tokenRow.value, config.encryptionKey);
  
  const allStars: any[] = [];
  let page = 1;
  const perPage = 100;
  
  while (true) {
    const response = await fetch(`https://api.github.com/user/starred?per_page=${perPage}&page=${page}&sort=updated`, {
      headers: {
        'Authorization': `token ${githubToken}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'GithubStarsManager'
      }
    });
    
    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status}`);
    }
    
    const stars = await response.json() as any[];
    
    if (stars.length === 0) break;
    
    allStars.push(...stars);
    
    if (stars.length < perPage) break;
    
    page++;
    
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  console.log(`Manual sync: Fetched ${allStars.length} starred repos for user ${userId}`);
  
  const existingRepos = db.prepare('SELECT id, full_name FROM repositories WHERE user_id = ?').all(userId) as { id: number; full_name: string }[];
  const existingMap = new Map(existingRepos.map(r => [r.full_name, r.id]));
  const newStars: any[] = [];
  const removedStars: string[] = [];
  
  for (const star of allStars) {
    if (!existingMap.has(star.full_name)) {
      newStars.push(star);
    }
    existingMap.delete(star.full_name);
  }
  
  for (const [fullName] of existingMap) {
    removedStars.push(fullName);
  }
  
  const insertRepo = db.prepare(`
    INSERT INTO repositories (
      id, user_id, name, full_name, description, html_url, stargazers_count,
      language, created_at, updated_at, pushed_at, starred_at, owner_login, owner_avatar_url, topics
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  for (const repo of newStars) {
    insertRepo.run(
      repo.id,
      userId,
      repo.name,
      repo.full_name,
      repo.description,
      repo.html_url,
      repo.stargazers_count,
      repo.language,
      repo.created_at,
      repo.updated_at,
      repo.pushed_at,
      new Date().toISOString(),
      repo.owner?.login,
      repo.owner?.avatar_url,
      JSON.stringify(repo.topics || [])
    );
  }
  
  for (const fullName of removedStars) {
    db.prepare('DELETE FROM repositories WHERE user_id = ? AND full_name = ?').run(userId, fullName);
  }
  
  console.log(`Manual sync for user ${userId}: ${newStars.length} added, ${removedStars.length} removed`);
  
  if (newStars.length > 0) {
    const analyzedRepos = await analyzeNewStars(userId, newStars);
    await sendStarNotification(userId, newStars.length, removedStars.length, analyzedRepos);
  } else if (removedStars.length > 0) {
    await sendStarNotification(userId, 0, removedStars.length, []);
  }
  
  return {
    added: newStars.length,
    removed: removedStars.length,
    message: `Synced ${allStars.length} repos: ${newStars.length} added, ${removedStars.length} removed`
  };
}

export async function checkReleasesManually(userId: number): Promise<{ checked: number; newReleases: number }> {
  await checkReleases(userId);
  return { checked: 0, newReleases: 0 };
}
