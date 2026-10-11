# Security Policy

## Supported versions

Only the latest tagged release receives security fixes. Older desktop
installers and Docker images are not patched retroactively — update to the
newest `vX.Y.Z` release before reporting a regression against it.

## Reporting a vulnerability

**Please do not open a public issue or pull request for a security problem.**

Report vulnerabilities privately through GitHub's
[Private Vulnerability Reporting](https://github.com/AmintaCCCP/GithubStarsManager/security/advisories/new)
on this repository. This is the preferred and fastest channel and reaches the
maintainer directly.

## What to include

To make triage fast, please include:

- Affected component (desktop app / backend server / Cloudflare worker /
  landing page) and version (tag or commit SHA);
- A minimal reproduction: steps, payload, or proof-of-concept;
- Expected vs. actual behaviour and the impact you believe it enables;
- Any logs or screenshots, with secrets and tokens redacted.

## Response targets

| Stage | Target |
| --- | --- |
| Acknowledgement | within 48 hours |
| Initial assessment (affected? severity) | within 7 days |
| Fix or mitigation for accepted reports | best effort, agreed per case |

If a report is accepted, the maintainer will coordinate disclosure: you will
be credited in the release notes unless you prefer to remain anonymous, and
the fix ships before any public detail is published.

## Scope notes

- The desktop app ships no telemetry; reports about data leaving the machine
  should describe the exact code path you observed.
- Issues in third-party dependencies are still welcome — please mention the
  advisory ID (GHSA / CVE) if one exists so it can be cross-checked against
  the automated scanners (CodeQL, gitleaks, Dependabot) already configured in
  this repository.
