using System.Globalization;
using System.Text;

namespace Runeframe.Win32Input;

/// <summary>
/// The stdout wire format: exactly one JSON object per line, LF terminated,
/// nothing else. Every line the helper writes to stdout goes through here.
///
///   ready  {type:"ready", originalMode:int, mode:int}
///   key    {type:"key", down:bool, repeat:int, char:string, virtualKey:int,
///           virtualScanCode:int, control:int}
///   mouse  {type:"mouse", x:int, y:int, buttons:int, flags:int, control:int,
///           windowLeft:int, windowTop:int}
///   resize {type:"resize", columns:int, rows:int}
///   error  {type:"error", message:string}
///
/// Numbers are unsigned Win32 values (mode/control/buttons/flags are DWORDs,
/// x/y/windowLeft/windowTop are SHORTs, repeat/virtualKey/virtualScanCode are
/// WORDs) and are always formatted with the invariant culture.
///
/// Serialization is deterministic and manual: no reflection-based JSON, so the
/// production host stays NativeAOT/trim friendly. Escaping is invariant:
/// printable ASCII stays raw, quote/backslash use the short escapes, control
/// characters and everything non-ASCII are written as \uXXXX with uppercase
/// hex. UTF-16 surrogate code units are therefore preserved exactly: a lone
/// surrogate becomes an explicit escape that JSON.parse reconstructs as the
/// same code unit, and an astral character remains two events whose escapes
/// concatenate.
/// </summary>
internal static class Protocol
{
    public static string Ready(uint originalMode, uint mode) =>
        "{\"type\":\"ready\",\"originalMode\":" + originalMode.ToString(CultureInfo.InvariantCulture)
        + ",\"mode\":" + mode.ToString(CultureInfo.InvariantCulture)
        + "}";

    public static string Key(
        bool down,
        ushort repeatCount,
        ushort unicodeChar,
        ushort virtualKeyCode,
        ushort virtualScanCode,
        uint controlKeyState) =>
        "{\"type\":\"key\",\"down\":" + (down ? "true" : "false")
        + ",\"repeat\":" + repeatCount.ToString(CultureInfo.InvariantCulture)
        + ",\"char\":" + EncodeChar(unicodeChar)
        + ",\"virtualKey\":" + virtualKeyCode.ToString(CultureInfo.InvariantCulture)
        + ",\"virtualScanCode\":" + virtualScanCode.ToString(CultureInfo.InvariantCulture)
        + ",\"control\":" + controlKeyState.ToString(CultureInfo.InvariantCulture)
        + "}";

    public static string Mouse(
        short x,
        short y,
        uint buttons,
        uint flags,
        uint controlKeyState,
        short windowLeft,
        short windowTop) =>
        "{\"type\":\"mouse\",\"x\":" + x.ToString(CultureInfo.InvariantCulture)
        + ",\"y\":" + y.ToString(CultureInfo.InvariantCulture)
        + ",\"buttons\":" + buttons.ToString(CultureInfo.InvariantCulture)
        + ",\"flags\":" + flags.ToString(CultureInfo.InvariantCulture)
        + ",\"control\":" + controlKeyState.ToString(CultureInfo.InvariantCulture)
        + ",\"windowLeft\":" + windowLeft.ToString(CultureInfo.InvariantCulture)
        + ",\"windowTop\":" + windowTop.ToString(CultureInfo.InvariantCulture)
        + "}";

    public static string Resize(short columns, short rows) =>
        "{\"type\":\"resize\",\"columns\":" + columns.ToString(CultureInfo.InvariantCulture)
        + ",\"rows\":" + rows.ToString(CultureInfo.InvariantCulture)
        + "}";

    public static string Error(string message) =>
        "{\"type\":\"error\",\"message\":" + EscapeString(message) + "}";

    /// <summary>
    /// JSON string for one UTF-16 code unit. Zero is the empty string (no
    /// character); surrogate code units are emitted as explicit \uXXXX escapes
    /// so JSON.parse reconstructs the exact code unit and can pair them.
    /// </summary>
    private static string EncodeChar(ushort unicodeChar) =>
        unicodeChar == 0 ? "\"\"" : EscapeString(((char)unicodeChar).ToString());

    private static string EscapeString(string value)
    {
        var builder = new StringBuilder(value.Length + 2);
        builder.Append('"');
        foreach (char codeUnit in value)
        {
            AppendEscaped(builder, codeUnit);
        }

        builder.Append('"');
        return builder.ToString();
    }

    private static void AppendEscaped(StringBuilder builder, char codeUnit)
    {
        switch (codeUnit)
        {
            case '"':
                builder.Append("\\\"");
                return;
            case '\\':
                builder.Append("\\\\");
                return;
            case '\b':
                builder.Append("\\b");
                return;
            case '\f':
                builder.Append("\\f");
                return;
            case '\n':
                builder.Append("\\n");
                return;
            case '\r':
                builder.Append("\\r");
                return;
            case '\t':
                builder.Append("\\t");
                return;
        }

        if (codeUnit < 0x20 || codeUnit >= 0x7F)
        {
            builder.Append("\\u");
            builder.Append(((int)codeUnit).ToString("X4", CultureInfo.InvariantCulture));
            return;
        }

        builder.Append(codeUnit);
    }
}
