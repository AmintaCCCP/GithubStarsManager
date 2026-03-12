import cron from 'node-cron';
import { getDb } from '../db/connection.js';
import { config } from '../config.js';
import { decrypt } from './crypto.js';
import { sendNotification } from './notification.js';

export function startReleaseMonitor() {
  // Run every hour
  cron.schedule('0 * * * *', async () => {
    console.log('⏰ Running release monitor job...');
    await checkNewReleases();
  });

  // Also run once on startup after a short delay
  setTimeout(() => {
    console.log('🚀 Initial release monitor check...');
    checkNewReleases().catch(err => console.error('Error in initial release check:', err));
  }, 10000);
}

async function checkNewReleases() {
  const db = getDb();
  
  // Find users with apprise_url
  const users = db.prepare('SELECT id, username, apprise_url FROM users WHERE apprise_url IS NOT NULL').all() as any[];
  
  for (const user of users) {
    try {
      // Get github token
      const tokenRow = db.prepare('SELECT value FROM settings WHERE user_id = ? AND key = ?').get(user.id, 'github_token') as any;
      if (!tokenRow) continue;
      
      const githubToken = decrypt(tokenRow.value, config.encryptionKey);
      
      // Get subscribed repos
      const repos = db.prepare('SELECT id, full_name, name FROM repositories WHERE user_id = ? AND subscribed_to_releases = 1').all(user.id) as any[];
      
      for (const repo of repos) {
        await checkRepoReleases(user.id, user.apprise_url, githubToken, repo);
      }
    } catch (err) {
      console.error(`Error checking releases for user ${user.username}:`, err);
    }
  }
}

async function checkRepoReleases(userId: number, appriseUrl: string, token: string, repo: any) {
  const db = getDb();
  
  try {
    const response = await fetch(`https://api.github.com/repos/${repo.full_name}/releases?per_page=5`, {
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'GithubStarsManager'
      }
    });

    if (!response.ok) {
      console.warn(`Failed to fetch releases for ${repo.full_name}: ${response.statusText}`);
      return;
    }

    const githubReleases = await response.json() as any[];
    
    for (const ghRelease of githubReleases) {
      // Check if this release already exists for this user
      const existing = db.prepare('SELECT id FROM releases WHERE user_id = ? AND repo_id = ? AND tag_name = ?').get(userId, repo.id, ghRelease.tag_name);
      
      if (!existing) {
        // New release found!
        console.log(`✨ New release found for ${repo.full_name}: ${ghRelease.tag_name}`);
        
        // Insert into DB
        db.prepare(`
          INSERT INTO releases (
            id, user_id, tag_name, name, body, published_at, html_url, 
            assets, repo_id, repo_full_name, repo_name, prerelease, draft, is_read
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
        `).run(
          ghRelease.id,
          userId,
          ghRelease.tag_name,
          ghRelease.name || ghRelease.tag_name,
          ghRelease.body,
          ghRelease.published_at,
          ghRelease.html_url,
          JSON.stringify(ghRelease.assets),
          repo.id,
          repo.full_name,
          repo.name,
          ghRelease.prerelease ? 1 : 0,
          ghRelease.draft ? 1 : 0
        );

        // Send notification
        const title = `🚀 New Release: ${repo.full_name}`;
        const message = `Repo: ${repo.full_name}\nTag: ${ghRelease.tag_name}\nName: ${ghRelease.name || ghRelease.tag_name}\nURL: ${ghRelease.html_url}`;
        
        await sendNotification(appriseUrl, title, message);
      }
    }
  } catch (err) {
    console.error(`Error checking repo ${repo.full_name}:`, err);
  }
}
