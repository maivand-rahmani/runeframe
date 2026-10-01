# Windows input transport (`src/input/transports/windows`)

Standalone, Windows-only Node transport for Ink 7 applications. The native
helper owns the console input queue (`CONIN$`) and emits JSON records; this
module translates them into keyboard bytes plus SGR mouse reports and routes
both through the shared SGR input multiplexer/parser (any-event motion `1003`
with extended coordinates `1006`), so:

- `stdin` (the multiplexer's Ink-facing stream) carries keyboard bytes only,
- `mouseEvents` publishes normalized press/release/wheel and hover/drag move
  events,
- the helper stays the sole console queue owner: JavaScript never reads
  `process.stdin` and never calls `process.stdin.setRawMode`.

## Usage

Call the factory before `render`, keep the render instance in a mutable
binding, and latch the failure callback so a helper failure that lands before
or after `render` unmounts Ink exactly once:

```ts
import { render } from 'ink'
import { createWindowsInputTransport } from 'runeframe/windows-input'

let instance: ReturnType<typeof render> | undefined
let pendingFailure: Error | undefined

const input = await createWindowsInputTransport({
  onInputFailure: (error) => {
    pendingFailure = error
    instance?.unmount()
  },
})

try {
  instance = render(<App />, { stdin: input.stdin })
  // A failure may land before `render` returns; honor the latch.
  if (pendingFailure) instance.unmount()
  await instance.waitUntilExit()
} finally {
  instance?.unmount()
  await input.close()
}
```

`render` sits inside the `try` so a throwing render still reaches `close()`.
`close()` is idempotent: it disposes the multiplexer first, then performs the
bounded graceful helper stop (`stop\n`, bounded wait, force kill only as a last
resort). A helper that has to be force-killed cannot run its own console-mode
restoration; the transport writes that caveat to stderr when it happens. The
factory is exported from the import-only ESM subpath `runeframe/windows-input`;
a host that also runs on other platforms should import it dynamically (or only
on win32) so non-Windows runs never load the Windows-only module.

## Failure handling

`onInputFailure` is called **exactly once** when the helper's byte source
terminates unexpectedly after readiness: a post-ready helper error or stdout
EOF, with EOF surfaced as an `Error`. The callback runs after the shared
multiplexer has flushed held bytes, ended `stdin` and restored raw mode, so the
host can report the failure and unmount Ink instead of sitting in a dead
fullscreen. It is never called by a normal `close()`, and a throwing callback
is swallowed so it cannot mask the failure or block teardown.

The transport installs no global process signal/exit listeners: Ctrl+C remains
Ink-driven and the host owns cleanup. If the host is not mounted yet when the
failure lands, the host latch (`pendingFailure` above) unmounts immediately
after `render`.

## Assets and platform selection

The helper executable is resolved next to this module:

```
./binaries/win-x64/Runeframe.Win32Input.exe
./binaries/win-arm64/Runeframe.Win32Input.exe
```

The relative URL resolves both from the TypeScript source entry and from the
emitted `dist/windows-input.js` bundle. The factory selects the asset from
`process.platform`/`process.arch` and **fails closed** before spawning for
unsupported targets or a missing binary; there is no `dotnet` build or runtime
fallback. Tests inject `platform`/`arch`/`executablePath`/`fileExists`/
`spawnHelper`, so no process is ever launched in CI.

## Wire protocol

One JSON object per line on helper stdout; diagnostics go to stderr:

| type | fields |
| --- | --- |
| `ready` | `originalMode:int`, `mode:int` |
| `key` | `down:boolean`, `repeat:int`, `char:string`, `virtualKey:int`, `virtualScanCode:int\|null`, `control:int` |
| `mouse` | `x:int`, `y:int`, `buttons:int`, `flags:int`, `control:int`, `windowLeft:int`, `windowTop:int` |
| `resize` | `columns:int`, `rows:int` |
| `error` | `message:string` |

`down` is a JSON boolean; the native side now serializes the 32-bit BOOL
correctly (int value plus a computed property), so JavaScript never coerces a
numeric truthiness. Malformed JSON, unknown types and records with missing
required fields are ignored; an over-long protocol line fails visibly and ends
the stream.

## Behavior notes

- Keyboard: navigation virtual keys and the enhanced gray scan-code fallback,
  Ctrl+letter control bytes, Alt prefixes, repeats (bounded), and Unicode
  surrogate pairs joined across records.
- Mouse: stateful left press/release edges, vertical wheel with modifiers, and
  press-form motion. A `MOUSE_MOVED` record becomes SGR `Cb=32` while the left
  button is held (drag) or `Cb=35` with no button (hover); motion with only
  other buttons held is ignored. Motion never mutates the press/release edge
  tracker, so it cannot synthesize a press, release or click. All reports are
  mapped from buffer coordinates through the reported viewport origin. There
  is no separate Windows mouse parser, event model or hit testing here — the
  shared SGR parser/multiplexer and the framework own routing, including
  `MouseArea` hover and captured drag callbacks.
- Known limitation (nonregression): right/middle buttons, horizontal wheel and
  out-of-viewport points remain ignored, and a drag release is still reported
  only when a press edge was seen first. Hover/drag motion is covered by the
  automated transport and parser tests; physical hover/drag in a real terminal
  has not been verified yet.
- Unexpected helper exit/error writes a visible warning, ends the Ink stream
  and calls `onInputFailure` exactly once so the host can unmount and await
  `close()`.
- No global process signal/exit listeners, no counters, no environment flags,
  no debug output and no automatic trial timeout: the host owns lifecycle.
