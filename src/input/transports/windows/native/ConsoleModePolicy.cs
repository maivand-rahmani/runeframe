namespace Runeframe.Win32Input;

/// <summary>
/// The exact console input mode transition the record session performs while it
/// owns CONIN$. Shared by the production host and the test-only record harness
/// under <c>tests/native/win32-input</c>, so the harness verifies the real
/// policy instead of a copy of it.
/// </summary>
internal static class ConsoleModePolicy
{
    public static uint OwnedInputMode(uint currentMode)
    {
        // Enable mouse + window records and extended flags; disable quick-edit
        // (so clicks do not enter mark mode), processed input (so Ctrl+C
        // becomes a key record), line/echo (raw records) and VT input (so keys
        // stay discrete virtual-key records instead of being collapsed into
        // escape sequences).
        return (currentMode
                | Win32.ENABLE_MOUSE_INPUT
                | Win32.ENABLE_WINDOW_INPUT
                | Win32.ENABLE_EXTENDED_FLAGS)
            & ~(Win32.ENABLE_QUICK_EDIT_MODE
                | Win32.ENABLE_PROCESSED_INPUT
                | Win32.ENABLE_LINE_INPUT
                | Win32.ENABLE_ECHO_INPUT
                | Win32.ENABLE_VIRTUAL_TERMINAL_INPUT);
    }
}
