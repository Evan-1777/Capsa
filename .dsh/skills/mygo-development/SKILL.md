---
name: mygo-development
description: Core architecture rules, anti-hallucination guardrails, and development disciplines for building desktop applications with github.com/egoist/mygo. Use whenever creating or modifying MyGo applications, configuring Native UI vs Webview modes, or implementing Go-to-TypeScript IPC.
---

# MyGo Development Rules & Disciplines

This skill provides core architectural boundaries, API conventions, and hard constraints for AI Coding Agents working on MyGo desktop applications (`github.com/egoist/mygo`).

---

## 1. Core Identity & Hard Constraints

- **Framework**: `MyGo` is a pure Go desktop application framework created by egoist.
- **Go Version**: Requires Go 1.27 or later.
- **Strictly No CGO**:
  - Always compile with `CGO_ENABLED=0`.
  - All native platform interop is handled through pure Go dynamic linking (`purego` on macOS/Linux, `syscall` on Windows). Never introduce `import "C"`.
- **Anti-Hallucination Guardrails**:
  - Do NOT confuse MyGo with Wails, Fyne, Gio, or Electron.
  - Do NOT hallucinate `wails.json`, `wails.Run`, `fyne.NewApp`, or React hooks in Go.
  - Do NOT write string-based raw event channels; MyGo uses typed Go ↔ TypeScript bindings or native Go views.

---

## 2. Dual-Mode UI Architecture

A MyGo application operates in one of two modes (or a hybrid):

### Mode A: Native GPU UI (Package `github.com/egoist/mygo/ui`)
- **Rendering**: Drawn directly by MyGo via the GPU (Metal / Direct3D 11 / OpenGL). Zero HTML, zero JS, zero webview.
- **View Pattern**: Declarative/immediate-mode Go function: `func (s *State) view(c *ui.Context)`.
- **Element Lifetime**:
  - `ui.Element` values expire at the end of each build pass.
  - **NEVER store `ui.Element` in struct fields, maps, or global variables.**
  - Use `ui.Handle` for persistent identity and focus/geometry queries: `ui.Button(c, ...).Bind(&s.buttonHandle)`.
  - Give stateful controls stable keys: `c.Key("item-id")`.
- **Context Scope**:
  - `*ui.Context` is scoped strictly to the view function stack. Never retain it in background goroutines. Capture `c.Services()` if persistent services are needed.
- **Threading & Side Effects**:
  - Views rebuild frequently. Never trigger unconditional network calls or heavy I/O inside `view(c)`.
  - Execute background tasks in a goroutine and update state using `w.Update(func() { ... })`.

### Mode B: System Webview + Typed IPC
- **Rendering**: OS system webview (WKWebView on macOS, WebView2 on Windows, WebKitGTK on Linux).
- **Go Service Binding**:
  - Export Go structs with public methods.
  - Bind them using `mygo.Bind(MyService{})`.
  - Typed broadcast events use `var EventName = mygo.NewEvent[PayloadType]("event:name")`.
- **TypeScript Generation**:
  - Run `mygo generate` to create typed client files (`src/mygo.ts`).
  - Frontend imports methods and events directly: `import { MyService, events } from "./mygo"`.
  - Do NOT invent ad-hoc JSON-RPC wire protocols.

---

## 3. Standard Project Commands

```bash
# Verify compilation and platform constraints
CGO_ENABLED=0 go build ./...
go vet ./...

# Run unit tests and in-memory Native UI tests (headless)
go test ./...

# Development live-reload
mygo dev          # or: go tool mygo dev / bun run dev

# Generate TypeScript client for bound services
mygo generate     # or: go tool mygo generate

# Package distribution binaries
mygo build        # or: go tool mygo build
```

---

## 4. Verification Checklist Before Delivery

1. `CGO_ENABLED=0 go build ./...` passes without errors.
2. `go vet ./...` reports zero warnings.
3. Native UI views have a corresponding `ui.NewTester` test in `*_test.go` verifying clicks and state updates.
4. No `ui.Element` is stored across frames.

---

## 5. Offline Documentation & Starters

When the project includes the local `MyGo/` directory, refer to:
- `MyGo/docs/llms.txt`: Complete topic and component index.
- `MyGo/docs/ui/<component>.md`: Syntax and API reference for specific Native UI controls (e.g., `button.md`, `table.md`, `input.md`, `dialog.md`).
- `MyGo/docs/bindings.md`: Go ↔ TypeScript typed IPC reference.
- `MyGo/starters/native/` & `MyGo/starters/web/`: Minimal compilable starters.
