using System.Globalization;
using System.Runtime.InteropServices;

namespace Runeframe.Win32Input;

/// <summary>
/// Independent, hand-built native byte fixtures for the Win32 console record
/// ABI, used by the pure <c>--self-test</c> mode. No console handle is opened;
/// these are pure memory buffers.
///
/// Why these exist: the earlier physical input diagnostic run read
/// <c>UnicodeChar</c> from the native scan-code offset (arrows produced H/P,
/// space produced 9) while the size/offset-only self-test still passed. A
/// symmetric Marshal round-trip and <c>Marshal.OffsetOf</c> cannot catch a
/// wrong-but-self-consistent layout, so the expected bytes below are literal
/// wincon.h layout values and both directions are asserted against them:
/// hand-built bytes -&gt; <c>PtrToStructure</c>, and a C# instance -&gt;
/// <c>StructureToPtr</c> -&gt; literal byte offsets.
///
/// Native layouts (wincon.h):
/// <code>
/// KEY_EVENT_RECORD (16 bytes)
///    0  BOOL  bKeyDown            (int32)
///    4  WORD  wRepeatCount
///    6  WORD  wVirtualKeyCode
///    8  WORD  wVirtualScanCode
///   10  WCHAR UnicodeChar
///   12  DWORD dwControlKeyState
///
/// INPUT_RECORD (20 bytes)
///    0  WORD  EventType
///    2  (2 bytes alignment padding)
///    4  union { KEY_EVENT_RECORD KeyEvent; ... }
/// </code>
/// </summary>
internal static class SelfTestAbiFixture
{
    public const int KeyEventRecordSize = 16;
    public const int InputRecordSize = 20;

    public const ushort VirtualKeyUp = 0x26;
    public const ushort ScanCodeUp = 0x48;
    public const ushort VirtualKeySpace = 0x20;
    public const ushort ScanCodeSpace = 0x39;
    public const uint EnhancedKey = 0x0100;

    /// <summary>16 literal native bytes: Up key-down, no character.</summary>
    public static byte[] ArrowKeyEventRecordBytes() =>
        new byte[KeyEventRecordSize]
        {
            0x01, 0x00, 0x00, 0x00, //  0 bKeyDown = TRUE (int32 1)
            0x01, 0x00,             //  4 wRepeatCount = 1
            0x26, 0x00,             //  6 wVirtualKeyCode = VK_UP
            0x48, 0x00,             //  8 wVirtualScanCode = Up scan
            0x00, 0x00,             // 10 UnicodeChar = 0 (empty)
            0x00, 0x01, 0x00, 0x00, // 12 dwControlKeyState = ENHANCED_KEY
        };

    /// <summary>20 literal native bytes: KEY_EVENT union + the Up record above.</summary>
    public static byte[] ArrowInputRecordBytes() =>
        new byte[InputRecordSize]
        {
            0x01, 0x00,             //  0 EventType = KEY_EVENT
            0x00, 0x00,             //  2 alignment padding
            0x01, 0x00, 0x00, 0x00, //  4 bKeyDown = TRUE
            0x01, 0x00,             //  8 wRepeatCount = 1
            0x26, 0x00,             // 10 wVirtualKeyCode = VK_UP
            0x48, 0x00,             // 12 wVirtualScanCode = Up scan
            0x00, 0x00,             // 14 UnicodeChar = 0
            0x00, 0x01, 0x00, 0x00, // 16 dwControlKeyState = ENHANCED_KEY
        };

    /// <summary>16 literal native bytes: Space key-down with the ' ' character.</summary>
    public static byte[] SpaceKeyEventRecordBytes() =>
        new byte[KeyEventRecordSize]
        {
            0x01, 0x00, 0x00, 0x00, //  0 bKeyDown = TRUE
            0x01, 0x00,             //  4 wRepeatCount = 1
            0x20, 0x00,             //  6 wVirtualKeyCode = VK_SPACE
            0x39, 0x00,             //  8 wVirtualScanCode = Space scan
            0x20, 0x00,             // 10 UnicodeChar = ' '
            0x00, 0x00, 0x00, 0x00, // 12 dwControlKeyState = 0
        };

    /// <summary>20 literal native bytes: KEY_EVENT union + the Space record above.</summary>
    public static byte[] SpaceInputRecordBytes() =>
        new byte[InputRecordSize]
        {
            0x01, 0x00,             //  0 EventType = KEY_EVENT
            0x00, 0x00,             //  2 alignment padding
            0x01, 0x00, 0x00, 0x00, //  4 bKeyDown = TRUE
            0x01, 0x00,             //  8 wRepeatCount = 1
            0x20, 0x00,             // 10 wVirtualKeyCode = VK_SPACE
            0x39, 0x00,             // 12 wVirtualScanCode = Space scan
            0x20, 0x00,             // 14 UnicodeChar = ' '
            0x00, 0x00, 0x00, 0x00, // 16 dwControlKeyState = 0
        };

    /// <summary>Marshal the literal 16-byte KEY_EVENT_RECORD fixture.</summary>
    public static KEY_EVENT_RECORD ReadKeyEventRecord(byte[] bytes) =>
        WithNativeBytes(bytes, ptr => Marshal.PtrToStructure<KEY_EVENT_RECORD>(ptr));

    /// <summary>Marshal the literal 20-byte INPUT_RECORD fixture.</summary>
    public static INPUT_RECORD ReadInputRecord(byte[] bytes) =>
        WithNativeBytes(bytes, ptr => Marshal.PtrToStructure<INPUT_RECORD>(ptr));

    /// <summary>Marshal a C# KEY_EVENT_RECORD back into native bytes.</summary>
    public static byte[] WriteKeyEventRecord(KEY_EVENT_RECORD record) =>
        ToNativeBytes(
            Marshal.SizeOf<KEY_EVENT_RECORD>(),
            ptr => Marshal.StructureToPtr(record, ptr, false));

    /// <summary>Marshal a C# INPUT_RECORD back into native bytes.</summary>
    public static byte[] WriteInputRecord(INPUT_RECORD record) =>
        ToNativeBytes(
            Marshal.SizeOf<INPUT_RECORD>(),
            ptr => Marshal.StructureToPtr(record, ptr, false));

    /// <summary>
    /// Diagnostic probe only (not a production shape): the same native layout
    /// as INPUT_RECORD but declared <see cref="LayoutKind.Sequential"/>. Used
    /// to tell whether the embedded-layout divergence is specific to
    /// <see cref="LayoutKind.Explicit"/> or affects nested struct fields
    /// generally.
    /// </summary>
    [StructLayout(LayoutKind.Sequential)]
    internal struct SequentialInputRecordProbe
    {
        public ushort EventType;
        public ushort Padding;
        public KEY_EVENT_RECORD KeyEvent;
    }

    /// <summary>Marshal the literal 20-byte fixture through the sequential probe.</summary>
    public static SequentialInputRecordProbe ReadSequentialProbe(byte[] bytes) =>
        WithNativeBytes(bytes, ptr => Marshal.PtrToStructure<SequentialInputRecordProbe>(ptr));

    /// <summary>Marshal the sequential probe back into native bytes.</summary>
    public static byte[] WriteSequentialProbe(SequentialInputRecordProbe record) =>
        ToNativeBytes(
            Marshal.SizeOf<SequentialInputRecordProbe>(),
            ptr => Marshal.StructureToPtr(record, ptr, false));

    /// <summary>
    /// True when <paramref name="bytes"/> contains exactly
    /// <paramref name="expected"/> at <paramref name="offset"/>.
    /// </summary>
    public static bool BytesAt(byte[] bytes, int offset, params byte[] expected)
    {
        if (offset < 0 || offset + expected.Length > bytes.Length)
        {
            return false;
        }

        for (int i = 0; i < expected.Length; i++)
        {
            if (bytes[offset + i] != expected[i])
            {
                return false;
            }
        }

        return true;
    }

    /// <summary>Space-separated hex for failure details; contains no key text.</summary>
    public static string Hex(byte[] bytes) =>
        string.Join(" ", bytes.Select(b => b.ToString("X2", CultureInfo.InvariantCulture)));

    private static T WithNativeBytes<T>(byte[] bytes, Func<IntPtr, T> read)
    {
        IntPtr ptr = Marshal.AllocHGlobal(bytes.Length);
        try
        {
            Marshal.Copy(bytes, 0, ptr, bytes.Length);
            return read(ptr);
        }
        finally
        {
            Marshal.FreeHGlobal(ptr);
        }
    }

    private static byte[] ToNativeBytes(int size, Action<IntPtr> write)
    {
        IntPtr ptr = Marshal.AllocHGlobal(size);
        try
        {
            // Zero first so padding bytes (INPUT_RECORD 2..3) are deterministic
            // regardless of whether StructureToPtr writes them.
            Marshal.Copy(new byte[size], 0, ptr, size);
            write(ptr);
            var bytes = new byte[size];
            Marshal.Copy(ptr, bytes, 0, size);
            return bytes;
        }
        finally
        {
            Marshal.FreeHGlobal(ptr);
        }
    }
}
