# J.A.R.V.I.S. on Windows 10/11

This setup keeps the original React/Three.js interface and local Node bridge. The scripts automate prerequisite checks, dependency installation and startup; they do not replace the agent or remove original features.

## Install

1. Download and extract the Windows setup ZIP from the Windows build and verification workflow artifact.
2. Open the extracted folder.
3. Run in PowerShell:

   powershell -ExecutionPolicy Bypass -File .\install-windows.ps1

4. If prompted, approve installation of the official Node.js LTS package through winget.
5. When installation finishes, run claude in PowerShell and complete the official Claude Code sign-in.
6. Start JARVIS by double-clicking start-windows.bat.

## Requirements and limits

- The scripts install Node.js LTS (when winget is available), Claude Code and the exact dependencies from package-lock.json.
- JARVIS starts the original local bridge and Vite interface and opens the local page in Chrome/Edge.
- The original brain uses Claude Code. A valid account/subscription and first-time interactive sign-in are required. The installer cannot bypass authentication or subscription requirements.
- Optional MCP integrations, ElevenLabs, Picovoice and other third-party services still require their own accounts/keys and setup.
- The setup does not activate unrestricted write/shell mode. The original default-deny policy remains active.
- This is a guided Windows setup ZIP, not yet a signed native EXE/MSI installer. GitHub Actions creates the ZIP only after lint, production build and tests pass.

## Troubleshooting

- If node or claude is not found after installation, close and reopen PowerShell, then run install-windows.ps1 again.
- Complete authentication in the official Claude Code CLI. Never share passwords, verification codes or API keys.
- If the browser does not open automatically, visit http://localhost:5173.
- Keep the PowerShell window open while JARVIS runs. Press Ctrl+C to stop it.
- Run npm run setup for diagnostics.
