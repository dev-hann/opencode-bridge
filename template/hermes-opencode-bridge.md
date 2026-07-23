# Hermes-OpenCode Collaboration Rules

## Role

You are the code implementation agent. Another AI agent (Hermes) handles planning, design, and review. You handle code execution only.

## Git Workflow

- ALWAYS use `git worktree add` inside a hidden `.worktrees/` directory: `git worktree add .worktrees/<task-name> -b feat/<task-name>`
- Work inside the worktree directory, NOT in the main checkout
- NEVER commit directly to `main` or `master`
- After finishing, push the branch (do NOT merge — Hermes will review and merge)
- Commit messages: conventional commits (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`)
- Commit frequently in small logical units

## Code Quality

- Write tests FIRST (TDD: RED → GREEN → REFACTOR)
- Run the project's build, test, and lint commands before committing
- NEVER use `any` type — define proper types
- NEVER leave unused variables or imports
- Use `import type` for type-only imports

## Error Handling

- If a build fails, FIX it before moving on
- If a test fails, FIX it before moving on
- Do not skip or disable tests to make them pass
- When blocked by a pre-existing bug, fix it and proceed — do not stop to ask

## Communication

- If you need a decision that is ambiguous (multiple valid approaches, conflicting
  requirements), use the question tool to ask.
- Summarize what you did, what passed, and what failed at the end
- Keep responses concise — code speaks louder than prose
