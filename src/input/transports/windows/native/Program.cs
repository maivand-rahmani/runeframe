namespace Runeframe.Win32Input;

/// <summary>
/// Production entry point for the Windows record-input host: it owns CONIN$ as
/// the single console-input reader and streams protocol JSON lines on stdout.
/// stdin must be a control pipe ('stop' / EOF). This host has no arguments and
/// no test/VT modes; it is normally launched by the Node transport wrapper with
/// <c>stdio: ['pipe', 'pipe', 'pipe']</c>.
/// </summary>
internal static class Program
{
    private static int Main(string[] args)
    {
        foreach (string arg in args)
        {
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
        RecordInputSession.Log("usage: Runeframe.WindowsInput (no arguments)");
        RecordInputSession.Log("  owns CONIN$ and writes JSON protocol lines to stdout; stdin must be a");
        RecordInputSession.Log("  control pipe where 'stop' or EOF restores the console mode and exits");
    }
}
