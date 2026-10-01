namespace Runeframe.Win32Input;

/// <summary>
/// Exit codes shared by the production host and the test-only harnesses.
/// Documented in the harness README (<c>tests/native/win32-input/README.md</c>).
/// </summary>
internal static class ExitCodes
{
    public const int Success = 0;
    public const int SelfTestFailed = 1;
    public const int Usage = 2;
    public const int NoConsole = 3;
    public const int NoControlPipe = 4;
    public const int Win32Failure = 5;

    /// <summary>
    /// An isolated console harness could not establish a private console (or
    /// CreateProcessW/wait failed). Nothing was injected anywhere.
    /// </summary>
    public const int ConsoleHarnessUnsafe = 6;
}
