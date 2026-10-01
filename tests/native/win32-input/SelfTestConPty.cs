using System.Diagnostics;
using System.Globalization;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;

namespace Runeframe.Win32Input;

/// <summary>
/// Headless ConPTY harness for the production record path
/// (<c>--self-test-conpty-records</c>).
///
/// It creates a private pseudoconsole (<c>CreatePseudoConsole</c>, 80x30) and
/// launches this same binary in its default record mode (VT input OFF)
/// attached to it, with:
///  - stdin  = control pipe (<c>stop</c> / EOF authority),
///  - stdout = JSON protocol sideband (<c>ReadConsoleInputW</c> +
///    <see cref="RecordTranslator"/> records),
///  - stderr = diagnostics.
/// The child opens <c>CONIN$</c> itself; that console input buffer is the
/// pseudoconsole's. The host writes literal escape-sequence input bytes (ASCII
/// <c>4z</c>, <c>ESC[A</c>, <c>ESC[C</c>, space, Ctrl+C, optional
/// <c>ESC[1;2A</c>, SGR press/release/wheel) into the pseudoconsole input pipe,
/// ConPTY translates them into console input records, and the harness parses
/// the child's protocol lines semantically. Nothing is injected with
/// <c>WriteConsoleInputW</c>; scan codes are never asserted and key-up/resize
/// records are ignored.
///
/// Safety: no <c>CREATE_NEW_CONSOLE</c>, no <c>AllocConsole</c>/<c>FreeConsole</c>,
/// no <c>CREATE_NO_WINDOW</c>/<c>DETACHED_PROCESS</c> guesses, no
/// <c>SetConsoleMode</c> on the caller's console, and the pseudoconsole is
/// headless by design. The caller's console is never read, written or re-moded.
/// The child inherits only its three explicit pipe ends (a handle list), and
/// every native return is checked. Shutdown is control-pipe first, then a
/// bounded background <c>ClosePseudoConsole</c>, and only this test child is
/// terminated as a last resort; no join, write or close is unbounded.
///
/// Scope: the record checks prove the ConPTY-fed <c>ReadConsoleInputW</c> +
/// <see cref="RecordTranslator"/> path only; they are NOT physical keyboard or
/// mouse parity, and no real device is involved. Reports are written under
/// <c>bin</c> (git-ignored).
/// </summary>
internal static class SelfTestConPty
{
    private const string RecordReportName = "conpty records self-test";
    private const string ChildLogPrefix = "[runeframe-win32-input]";
    private const string RecordReadyMarker = "ready: originalMode=0x";

    private const int ReadyTimeoutMilliseconds = 15_000;
    private const int FixtureStableMilliseconds = 250;
    private const int FixtureTimeoutMilliseconds = 2_000;
    private const int StopWaitMilliseconds = 15_000;
    private const int PseudoConsoleCloseWaitMilliseconds = 5_000;
    private const int TerminateWaitMilliseconds = 5_000;
    private const int DrainJoinMilliseconds = 3_000;
    private const int DrainBufferSize = 4096;
    private const int MaxCapturedBytes = 64 * 1024;
    private const uint TerminateExitCode = 1;
    private const short ConsoleWidth = 80;
    private const short ConsoleHeight = 30;

    private static readonly byte[] StopCommand = Encoding.ASCII.GetBytes("stop\n");

    /// <summary>
    /// Literal escape-sequence input fixtures for the record-mode scenario. The expected
    /// results are semantic protocol records, not byte matches: ConPTY
    /// translates these host bytes into console input records and the
    /// production record helper (VT input OFF) reports them through
    /// <see cref="RecordTranslator"/>. Scan codes are deliberately not
    /// asserted: the host assigns them, and only VK/char/modifier identity is
    /// contract-stable.
    /// </summary>
    private static readonly (string Name, byte[] Bytes)[] RecordFixtures =
    {
        ("ascii-4z", Encoding.ASCII.GetBytes("4z")),
        ("arrow-up", Encoding.ASCII.GetBytes("\u001b[A")),
        ("arrow-right", Encoding.ASCII.GetBytes("\u001b[C")),
        ("space", Encoding.ASCII.GetBytes(" ")),
        ("ctrl-c", new byte[] { 0x03 }),
        ("shift-arrow-up", Encoding.ASCII.GetBytes("\u001b[1;2A")),
        ("sgr-press", Encoding.ASCII.GetBytes("\u001b[<0;4;2M")),
        ("sgr-release", Encoding.ASCII.GetBytes("\u001b[<0;4;2m")),
        ("sgr-wheel", Encoding.ASCII.GetBytes("\u001b[<65;4;2M")),
    };

    /// <summary>
    /// Public entry point for the production record scenario
    /// (<c>--self-test-conpty-records</c>): the same headless private
    /// pseudoconsole and safety envelope, but the child is the original record
    /// helper (default record mode, VT input off) with control-stdin and JSON-stdout /
    /// stderr sidebands, and its protocol lines are parsed semantically.
    /// Never touches the caller's console.
    /// </summary>
    public static int RunRecordOrchestrator() => RunOrchestratorCore(RecordReportName, RunRecordScenario);

    private static int RunOrchestratorCore(
        string reportName,
        Func<string, Action<string, bool, string?>, Action<string, string>, bool> scenario)
    {
        if (!OperatingSystem.IsWindows())
        {
            Console.Out.WriteLine($"{reportName}: SKIP (Windows only)");
            return ExitCodes.Success;
        }

        string? executable = Environment.ProcessPath;
        if (string.IsNullOrEmpty(executable))
        {
            Console.Out.WriteLine($"{reportName}: FAIL (cannot resolve the current executable path)");
            return ExitCodes.ConsoleHarnessUnsafe;
        }

        string reportsDirectory = Path.Combine(AppContext.BaseDirectory, "conpty-selftest-reports");
        string runId = $"{Environment.ProcessId}-{DateTime.UtcNow:yyyyMMdd-HHmmss}";
        var report = new List<string>();
        int checks = 0;
        int failures = 0;
        bool harnessUnsafe = false;

        void Check(string name, bool ok, string? detail = null)
        {
            checks++;
            if (ok)
            {
                report.Add($"{reportName} ok: {name}");
                return;
            }

            failures++;
            report.Add($"{reportName} FAIL: {name}{(detail is null ? string.Empty : $" ({detail})")}");
        }

        void Info(string name, string data) => report.Add($"{reportName} data: {name}={data}");

        try
        {
            Directory.CreateDirectory(reportsDirectory);
        }
        catch (Exception ex)
        {
            Console.Out.WriteLine($"{reportName}: FAIL (cannot create the report directory under bin: {ex.Message})");
            return ExitCodes.ConsoleHarnessUnsafe;
        }

        Console.Out.WriteLine($"{reportName}: creating a headless private pseudoconsole; the caller's console is never read, written or re-moded");
        Console.Out.WriteLine($"{reportName}: report directory {reportsDirectory}");

        try
        {
            harnessUnsafe = !scenario(executable, Check, Info);
        }
        catch (Exception ex)
        {
            Check("harness-internal", false, $"{ex.GetType().Name}: {ex.Message}");
            harnessUnsafe = true;
        }

        report.Add(failures == 0
            ? $"{reportName}: PASS ({checks} checks)"
            : $"{reportName}: FAIL ({failures} of {checks} checks failed)");

        string summaryPath = Path.Combine(reportsDirectory, $"conpty-selftest-{runId}.txt");
        WriteAllLinesBestEffort(summaryPath, report);

        foreach (string line in report)
        {
            Console.Out.WriteLine(line);
        }

        Console.Out.WriteLine($"{reportName}: report file {summaryPath}");

        if (failures == 0)
        {
            return ExitCodes.Success;
        }

        return harnessUnsafe ? ExitCodes.ConsoleHarnessUnsafe : ExitCodes.SelfTestFailed;
    }

    /// <summary>
    /// Runs the record-mode scenario: the production record helper (VT input OFF) attached to a headless private
    /// pseudoconsole with control-stdin and JSON-stdout / stderr sidebands. The
    /// host writes literal VT input bytes into the pseudoconsole input pipe and
    /// parses the child's protocol lines semantically; scan codes are never
    /// asserted because the host assigns them. Returns false when the harness
    /// could not establish the pseudoconsole session (nothing was injected);
    /// fixture mismatches are check failures, not harness failures.
    /// </summary>
    private static bool RunRecordScenario(
        string executable,
        Action<string, bool, string?> check,
        Action<string, string> info)
    {
        var nonInheritable = new SECURITY_ATTRIBUTES
        {
            nLength = Marshal.SizeOf<SECURITY_ATTRIBUTES>(),
            bInheritHandle = false,
        };
        var inheritable = new SECURITY_ATTRIBUTES
        {
            nLength = Marshal.SizeOf<SECURITY_ATTRIBUTES>(),
            bInheritHandle = true,
        };

        IntPtr ptyInputRead = IntPtr.Zero;
        IntPtr hostWrite = IntPtr.Zero;
        IntPtr ptyOutputWrite = IntPtr.Zero;
        IntPtr hostRead = IntPtr.Zero;
        IntPtr childStdinRead = IntPtr.Zero;
        IntPtr parentStdinWrite = IntPtr.Zero;
        IntPtr childStdoutWrite = IntPtr.Zero;
        IntPtr parentStdoutRead = IntPtr.Zero;
        IntPtr childStderrWrite = IntPtr.Zero;
        IntPtr parentStderrRead = IntPtr.Zero;
        IntPtr pseudoConsole = IntPtr.Zero;
        IntPtr attributeList = IntPtr.Zero;
        IntPtr handleList = IntPtr.Zero;
        bool attributeListInitialized = false;
        PROCESS_INFORMATION process = default;
        bool processCreated = false;
        bool childExited = false;
        var drains = new List<PipeDrain>();

        try
        {
            // ---- pseudoconsole pipes (non-inheritable; ConPTY duplicates them) ----
            if (!Win32TestPipe.CreatePipe(out ptyInputRead, out hostWrite, ref nonInheritable, 0)
                || !Win32TestPipe.CreatePipe(out hostRead, out ptyOutputWrite, ref nonInheritable, 0))
            {
                check("conpty-pipes", false, $"CreatePipe failed (win32 error {Marshal.GetLastWin32Error()})");
                return false;
            }

            check("conpty-pipes", true, null);

            int createResult;
            try
            {
                createResult = Win32ConPty.CreatePseudoConsole(
                    new COORD { X = ConsoleWidth, Y = ConsoleHeight },
                    ptyInputRead,
                    ptyOutputWrite,
                    0,
                    out pseudoConsole);
            }
            catch (EntryPointNotFoundException)
            {
                check("conpty-create", false, "CreatePseudoConsole is not available on this Windows build (requires Windows 10 1809+)");
                return false;
            }

            if (createResult < 0 || pseudoConsole == IntPtr.Zero)
            {
                check("conpty-create", false, $"CreatePseudoConsole failed (hr=0x{createResult:X8}, win32 error {Marshal.GetLastWin32Error()})");
                pseudoConsole = IntPtr.Zero;
                return false;
            }

            check("conpty-create", true, null);

            // The pseudoconsole duplicated its pipe ends; the host keeps only
            // the input write end and the output read end.
            CloseHandleIfSet(ref ptyInputRead);
            CloseHandleIfSet(ref ptyOutputWrite);

            // ---- sideband + control pipes (child ends inheritable and listed) ----
            if (!Win32TestPipe.CreatePipe(out childStdinRead, out parentStdinWrite, ref inheritable, 0)
                || !Win32TestPipe.CreatePipe(out parentStdoutRead, out childStdoutWrite, ref inheritable, 0)
                || !Win32TestPipe.CreatePipe(out parentStderrRead, out childStderrWrite, ref inheritable, 0))
            {
                check("sideband-pipes", false, $"CreatePipe failed (win32 error {Marshal.GetLastWin32Error()})");
                return false;
            }

            bool parentHandlesPrivate =
                Win32TestPipe.SetHandleInformation(parentStdinWrite, Win32TestPipe.HANDLE_FLAG_INHERIT, 0)
                && Win32TestPipe.SetHandleInformation(parentStdoutRead, Win32TestPipe.HANDLE_FLAG_INHERIT, 0)
                && Win32TestPipe.SetHandleInformation(parentStderrRead, Win32TestPipe.HANDLE_FLAG_INHERIT, 0);
            check("sideband-pipes", true, null);
            check(
                "parent-handles-non-inheritable",
                parentHandlesPrivate,
                parentHandlesPrivate ? null : $"SetHandleInformation failed (win32 error {Marshal.GetLastWin32Error()})");

            // ---- attribute list: pseudoconsole + explicit handle list ----
            IntPtr attributeListSize = IntPtr.Zero;
            _ = Win32ConPty.InitializeProcThreadAttributeList(IntPtr.Zero, 2, 0, ref attributeListSize);
            if (attributeListSize == IntPtr.Zero)
            {
                check("attribute-list", false, $"InitializeProcThreadAttributeList sizing failed (win32 error {Marshal.GetLastWin32Error()})");
                return false;
            }

            attributeList = Marshal.AllocHGlobal(attributeListSize);
            if (!Win32ConPty.InitializeProcThreadAttributeList(attributeList, 2, 0, ref attributeListSize))
            {
                check("attribute-list", false, $"InitializeProcThreadAttributeList failed (win32 error {Marshal.GetLastWin32Error()})");
                return false;
            }

            attributeListInitialized = true;

            IntPtr[] inheritedHandles = { childStdinRead, childStdoutWrite, childStderrWrite };
            handleList = Marshal.AllocHGlobal(inheritedHandles.Length * IntPtr.Size);
            Marshal.Copy(inheritedHandles, 0, handleList, inheritedHandles.Length);

            if (!Win32ConPty.UpdateProcThreadAttribute(
                    attributeList,
                    0,
                    Win32ConPty.PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE,
                    pseudoConsole,
                    new IntPtr(IntPtr.Size),
                    IntPtr.Zero,
                    IntPtr.Zero))
            {
                check("attribute-pseudoconsole", false, $"UpdateProcThreadAttribute(PSEUDOCONSOLE) failed (win32 error {Marshal.GetLastWin32Error()})");
                return false;
            }

            if (!Win32ConPty.UpdateProcThreadAttribute(
                    attributeList,
                    0,
                    Win32ConPty.PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
                    handleList,
                    new IntPtr(inheritedHandles.Length * IntPtr.Size),
                    IntPtr.Zero,
                    IntPtr.Zero))
            {
                check("attribute-handle-list", false, $"UpdateProcThreadAttribute(HANDLE_LIST) failed (win32 error {Marshal.GetLastWin32Error()})");
                return false;
            }

            check("attribute-list", true, null);

            // ---- spawn the production record child attached to the ConPTY ----
            string? commandLine = BuildRecordCommandLine(executable, out string? hostError);
            if (commandLine is null)
            {
                check("spawn", false, hostError);
                return false;
            }

            var startupInfo = new STARTUPINFOEXW
            {
                StartupInfo = new STARTUPINFO
                {
                    cb = Marshal.SizeOf<STARTUPINFOEXW>(),
                    dwFlags = Win32TestPipe.STARTF_USESTDHANDLES,
                    hStdInput = childStdinRead,
                    hStdOutput = childStdoutWrite,
                    hStdError = childStderrWrite,
                },
                lpAttributeList = attributeList,
            };

            if (!Win32ConPty.CreateProcessW(
                    null,
                    commandLine,
                    IntPtr.Zero,
                    IntPtr.Zero,
                    true,
                    Win32ConPty.EXTENDED_STARTUPINFO_PRESENT,
                    IntPtr.Zero,
                    null,
                    ref startupInfo,
                    out process))
            {
                check("spawn", false, $"CreateProcessW(EXTENDED_STARTUPINFO_PRESENT) failed (win32 error {Marshal.GetLastWin32Error()})");
                return false;
            }

            processCreated = true;
            check("spawn", true, null);
            info("child-pid", process.ProcessId.ToString(CultureInfo.InvariantCulture));

            // The child owns the child-side ends now.
            CloseHandleIfSet(ref childStdinRead);
            CloseHandleIfSet(ref childStdoutWrite);
            CloseHandleIfSet(ref childStderrWrite);

            // ---- concurrent drains: ConPTY output, stdout sideband, stderr sideband ----
            var conptyOutput = new ByteCapture();
            var stdoutCapture = new ByteCapture();
            var stderrCapture = new ByteCapture();
            drains.Add(new PipeDrain(hostRead, conptyOutput, "conpty-output"));
            drains.Add(new PipeDrain(parentStdoutRead, stdoutCapture, "child-stdout"));
            drains.Add(new PipeDrain(parentStderrRead, stderrCapture, "child-stderr"));
            foreach (PipeDrain drain in drains)
            {
                drain.Start();
            }

            hostRead = IntPtr.Zero;
            parentStdoutRead = IntPtr.Zero;
            parentStderrRead = IntPtr.Zero;

            // ---- readiness: the record helper logs the applied mode on stderr ----
            bool ready = WaitForText(stderrCapture, RecordReadyMarker, ReadyTimeoutMilliseconds, process.Process);
            check(
                "ready",
                ready,
                ready ? null : $"no '{RecordReadyMarker}' diagnostic within {ReadyTimeoutMilliseconds} ms: {OneLine(stderrCapture.SnapshotText())}");
            if (!ready)
            {
                return false;
            }

            // ---- prefix: JSON ready line (and the initial resize) ----
            var allProtocol = new StringBuilder();
            byte[] prefixBytes = CaptureStable(stdoutCapture, FixtureStableMilliseconds, FixtureTimeoutMilliseconds);
            allProtocol.Append(Encoding.UTF8.GetString(prefixBytes));
            info("records-prefix", DescribeBytes(prefixBytes));
            if (TryParseRecordLines(prefixBytes, out List<JsonElement> prefixRecords, out string? prefixError))
            {
                bool readyFirst = prefixRecords.Count > 0 && RecordType(prefixRecords[0]) == "ready";
                check("records-ready-first", readyFirst, $"expected a 'ready' JSON record first; observed {DescribeRecordTypes(prefixRecords)}");
                bool readyShape = readyFirst
                    && RecordNumber(prefixRecords[0], "originalMode") >= 0
                    && RecordNumber(prefixRecords[0], "mode") >= 0;
                check("records-ready-shape", readyShape, DescribeRecordTypes(prefixRecords));
                info("records-prefix-types", DescribeRecordTypes(prefixRecords));
            }
            else
            {
                check("records-ready-first", false, $"stdout was not clean newline JSON: {prefixError}");
            }

            // ---- literal escape-sequence fixtures into the ConPTY input pipe ----
            bool aliasFree = true;
            foreach ((string name, byte[] bytes) in RecordFixtures)
            {
                RunRecordFixture(hostWrite, stdoutCapture, name, bytes, process.Process, check, info, allProtocol, out bool fixtureAliasFree);
                aliasFree &= fixtureAliasFree;
            }

            check(
                "records-no-scan-code-alias",
                aliasFree,
                "a fixture key char did not match the native character (historical H/P/9 scan-code alias)");

            byte[] late = CaptureStable(stdoutCapture, FixtureStableMilliseconds, FixtureTimeoutMilliseconds);
            allProtocol.Append(Encoding.UTF8.GetString(late));
            info("records-late-bytes", DescribeBytes(late));
            check("records-no-late-records", late.Length == 0, $"unexpected late protocol bytes after the fixtures: {DescribeBytes(late)}");

            // ---- stop via the control pipe, bounded ----
            bool stopSent = WriteAllBytes(parentStdinWrite, StopCommand, out string? stopError);
            check("stop-command", stopSent, stopError);

            childExited = stopSent && WaitForProcess(process.Process, StopWaitMilliseconds);
            bool pseudoConsoleCloseAttempted = false;
            bool forcedTerminate = false;
            if (!childExited)
            {
                pseudoConsoleCloseAttempted = true;
                ClosePseudoConsoleBounded(ref pseudoConsole, PseudoConsoleCloseWaitMilliseconds);
                childExited = WaitForProcess(process.Process, PseudoConsoleCloseWaitMilliseconds);
                if (!childExited)
                {
                    forcedTerminate = Win32.TerminateProcess(process.Process, TerminateExitCode);
                    childExited = WaitForProcess(process.Process, TerminateWaitMilliseconds);
                }
            }

            int exitCode = int.MinValue;
            bool exitCodeReadable = TryGetExitCode(process.Process, out exitCode);
            check(
                "child-exit",
                childExited && exitCodeReadable && exitCode == ExitCodes.Success,
                childExited
                    ? (exitCodeReadable ? $"exit code {exitCode}" : "GetExitCodeProcess failed")
                    : $"the child did not exit within {StopWaitMilliseconds} ms after the stop command; pseudoconsole close attempted={pseudoConsoleCloseAttempted}, isolated terminate={forcedTerminate} (only this test child was touched)");
            if (forcedTerminate)
            {
                info("forced-terminate", "the test child was terminated as a harness last resort after the pseudoconsole close and bounded wait; its console-mode restore is not guaranteed");
            }

            // ---- mode lifecycle, VT-off evidence and clean stop from stderr ----
            string stderr = stderrCapture.SnapshotText();
            check(
                "records-mode-lifecycle",
                stderr.Contains("console input mode lifecycle: original=0x", StringComparison.Ordinal)
                    && stderr.Contains("requested=0x", StringComparison.Ordinal),
                OneLine(stderr));
            check(
                "records-mode-requested-vt-off",
                TryParseModeField(stderr, "requested=0x", out uint requestedMode)
                    && (requestedMode & Win32.ENABLE_VIRTUAL_TERMINAL_INPUT) == 0,
                OneLine(ExtractModeLines(stderr)));
            check(
                "records-mode-applied-vt-off",
                TryParseModeField(stderr, "appliedMode=0x", out uint appliedMode)
                    && (appliedMode & Win32.ENABLE_VIRTUAL_TERMINAL_INPUT) == 0,
                OneLine(ExtractModeLines(stderr)));
            check("records-mode-restored", RestoreLineVerified(stderr, out string restoreDetail), restoreDetail);
            check(
                "records-read-loop-stopped",
                stderr.Contains("stopped (stop command from control pipe)", StringComparison.Ordinal),
                OneLine(ExtractModeLines(stderr)));

            // ---- final stdout: every line complete JSON, no diagnostics ----
            byte[] allBytes = Encoding.UTF8.GetBytes(allProtocol.ToString());
            bool stdoutJsonClean = TryParseRecordLines(allBytes, out List<JsonElement> finalRecords, out string? stdoutError);
            check(
                "records-stdout-clean",
                stdoutJsonClean && !StdoutContainsDiagnostics(allBytes),
                stdoutJsonClean
                    ? (StdoutContainsDiagnostics(allBytes) ? "stdout contained stderr-style diagnostics" : null)
                    : stdoutError);

            info("records-stdout-types", DescribeRecordTypes(finalRecords));
            info("records-stdout-bytes", DescribeBytes(allBytes));
            info("records-mode-lines", OneLine(ExtractModeLines(stderr)));
            info("child-exit-code", exitCodeReadable ? exitCode.ToString(CultureInfo.InvariantCulture) : "unreadable");
            info("conpty-output-bytes", conptyOutput.Count.ToString(CultureInfo.InvariantCulture));
            info("note-scope", "synthetic ConPTY-fed input only: this proves the record ReadConsoleInputW path, not physical keyboard or mouse parity, and SGR delivery from a real device is not proven");

            return true;
        }
        finally
        {
            // 1. The test child must not outlive the harness. Only this child
            //    is ever touched; the caller's console is never involved.
            if (processCreated && !childExited)
            {
                ClosePseudoConsoleBounded(ref pseudoConsole, PseudoConsoleCloseWaitMilliseconds);
                if (Win32.WaitForSingleObject(process.Process, PseudoConsoleCloseWaitMilliseconds) != Win32.WAIT_OBJECT_0)
                {
                    Win32.TerminateProcess(process.Process, TerminateExitCode);
                    Win32.WaitForSingleObject(process.Process, TerminateWaitMilliseconds);
                }
            }

            // 2. Close the pseudoconsole if it is still open (on the normal
            //    path the child already exited, so this returns promptly).
            ClosePseudoConsoleBounded(ref pseudoConsole, PseudoConsoleCloseWaitMilliseconds);

            // 3. Release the write ends and let every drain end, bounded.
            CloseHandleIfSet(ref parentStdinWrite);
            CloseHandleIfSet(ref hostWrite);
            foreach (PipeDrain drain in drains)
            {
                drain.Join(DrainJoinMilliseconds);
            }

            CloseHandleIfSet(ref hostRead);
            CloseHandleIfSet(ref parentStdoutRead);
            CloseHandleIfSet(ref parentStderrRead);

            // 4. Ends that can still be open after an early failure return.
            CloseHandleIfSet(ref childStdinRead);
            CloseHandleIfSet(ref childStdoutWrite);
            CloseHandleIfSet(ref childStderrWrite);
            CloseHandleIfSet(ref ptyInputRead);
            CloseHandleIfSet(ref ptyOutputWrite);

            // 5. Attribute list and handle-list memory.
            if (attributeListInitialized && attributeList != IntPtr.Zero)
            {
                Win32ConPty.DeleteProcThreadAttributeList(attributeList);
            }

            if (attributeList != IntPtr.Zero)
            {
                Marshal.FreeHGlobal(attributeList);
                attributeList = IntPtr.Zero;
            }

            if (handleList != IntPtr.Zero)
            {
                Marshal.FreeHGlobal(handleList);
                handleList = IntPtr.Zero;
            }

            // 6. Process/thread handles last.
            if (processCreated)
            {
                Win32.CloseHandle(process.Thread);
                Win32.CloseHandle(process.Process);
            }
        }
    }

    /// <summary>
    /// Writes one record-mode fixture and checks the protocol records it
    /// produced. Only fixed synthetic literals are involved; no user input.
    /// </summary>
    private static bool RunRecordFixture(
        IntPtr hostWrite,
        ByteCapture stdoutCapture,
        string name,
        byte[] bytes,
        IntPtr process,
        Action<string, bool, string?> check,
        Action<string, string> info,
        StringBuilder allProtocol,
        out bool aliasFree)
    {
        aliasFree = true;
        stdoutCapture.Reset();
        if (!WriteAllBytes(hostWrite, bytes, out string? writeError))
        {
            check($"records-fixture-{name}", false, writeError);
            return false;
        }

        byte[] observed = CaptureStable(stdoutCapture, FixtureStableMilliseconds, FixtureTimeoutMilliseconds);
        allProtocol.Append(Encoding.UTF8.GetString(observed));
        if (!TryParseRecordLines(observed, out List<JsonElement> records, out string? parseError))
        {
            check($"records-fixture-{name}", false, $"stdout was not clean newline JSON: {parseError}");
            return false;
        }

        if (name == "ctrl-c")
        {
            bool alive = Win32.WaitForSingleObject(process, 0) == Win32.WAIT_TIMEOUT;
            check(
                "records-ctrl-c-no-forced-signal",
                alive,
                alive ? null : "the child exited after byte 0x03; ConPTY turned Ctrl+C into a signal instead of a key record");
        }

        return CheckRecordFixture(name, records, check, info, out aliasFree);
    }

    /// <summary>
    /// Semantic expectations for one fixture. Key-up, initial-resize and other
    /// non-action records are ignored by filtering on <c>down</c>/<c>type</c>;
    /// scan codes are never asserted. <paramref name="aliasFree"/> reports
    /// whether the observed key characters matched the native character rather
    /// than the historical scan-code alias (H/P/9).
    /// </summary>
    private static bool CheckRecordFixture(
        string name,
        List<JsonElement> records,
        Action<string, bool, string?> check,
        Action<string, string> info,
        out bool aliasFree)
    {
        aliasFree = true;
        List<JsonElement> downs = records
            .Where(record => RecordType(record) == "key" && RecordBool(record, "down"))
            .ToList();
        List<JsonElement> mice = records.Where(record => RecordType(record) == "mouse").ToList();
        string keyDetail = DescribeKeyRecords(downs);
        string mouseDetail = DescribeMouseRecords(mice);

        switch (name)
        {
            case "ascii-4z":
                {
                    bool ok = downs.Count == 2
                        && KeyChar(downs[0]) == "4"
                        && KeyChar(downs[1]) == "z"
                        && RecordNumber(downs[0], "repeat") >= 1
                        && RecordNumber(downs[1], "repeat") >= 1;
                    aliasFree = ok;
                    check("records-ascii-4z", ok, $"expected key-down chars '4' then 'z' with repeat>=1; observed {keyDetail}");
                    return ok;
                }

            case "arrow-up":
                {
                    bool ok = downs.Count == 1
                        && RecordNumber(downs[0], "virtualKey") == 38
                        && KeyChar(downs[0]) == string.Empty
                        && RecordNumber(downs[0], "repeat") >= 1;
                    aliasFree = ok;
                    check("records-arrow-up", ok, $"expected one VK 38 key-down with empty char (never the 'H' scan-code alias); observed {keyDetail}");
                    return ok;
                }

            case "arrow-right":
                {
                    bool ok = downs.Count == 1
                        && RecordNumber(downs[0], "virtualKey") == 39
                        && KeyChar(downs[0]) == string.Empty
                        && RecordNumber(downs[0], "repeat") >= 1;
                    aliasFree = ok;
                    check("records-arrow-right", ok, $"expected one VK 39 key-down with empty char (never the 'P' scan-code alias); observed {keyDetail}");
                    return ok;
                }

            case "space":
                {
                    bool ok = downs.Count == 1 && KeyChar(downs[0]) == " ";
                    aliasFree = ok;
                    check("records-space-u20-not-9", ok, $"expected one key-down with char U+0020 (never the scan-code alias '9'); observed {keyDetail}");
                    return ok;
                }

            case "ctrl-c":
                {
                    if (downs.Count == 0)
                    {
                        info("records-ctrl-c", "host delivered no key record for byte 0x03; the child stayed alive and no forced signal was observed");
                        return true;
                    }

                    bool ok = downs.Any(record => KeyChar(record) == "\u0003")
                        && downs.All(record => KeyChar(record) is "" or "\u0003");
                    aliasFree = ok;
                    check("records-ctrl-c", ok, $"expected char U+0003 key-down (not a forced signal, not an alias); observed {keyDetail}");
                    return ok;
                }

            case "shift-arrow-up":
                {
                    if (downs.Count == 0)
                    {
                        info("records-shift-arrow-up", "optional fixture: the host delivered no key record for ESC[1;2A");
                        return true;
                    }

                    // The host may deliver a separate VK_SHIFT record next to
                    // the arrow; the contract is the arrow itself: VK 38 with
                    // SHIFT_PRESSED and an empty char. Modifier-only records are
                    // ignored.
                    bool ok = downs.Any(record =>
                        RecordNumber(record, "virtualKey") == 38
                        && KeyChar(record) == string.Empty
                        && (RecordNumber(record, "control") & 0x0010) != 0);
                    aliasFree = ok;
                    check("records-shift-arrow-up", ok, $"expected a VK 38 key-down with SHIFT_PRESSED and empty char (modifier records ignored); observed {keyDetail}");
                    return ok;
                }

            case "sgr-press":
                {
                    bool ok = mice.Any(record =>
                        MouseX(record) == 3 && MouseY(record) == 1
                        && RecordNumber(record, "buttons") == 1 && RecordNumber(record, "flags") == 0);
                    check("records-sgr-press", ok, $"expected mouse x=3 y=1 buttons=1 flags=0; observed {mouseDetail}");
                    return ok;
                }

            case "sgr-release":
                {
                    bool ok = mice.Any(record =>
                        MouseX(record) == 3 && MouseY(record) == 1
                        && RecordNumber(record, "buttons") == 0 && RecordNumber(record, "flags") == 0);
                    check("records-sgr-release", ok, $"expected mouse x=3 y=1 buttons=0 flags=0; observed {mouseDetail}");
                    return ok;
                }

            case "sgr-wheel":
                {
                    bool ok = mice.Any(record =>
                        MouseX(record) == 3 && MouseY(record) == 1
                        && RecordNumber(record, "flags") == 4 && WheelDelta(record) != 0);
                    check("records-sgr-wheel", ok, $"expected mouse x=3 y=1 flags=4 with a nonzero wheel delta; observed {mouseDetail}");
                    bool direction = mice.Any(record => RecordNumber(record, "flags") == 4 && WheelDelta(record) < 0);
                    check("records-sgr-wheel-direction", direction, $"expected SGR 65 (wheel down) to map to a negative wheel delta; observed {mouseDetail}");
                    return ok;
                }

            default:
                check($"records-fixture-{name}", false, "unknown fixture");
                return false;
        }
    }

    /// <summary>
    /// Parses captured stdout as protocol lines: every non-empty line must be
    /// one complete JSON object terminated by LF; a trailing partial line is an
    /// error. Records are cloned so they outlive the document.
    /// </summary>
    private static bool TryParseRecordLines(byte[] bytes, out List<JsonElement> records, out string? error)
    {
        records = new List<JsonElement>();
        error = null;
        string text = Encoding.UTF8.GetString(bytes);
        int index = 0;
        while (index < text.Length)
        {
            int newline = text.IndexOf('\n', index);
            if (newline < 0)
            {
                string partial = text[index..].TrimEnd('\r');
                if (partial.Length > 0)
                {
                    error = $"incomplete JSON line without a newline: {Truncate(partial)}";
                    return false;
                }

                break;
            }

            string line = text[index..newline].TrimEnd('\r');
            index = newline + 1;
            if (line.Length == 0)
            {
                continue;
            }

            try
            {
                using JsonDocument document = JsonDocument.Parse(line);
                records.Add(document.RootElement.Clone());
            }
            catch (JsonException ex)
            {
                error = $"invalid JSON line '{Truncate(line)}': {ex.Message}";
                return false;
            }
        }

        return true;
    }

    private static string RecordType(JsonElement record) =>
        record.TryGetProperty("type", out JsonElement type) && type.ValueKind == JsonValueKind.String
            ? type.GetString() ?? string.Empty
            : string.Empty;

    private static bool RecordBool(JsonElement record, string property) =>
        record.TryGetProperty(property, out JsonElement value) && value.ValueKind == JsonValueKind.True;

    private static long RecordNumber(JsonElement record, string property) =>
        record.TryGetProperty(property, out JsonElement value)
            && value.ValueKind == JsonValueKind.Number
            && value.TryGetInt64(out long number)
            ? number
            : long.MinValue;

    private static string KeyChar(JsonElement key) =>
        key.TryGetProperty("char", out JsonElement value) && value.ValueKind == JsonValueKind.String
            ? value.GetString() ?? string.Empty
            : "<missing>";

    private static long MouseX(JsonElement mouse) => RecordNumber(mouse, "x");

    private static long MouseY(JsonElement mouse) => RecordNumber(mouse, "y");

    /// <summary>Signed high word of the raw mouse button state (wheel delta).</summary>
    private static int WheelDelta(JsonElement mouse)
    {
        long buttons = RecordNumber(mouse, "buttons");
        if (buttons < 0)
        {
            return 0;
        }

        int high = (int)((buttons >> 16) & 0xFFFF);
        return high >= 0x8000 ? high - 0x10000 : high;
    }

    private static string DescribeKeyRecords(List<JsonElement> downs)
    {
        if (downs.Count == 0)
        {
            return "no key-down records";
        }

        var parts = new List<string>();
        foreach (JsonElement record in downs.Take(6))
        {
            parts.Add(
                $"vk={RecordNumber(record, "virtualKey")}"
                + $" char={CodePointLabel(KeyChar(record))}"
                + $" scan={RecordNumber(record, "virtualScanCode")}"
                + $" repeat={RecordNumber(record, "repeat")}"
                + $" control=0x{RecordNumber(record, "control"):X8}");
        }

        if (downs.Count > 6)
        {
            parts.Add($"...(+{downs.Count - 6} more)");
        }

        return string.Join(" ", parts);
    }

    private static string CodePointLabel(string value) =>
        value.Length == 0 ? "U+0000"
        : value == "<missing>" ? "missing"
        : $"U+{(int)value[0]:X4}";

    private static string DescribeMouseRecords(List<JsonElement> mice)
    {
        if (mice.Count == 0)
        {
            return "no mouse records";
        }

        var parts = new List<string>();
        foreach (JsonElement record in mice.Take(6))
        {
            parts.Add(
                $"x={RecordNumber(record, "x")} y={RecordNumber(record, "y")}"
                + $" buttons=0x{RecordNumber(record, "buttons"):X8}"
                + $" flags={RecordNumber(record, "flags")}"
                + $" control=0x{RecordNumber(record, "control"):X8}"
                + $" origin={RecordNumber(record, "windowLeft")}/{RecordNumber(record, "windowTop")}");
        }

        if (mice.Count > 6)
        {
            parts.Add($"...(+{mice.Count - 6} more)");
        }

        return string.Join(" ", parts);
    }

    private static string DescribeRecordTypes(List<JsonElement> records)
    {
        if (records.Count == 0)
        {
            return "no records";
        }

        string types = string.Join(",", records.Take(16).Select(RecordType));
        return records.Count > 16 ? $"{types},...(+{records.Count - 16})" : types;
    }

    private static bool StdoutContainsDiagnostics(byte[] bytes) =>
        bytes.AsSpan().IndexOf(Encoding.ASCII.GetBytes(ChildLogPrefix)) >= 0;

    private static bool TryParseModeField(string stderr, string marker, out uint value)
    {
        value = 0;
        int start = stderr.IndexOf(marker, StringComparison.Ordinal);
        if (start < 0)
        {
            return false;
        }

        start += marker.Length;
        return start + 8 <= stderr.Length && TryParseHex(stderr.AsSpan(start, 8), out value);
    }

    private static string Truncate(string value) => value.Length <= 160 ? value : value[..160] + "...";

    /// <summary>
    /// Bounded wait until the capture stops growing for the settle window, then
    /// returns and clears it. A starved fixture returns its (possibly empty)
    /// bytes after the full timeout; nothing waits indefinitely.
    /// </summary>
    private static byte[] CaptureStable(ByteCapture capture, int settleMilliseconds, int timeoutMilliseconds)
    {
        var stopwatch = Stopwatch.StartNew();
        int lastCount = capture.Count;
        int stableFor = 0;

        while (stopwatch.ElapsedMilliseconds < timeoutMilliseconds)
        {
            Thread.Sleep(25);
            int count = capture.Count;
            if (count > 0 && count == lastCount)
            {
                stableFor += 25;
                if (stableFor >= settleMilliseconds)
                {
                    break;
                }
            }
            else
            {
                stableFor = 0;
                lastCount = count;
            }
        }

        return capture.SnapshotAndReset();
    }

    private static bool WaitForText(ByteCapture capture, string needle, int timeoutMilliseconds, IntPtr process)
    {
        var stopwatch = Stopwatch.StartNew();
        while (stopwatch.ElapsedMilliseconds < timeoutMilliseconds)
        {
            if (capture.SnapshotText().Contains(needle, StringComparison.Ordinal))
            {
                return true;
            }

            if (Win32.WaitForSingleObject(process, 0) == Win32.WAIT_OBJECT_0)
            {
                break;
            }

            Thread.Sleep(25);
        }

        return capture.SnapshotText().Contains(needle, StringComparison.Ordinal);
    }

    private static bool WaitForProcess(IntPtr process, int timeoutMilliseconds)
    {
        return Win32.WaitForSingleObject(process, (uint)timeoutMilliseconds) == Win32.WAIT_OBJECT_0;
    }

    private static bool TryGetExitCode(IntPtr process, out int exitCode)
    {
        if (Win32.GetExitCodeProcess(process, out uint code))
        {
            exitCode = unchecked((int)code);
            return true;
        }

        exitCode = int.MinValue;
        return false;
    }

    /// <summary>
    /// Closes the pseudoconsole on a background thread with a bounded join, so
    /// a blocking close can never deadlock the reporting thread. The handle is
    /// consumed either way.
    /// </summary>
    private static void ClosePseudoConsoleBounded(ref IntPtr pseudoConsole, int timeoutMilliseconds)
    {
        IntPtr handle = pseudoConsole;
        if (handle == IntPtr.Zero)
        {
            return;
        }

        pseudoConsole = IntPtr.Zero;
        var thread = new Thread(() =>
        {
            try
            {
                Win32ConPty.ClosePseudoConsole(handle);
            }
            catch (Exception)
            {
                // Best effort during teardown.
            }
        })
        {
            IsBackground = true,
            Name = "runeframe-conpty-close",
        };
        thread.Start();
        thread.Join(timeoutMilliseconds);
    }

    private static void CloseHandleIfSet(ref IntPtr handle)
    {
        if (handle == IntPtr.Zero)
        {
            return;
        }

        Win32.CloseHandle(handle);
        handle = IntPtr.Zero;
    }

    private static bool WriteAllBytes(IntPtr handle, byte[] bytes, out string? error)
    {
        if (handle == IntPtr.Zero)
        {
            error = "the write handle is closed";
            return false;
        }

        if (!Win32TestPipe.WriteBytesToHandle(handle, bytes, bytes.Length, out int win32Error))
        {
            error = $"WriteFile failed (win32 error {win32Error})";
            return false;
        }

        error = null;
        return true;
    }

    private static string? BuildRecordCommandLine(string executable, out string? error) =>
        BuildCommandLineCore(executable, Array.Empty<string>(), out error);

    private static string? BuildCommandLineCore(string executable, IReadOnlyList<string> modeArguments, out string? error)
    {
        error = null;
        var effective = new List<string>(modeArguments);

        // When launched as `dotnet Runeframe.Win32Input.dll ...`, ProcessPath is
        // the dotnet host and the entry assembly must travel as the first
        // argument; an apphost exe needs no such repair.
        string? entryAssembly = Assembly.GetEntryAssembly()?.Location;
        if (string.Equals(Path.GetFileNameWithoutExtension(executable), "dotnet", StringComparison.OrdinalIgnoreCase))
        {
            if (string.IsNullOrEmpty(entryAssembly))
            {
                error = "cannot resolve the entry assembly to launch through the dotnet host";
                return null;
            }

            effective.Insert(0, entryAssembly);
        }

        return effective.Count == 0
            ? Quote(executable)
            : Quote(executable) + " " + string.Join(' ', effective.Select(Quote));
    }

    private static bool RestoreLineVerified(string stderr, out string detail)
    {
        const string marker = "restored console input mode to original 0x";
        int start = stderr.IndexOf(marker, StringComparison.Ordinal);
        if (start < 0)
        {
            detail = "no restore line on stderr";
            return false;
        }

        start += marker.Length;
        if (start + 8 > stderr.Length || !TryParseHex(stderr.AsSpan(start, 8), out uint original))
        {
            detail = "restore line unreadable";
            return false;
        }

        const string readbackMarker = "(readback 0x";
        int readbackStart = stderr.IndexOf(readbackMarker, start, StringComparison.Ordinal);
        if (readbackStart < 0)
        {
            detail = "restore line has no read-back";
            return false;
        }

        readbackStart += readbackMarker.Length;
        if (readbackStart + 8 > stderr.Length || !TryParseHex(stderr.AsSpan(readbackStart, 8), out uint readBack))
        {
            detail = "read-back unreadable";
            return false;
        }

        if (original != readBack)
        {
            detail = $"original 0x{original:X8} != read-back 0x{readBack:X8}";
            return false;
        }

        detail = $"0x{original:X8}";
        return true;
    }

    private static bool TryParseHex(ReadOnlySpan<char> text, out uint value) =>
        uint.TryParse(text, NumberStyles.HexNumber, CultureInfo.InvariantCulture, out value);

    private static string ExtractModeLines(string stderr)
    {
        var wanted = new List<string>();
        foreach (string raw in stderr.Split('\n'))
        {
            string line = raw.TrimEnd('\r');
            if (line.Contains("console input mode", StringComparison.Ordinal)
                || line.Contains("stop requested", StringComparison.Ordinal))
            {
                wanted.Add(line);
            }
        }

        return string.Join(" | ", wanted);
    }

    private static string Hex(byte[] bytes) => bytes.Length == 0 ? "<empty>" : Convert.ToHexString(bytes).ToLowerInvariant();

    private static string DescribeBytes(byte[] bytes) => $"{bytes.Length} byte(s) {Hex(bytes)}";

    private static string OneLine(string text)
    {
        string one = text.Replace('\r', ' ').Replace('\n', ' ').Trim();
        return one.Length <= 400 ? one : one[..400] + "...";
    }

    private static string Quote(string value) => "\"" + value + "\"";

    private static void WriteAllLinesBestEffort(string path, List<string> lines)
    {
        try
        {
            string? directory = Path.GetDirectoryName(path);
            if (!string.IsNullOrEmpty(directory))
            {
                Directory.CreateDirectory(directory);
            }

            File.WriteAllLines(path, lines);
        }
        catch (Exception)
        {
            // The report is printed to stdout regardless.
        }
    }

    /// <summary>Bounded byte capture shared by the drain threads.</summary>
    private sealed class ByteCapture
    {
        private readonly object _gate = new();
        private readonly List<byte> _bytes = new();

        public int Count
        {
            get
            {
                lock (_gate)
                {
                    return _bytes.Count;
                }
            }
        }

        public void Add(byte[] buffer, int count)
        {
            lock (_gate)
            {
                int room = MaxCapturedBytes - _bytes.Count;
                if (room <= 0)
                {
                    return;
                }

                int take = Math.Min(count, room);
                for (int i = 0; i < take; i++)
                {
                    _bytes.Add(buffer[i]);
                }
            }
        }

        public void Reset()
        {
            lock (_gate)
            {
                _bytes.Clear();
            }
        }

        public byte[] Snapshot()
        {
            lock (_gate)
            {
                return _bytes.ToArray();
            }
        }

        public byte[] SnapshotAndReset()
        {
            lock (_gate)
            {
                byte[] result = _bytes.ToArray();
                _bytes.Clear();
                return result;
            }
        }

        public string SnapshotText()
        {
            lock (_gate)
            {
                return Encoding.UTF8.GetString(_bytes.ToArray());
            }
        }
    }

    /// <summary>
    /// One pipe drain thread. It reads until EOF or a pipe error and appends
    /// into a bounded capture, so a full pseudoconsole output pipe can never
    /// block the ConPTY. Joins are always bounded by the caller.
    /// </summary>
    private sealed class PipeDrain
    {
        private readonly IntPtr _handle;
        private readonly ByteCapture _capture;
        private readonly string _name;
        private Thread? _thread;

        public PipeDrain(IntPtr handle, ByteCapture capture, string name)
        {
            _handle = handle;
            _capture = capture;
            _name = name;
        }

        public void Start()
        {
            _thread = new Thread(Loop)
            {
                IsBackground = true,
                Name = $"runeframe-conpty-drain-{_name}",
            };
            _thread.Start();
        }

        public void Join(int timeoutMilliseconds)
        {
            _thread?.Join(timeoutMilliseconds);
        }

        private void Loop()
        {
            var buffer = new byte[DrainBufferSize];
            try
            {
                while (true)
                {
                    if (!Win32TestPipe.ReadFile(_handle, ref buffer[0], (uint)buffer.Length, out uint read, IntPtr.Zero)
                        || read == 0)
                    {
                        break;
                    }

                    _capture.Add(buffer, (int)read);
                }
            }
            catch (Exception)
            {
                // A closed pipe ends the drain; nothing to report.
            }
        }
    }
}
