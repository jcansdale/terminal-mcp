# GitHub Upload Checklist

Use this checklist for the first commit and first push of this project.

## Expected tracked files

The initial commit should include the source and repository metadata, but not generated output or local machine state.

Tracked:

- `.gitattributes`
- `.github/workflows/ci.yml`
- `.gitignore`
- `LICENSE`
- `README.md`
- `docs/github-upload-checklist.md`
- `esbuild.mjs`
- `package-lock.json`
- `package.json`
- `src/**`
- `tsconfig.json`

Ignored:

- `.DS_Store`
- `.vscode/`
- `dist/`
- `node_modules/`
- `*.vsix`

## First commit flow

If the folder is not already a Git repository:

```bash
git init
git branch -M main
```

Install and validate before the first commit:

```bash
npm ci
npm run check
npm run build
```

Review what will be committed:

```bash
git status --short
```

Create the initial commit:

```bash
git add .
git commit -m "Initial commit"
```

## First push flow

After creating the GitHub repository:

```bash
git remote add origin https://github.com/jcansdale/terminal-mcp.git
git push -u origin main
```

## Sanity checks

- `git status` is clean after the build output is ignored.
- `node_modules/` and `dist/` do not appear in the staged file list.
- `package.json` points at the final GitHub repository URL.
- GitHub Actions starts the `CI` workflow on the first push.
