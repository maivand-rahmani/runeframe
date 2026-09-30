using System.Globalization;
using System.Reflection;
using System.Runtime.InteropServices;

namespace Runeframe.Win32Input;

/// <summary>
/// Deterministic console RECORD ABI/mode integration harness
/// (<c>--self-test-console</c>).
///
/// The public mode (orchestrator) launches this same binary as a child with
/// <c>CreateProcessW</c> + <c>CREATE_NEW_CONSOLE</c>, so the child runs inside a
/// brand-new console that is guaranteed not to be the caller's console. The
/// child (<c>--self-test-console-child</c>) proves that isolation with
/// <c>GetConsoleProcessList</c> before it opens CONIN$, applies the production
/// input mode, injects known INPUT_RECORD fixtures with
/// <c>WriteConsoleInputW</c>, reads them back through the same
/// <see cref="RecordTranslator"/> the production loop uses, and asserts the
/// exact protocol lines. The child's original mode is restored in a
/// <c>finally</c> block and verified by read-back; the child never reads
/// stdin, never starts the control-pipe reader and writes its plain-text
/// report to a file the orchestrator echoes.
///
/// Safety rules: the orchestrator never touches console input at all. The
/// child refuses to open the input buffer or inject anything unless its
/// console lists exactly one attached process (itself) and, when both handles
/// exist, its console window differs from the parent's. Nothing can ever be
/// injected into a console shared with the user or the parent process.
/// </summary>
internal static class SelfTestConsole
{
    private const int ChildTimeoutMilliseconds = 30_000;
    private const int TerminateWaitMilliseconds = 5_000;
    private const uint TerminateExitCode = 1;
    private const int DrainBatchSize = 64;
    private const int MaxDrainIterations = 64;

    // Fixture constants (VK/scan codes and flags from winuser.h/wincon.h).
    private const ushort VirtualKeyFour = 0x34;       // '4'
    private const ushort ScanCodeFour = 0x05;
    private const ushort VirtualKeyRight = 0x27;      // VK_RIGHT
    private const ushort ScanCodeRight = 0x4D;
    private const ushort VirtualKeyC = 0x43;          // 'C'
    private const ushort ScanCodeC = 0x2E;
    private const ushort UnicodeCtrlC = 0x0003;
    private const uint EnhancedKey = 0x0100;
    private const uint LeftCtrlPressed = 0x0008;
    private const uint MouseWheeled = 0x0004;
    private const uint WheelUpHighWord = 0x0078_0000;   // wheel delta +120
    private const uint WheelDownHighWord = 0xFF88_0000; // wheel delta -120

    // Exact expected protocol lines for the fixed keyboard fixtures.
    private const string KeyFourDownLine = "{\"type\":\"key\",\"down\":true,\"repeat\":1,\"char\":\"4\",\"virtualKey\":52,\"virtualScanCode\":5,\"control\":0}";
    private const string KeyFourUpLine = "{\"type\":\"key\",\"down\":false,\"repeat\":1,\"char\":\"4\",\"virtualKey\":52,\"virtualScanCode\":5,\"control\":0}";
    private const string KeyRightDownLine = "{\"type\":\"key\",\"down\":true,\"repeat\":1,\"char\":\"\",\"virtualKey\":39,\"virtualScanCode\":77,\"control\":256}";
    private const string KeyRightUpLine = "{\"type\":\"key\",\"down\":false,\"repeat\":1,\"char\":\"\",\"virtualKey\":39,\"virtualScanCode\":77,\"control\":256}";
    private const string KeyCtrlCDownLine = "{\"type\":\"key\",\"down\":true,\"repeat\":1,\"char\":\"\\u0003\",\"virtualKey\":67,\"virtualScanCode\":46,\"control\":8}";
    private const string KeyCtrlCUpLine = "{\"type\":\"key\",\"down\":false,\"repeat\":1,\"char\":\"\\u0003\",\"virtualKey\":67,\"virtualScanCode\":46,\"control\":8}";

    /// <summary>
    /// Public entry point: spawn the isolated child and relay its report.
    /// Never reads or writes the caller's console input buffer.
    /// </summary>
    public static int RunOrchestrator()
    {
        if (!OperatingSystem.IsWindows())
        {
            Console.Out.WriteLine("console self-test: SKIP (Windows only)");
            return ExitCodes.Success;
        }

        string? executable = Environment.ProcessPath;
        if (string.IsNullOrEmpty(executable))
        {
            Console.Out.WriteLine("console self-test: FAIL (cannot resolve the current executable path)");
            return ExitCodes.ConsoleHarnessUnsafe;
        }

        string reportPath = Path.Combine(
            Path.GetTempPath(),
            $"runeframe-win32input-console-selftest-{Environment.ProcessId}-{Guid.NewGuid():N}.txt");

        var childArguments = new List<string> { "--self-test-console-child", "--report-file", reportPath };

        IntPtr parentConsoleWindow = Win32.GetConsoleWindow();
        if (parentConsoleWindow != IntPtr.Zero)
        {
            childArguments.Add("--parent-console-window");
            childArguments.Add(parentConsoleWindow.ToInt64().ToString(CultureInfo.InvariantCulture));
        }

        // When launched as `dotnet Runeframe.Win32Input.dll ...`, ProcessPath is
        // the dotnet host and the entry assembly must travel as the first
        // argument; an apphost exe needs no such repair.
        string? entryAssembly = Assembly.GetEntryAssembly()?.Location;
        if (string.Equals(Path.GetFileNameWithoutExtension(executable), "dotnet", StringComparison.OrdinalIgnoreCase)
            && !string.IsNullOrEmpty(entryAssembly))
        {
            childArguments.Insert(0, entryAssembly);
        }

        string commandLine = Quote(executable) + " " + string.Join(' ', childArguments.Select(Quote));

        Console.Out.WriteLine("console self-test: launching isolated CREATE_NEW_CONSOLE child");
        Console.Out.WriteLine($"console self-test: child report file {reportPath}");

        var startupInfo = new STARTUPINFO { cb = Marshal.SizeOf<STARTUPINFO>() };
        bool created = Win32.CreateProcessW(
            executable,
            commandLine,
            IntPtr.Zero,
            IntPtr.Zero,
            false,
            Win32.CREATE_NEW_CONSOLE,
            IntPtr.Zero,
            null,
            ref startupInfo,
            out PROCESS_INFORMATION process);

        if (!created)
        {
            int error = Marshal.GetLastWin32Error();
            Console.Out.WriteLine($"console self-test: FAIL (CreateProcessW with CREATE_NEW_CONSOLE failed, win32 error {error}; nothing was injected)");
            return ExitCodes.ConsoleHarnessUnsafe;
        }

        int exitCode;
        try
        {
            uint waitResult = Win32.WaitForSingleObject(process.Process, ChildTimeoutMilliseconds);
            if (waitResult == Win32.WAIT_TIMEOUT)
            {
                Win32.TerminateProcess(process.Process, TerminateExitCode);
                Win32.WaitForSingleObject(process.Process, TerminateWaitMilliseconds);
                Console.Out.WriteLine("console self-test: FAIL (the isolated child did not finish in time; it was terminated, nothing else was touched)");
                return ExitCodes.ConsoleHarnessUnsafe;
            }

            if (waitResult != Win32.WAIT_OBJECT_0)
            {
                int error = Marshal.GetLastWin32Error();
                Console.Out.WriteLine($"console self-test: FAIL (waiting for the isolated child failed, win32 error {error})");
                return ExitCodes.ConsoleHarnessUnsafe;
            }

            if (!Win32.GetExitCodeProcess(process.Process, out uint nativeExitCode))
            {
                int error = Marshal.GetLastWin32Error();
                Console.Out.WriteLine($"console self-test: FAIL (GetExitCodeProcess failed, win32 error {error})");
                return ExitCodes.ConsoleHarnessUnsafe;
            }

            exitCode = unchecked((int)nativeExitCode);
        }
        finally
        {
            if (process.Thread != IntPtr.Zero)
            {
                Win32.CloseHandle(process.Thread);
            }

            if (process.Process != IntPtr.Zero)
            {
                Win32.CloseHandle(process.Process);
            }
        }

        if (File.Exists(reportPath))
        {
            foreach (string line in File.ReadLines(reportPath))
            {
                Console.Out.WriteLine(line);
            }

            try
            {
                File.Delete(reportPath);
            }
            catch (Exception)
            {
                // Best effort; a leftover temp report is harmless.
            }
        }
        else
        {
            Console.Out.WriteLine("console self-test: FAIL (the isolated child left no report; it may have failed before finishing)");
            if (exitCode == ExitCodes.Success)
            {
                exitCode = ExitCodes.ConsoleHarnessUnsafe;
            }
        }

        Console.Out.WriteLine(exitCode == ExitCodes.Success
            ? "console self-test: PASS (all checks ran in the child's private console; the caller's console was never written to)"
            : $"console self-test: FAIL (isolated child exit code {exitCode})");
        return exitCode;
    }

    /// <summary>
    /// Child entry point. Runs only after CREATE_NEW_CONSOLE placed it in a
    /// fresh console; verifies that claim before doing anything to that
    /// console. Exits 0 = pass, 1 = check failure, 6 = isolation/infrastructure
    /// failure (nothing injected).
    /// </summary>
    public static int RunChild(string[] args)
    {
        if (!OperatingSystem.IsWindows())
        {
            return ExitCodes.ConsoleHarnessUnsafe;
        }

        string? reportPath = null;
        IntPtr parentConsoleWindow = IntPtr.Zero;

        for (int i = 1; i < args.Length; i++)
        {
            switch (args[i])
            {
                case "--report-file" when i + 1 < args.Length:
                    reportPath = args[++i];
                    break;

                case "--parent-console-window" when i + 1 < args.Length:
                    if (!long.TryParse(args[++i], NumberStyles.Integer, CultureInfo.InvariantCulture, out long parentWindow))
                    {
                        return ExitCodes.Usage;
                    }

                    parentConsoleWindow = new IntPtr(parentWindow);
                    break;

                default:
                    return ExitCodes.Usage;
            }
        }

        var report = new List<string>();
        int checks = 0;
        int failures = 0;

        void Check(string name, bool ok, string? detail = null)
        {
            checks++;

            if (ok)
            {
                report.Add($"console-test ok: {name}");
                return;
            }

            failures++;
            report.Add($"console-test FAIL: {name}{(detail is null ? string.Empty : $" ({detail})")}");
        }

        IntPtr consoleInput = IntPtr.Zero;
        IntPtr consoleOutput = IntPtr.Zero;
        int recommendedExitCode;

        try
        {
            recommendedExitCode = RunIsolatedChecks(Check, parentConsoleWindow, out consoleInput, out consoleOutput);
        }
        catch (Exception ex)
        {
            Check("harness-internal", false, ex.GetType().Name);
            recommendedExitCode = ExitCodes.ConsoleHarnessUnsafe;
        }
        finally
        {
            if (consoleInput != IntPtr.Zero)
            {
                Win32.CloseHandle(consoleInput);
            }

            if (consoleOutput != IntPtr.Zero)
            {
                Win32.CloseHandle(consoleOutput);
            }
        }

        int exitCode = failures == 0
            ? ExitCodes.Success
            : recommendedExitCode == ExitCodes.ConsoleHarnessUnsafe
                ? ExitCodes.ConsoleHarnessUnsafe
                : ExitCodes.SelfTestFailed;

        WriteReport(reportPath, report, checks, failures);
        return exitCode;
    }

    private static int RunIsolatedChecks(
        Action<string, bool, string?> check,
        IntPtr parentConsoleWindow,
        out IntPtr consoleInput,
        out IntPtr consoleOutput)
    {
        consoleInput = IntPtr.Zero;
        consoleOutput = IntPtr.Zero;

        // ------------------------------------------------------------------
        // Isolation proof, before any console handle is opened: the console
        // attached to this process must contain exactly this process. A
        // console shared with the parent or the user would otherwise receive
        // the injected records.
        // ------------------------------------------------------------------
        uint[] attachedProcesses = new uint[4];
        uint attachedCount = Win32.GetConsoleProcessList(attachedProcesses, (uint)attachedProcesses.Length);
        bool exclusive = attachedCount == 1 && attachedProcesses[0] == (uint)Environment.ProcessId;
        check(
            "isolation-exclusive-console",
            exclusive,
            exclusive ? null : $"this console lists {attachedCount} attached process(es); refusing to inject");
        if (!exclusive)
        {
            return ExitCodes.ConsoleHarnessUnsafe;
        }

        IntPtr consoleWindow = Win32.GetConsoleWindow();
        bool distinctWindow = parentConsoleWindow == IntPtr.Zero
            || consoleWindow == IntPtr.Zero
            || consoleWindow != parentConsoleWindow;
        check(
            "isolation-distinct-window",
            distinctWindow,
            distinctWindow ? null : "child and parent report the same console window; refusing to inject");
        if (!distinctWindow)
        {
            return ExitCodes.ConsoleHarnessUnsafe;
        }

        TryHideConsoleWindow(consoleWindow);

        consoleInput = Win32.CreateFileW(
            "CONIN$",
            Win32.GENERIC_READ | Win32.GENERIC_WRITE,
            Win32.FILE_SHARE_READ | Win32.FILE_SHARE_WRITE,
            IntPtr.Zero,
            Win32.OPEN_EXISTING,
            0,
            IntPtr.Zero);

        if (consoleInput == Win32.InvalidHandleValue)
        {
            consoleInput = IntPtr.Zero;
            check("open-conin", false, $"CreateFileW(CONIN$) failed (win32 error {Marshal.GetLastWin32Error()})");
            return ExitCodes.ConsoleHarnessUnsafe;
        }

        check("open-conin", true, null);

        consoleOutput = Win32.CreateFileW(
            "CONOUT$",
            Win32.GENERIC_READ | Win32.GENERIC_WRITE,
            Win32.FILE_SHARE_READ | Win32.FILE_SHARE_WRITE,
            IntPtr.Zero,
            Win32.OPEN_EXISTING,
            0,
            IntPtr.Zero);

        bool hasScreenBuffer = consoleOutput != Win32.InvalidHandleValue;
        if (!hasScreenBuffer)
        {
            consoleOutput = IntPtr.Zero;
        }

        // ------------------------------------------------------------------
        // Mode save/apply. The restore and its read-back run in the finally,
        // even when a later check fails or throws.
        // ------------------------------------------------------------------
        bool modeSaved = Win32.GetConsoleMode(consoleInput, out uint originalMode);
        check("mode-save", modeSaved, modeSaved ? null : $"GetConsoleMode failed (win32 error {Marshal.GetLastWin32Error()})");
        if (!modeSaved)
        {
            return ExitCodes.ConsoleHarnessUnsafe;
        }

        bool modeOwned = false;
        try
        {
            uint requestedMode = ConsoleModePolicy.OwnedInputMode(originalMode);
            bool setModeOk = Win32.SetConsoleMode(consoleInput, requestedMode);
            modeOwned = setModeOk;

            bool modeApplied = setModeOk
                && Win32.GetConsoleMode(consoleInput, out uint appliedMode)
                && appliedMode == requestedMode;
            check(
                "mode-apply",
                modeApplied,
                setModeOk
                    ? "read-back did not match the requested mode"
                    : $"SetConsoleMode failed (win32 error {Marshal.GetLastWin32Error()})");

            // ------------------------------------------------------------------
            // Live geometry of the private console, used to build the exact
            // expected mouse/resize lines. Captured before injecting; only this
            // process can change the private console while the checks run.
            // ------------------------------------------------------------------
            if (!TryReadWindowGeometry(consoleOutput, hasScreenBuffer, out short windowLeft, out short windowTop, out short columns, out short rows))
            {
                check("screen-buffer", false, "GetConsoleScreenBufferInfo on the private console failed");
                return ExitCodes.ConsoleHarnessUnsafe;
            }

            check("screen-buffer", true, null);

            // Drop anything the fresh console queued on startup (focus or
            // initial window records) so the fixture assertion stays exact.
            if (!DrainAll(consoleInput, null, out _))
            {
                check("queue-drain", false, "could not drain the private console queue before injecting");
                return ExitCodes.ConsoleHarnessUnsafe;
            }

            check("queue-drain", true, null);

            // ------------------------------------------------------------------
            // Fixtures: keyboard batch, mouse batch, resize batch.
            // ------------------------------------------------------------------
            INPUT_RECORD[] keyBatch =
            {
                KeyRecord(true, 1, VirtualKeyFour, VirtualKeyFour, ScanCodeFour, 0),
                KeyRecord(false, 1, VirtualKeyFour, VirtualKeyFour, ScanCodeFour, 0),
                KeyRecord(true, 1, 0, VirtualKeyRight, ScanCodeRight, EnhancedKey),
                KeyRecord(false, 1, 0, VirtualKeyRight, ScanCodeRight, EnhancedKey),
                KeyRecord(true, 1, UnicodeCtrlC, VirtualKeyC, ScanCodeC, LeftCtrlPressed),
                KeyRecord(false, 1, UnicodeCtrlC, VirtualKeyC, ScanCodeC, LeftCtrlPressed),
            };

            INPUT_RECORD[] mouseBatch =
            {
                MouseRecord(10, 20, 1, 0, 0),
                MouseRecord(10, 20, 0, 0, 0),
                MouseRecord(11, 21, WheelUpHighWord, MouseWheeled, 0),
                MouseRecord(12, 22, WheelDownHighWord, MouseWheeled, 0),
            };

            INPUT_RECORD[] resizeBatch = { ResizeRecord(7, 3) };

            bool keyBatchWritten = WriteBatch(consoleInput, keyBatch, out string? keyBatchError);
            check("enqueue-key-batch", keyBatchWritten, keyBatchError);

            bool mouseBatchWritten = WriteBatch(consoleInput, mouseBatch, out string? mouseBatchError);
            check("enqueue-mouse-batch", mouseBatchWritten, mouseBatchError);

            bool resizeBatchWritten = WriteBatch(consoleInput, resizeBatch, out string? resizeBatchError);
            check("enqueue-resize-batch", resizeBatchWritten, resizeBatchError);

            // ------------------------------------------------------------------
            // Read back through the production translation helper.
            // ------------------------------------------------------------------
            var lines = new List<string>();
            var translator = new RecordTranslator(consoleOutput, hasScreenBuffer, lines.Add, _ => { });
            bool drained = DrainAll(consoleInput, translator.EmitRecord, out _);
            check("records-read", drained, drained ? null : "ReadConsoleInputW failed on the private console");

            bool queueEmpty = Win32.GetNumberOfConsoleInputEvents(consoleInput, out uint remaining) && remaining == 0;
            check(
                "queue-drained",
                drained && queueEmpty,
                drained && queueEmpty ? null : $"{remaining} record(s) remain in the private console queue");

            var expected = new List<(string Category, string Line)>
            {
                ("key-4-down", KeyFourDownLine),
                ("key-4-up", KeyFourUpLine),
                ("key-enhanced-right-down", KeyRightDownLine),
                ("key-enhanced-right-up", KeyRightUpLine),
                ("key-ctrl-c-down", KeyCtrlCDownLine),
                ("key-ctrl-c-up", KeyCtrlCUpLine),
                ("mouse-press", MouseLine(10, 20, 1, 0, 0, windowLeft, windowTop)),
                ("mouse-release", MouseLine(10, 20, 0, 0, 0, windowLeft, windowTop)),
                ("mouse-wheel-up", MouseLine(11, 21, WheelUpHighWord, MouseWheeled, 0, windowLeft, windowTop)),
                ("mouse-wheel-down", MouseLine(12, 22, WheelDownHighWord, MouseWheeled, 0, windowLeft, windowTop)),
                ("resize", $"{{\"type\":\"resize\",\"columns\":{columns},\"rows\":{rows}}}"),
            };

            check("record-count", lines.Count == expected.Count, $"expected {expected.Count} protocol lines, read {lines.Count}");

            for (int i = 0; i < expected.Count; i++)
            {
                string actual = i < lines.Count ? lines[i] : "<missing>";
                check(
                    expected[i].Category,
                    actual == expected[i].Line,
                    actual == expected[i].Line ? null : $"expected '{expected[i].Line}', got '{actual}'");
            }

            return ExitCodes.SelfTestFailed;
        }
        finally
        {
            bool restored = true;
            if (modeOwned)
            {
                bool setBack = Win32.SetConsoleMode(consoleInput, originalMode);
                restored = setBack
                    && Win32.GetConsoleMode(consoleInput, out uint restoredMode)
                    && restoredMode == originalMode;
            }

            check("mode-restore", restored, restored ? null : "console input mode did not return to the saved value");
        }
    }

    private static INPUT_RECORD KeyRecord(bool down, ushort repeat, ushort unicodeChar, ushort virtualKey, ushort scanCode, uint controlState) => new()
    {
        EventType = Win32.KEY_EVENT,
        KeyEvent = new KEY_EVENT_RECORD
        {
            Down = down,
            RepeatCount = repeat,
            VirtualKeyCode = virtualKey,
            VirtualScanCode = scanCode,
            UnicodeChar = unicodeChar,
            ControlKeyState = controlState,
        },
    };

    private static INPUT_RECORD MouseRecord(short x, short y, uint buttons, uint flags, uint controlState) => new()
    {
        EventType = Win32.MOUSE_EVENT,
        MouseEvent = new MOUSE_EVENT_RECORD
        {
            MousePosition = new COORD { X = x, Y = y },
            ButtonState = buttons,
            ControlKeyState = controlState,
            EventFlags = flags,
        },
    };

    private static INPUT_RECORD ResizeRecord(short columns, short rows) => new()
    {
        EventType = Win32.WINDOW_BUFFER_SIZE_EVENT,
        WindowBufferSizeEvent = new WINDOW_BUFFER_SIZE_RECORD { Size = new COORD { X = columns, Y = rows } },
    };

    private static bool WriteBatch(IntPtr consoleInput, INPUT_RECORD[] records, out string? error)
    {
        if (!Win32.WriteConsoleInputW(consoleInput, records, (uint)records.Length, out uint written))
        {
            error = $"WriteConsoleInputW failed (win32 error {Marshal.GetLastWin32Error()})";
            return false;
        }

        if (written != records.Length)
        {
            error = $"wrote {written} of {records.Length} records";
            return false;
        }

        error = null;
        return true;
    }

    /// <summary>
    /// Bounded drain of the private console queue using the same Win32 calls
    /// as the production read loop (GetNumberOfConsoleInputEvents +
    /// ReadConsoleInputW in batches). <paramref name="sink"/> receives every
    /// record; pass null to discard.
    /// </summary>
    private static bool DrainAll(IntPtr consoleInput, Action<INPUT_RECORD>? sink, out uint total)
    {
        total = 0;
        var buffer = new INPUT_RECORD[DrainBatchSize];

        for (int iteration = 0; iteration < MaxDrainIterations; iteration++)
        {
            if (!Win32.GetNumberOfConsoleInputEvents(consoleInput, out uint pending))
            {
                return false;
            }

            if (pending == 0)
            {
                return true;
            }

            uint wanted = Math.Min(pending, (uint)buffer.Length);
            if (!Win32.ReadConsoleInputW(consoleInput, buffer, wanted, out uint read) || read == 0)
            {
                return false;
            }

            total += read;
            if (sink is not null)
            {
                for (uint i = 0; i < read; i++)
                {
                    sink(buffer[i]);
                }
            }
        }

        return false;
    }

    private static bool TryReadWindowGeometry(
        IntPtr consoleOutput,
        bool hasScreenBuffer,
        out short windowLeft,
        out short windowTop,
        out short columns,
        out short rows)
    {
        windowLeft = 0;
        windowTop = 0;
        columns = 0;
        rows = 0;

        if (!hasScreenBuffer || !Win32.GetConsoleScreenBufferInfo(consoleOutput, out CONSOLE_SCREEN_BUFFER_INFO info))
        {
            return false;
        }

        int width = info.Window.Right - info.Window.Left + 1;
        int height = info.Window.Bottom - info.Window.Top + 1;
        if (width <= 0 || height <= 0 || width > short.MaxValue || height > short.MaxValue)
        {
            return false;
        }

        windowLeft = info.Window.Left;
        windowTop = info.Window.Top;
        columns = (short)width;
        rows = (short)height;
        return true;
    }

    private static string MouseLine(short x, short y, uint buttons, uint flags, uint controlState, short windowLeft, short windowTop) =>
        $"{{\"type\":\"mouse\",\"x\":{x},\"y\":{y},\"buttons\":{buttons},\"flags\":{flags},\"control\":{controlState},\"windowLeft\":{windowLeft},\"windowTop\":{windowTop}}}";

    private static void WriteReport(string? reportPath, List<string> report, int checks, int failures)
    {
        report.Add(failures == 0
            ? $"console-test: PASS ({checks} checks)"
            : $"console-test: FAIL ({failures} of {checks} checks failed)");

        if (string.IsNullOrEmpty(reportPath))
        {
            return;
        }

        try
        {
            File.WriteAllLines(reportPath, report);
        }
        catch (Exception)
        {
            // The orchestrator reports a missing report file.
        }
    }

    private static void TryHideConsoleWindow(IntPtr consoleWindow)
    {
        if (consoleWindow == IntPtr.Zero)
        {
            return;
        }

        try
        {
            Win32.ShowWindow(consoleWindow, Win32.SW_HIDE);
        }
        catch (Exception)
        {
            // Cosmetic only; the private console may be visible briefly.
        }
    }

    private static string Quote(string value) => "\"" + value + "\"";
}
