using System.Runtime.InteropServices;
using System.Text;

namespace Runeframe.Win32Input;

/// <summary>
/// Shared record-mode session: owns CONIN$ as the single console-input reader,
/// applies <see cref="ConsoleModePolicy"/>, reads INPUT_RECORDs through
/// <see cref="RecordTranslator"/> and streams <see cref="Protocol"/> JSON lines
/// to stdout. Used by the production host and by the test-only record harness
/// under <c>tests/native/win32-input</c>.
///
/// Contract:
///  - stdin is a CONTROL PIPE, never the console: a line "stop" (case
///    insensitive) or EOF requests shutdown. A console stdin is refused so two
///    readers can never race the same queue.
///  - The console input mode is saved with GetConsoleMode, the owned mode is
///    applied and read back, and the exact original mode is restored and
///    verified by read-back in the finally block; a mismatch is logged as a
///    visible failure.
///  - The read loop is a bounded 50 ms wait followed by a queue drain, so a
///    control-pipe stop is honored promptly and shutdown can never hang inside
///    ReadConsoleInputW. A raised ConsoleCancelKeyPress signal requests the
///    same stop path (e.Cancel = true) so the mode restore always runs; normal
///    Ctrl+C is delivered as a KEY_EVENT by the console and is not intercepted.
///  - stderr carries only lifecycle/safety diagnostics (mode save/apply/restore
///    with read-back, readiness, fatal errors, stop reason). No key content,
///    counters or per-key telemetry is ever written. stdout carries only the
///    protocol lines.
/// </summary>
internal static class RecordInputSession
{
    private const string LogPrefix = "[runeframe-win32-input]";
    private const int PollMilliseconds = 50;
    private const int ReadBatchSize = 64;

    private static readonly object StderrLock = new();

    private static volatile bool s_stopRequested;
    private static volatile string s_stopReason = "normal exit";
    private static TextWriter? s_protocol;
    private static bool s_protocolBroken;
    private static IntPtr s_consoleOutput = IntPtr.Zero;
    private static bool s_hasScreenBuffer;

    /// <summary>
    /// Runs the record session until the control pipe requests stop. Returns a
    /// process exit code; the exact original console input mode is restored in
    /// the finally block and verified by read-back.
    /// </summary>
    public static int Run()
    {
        s_stopRequested = false;
        s_stopReason = "normal exit";

        TryCreateProtocolWriter();

        if (!ValidateControlPipe())
        {
            return ExitCodes.NoControlPipe;
        }

        // CREATE: open the console input buffer itself. If this fails there is
        // no console attached (detached process, service, redirected everything).
        IntPtr consoleInput = Win32.CreateFileW(
            "CONIN$",
            Win32.GENERIC_READ | Win32.GENERIC_WRITE,
            Win32.FILE_SHARE_READ | Win32.FILE_SHARE_WRITE,
            IntPtr.Zero,
            Win32.OPEN_EXISTING,
            0,
            IntPtr.Zero);

        if (consoleInput == Win32.InvalidHandleValue)
        {
            int error = Marshal.GetLastWin32Error();
            Fatal($"CreateFileW(\"CONIN$\") failed (win32 error {error}); no console input buffer is attached to this process");
            return ExitCodes.NoConsole;
        }

        s_consoleOutput = Win32.CreateFileW(
            "CONOUT$",
            Win32.GENERIC_READ | Win32.GENERIC_WRITE,
            Win32.FILE_SHARE_READ | Win32.FILE_SHARE_WRITE,
            IntPtr.Zero,
            Win32.OPEN_EXISTING,
            0,
            IntPtr.Zero);
        s_hasScreenBuffer = s_consoleOutput != Win32.InvalidHandleValue;
        if (!s_hasScreenBuffer)
        {
            int error = Marshal.GetLastWin32Error();
            s_consoleOutput = IntPtr.Zero;
            Log($"CreateFileW(\"CONOUT$\") failed (win32 error {error}); window origin/size unavailable, windowLeft/windowTop will be reported as 0");
        }

        int exitCode = ExitCodes.Success;
        uint originalMode = 0;
        bool modeOwned = false;

        try
        {
            if (!Win32.GetConsoleMode(consoleInput, out originalMode))
            {
                int error = Marshal.GetLastWin32Error();
                Fatal($"GetConsoleMode(CONIN$) failed (win32 error {error}); original mode unknown, nothing was changed");
                return ExitCodes.Win32Failure;
            }

            // Enable mouse + window records and extended flags; disable
            // quick-edit (so clicks do not enter mark mode), processed input
            // (so Ctrl+C becomes a key record), line/echo (raw records) and
            // VT input (so keys stay discrete virtual-key records instead of
            // being collapsed into escape sequences). Shared with the test
            // harnesses via ConsoleModePolicy.
            uint requestedMode = ConsoleModePolicy.OwnedInputMode(originalMode);

            Log($"console input mode lifecycle: original=0x{originalMode:X8}, requested=0x{requestedMode:X8}");

            if (!Win32.SetConsoleMode(consoleInput, requestedMode))
            {
                int error = Marshal.GetLastWin32Error();
                Fatal($"SetConsoleMode(CONIN$, 0x{requestedMode:X8}) failed (win32 error {error})");
                return ExitCodes.Win32Failure;
            }

            modeOwned = true;

            uint appliedMode = requestedMode;
            if (Win32.GetConsoleMode(consoleInput, out uint readBack))
            {
                appliedMode = readBack;
                if (readBack != requestedMode)
                {
                    Log($"warning: applied console input mode 0x{readBack:X8} differs from requested 0x{requestedMode:X8}");
                }
            }
            else
            {
                Log($"warning: GetConsoleMode read-back failed (win32 error {Marshal.GetLastWin32Error()}); reporting requested mode 0x{requestedMode:X8}");
            }

            try
            {
                Console.CancelKeyPress += OnCancelKeyPress;
            }
            catch (Exception ex)
            {
                Log($"could not register cancel-key handler: {ex.Message}");
            }

            StartControlPipeReader();

            WriteProtocol(Protocol.Ready(originalMode, appliedMode));
            Log($"ready: originalMode=0x{originalMode:X8}, appliedMode=0x{appliedMode:X8}");

            var translator = new RecordTranslator(s_consoleOutput, s_hasScreenBuffer, WriteProtocol, Log);

            // One initial resize so the consuming app can lay out before the
            // first physical event; skipped when CONOUT$ is unavailable.
            if (translator.TryRefreshWindowSize(out short columns, out short rows))
            {
                WriteProtocol(Protocol.Resize(columns, rows));
            }
            else
            {
                Log("initial console window size unavailable; no initial resize event emitted");
            }

            exitCode = ReadLoop(consoleInput, translator);
        }
        finally
        {
            if (modeOwned)
            {
                RestoreMode(consoleInput, originalMode);
            }

            Win32.CloseHandle(consoleInput);

            if (s_hasScreenBuffer)
            {
                Win32.CloseHandle(s_consoleOutput);
                s_consoleOutput = IntPtr.Zero;
                s_hasScreenBuffer = false;
            }

            if (s_protocol is not null)
            {
                try
                {
                    s_protocol.Flush();
                }
                catch (Exception)
                {
                    // Best effort; the pipe may already be gone.
                }

                s_protocol.Dispose();
                s_protocol = null;
            }

            Log($"stopped ({s_stopReason}); exit code {exitCode}");
        }

        return exitCode;
    }

    /// <summary>
    /// Restores the exact original input mode and verifies it with a read-back:
    /// only a read-back proves the console really left the owned mode. Any
    /// mismatch is a visible failure, never silent.
    /// </summary>
    private static void RestoreMode(IntPtr consoleInput, uint originalMode)
    {
        if (Win32.SetConsoleMode(consoleInput, originalMode))
        {
            if (Win32.GetConsoleMode(consoleInput, out uint restoredMode))
            {
                if (restoredMode == originalMode)
                {
                    Log($"restored console input mode to original 0x{originalMode:X8} (readback 0x{restoredMode:X8})");
                }
                else
                {
                    Log($"FAILED to restore console input mode: original 0x{originalMode:X8}, readback 0x{restoredMode:X8}; the console may retain the helper's input mode");
                }
            }
            else
            {
                Log($"restored console input mode to original 0x{originalMode:X8}; read-back failed (win32 error {Marshal.GetLastWin32Error()})");
            }
        }
        else
        {
            Log($"FAILED to restore console input mode 0x{originalMode:X8} (win32 error {Marshal.GetLastWin32Error()}); the console may retain the helper's input mode");
        }
    }

    /// <summary>
    /// Bounded wait (50 ms) then drain every pending console record. Reads run
    /// on one thread only; the control-pipe thread never touches CONIN$; it
    /// just flips the stop flag, so shutdown can never hang inside
    /// ReadConsoleInputW. Translation is shared with the test harnesses through
    /// <see cref="RecordTranslator"/>.
    /// </summary>
    private static int ReadLoop(IntPtr consoleInput, RecordTranslator translator)
    {
        var records = new INPUT_RECORD[ReadBatchSize];

        while (!s_stopRequested)
        {
            uint waitResult = Win32.WaitForSingleObject(consoleInput, PollMilliseconds);
            if (waitResult == Win32.WAIT_TIMEOUT)
            {
                continue;
            }

            if (waitResult != Win32.WAIT_OBJECT_0)
            {
                int error = Marshal.GetLastWin32Error();
                Fatal($"WaitForSingleObject(CONIN$, {PollMilliseconds}ms) failed (waitResult=0x{waitResult:X8}, win32 error {error})");
                return ExitCodes.Win32Failure;
            }

            while (!s_stopRequested)
            {
                if (!Win32.GetNumberOfConsoleInputEvents(consoleInput, out uint pending))
                {
                    int error = Marshal.GetLastWin32Error();
                    Fatal($"GetNumberOfConsoleInputEvents(CONIN$) failed (win32 error {error})");
                    return ExitCodes.Win32Failure;
                }

                if (pending == 0)
                {
                    break;
                }

                uint wanted = Math.Min(pending, (uint)records.Length);
                if (!Win32.ReadConsoleInputW(consoleInput, records, wanted, out uint read))
                {
                    int error = Marshal.GetLastWin32Error();
                    if (error is Win32.ERROR_OPERATION_ABORTED or Win32.ERROR_INVALID_HANDLE
                        or Win32.ERROR_ACCESS_DENIED or Win32.ERROR_BROKEN_PIPE or Win32.ERROR_NO_DATA)
                    {
                        Log($"console input became unavailable (win32 error {error}); the console was probably closed");
                        s_stopRequested = true;
                        break;
                    }

                    Fatal($"ReadConsoleInputW failed (win32 error {error})");
                    return ExitCodes.Win32Failure;
                }

                if (read == 0)
                {
                    break;
                }

                for (uint i = 0; i < read; i++)
                {
                    translator.EmitRecord(records[i]);
                }

                if (read < wanted)
                {
                    // The queue was drained; go back to the bounded wait.
                    break;
                }
            }
        }

        return ExitCodes.Success;
    }

    private static void TryCreateProtocolWriter()
    {
        try
        {
            s_protocol = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(encoderShouldEmitUTF8Identifier: false))
            {
                AutoFlush = true,
                NewLine = "\n",
            };
        }
        catch (Exception ex)
        {
            s_protocolBroken = true;
            Log($"could not open stdout for protocol output: {ex.Message}");
        }
    }

    /// <summary>
    /// The helper never reads the console through stdin, so a console stdin
    /// would create a second reader racing the CONIN$ reader. Refuse to start.
    /// A missing/NUL stdin is allowed; it will surface as EOF.
    /// </summary>
    internal static bool ValidateControlPipe()
    {
        IntPtr stdin = Win32.GetStdHandle(Win32.STD_INPUT_HANDLE);
        if (stdin == IntPtr.Zero || stdin == Win32.InvalidHandleValue)
        {
            return true;
        }

        uint type = Win32.GetFileType(stdin);
        if (type == Win32.FILE_TYPE_CHAR && Win32.GetConsoleMode(stdin, out _))
        {
            Fatal("stdin is the console input buffer; the helper requires stdin to be a control pipe (spawn with stdio: ['pipe', 'pipe', 'pipe'])");
            return false;
        }

        return true;
    }

    private static void StartControlPipeReader()
    {
        var thread = new Thread(ControlPipeLoop)
        {
            IsBackground = true,
            Name = "runeframe-win32-input-control-pipe",
        };
        thread.Start();
    }

    private static void ControlPipeLoop()
    {
        try
        {
            using Stream stdin = Console.OpenStandardInput();
            var bytes = new byte[256];
            var line = new StringBuilder();

            while (true)
            {
                int read = stdin.Read(bytes, 0, bytes.Length);
                if (read <= 0)
                {
                    RequestStop("control pipe EOF");
                    return;
                }

                for (int i = 0; i < read; i++)
                {
                    char c = (char)bytes[i];
                    if (c == '\n')
                    {
                        if (IsStopCommand(line))
                        {
                            return;
                        }

                        line.Clear();
                    }
                    else if (c != '\r')
                    {
                        line.Append(c);
                    }
                }
            }
        }
        catch (Exception ex)
        {
            RequestStop($"control pipe read failed: {ex.Message}");
        }
    }

    private static bool IsStopCommand(StringBuilder line)
    {
        string command = line.ToString().Trim();
        if (!command.Equals("stop", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        RequestStop("stop command from control pipe");
        return true;
    }

    private static void RequestStop(string reason)
    {
        s_stopReason = reason;
        s_stopRequested = true;
    }

    private static void OnCancelKeyPress(object? sender, ConsoleCancelEventArgs e)
    {
        // Processed input is disabled while this session owns the console, so a
        // normal Ctrl+C arrives as a KEY_EVENT and flows to the consumer. This
        // handler fires only for an externally raised console signal (for
        // example Ctrl+Break): cancel the default termination and request the
        // normal stop path so the finally block restores the exact mode.
        e.Cancel = true;
        RequestStop($"console {e.SpecialKey} cancel signal");
        Log($"console {e.SpecialKey} cancel signal; requesting stop so the console mode is restored");
    }

    private static void WriteProtocol(string line)
    {
        TextWriter? writer = s_protocol;
        if (writer is null || s_protocolBroken)
        {
            return;
        }

        try
        {
            writer.WriteLine(line);
        }
        catch (Exception ex)
        {
            s_protocolBroken = true;
            Log($"stdout write failed: {ex.Message}");
            RequestStop("stdout write failed");
        }
    }

    private static void Fatal(string message)
    {
        Log(message);

        // Protocol error line for the parent; harmless no-op when stdout is
        // unavailable or already broken.
        WriteProtocol(Protocol.Error(message));
    }

    internal static void Log(string message)
    {
        lock (StderrLock)
        {
            try
            {
                Console.Error.WriteLine($"{LogPrefix} {message}");
            }
            catch (Exception)
            {
                // Diagnostics are best effort; never fail because of stderr.
            }
        }
    }
}
