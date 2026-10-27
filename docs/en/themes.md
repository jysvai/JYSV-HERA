<!-- lang --><sub>[한국어](../ko/themes.md) · [All docs](README.md) · [README](../../README.md)</sub>

# Themes

<img src="../images/features/themes.jpg" alt="" width="120" align="right">

Open **Theme · colors** (테마 · 색상) from the sidebar. Changes apply immediately. The ☀/☾ button in the title bar switches between light and dark at any time.

## Mode (밝기)

**Dark**, **Light**, or **Follow system** (시스템 따라가기).

## Presets

Nine ready-made themes:

| Dark | Light |
|---|---|
| HERA Dark (HERA 다크) | HERA Light (HERA 라이트) |
| HERA Dim (HERA 딤, a lighter dark) | White (화이트) |
| Midnight (미드나잇) | Sepia (세피아, easy on the eyes) |
| Graphite (그라파이트) | Sky (스카이) |
| Aurora (오로라) | |

HERA keeps one choice for light mode and one for dark mode ("Light theme · …" and "Dark theme · …"). Picking a theme switches to its mode, unless the mode is set to follow the system; then it is used whenever that mode is active.

## Accent color (강조색)

Twelve swatches, a color picker ("Pick your own accent", 강조색 직접 고르기) and "Theme default" (테마 기본) to go back to the theme's own accent. An accent you choose here wins over the accent of a custom theme.

## Readability (읽기 편하게)

- **Sharper text** (글자 선명하게): high contrast for text and borders.
- Terminal font size, with − and + buttons (8 to 28), the same value as in Settings.

## Your own colors (내 색상 만들기)

Press **Create from the current theme** (지금 테마를 복제해서 만들기). It makes a copy named "<name> 사본" (copy) of the theme you are using, which you can then edit:

- A name (up to 40 characters). The badge shows whether it is a light or a dark theme.
- Each interface color, with a color picker and a hex field.
- The terminal's background, foreground, cursor, selection and the 16 ANSI colors.

Edits show live and are saved 350 ms after you stop. **Delete** removes the theme; if it was the one in use, HERA goes back to HERA Dark or HERA Light.

## Terminal colors from Windows Terminal

On Windows, Settings, Terminal can import the color scheme of your Windows Terminal default profile as a custom theme named "<scheme> (WT)". Schemes defined in your `settings.json` and Windows Terminal's built-in ones (Campbell, One Half, Solarized, Tango, Vintage and others) are understood. The scheme must define all 16 ANSI colors plus background and foreground as `#RRGGBB`. See [Terminal](terminal.md#import-from-windows-terminal).
