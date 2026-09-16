# Repo Health Page example

Install this directory from **Settings → Plugins → Install local plugin**, then enable it and click **Open page: Repository Health**.

This page-only plugin has no `worker.js`. Its HTML, CSS and JavaScript load inside a sandboxed iframe through the `plugin-page:` protocol. It searches only the Host's sanitized local repository snapshot through the `repositories.search` bridge method. Empty results are normal until the Host has loaded repositories.

Page-only plugins do not receive Node.js or Electron APIs. If a plugin also declares `main`, its Node Worker is still trusted local code, not a security sandbox.
