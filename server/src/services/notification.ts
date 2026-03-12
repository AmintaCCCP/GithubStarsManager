export async function sendNotification(appriseUrl: string, title: string, message: string): Promise<boolean> {
  if (!appriseUrl) return false;

  try {
    const response = await fetch(appriseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title,
        body: message,
      }),
    });

    if (!response.ok) {
      console.error(`Apprise notification failed: ${response.status} ${response.statusText}`);
      return false;
    }

    return true;
  } catch (err) {
    console.error('Error sending Apprise notification:', err);
    return false;
  }
}
