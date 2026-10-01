# External discovery feeds

Discovery can show repositories from a user-configured website. The site must expose a public HTTPS URL that returns JSON in this format:

```json
{
  "repositories": [
    "https://github.com/owner/first-repo",
    "owner/second-repo"
  ]
}
```

Each entry must be a GitHub repository URL or an `owner/repo` name. A feed can list up to 30 public repositories. The app reads the list directly in the browser, then fetches current repository details from GitHub. It does not send the user's GitHub token to the feed website, submit data to it, or scrape arbitrary HTML.

For the web app, the feed server must allow cross-origin reads from the app's origin (for example, with an appropriate `Access-Control-Allow-Origin` response header). The URL is checked when the user adds it; a failed or malformed feed is not saved. Each user can add up to ten feeds under **Discover → Manage discovery channels → External discovery feeds**.

## RSS / Atom feeds

Instead of the JSON format above, users can add a public RSS or Atom feed under **Discover → Manage discovery channels → RSS discovery feeds**. The app scans the feed text (item links, descriptions, content) for `github.com/owner/repo` links, skips GitHub site-section paths such as `/topics/…`, and keeps the first 30 unique repositories per refresh in feed order. A feed without any repository links is rejected when it is added. The same HTTPS, CORS, size limit, and no-token rules apply.
