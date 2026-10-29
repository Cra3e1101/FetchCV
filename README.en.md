<div align="center">
  <img src="FetchCV_LOGO.png" alt="FetchCV" width="88" />
  <h1>FetchCV</h1>
  <p><a href="README.md">简体中文</a> · <strong>English</strong></p>
  <p><strong>Turn your real experience into your next opportunity.</strong></p>
  <p>A local-first AI job search workspace · Tailored resumes · Job research · Interview preparation</p>
  <p>
    <img src="https://img.shields.io/badge/Windows-10%20%2F%2011-0078D4" alt="Windows 10 / 11" />
    <img src="https://img.shields.io/badge/Local--first-Desktop-2F6B50" alt="Local-first desktop" />
    <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-3B82F6" alt="MIT License" /></a>
  </p>
  <p>
    <a href="#quick-start">Quick start</a> ·
    <a href="docs/getting-started.md">User guide (中文)</a> ·
    <a href="docs/README.md">Documentation (中文)</a> ·
    <a href="https://github.com/Cra3e1101/FetchCV/issues">Feedback</a>
  </p>
</div>

---

FetchCV brings your profile, target roles, resume versions, and interview materials into one desktop workspace. Import an existing resume, add a role, and use AI to understand the requirements, organize relevant experience, and suggest revisions. Review and approve the changes, then edit, export, and prepare for interviews.

**Built on your experience. Backed by sources. Changes stay in your hands.** Each role has its own workspace, so you can pursue several opportunities at once.

## Features

| Feature | What you can do |
| --- | --- |
| **Personal library** | Import PDF, Word, LaTeX, or JSON resumes; review education, internships, projects, and skills; build a reusable collection of experience and supporting materials. |
| **Job workspaces** | Paste a job description, import text, or read a public job posting. Keep conversations, tasks, and resume versions together for each role. |
| **Evidence-based tailoring** | Review the job requirements and experience behind each suggested revision. Accept, adjust, or reject changes while preserving your base resume. |
| **Resume editing and export** | Edit and preview your resume, then export a typeset PDF or an editable, single-column Word document. |
| **Interview research** | Combine your local knowledge library with public interview reports to organize questions, source excerpts, and preparation advice. |
| **Extensible agent** | Configure compatible model services, add capabilities through Skills and MCP, and manage tool permissions. |

The desktop supports light, dark, and system themes. API keys are encrypted on your device, and workspace data is stored locally. Cloud models and web research still make network requests; see [Data and privacy (中文)](docs/privacy.md).

## From resume to interview

```text
Import resume → Review profile → Add target role → Review suggestions → Edit and export → Prepare for interviews
```

1. **Build your experience library**: import your resume, review the extracted content, and add projects, portfolio materials, and certifications.
2. **Tailor your presentation to the role**: add the job description, discuss its requirements, and choose revisions supported by your experience.
3. **Prepare your application materials**: check the content and layout, export PDF / Word, and organize relevant interview reports and preparation priorities.

## Quick start

FetchCV currently supports running from source and building for Windows. No downloadable GitHub Release has been published yet. The desktop target is **Windows 10/11 x64**.

Install Git, **Node.js 22.19+ (22.x)**, and **Python 3.11+**. Python 3.12 is recommended. Run the following in PowerShell:

```powershell
git clone https://github.com/Cra3e1101/FetchCV.git
cd FetchCV

npm ci
python -m venv backend\.venv
backend\.venv\Scripts\python.exe -m pip install -e "backend[dev]"

$env:FETCHCV_PYTHON = (Resolve-Path backend\.venv\Scripts\python.exe).Path
npm run resume:runtime
npm run desktop:dev
```

Preparing the typesetting runtime for the first time requires an internet connection to download dependencies. After launch, open settings and configure your model service endpoint, API key, and model, then import your resume. OpenAI Chat Completions and Anthropic Messages compatible endpoints are supported; tool-calling capabilities depend on the selected model and service.

For detailed steps and common questions, see the [User guide (中文)](docs/getting-started.md). For installer builds, see the [Development guide (中文)](docs/development.md).

## Before you start

- **Import formats**: PDFs must contain extractable text; run OCR on scanned documents first. Word import supports `.docx`; convert older `.doc` files before importing. TeX is parsed statically without executing the imported source.
- **Content review**: review both extracted content and AI suggestions. Job fit is presented through requirements and supporting experience, with no promise of a third-party ATS pass rate.
- **Document output**: PDFs use the built-in resume template. Word exports are editable, single-column documents. The original document's layout is not guaranteed to be reproduced pixel for pixel.
- **Model services**: configure your own compatible service. Fees and data handling policies depend on the provider you choose.
- **Web sources**: access to public interview reports depends on the source website. Login requirements, CAPTCHAs, or access restrictions may prevent retrieval.

## Documentation

The guides below are currently available in Simplified Chinese.

| Guide | Contents |
| --- | --- |
| [User guide](docs/getting-started.md) | First launch, model configuration, resume import, and common questions |
| [Development guide](docs/development.md) | Development setup, check commands, and Windows installer builds |
| [Architecture](docs/architecture.md) | Desktop application, agent loop, tool gateway, and local backend |
| [Data and privacy](docs/privacy.md) | Local storage, model requests, and extension permissions |
| [Contributing](CONTRIBUTING.md) | Bug reports, feature suggestions, and code contributions |

## Technology

**React + Electron** power the desktop experience, **Pi Agent Runtime** handles model and tool interaction, **FastAPI + SQLite** provide local business services, and **XeLaTeX** typesets PDF output.

```text
src/                 Desktop interface
electron/            Desktop host and agent runtime
backend/             Local API, domain models, and document adapters
public/resume-editor/ Embedded resume editor
scripts/             Development and build tools
tests/               Automated tests
docs/                User and developer documentation
```

## Contributing

Report bugs or suggest improvements through [Issues](https://github.com/Cra3e1101/FetchCV/issues), or submit a pull request to improve the code and documentation. Please read the [Contributing guide (中文)](CONTRIBUTING.md) before starting, and use anonymized examples when reporting problems.

## License and acknowledgments

FetchCV's original code is released under the [MIT License](LICENSE). Third-party code, fonts, and runtime components remain under their respective licenses; see [Third-party notices (中文)](THIRD_PARTY_NOTICES.md).

Thanks to Pi, Electron, React, FastAPI, SQLite, TeX Live, and the other open-source projects that make FetchCV possible.
