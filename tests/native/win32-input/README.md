# Runeframe.Win32Input

Test-only Windows console record ABI/ConPTY harness. It is a component, not a
demo app and it does not render anything: it lives under
`tests/native/win32-input`, outside the test app, and nothing in
`examples/test-app` spawns this framework-dependent build. On Windows the app
starts the packaged self-contained NativeAOT helper exposed by the
`runeframe/windows-input` package entry, and this project builds and exercises
the same record core through deterministic ABI, console and ConPTY harnesses.
It can still be run standalone for diagnosis.

The **record core** (interop, mode policy, protocol serializer, record
translator and `RecordInputSession`) now lives in the library tree at
`src/input/transports/windows/native/` and is linked into this test-only
harness via `Compile Include` — the same source compiled into the production host project
`Runeframe.WindowsInput.Native.csproj` (record path only; no VT, self-test,
counters or debug telemetry). Harness-only interop lives in
`Win32TestInterop.cs`, and this project keeps its own dispatcher. The protocol
serializer is hand-escaped (no reflection-based JSON) so the production host
stays NativeAOT friendly.

## Build

```
cd tests/native/win32-input
dotnet build -c Release
```

Produces `bin/Release/net10.0/Runeframe.Win32Input.dll` (net10.0, assembly
name `Runeframe.Win32Input`).

## Run

```
dotnet bin/Release/net10.0/Runeframe.Win32Input.dll
```

Requirements and behavior:

- **stdin is a control pipe, never the console.** Spawn with
  `stdio: ['pipe', 'pipe', 'pipe']`. A line `stop` (case insensitive) or EOF
  on stdin requests shutdown; the helper then restores the console mode and
  exits. If stdin is the console input buffer itself the helper refuses to
  start (exit code 4) so two readers can never race the same queue.
- **CONIN$ is opened with `CreateFileW`** and this process is the single
  reader of the console input buffer. Node must not read `process.stdin`
  while the helper runs.
- **stdout is protocol only** (one JSON object per line, LF terminated).
  All diagnostics go to stderr, prefixed `[runeframe-win32-input]`.
- Console input mode is read with `GetConsoleMode` and restored exactly in a
  `finally` block; the start/stop mode lifecycle is logged to stderr.

Applied mode while owned: enable `ENABLE_MOUSE_INPUT` (0x10),
`ENABLE_WINDOW_INPUT` (0x08), `ENABLE_EXTENDED_FLAGS` (0x80); disable
`ENABLE_QUICK_EDIT_MODE` (0x40), `ENABLE_PROCESSED_INPUT` (0x01),
`ENABLE_LINE_INPUT` (0x02), `ENABLE_ECHO_INPUT` (0x04) and
`ENABLE_VIRTUAL_TERMINAL_INPUT` (0x200). Because processed input is cleared,
Ctrl+C arrives as a normal key record instead of a console signal.

## Stdout protocol

| type | fields |
| --- | --- |
| `ready` | `originalMode:int`, `mode:int` |
| `key` | `down:boolean`, `repeat:number`, `char:string`, `virtualKey:number`, `virtualScanCode:number`, `control:number` |
| `mouse` | `x:number`, `y:number`, `buttons:number`, `flags:number`, `control:number`, `windowLeft:number`, `windowTop:number` |
| `resize` | `columns:number`, `rows:number` |
| `error` | `message:string` |

- `ready` is emitted after CONIN$ is owned and the mode is applied.
- One initial `resize` follows `ready` with the current visible window size
  (same source as Node's `stdout.columns`/`rows`). It is skipped when
  `CONOUT$` is unavailable.
- `mouse.x`/`mouse.y` are **buffer coordinates** as reported by the console;
  subtract `windowLeft`/`windowTop` for window-relative coordinates.
  `windowLeft`/`windowTop` come from `GetConsoleScreenBufferInfo`; when
  `CONOUT$` cannot be opened or the call fails, they are reported as `0`
  (logged once to stderr).
- `mouse.buttons` is the raw `dwButtonState` DWORD (wheel deltas stay in the
  high word), `mouse.flags` is the raw `dwEventFlags`.
- `key.char` is a single UTF-16 code unit (empty string when the console
  reports `\0`); astral characters arrive as two events. Unpaired surrogate
  code units are emitted as explicit `\uXXXX` escapes (System.Text.Json would
  replace them with U+FFFD); Node's `JSON.parse` reconstructs the exact code
  units, so concatenating a high+low pair yields the astral character.
- `key.virtualScanCode` (camelCase number) is the raw `wVirtualScanCode` from
  `KEY_EVENT_RECORD`, emitted next to `virtualKey` without changing any
  existing field. It is an additive field, e.g. arrow up is
  `virtualKey:38, virtualScanCode:72`; consumers that do not know it can
  ignore it (the TS parser already ignores unknown fields). Keyboard input is
  still never logged anywhere beyond these protocol lines.
- `FOCUS_EVENT`/`MENU_EVENT` records are consumed and dropped.

This lane does not claim that the scan code field fixes the observed arrow
delivery failure in the physical mouse-enabled run; that requires the physical
diagnostic. The field only gives the consumer more record identity to work
with.

## Shutdown

The read loop does a bounded `WaitForSingleObject(CONIN$, 50ms)` then drains
`ReadConsoleInputW` batches, so a stop request is honored within ~50 ms and
shutdown can never hang inside a console read. Key, mouse and window records
share one FIFO queue drained in order, so key input cannot be starved by
mouse floods.

Shut the helper down with `stop` or EOF before killing the process: a hard
termination (`TerminateProcess`) cannot run the `finally` block, so the
console input mode would stay as the helper set it until the console itself
goes away. The intended parent flow is control-pipe stop, then wait for exit.

## `--self-test`

```
dotnet bin/Release/net10.0/Runeframe.Win32Input.dll --self-test
```

Requires no terminal: checks marshaled `INPUT_RECORD`/`KEY_EVENT_RECORD`/
`MOUSE_EVENT_RECORD`/`CONSOLE_SCREEN_BUFFER_INFO` sizes and offsets plus the
exact JSON protocol lines and field shapes. It also runs independent
hand-built native-byte ABI fixtures (`SelfTestAbiFixture`) that anchor the
layout to literal wincon.h bytes in both directions. Prints a plain-text
report to stdout (not protocol) and exits 0 on success, 1 on failure.

## `--self-test-console` (isolated console RECORD ABI/mode harness)

```
dotnet bin/Release/net10.0/Runeframe.Win32Input.dll --self-test-console
```

A deterministic integration harness for the Win32 console record ABI and the
owned input mode. It is safe to run from any terminal: **it never writes
records to, or changes the mode of, the console you run it from.**

How isolation is guaranteed:

- `--self-test-console` does not touch any console. It spawns this same binary
  as a child with `CreateProcessW` + `CREATE_NEW_CONSOLE`, so the child gets a
  brand-new console of its own; the parent only waits (30 s bound) and relays
  the child's plain-text report.
- Before opening anything, the child proves isolation:
  `GetConsoleProcessList` must list exactly one attached process — the child
  itself — and, when both consoles report a window handle, the child's console
  window must differ from the parent's. If that proof fails the child exits
  without calling `WriteConsoleInputW` (or `SetConsoleMode`) and reports the
  refusal; exit code 6.
- Only after the proof does it open `CONIN$`/`CONOUT$` on its private console,
  save the input mode, apply the exact production mode
  (`ConsoleModePolicy.OwnedInputMode`, shared with the normal run), inject
  known fixtures with `WriteConsoleInputW` in three batches, read them back
  with `ReadConsoleInputW` through the same `RecordTranslator` the production
  read loop uses, and assert the exact protocol lines.

Fixtures injected into the child's private console:

- `4`: key down/up, `VK=0x34` (52), `wVirtualScanCode=0x05` (5), `char='4'`.
- Enhanced right arrow: key down/up, `VK=0x27` (39), scan `0x4D` (77),
  `ENHANCED_KEY` (0x0100).
- `Ctrl+C` as a key record: `UnicodeChar=0x0003`, `VK=0x43`, scan `0x2E`,
  `LEFT_CTRL_PRESSED` — proves the char arrives as data, not as a signal.
- Mouse press/release at (10,20) and wheel up/down at (11,21)/(12,22) with
  `MOUSE_WHEELED` and signed high-word deltas `+120` (`0x00780000`) and
  `-120` (`0xFF880000`).
- A `WINDOW_BUFFER_SIZE_EVENT` with a sentinel payload `(7,3)`: the expected
  `resize` line must carry the console's actual visible window size, proving
  the production translation re-queries `CONSOLE_SCREEN_BUFFER_INFO` instead
  of echoing the record payload.

Report and safety properties:

- Only pass/fail categories are reported (`isolation-*`, `open-conin`,
  `mode-save`, `mode-apply`, `screen-buffer`, `queue-*`, `enqueue-*`,
  `key-*`, `mouse-*`, `resize`, `record-count`, `records-read`,
  `mode-restore`). The only input text that can appear, and only on a
  failing check, is the known fixture `4` inside the expected/actual line.
- The child's saved mode is restored in a `finally` block and verified by
  read-back; the result is the `mode-restore` report line.
- The child never reads stdin, never starts the control-pipe reader, and is
  the only reader of its private console queue. No interactive input is
  required from the user.
- Exit codes: 0 = all checks passed, 1 = check failure, 6 = no isolated
  console could be established (nothing was injected anywhere), 2 = usage.

Depending on the default terminal, a console window/tab may appear briefly
while the child runs; it hides its window when possible.

This harness is a deterministic ABI/mode test only. It makes no claim about
physical input, ConPTY delivery or terminal focus behavior.

## `--self-test-conpty-records` (headless ConPTY harness)

```
dotnet bin/Release/net10.0/Runeframe.Win32Input.dll --self-test-conpty-records
```

It creates a private headless pseudoconsole (80x30) and launches this same
binary attached to it with an explicit handle list. There is no console window,
no `CREATE_NEW_CONSOLE`/`AllocConsole`, and the caller's console is never read,
written or re-moded. stdin is the control pipe, stdout/stderr are separate
sidebands, the pseudoconsole output pipe is drained concurrently, and shutdown
is control-pipe first, then a bounded `ClosePseudoConsole`; only the test child
is ever terminated as a last resort.

- It runs the production record path (default record mode, VT input OFF): the
  host writes literal VT bytes into the pseudoconsole input pipe, ConPTY
  translates them into console input records, and the child's JSON protocol
  lines (`ReadConsoleInputW` + `RecordTranslator`) are parsed semantically.
  Fixtures are fixed private literals only (ASCII `4z`, `ESC[A`/`ESC[C`, space,
  Ctrl+C, optional `ESC[1;2A`, SGR press/release/wheel); scan codes are never
  asserted, and key-up/resize records are ignored. It checks VK/char identity
  (no H/P/9 scan-code alias), mouse cell/button/flag values, clean newline
  JSON, VT-off mode application with restore read-back, and a clean stop/exit.

It proves the synthetic ConPTY-fed path only: it is not physical keyboard or
mouse parity, and no real device is involved. Reports are written under
`bin/Release/net10.0/conpty-selftest-reports/` (git-ignored).

## Exit codes

| code | meaning |
| --- | --- |
| 0 | clean shutdown (`stop` command, EOF, or console closed) |
| 1 | `--self-test` failure or isolated console check failure |
| 2 | unknown argument |
| 3 | no console attached (`CreateFileW("CONIN$")` failed) |
| 4 | stdin is the console, not a control pipe |
| 5 | Win32 failure while owning the console (record mode) |
| 6 | isolated console harness (`--self-test-console`) or headless ConPTY harness: no isolated console could be established; nothing was injected |

## Scope note

This helper only transports records. Whether physical mouse input reaches the
console queue (especially through ConPTY) is Phase 1's blocking experiment and
must be proven by a user-run physical test; nothing here claims mouse support
before that.
