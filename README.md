# UE5 MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io) server that bridges Claude AI to a live Unreal Engine 5 editor session. Claude can inspect and modify scene objects, read output logs, search C++ source files, trigger console commands, and scaffold new C++ classes — all from a natural language prompt.

---

## How It Works

```
Claude ──JSON-RPC──► MCP Server (Node.js) ──HTTP──► UE5 Remote Control API (port 30010)
                          │
                          └──filesystem──► Source/*.cpp/h, Saved/Logs/*.log
```

Claude Desktop spawns the MCP server as a child process over `stdio`. When Claude decides to use a tool, it sends a JSON-RPC request; the server translates it into a UE5 Remote Control HTTP call (or a file system read/write) and returns the result.

---

## Prerequisites

### Unreal Engine 5

1. Open your project in the UE5 Editor.
2. Go to **Edit → Plugins**, search for **Remote Control API**, enable it, and restart the editor.
3. Add the following to `Config/DefaultEngine.ini`:

```ini
[/Script/RemoteControlAPI.RemoteControlSettings]
bEnableRemoteControlHttp=True
RemoteControlHttpServerPort=30010
bRestrictServerToLocalHost=True
```

> **Security:** Keep `bRestrictServerToLocalHost=True`. The Remote Control API has no authentication by default — exposing it to a network without protection is a serious risk.

### Node.js

Node.js **v20 or later** is required.

---

## Installation

```bash
cd C:/dev/ue5_MCP
npm install
npm run build
```

This compiles TypeScript to `dist/`. The runnable entry point is `dist/index.js`.

---

## Configuration

Copy `.env.example` to `.env` and fill in your paths. The MCP server reads these as environment variables (injected via Claude Desktop config — see below).

| Variable | Required | Default | Description |
|---|---|---|---|
| `UE5_RC_URL` | No | `http://127.0.0.1:30010` | Remote Control API base URL |
| `UE5_PROJECT_SOURCE` | Yes (for source tools) | — | Absolute path to your project's `Source/` directory |
| `UE5_LOG_PATH` | Yes (for log tool) | — | Absolute path to the `.log` file, e.g. `C:/…/Saved/Logs/MyProject.log` |
| `MCP_SECRET` | No | — | Adds `X-MCP-Secret` header to all Remote Control requests |
| `UE5_ALLOW_FILE_WRITE` | No | `false` | Must be exactly `"true"` to enable the file staging/write tools |
| `UE5_WRITE_EXTENSIONS` | No | `.cpp,.h` | Comma-separated allowed extensions for file writes |
| `UE5_STAGING_TTL_MS` | No | `600000` | Milliseconds before a staged batch expires (default: 10 minutes) |

---

## Connecting to Claude

### Claude Code (CLI / VS Code)

Add a `.mcp.json` file in the root of the project you want the tools available in (or in the MCP server directory itself):

```json
{
  "mcpServers": {
    "ue5": {
      "type": "stdio",
      "command": "node",
      "args": ["C:/dev/ue5_MCP/dist/index.js"],
      "env": {
        "UE5_RC_URL": "http://127.0.0.1:30010",
        "UE5_PROJECT_SOURCE": "C:\\Github\\MyProject\\Source",
        "UE5_LOG_PATH": "C:\\Github\\MyProject\\Saved\\Logs\\MyProject.log",
        "UE5_ALLOW_FILE_WRITE": "false"
      }
    }
  }
}
```

Alternatively, add it via the CLI:

```bash
claude mcp add --transport stdio \
  --env UE5_RC_URL=http://127.0.0.1:30010 \
  --env "UE5_PROJECT_SOURCE=C:\Github\MyProject\Source" \
  --env "UE5_LOG_PATH=C:\Github\MyProject\Saved\Logs\MyProject.log" \
  --env UE5_ALLOW_FILE_WRITE=false \
  ue5 -- node C:/dev/ue5_MCP/dist/index.js
```

When you start a new Claude Code session in a directory that has this `.mcp.json`, the 10 UE5 tools will be available automatically. You'll be prompted to approve the server on first use.

### Claude Desktop (optional)

If you also want to use it with Claude Desktop, add to `%APPDATA%\Claude\claude_desktop_config.json` (Windows) or `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):

```json
{
  "mcpServers": {
    "ue5": {
      "command": "node",
      "args": ["C:/dev/ue5_MCP/dist/index.js"],
      "env": {
        "UE5_RC_URL": "http://127.0.0.1:30010",
        "UE5_PROJECT_SOURCE": "C:\\Github\\MyProject\\Source",
        "UE5_LOG_PATH": "C:\\Github\\MyProject\\Saved\\Logs\\MyProject.log",
        "UE5_ALLOW_FILE_WRITE": "false"
      }
    }
  }
}
```

Restart Claude Desktop after editing. The hammer icon in the toolbar should show **10 tools** when a conversation is active.

---

## Available Tools

### Remote Control (4 tools)

These tools communicate directly with the running UE5 editor via the Remote Control API.

#### `ue5_run_console_command`
Executes any Unreal console command in the live editor.

```
command: "stat fps"           → shows FPS overlay
command: "r.VSync 0"          → disables VSync
command: "stat unit"          → shows frame time breakdown
command: "showflag.Bloom 0"   → disables bloom
```

> Blocked commands: `quit`, `exit`, `open`, `cmd`, `exec`, `start`, `shell`, `servertravel`, `disconnect`

#### `ue5_get_object_property`
Reads a property value from any UObject by its full actor path.

```
objectPath:   "/Game/Maps/TestMap.TestMap:PersistentLevel.PointLight_0"
propertyName: "Intensity"
```

#### `ue5_set_object_property`
Sets a property on any UObject.

```
objectPath:    "/Game/Maps/TestMap.TestMap:PersistentLevel.PointLight_0"
propertyName:  "Intensity"
propertyValue: 5000
```

#### `ue5_call_function`
Calls a Blueprint-callable UFUNCTION on any actor or component.

```
objectPath:   "/Game/Maps/TestMap.TestMap:PersistentLevel.MyActor_0"
functionName: "ResetState"
parameters:   {}
```

---

### Source Search (2 tools)

These tools search and read files in your `UE5_PROJECT_SOURCE` directory. They never write anything.

#### `ue5_search_source`
Full-text regex search across `.cpp` and `.h` files with context lines.

```
pattern:      "AGameModeBase"
fileGlob:     "**/*.h"          (optional, default: **/*.{cpp,h})
maxResults:   30                (optional, default: 50)
contextLines: 3                 (optional, default: 2)
```

Example output:
```
=== MyGame/GameMode/MyGameMode.h:8 ===
   6:  #include "CoreMinimal.h"
   7:  #include "GameFramework/GameModeBase.h"
>> 8:  class MYGAME_API AMyGameMode : public AGameModeBase
   9:  {
  10:      GENERATED_BODY()
```

#### `ue5_read_file`
Returns the content of a specific source file, optionally scoped to a line range.

```
filePath:  "MyGame/GameMode/MyGameMode.cpp"
startLine: 20    (optional)
endLine:   50    (optional)
```

---

### Log Reader (1 tool)

#### `ue5_read_log`
Reads the tail of the UE5 output log. Reads only the last N bytes to avoid loading gigabyte-sized session logs.

```
filter:    "Error"     (All | Error | Warning | Display, default: All)
maxLines:  200         (default: 100)
tailBytes: 1048576     (default: 512000 = 500 KB)
```

Use `filter: "Error"` after a failed compile to surface just the relevant errors.

---

### File Writer (3 tools)

> **Requires `UE5_ALLOW_FILE_WRITE=true`** in your environment. Disabled by default.
> Only `.cpp` and `.h` files are permitted. Paths are jailed to `UE5_PROJECT_SOURCE`.

The write workflow is a three-step process designed to give you a review gate before anything touches disk:

**Step 1 — Stage**
```
ue5_stage_files:
  files: [
    { path: "MyGame/MyActor.h",   content: "..." },
    { path: "MyGame/MyActor.cpp", content: "..." }
  ]
```
Files are held in memory. Nothing is written yet.

**Step 2 — Preview**
```
ue5_preview_staged
```
Returns the full content of every staged file. Review it before proceeding.

**Step 3 — Commit**
```
ue5_commit_files:
  triggerCompile: true
```
Writes all staged files to disk (creating directories as needed), clears the staging area, and optionally triggers a hot reload compile. Follow up with `ue5_read_log filter: "Error"` to check compile results.

---

## Example Prompts

```
"Turn on GPU timing stats in the UE5 editor."
→ Calls ue5_run_console_command: "stat gpu"

"Set the intensity of DirectionalLight_0 to 3.14."
→ Calls ue5_set_object_property with the actor path and Intensity value

"Show me everywhere UHealthComponent is used in the project."
→ Calls ue5_search_source: pattern "UHealthComponent", maxResults 50

"My project just failed to compile. What are the errors?"
→ Calls ue5_read_log: filter "Error", maxLines 50

"Create a minimal AActor subclass called APickup with a USphereComponent."
→ Calls ue5_search_source to find conventions, then ue5_stage_files,
  ue5_preview_staged for your review, then ue5_commit_files with triggerCompile: true
```

---

## Development

```bash
npm run dev       # Run directly with ts-node (no compile step)
npm run build     # Compile TypeScript → dist/
npm run start     # Run compiled output
npm run inspect   # Open MCP Inspector browser UI to test tools interactively
```

The MCP Inspector is the fastest way to test tools without Claude Desktop. It shows all registered tools with their schemas and lets you call them manually.

---

## Security

| Risk | Mitigation |
|---|---|
| Arbitrary console commands | Blocked prefix allowlist; `quit`, `open`, `exit` etc. are rejected |
| Remote Control API exposure | Keep `bRestrictServerToLocalHost=True` in `DefaultEngine.ini` |
| Path traversal in file reads | `../` patterns and escaped traversals are rejected before any `readFile` |
| Source file writes | Jailed to `UE5_PROJECT_SOURCE`; extension whitelist (`.cpp`, `.h` only); disabled by default |
| Log credential exposure | Logs may contain secrets from plugin init — redact before sharing raw log output |
| HTTP transport | If switching from stdio to HTTP/SSE transport, validate `MCP_SECRET` on every request |

---

## Project Structure

```
src/
  index.ts              Entry point — bootstraps MCP server, registers tools
  utils/
    ue5-client.ts       Axios wrapper for all Remote Control API HTTP calls
    log-parser.ts       Pure log line parsing/filtering (no I/O)
    path-guard.ts       Path traversal security guard (shared by read and write tools)
  tools/
    remote-control.ts   ue5_run_console_command, ue5_get/set_object_property, ue5_call_function
    source-search.ts    ue5_search_source, ue5_read_file
    log-reader.ts       ue5_read_log
    file-writer.ts      ue5_stage_files, ue5_preview_staged, ue5_commit_files
dist/                   Compiled JavaScript output (generated by npm run build)
.env.example            Template for environment variable configuration
```
