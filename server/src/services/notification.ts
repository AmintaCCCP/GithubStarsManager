export async function sendNotification(appriseUrl: string, title: string, message: string): Promise<boolean> {
  if (!appriseUrl) return false;

  try {
    let targetUrl = appriseUrl;
    let body: Record<string, unknown> = { title, body: message };

    if (appriseUrl.startsWith('apprise://') || appriseUrl.startsWith('apprises://')) {
      const isSecure = appriseUrl.startsWith('apprises://');
      const urlWithoutScheme = appriseUrl.replace(/^apprises?:\/\//, '');
      const [host, ...pathParts] = urlWithoutScheme.split('/');
      const token = pathParts.join('/');
      
      const protocol = isSecure ? 'https' : 'http';
      targetUrl = `${protocol}://${host}/notify/${token}`;
      
      body = {
        title,
        body: message,
        type: 'info',
        format: 'text'
      };
    } else if (appriseUrl.includes('gotify') || appriseUrl.includes('Gotify')) {
      if (appriseUrl.startsWith('gotify://') || appriseUrl.startsWith('gotifys://')) {
        const isSecure = appriseUrl.startsWith('gotifys://');
        const urlWithoutScheme = appriseUrl.replace(/^gotifys?:\/\//, '');
        
        const [hostAndPath, queryString] = urlWithoutScheme.split('?');
        const [host, ...pathParts] = hostAndPath.split('/');
        const token = pathParts.join('/');
        
        const urlParams = new URLSearchParams(queryString || '');
        const priority = urlParams.get('priority') || '5';
        
        const protocol = isSecure ? 'https' : 'http';
        targetUrl = `${protocol}://${host}/message?token=${token}`;
        
        body = {
          title,
          message,
          priority: parseInt(priority, 10)
        };
      } else {
        body = {
          title,
          message,
          priority: 5
        };
      }
    } else if (appriseUrl.startsWith('discord://')) {
      const urlWithoutScheme = appriseUrl.replace(/^discord:\/\//, '');
      const [webhookId, webhookToken] = urlWithoutScheme.split('/');
      
      targetUrl = `https://discord.com/api/webhooks/${webhookId}/${webhookToken}`;
      
      body = {
        content: `**${title}**\n${message}`
      };
    } else if (appriseUrl.startsWith('telegram://')) {
      const urlWithoutScheme = appriseUrl.replace(/^telegram:\/\//, '');
      const [botToken, chatId] = urlWithoutScheme.split('/');
      
      targetUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
      
      body = {
        chat_id: chatId,
        text: `*${title}*\n${message}`,
        parse_mode: 'Markdown'
      };
    }

    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      console.error(`Notification failed: ${response.status} ${response.statusText}`, errorText);
      return false;
    }

    console.log(`✅ Notification sent successfully to ${appriseUrl.split('?')[0]}`);
    return true;
  } catch (err) {
    console.error('Error sending notification:', err);
    return false;
  }
}

export function validateNotificationUrl(url: string): { valid: boolean; message: string } {
  if (!url) {
    return { valid: false, message: 'URL is required' };
  }

  const supportedPrefixes = [
    'http://',
    'https://',
    'apprise://',
    'apprises://',
    'gotify://',
    'gotifys://',
    'discord://',
    'telegram://'
  ];

  const hasValidPrefix = supportedPrefixes.some(prefix => url.startsWith(prefix));
  
  if (!hasValidPrefix) {
    return {
      valid: false,
      message: `Unsupported URL format. Supported formats: ${supportedPrefixes.join(', ')}`
    };
  }

  return { valid: true, message: 'Valid URL format' };
}
