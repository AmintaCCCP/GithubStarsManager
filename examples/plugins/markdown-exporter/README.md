# Markdown Exporter Example

This is a minimal V1 plugin for local development. In the Electron app, open
Settings → Plugins → Install local plugin and select this directory.

The example deliberately uses only the public plugin context. It never receives
GitHub tokens, AI keys, Electron objects, or the application Zustand store.

V1 plugins execute as trusted local Node.js code. Review `worker.js` before
enabling it; the Worker boundary isolates lifecycle failures and timeouts but is
not a security sandbox.
