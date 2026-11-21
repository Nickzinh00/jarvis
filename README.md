# J.A.R.V.I.S.

A Windows desktop voice assistant with an Iron Man-inspired holographic interface. The interface is React + Vite + Three.js; a local Node bridge runs the agent and connects the desktop UI to the computer.

## Windows desktop installer

Download the latest successful **JARVIS-Windows-x64-Installer** artifact from:
https://github.com/Nickzinh00/jarvis/actions/workflows/windows-ci.yml

Extract the artifact ZIP and run the included .exe. The desktop app bundles its Electron runtime, interface and local bridge. A separate Node.js install is not required on the target PC.

## Choose the AI brain

J.A.R.V.I.S. is no longer limited to Claude Code. The default provider mode is **automatic**: it tries Ollama local first, then uses a cloud fallback if you configured one. Ollama runs a model on your computer and does not require a Claude subscription or cloud API key. The default local model, qwen3-vl:4b (about 3.3 GB), supports vision and tool use; it must be downloaded separately and uses local disk, RAM and available GPU memory. A lighter qwen3-vl:2b option (about 1.9 GB) is available for lower-resource PCs. It requires Ollama 0.12.7 or newer.

Other provider options include OpenAI API, OpenRouter, Groq, Together AI, DeepSeek, Google Gemini and custom OpenAI-compatible endpoints. They require a model ID and the provider's own API key; cloud usage may be billed. Claude Agent SDK remains available when configured.

Use the desktop menu and select **Configurar provedor de IA...** to choose automatic local-first mode, set a cloud fallback, or use one provider directly. To install the local Ollama runtime, use **Instalar Ollama local...**. The default example model can be downloaded with:

    ollama pull qwen3-vl:4b

Read WINDOWS.md for installation, setup and troubleshooting details.

## Preserved capabilities

The original 3D HUD, voice pipeline, wake word, VAD, interruption/barge-in, panels/blades, camera look/watch, interface controls, local file workspace, Claude Agent SDK path and configured MCP integrations are retained. The alternative provider agent supports streaming, tool calls, built-in display/UI/camera/workspace tools and eligible configured MCP servers.

Not every Claude Agent SDK-specific built-in can be reproduced identically on every provider. The alternative provider now reuses the original Chrome extension native-host transport for tab listing, navigation, page reading, screenshots, find, scroll, console and network diagnostics. Click/type/form input/new-tab/close-tab are exposed only when local write mode is enabled. The Chrome extension/native host must already be installed and running; this integration does not require the Claude Code subscription, but still depends on the extension being available.

## Security defaults

The bridge binds to loopback. Third-party MCP integrations are not started unless their exact names are listed in `JARVIS_MCP_SERVERS`; the default is none. Workspace file edits and browser interactions require `JARVIS_ALLOW_WRITES=1`. Arbitrary terminal commands require both `JARVIS_ALLOW_WRITES=1` and the separate `JARVIS_ALLOW_SHELL=1` opt-in. Keep shell access disabled unless it is genuinely needed. File tools remain restricted to the JARVIS workspace and approved temporary folders, with credential locations blocked. Never paste API keys, passwords or verification codes into chat.

The Windows installer is not currently signed with a commercial code-signing certificate, so SmartScreen may show an unknown-publisher/reputation warning. That warning alone is not a malware verdict; it is also not proof that a file is safe. Review the release checksum and do not install if Microsoft Defender reports a named threat.

## Development

Requires Node.js 20+ and npm. For local source development:

    npm install
    npm start

Build the production interface:

    npm run build

Build the Windows x64 desktop installer on Windows:

    npm run dist:win

The GitHub Actions workflow runs lint, the production build and automated tests before creating the installer artifact.
