# Download the Windows installer

The **Windows desktop build and verification** GitHub Actions workflow produces a Windows x64 NSIS .exe installer after dependency installation, lint, TypeScript/Vite production build and automated tests.

1. Open: https://github.com/Nickzinh00/jarvis/actions/workflows/windows-ci.yml
2. Open the newest successful run for the jarvis-windows-executor branch.
3. Download the artifact named **JARVIS-Windows-x64-Installer**.
4. Extract the artifact ZIP and run the included .exe installer.
5. Follow WINDOWS.md to choose automatic local-first mode, configure an optional cloud fallback, or use a cloud provider directly.

The .exe installs the desktop shell and application runtime. It does not include a local language model; Ollama and model files are installed separately because those can require several gigabytes. Cloud providers require the user's own API key and may charge usage.
