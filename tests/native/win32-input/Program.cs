namespace Runeframe.Win32Input;

/// <summary>
/// Test-only harness entry point (tests/native/win32-input). The default record
/// mode delegates to the shared production session
/// (<see cref="RecordInputSession"/>), which is the same source compiled into
/// the production NativeAOT host project. The remaining modes are test-only
/// harnesses that live only in this project.
/// </summary>
internal static class Program
{
    private static int Main(string[] args)
    {
        // The isolated console harness is dispatched before the ordinary
        // argument loop: its child mode carries extra arguments of its own.
        if (args.Length > 0 && args[0] == "--self-test-console")
        {
            return SelfTestConsole.RunOrchestrator();
        }

        if (args.Length > 0 && args[0] == "--self-test-console-child")
        {
            return SelfTestConsole.RunChild(args);
        }

        // Headless ConPTY harness for the production record path: a private
        // pseudoconsole (no console window, no CREATE_NEW_CONSOLE) with the
        // host's literal VT bytes translated by ConPTY into console input
        // records read back through ReadConsoleInputW/RecordTranslator. The
        // caller's console is never read, written or re-moded.
        if (args.Length > 0 && args[0] == "--self-test-conpty-records")
        {
            return SelfTestConPty.RunRecordOrchestrator();
        }

        foreach (string arg in args)
        {
            if (arg == "--self-test")
            {
                return SelfTest.Run();
            }

            if (arg is "--help" or "-h")
            {
                WriteUsage();
                return ExitCodes.Success;
            }

            RecordInputSession.Log($"unknown argument '{arg}'");
            WriteUsage();
            return ExitCodes.Usage;
        }

        return RecordInputSession.Run();
    }

    private static void WriteUsage()
    {
        RecordInputSession.Log("usage: Runeframe.Win32Input [--self-test | --self-test-console | --self-test-conpty-records | --help]");
        RecordInputSession.Log("  --self-test          pure protocol/interop checks, no terminal required, plain text on stdout");
        RecordInputSession.Log("  --self-test-console  isolated CREATE_NEW_CONSOLE record/mode harness; never writes to the");
        RecordInputSession.Log("                       caller's console (see README.md; child mode is spawned internally)");
        RecordInputSession.Log("  --self-test-conpty-records  headless ConPTY harness for the record path: literal VT bytes in,");
        RecordInputSession.Log("                       semantic JSON key/mouse records out through ReadConsoleInputW; private");
        RecordInputSession.Log("                       pseudoconsole, no console window, the caller's console is never touched");
        RecordInputSession.Log("  (no args)            shared record session (same core as the production host): own CONIN$");
        RecordInputSession.Log("                       and write JSON protocol lines to stdout; stdin must be a control pipe");
        RecordInputSession.Log("                       where 'stop' or EOF restores the console mode and exits");
    }
}
