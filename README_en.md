# FetchCV

English · [中文](README.md)

FetchCV is a local-first desktop job-search agent that brings profile management, job understanding, resume tailoring, fact verification, document export, and interview preparation into one workflow. This repository preserves separate Windows and macOS implementations so that each platform can be developed, tested, and packaged independently.

> This repository contains development source code only. It does not include installers, API keys, user resumes, local databases, virtual environments, or other personal material.

## Highlights

- Import PDF resumes and organize education, work experience, projects, skills, portfolios, and supporting material.
- Create an isolated workspace for each target role and ingest job descriptions from pasted text, local text files, or public job pages.
- Produce reviewable resume-editing proposals grounded in verified experience, without inventing facts or claiming fictional ATS scores.
- Edit and preview the same resume snapshot before PDF export; the Windows edition also supports ATS-friendly Word export.
- Use a single agent loop for structured tool selection, with permissions, approvals, scope, idempotency, and audit controls enforced by a ToolGateway.
- Support controlled web access, Skills, MCP servers, and sandboxed workspace tools.
- Store API credentials locally with Electron `safeStorage`, while the Sidecar listens on loopback only.

## Repository layout

```text
FetchCV/
├─ windows/    Windows 10/11 x64 edition (current version: 0.4.19)
├─ macos/      macOS edition (current version: 0.2.24)
├─ README.md
└─ README_en.md
```

Each platform directory contains a complete application:

```text
src/                     React desktop UI
electron/                Electron main process, secure storage, and Sidecar lifecycle
backend/                 FastAPI, SQLite, agent, and domain logic
public/resume-editor/    Embedded resume editor
scripts/                 Development, test, and packaging scripts
tests/                   Frontend and Electron regression tests
docs/                    Architecture and review notes
```

See the platform-specific [Windows documentation](windows/README.md) and [macOS documentation](macos/README.md) for detailed capabilities, architecture, and packaging notes.

## Technology

- React 18, Vite, Electron, Tailwind CSS, Radix UI, and Framer Motion
- FastAPI, SQLAlchemy, SQLite, and Alembic
- Windows agent runtime: `@earendil-works/pi-agent-core` and `@earendil-works/pi-ai`
- PDF/DOCX resume processing, a local Sidecar, controlled web access, and MCP tools

## Local development

### Windows

```powershell
Set-Location .\windows
npm ci
py -3 -m venv backend\.venv
backend\.venv\Scripts\python.exe -m pip install -e "backend[dev]"
npm run desktop
```

Validation and packaging:

```powershell
npm run check
npm run build
npm run test:unit
npm run desktop:package
```

### macOS

```bash
cd macos
npm ci
python3 -m venv backend/.venv
backend/.venv/bin/python -m pip install -e 'backend[dev]'
npm run desktop
```

Validation and packaging:

```bash
npm run check
npm run build
npm run backend:test
npm run desktop:package
```

Do not reuse `node_modules`, Python virtual environments, Sidecar binaries, or package artifacts across operating systems.

## Models and privacy

FetchCV supports OpenAI-compatible and Anthropic-compatible model configurations. Model connections are configured locally by the user. Secrets must never be committed to source code, Git history, business databases, or screenshots. Repository ignore rules exclude local databases, real-world test material, and generated artifacts, but contributors should still inspect every staged change before committing.

Web tools are restricted to public HTTPS endpoints by default and block local/private networks, URL credentials, and unsafe ports. CAPTCHA and login restrictions are not bypassed automatically.

## Project status

FetchCV is under active development. The Windows and macOS directories currently evolve independently, so their features and version numbers are not identical. Public distribution still requires the appropriate platform code-signing and notarization workflows.

## License

No open-source license is currently included. All rights are reserved until a license is explicitly added. Contact the repository owner before using, modifying, or distributing the code.

