# Third-party notices

JYSV HERA is licensed under the GNU Affero General Public License v3.0 only (see `LICENSE`).
It includes or is derived from the following third-party work, used under their own licenses.

## Hermes Agent (desktop shell)

HERA's window layout, design tokens and UI primitives are derived from the desktop app of
Hermes Agent by Nous Research — https://github.com/NousResearch/hermes-agent

```
MIT License

Copyright (c) 2025 Nous Research

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Bundled open-source packages

All of the following are distributed under the MIT License. Their copyright notices travel with
the packages (`node_modules/<package>/LICENSE`), and the packaged app keeps node-pty's license file.

| Package | Used for | License |
|---|---|---|
| [Electron](https://github.com/electron/electron) | application runtime (ships its own `LICENSE` and `LICENSES.chromium.html`) | MIT |
| [xterm.js](https://github.com/xtermjs/xterm.js) — `@xterm/xterm`, `@xterm/headless`, addons `fit`, `serialize`, `unicode11`, `web-links`, `webgl` | terminal emulation | MIT |
| [node-pty](https://github.com/microsoft/node-pty) (with winpty) | pseudo-terminals (ConPTY / winpty / Unix pty); on Windows it ships Microsoft's `conpty.dll` and `OpenConsole.exe`, the console host Windows Terminal uses | MIT |
| [Cascadia Mono](https://github.com/microsoft/cascadia-code) via [Fontsource](https://github.com/fontsource/font-files) — `@fontsource/cascadia-mono` | the terminal font (Windows Terminal's default) | SIL OFL 1.1 |
| [React](https://github.com/facebook/react), react-dom, scheduler | user interface | MIT |
| [nanostores](https://github.com/nanostores/nanostores), @nanostores/react | state | MIT |
| [Tabler Icons](https://github.com/tabler/tabler-icons) — `@tabler/icons-react` | icons | MIT |
| [Tailwind CSS](https://github.com/tailwindlabs/tailwindcss), [tailwind-merge](https://github.com/dcastil/tailwind-merge), [clsx](https://github.com/lukeed/clsx) | styling | MIT |

## lanes (optional integration)

HERA can work with [lanes](https://github.com/jysvai/lanes) (Apache-2.0), a separate Claude Code plugin.
HERA does not include lanes' code: it finds an installed copy, runs its launcher and reads the files it writes.
