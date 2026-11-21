# Windows package and verification

The Windows setup package is produced by the GitHub Actions workflow named **Windows build and verification**.

1. Open the workflow runs: https://github.com/Nickzinh00/jarvis/actions/workflows/windows-ci.yml
2. Select the newest successful run for the `jarvis-windows-executor` branch.
3. In the run's **Artifacts** section, download **JARVIS-Windows-Setup**.
4. Extract the ZIP, then follow [WINDOWS.md](WINDOWS.md).

The workflow runs `npm ci`, `npm run lint`, `npm run build`, and `npm test` on a Windows runner before uploading the ZIP. The ZIP contains the source and setup scripts; `install-windows.ps1` installs the runtime dependencies on the target PC.

This is a setup bundle, not a signed native installer. Claude Code sign-in and any optional third-party integrations still require the user's own accounts and consent.
