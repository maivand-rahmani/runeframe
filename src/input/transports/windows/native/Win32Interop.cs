using System.Runtime.InteropServices;

namespace Runeframe.Win32Input;

/// <summary>
/// Shared kernel32 interop for the record input path: console handles, input
/// mode, INPUT_RECORD reads and screen-buffer info. All results are checked by
/// the caller; nothing here throws.
///
/// This is the production surface. Harness-only declarations (process
/// creation, console injection, window control) live in a separate partial
/// part in the test-only harness under <c>tests/native/win32-input</c>, so the
/// production build carries no harness-only interop.
/// </summary>
internal static partial class Win32
{
    // CreateFileW access/share/creation.
    public const uint GENERIC_READ = 0x80000000;
    public const uint GENERIC_WRITE = 0x40000000;
    public const uint FILE_SHARE_READ = 0x00000001;
    public const uint FILE_SHARE_WRITE = 0x00000002;
    public const uint OPEN_EXISTING = 3;

    // GetFileType.
    public const uint FILE_TYPE_CHAR = 0x0002;

    // GetStdHandle.
    public const int STD_INPUT_HANDLE = -10;

    // Console input modes (wincon.h).
    public const uint ENABLE_PROCESSED_INPUT = 0x0001;
    public const uint ENABLE_LINE_INPUT = 0x0002;
    public const uint ENABLE_ECHO_INPUT = 0x0004;
    public const uint ENABLE_WINDOW_INPUT = 0x0008;
    public const uint ENABLE_MOUSE_INPUT = 0x0010;
    public const uint ENABLE_QUICK_EDIT_MODE = 0x0040;
    public const uint ENABLE_EXTENDED_FLAGS = 0x0080;
    public const uint ENABLE_VIRTUAL_TERMINAL_INPUT = 0x0200;

    // INPUT_RECORD.EventType values.
    public const ushort KEY_EVENT = 0x0001;
    public const ushort MOUSE_EVENT = 0x0002;
    public const ushort WINDOW_BUFFER_SIZE_EVENT = 0x0004;
    public const ushort MENU_EVENT = 0x0008;
    public const ushort FOCUS_EVENT = 0x0010;

    // WaitForSingleObject.
    public const uint WAIT_OBJECT_0 = 0x00000000;
    public const uint WAIT_TIMEOUT = 0x00000102;

    // Win32 error codes used by the record read loop.
    public const int ERROR_ACCESS_DENIED = 5;
    public const int ERROR_INVALID_HANDLE = 6;
    public const int ERROR_BROKEN_PIPE = 109;
    public const int ERROR_NO_DATA = 232;
    public const int ERROR_OPERATION_ABORTED = 995;

    public static readonly IntPtr InvalidHandleValue = new(-1);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern IntPtr CreateFileW(
        string lpFileName,
        uint dwDesiredAccess,
        uint dwShareMode,
        IntPtr lpSecurityAttributes,
        uint dwCreationDisposition,
        uint dwFlagsAndAttributes,
        IntPtr hTemplateFile);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr GetStdHandle(int nStdHandle);

    [DllImport("kernel32.dll", SetLastError = false)]
    public static extern uint GetFileType(IntPtr hFile);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool GetConsoleMode(IntPtr hConsoleHandle, out uint lpMode);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool SetConsoleMode(IntPtr hConsoleHandle, uint dwMode);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool ReadConsoleInputW(
        IntPtr hConsoleInput,
        [Out] INPUT_RECORD[] lpBuffer,
        uint nLength,
        out uint lpNumberOfEventsRead);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool GetNumberOfConsoleInputEvents(IntPtr hConsoleInput, out uint lpcNumberOfEvents);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool GetConsoleScreenBufferInfo(
        IntPtr hConsoleOutput,
        out CONSOLE_SCREEN_BUFFER_INFO lpConsoleScreenBufferInfo);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern uint WaitForSingleObject(IntPtr hHandle, uint dwMilliseconds);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool CloseHandle(IntPtr hObject);
}

[StructLayout(LayoutKind.Sequential)]
internal struct COORD
{
    public short X;
    public short Y;
}

/// <summary>
/// KEY_EVENT_RECORD (wincon.h), 16 bytes.
///
/// The native bKeyDown field is a 4-byte BOOL, stored here as
/// <see cref="DownValue"/> so the struct stays entirely blittable. This
/// matters because the struct is embedded in the explicit-layout
/// <see cref="INPUT_RECORD"/>: the marshaller copies an explicit-layout struct
/// using its managed layout instead of marshalling the nested fields
/// individually, so a managed <c>bool</c> (1 byte) shifted RepeatCount,
/// VirtualKeyCode, VirtualScanCode and UnicodeChar two bytes early and made
/// UnicodeChar read the native scan code (the historical H/P/Space-9
/// symptom). A 4-byte int keeps the managed layout byte-identical to the
/// native layout.
/// </summary>
[StructLayout(LayoutKind.Sequential)]
internal struct KEY_EVENT_RECORD
{
    /// <summary>Native 4-byte BOOL; any nonzero value means key-down.</summary>
    public int DownValue;

    /// <summary>
    /// Boolean view of <see cref="DownValue"/> for callers. A property is not
    /// a marshalled field, so it does not affect the layout.
    /// </summary>
    public bool Down
    {
        readonly get => DownValue != 0;
        set => DownValue = value ? 1 : 0;
    }

    public ushort RepeatCount;
    public ushort VirtualKeyCode;
    public ushort VirtualScanCode;

    // WCHAR: a single UTF-16 code unit. Astral characters arrive as two events
    // (one per surrogate), which is why the protocol field is a string.
    public ushort UnicodeChar;

    public uint ControlKeyState;
}

/// <summary>MOUSE_EVENT_RECORD (wincon.h), 16 bytes.</summary>
[StructLayout(LayoutKind.Sequential)]
internal struct MOUSE_EVENT_RECORD
{
    // Buffer coordinates; subtract windowLeft/windowTop for window-relative.
    public COORD MousePosition;
    public uint ButtonState;
    public uint ControlKeyState;
    public uint EventFlags;
}

/// <summary>WINDOW_BUFFER_SIZE_RECORD (wincon.h), 4 bytes.</summary>
[StructLayout(LayoutKind.Sequential)]
internal struct WINDOW_BUFFER_SIZE_RECORD
{
    public COORD Size;
}

/// <summary>
/// INPUT_RECORD (wincon.h), 20 bytes on x64: WORD EventType followed by a
/// 4-byte-aligned union at offset 4. Only the variants the protocol forwards
/// are laid out; FOCUS_EVENT/MENU_EVENT payloads are ignored.
/// </summary>
[StructLayout(LayoutKind.Explicit, Size = 20)]
internal struct INPUT_RECORD
{
    [FieldOffset(0)]
    public ushort EventType;

    [FieldOffset(4)]
    public KEY_EVENT_RECORD KeyEvent;

    [FieldOffset(4)]
    public MOUSE_EVENT_RECORD MouseEvent;

    [FieldOffset(4)]
    public WINDOW_BUFFER_SIZE_RECORD WindowBufferSizeEvent;
}

[StructLayout(LayoutKind.Sequential)]
internal struct SMALL_RECT
{
    public short Left;
    public short Top;
    public short Right;
    public short Bottom;
}

/// <summary>CONSOLE_SCREEN_BUFFER_INFO (wincon.h), 22 bytes.</summary>
[StructLayout(LayoutKind.Sequential)]
internal struct CONSOLE_SCREEN_BUFFER_INFO
{
    public COORD Size;
    public COORD CursorPosition;
    public ushort Attributes;
    public SMALL_RECT Window;
    public COORD MaximumWindowSize;
}
