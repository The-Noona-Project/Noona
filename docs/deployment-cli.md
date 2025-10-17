# Deployment CLI Navigation

The deployment console now uses a mission-style layout with dedicated zones:

- **Navigation rail** on the left lists the primary views. Use `←`/`→` or the number keys `1-4` to switch between Overview, Build Operations, Containers, and Settings.
- **Mission header** across the top surfaces the active environment, current scheduler capacity, Warden status, and the name of the focused canvas.
- **Central canvas** renders the active view only, so updates and keyboard handlers don't force the entire tree to re-render.
- **Status bar** along the bottom shows the latest ticker event and always reminds you of `Ctrl+Space` for the command palette and `F1` for help.

## Keyboard Shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl+Space` | Toggle the Command Palette overlay. |
| `F1` | Open the Command Palette directly. |
| `←` / `→` or `h` / `l` | Cycle the active canvas. |
| `1` – `4` | Jump to a specific view in the navigation rail. |
| `q` or `Ctrl+C` | Exit the CLI. |

### Build Operations view

| Shortcut | Action |
| --- | --- |
| `↑` / `↓` or `j` / `k` | Move the selection cursor. |
| `Space` | Toggle the highlighted service. |
| `a` / `n` | Select all / clear selection. |
| `b`, `p`, `u` | Switch between build, push, and pull tabs. |
| `c` | Toggle clean builds when the build tab is active. |
| `Enter` or `g` | Execute the active operation with the selected services. |

While the Command Palette is visible, press:

- `b` to focus the Build canvas,
- `p` to run a push for the current selection,
- `u` to run a pull,
- `o` to open the logs directory (`LOG_DIR`).

### Container Status view

| Shortcut | Action |
| --- | --- |
| `r` | Refresh container metadata. |
| `k` | Stop all managed containers. |
| `w` | Start Warden. |
| `x` | Clean selected services. |
| `d` then `y` | Delete all Docker resources (confirm with `y`). |
| `Space` | Toggle the highlighted service in the maintenance list. |

### Settings view

- Press `1` – `3` on the main menu to jump into build concurrency, debug defaults, or boot mode editors.
- Within a picker, press `Esc` to go back.

## Command Palette

The overlay provides a condensed list of global actions so operators can drive deployments without leaving the keyboard. It also serves as the in-app help surface to keep the redesign discoverable.

Every action dispatched through the palette updates the bottom ticker and writes to the persistent deployment log so the rest of the UI can stay idle.
