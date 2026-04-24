# SSH Real MCP Server

A Model Context Protocol (MCP) server that enables SSH remote command execution by delegating entirely to the **system `ssh` binary**. This means `ssh-agent`, `ProxyCommand`, `~/.ssh/config`, jump hosts, and every other OS-level SSH feature work out of the box — no Node.js crypto, no native addons.

## How it works

Instead of implementing the SSH protocol in Node.js, this server spawns `ssh` as a child process and pipes the output back to the MCP client. Authentication, key discovery, and connection routing are handled by your OS, exactly as if you ran `ssh` yourself in a terminal.

**Requirements:** `ssh` must be installed and available in `PATH` (standard on macOS and Linux).

## Features

- **Zero auth config** — uses your existing `ssh-agent`, `~/.ssh/config`, and key files automatically
- **ProxyCommand / jump hosts** — works natively, no special parameters needed
- **Connectivity test** — `ssh_test` tool to verify reachability before running commands
- **Argument injection protection** — host and username are validated before being passed to `ssh`
- **Configurable timeout** — commands are killed and an error is returned if they exceed the timeout
- Detailed results: stdout, stderr, and exit code

## Installation

### From npm

```bash
npm install -g @danielecr/realssh-mcp
```

### From source

```bash
git clone https://github.com/danielecr/realssh-mcp.git
cd realssh-mcp
npm install
npm run build
```

## VS Code / Copilot configuration

After installing the package globally, add the server to your MCP configuration. In VS Code, open the MCP config file via **Command Palette → MCP: Open User Configuration** and add:

```json
{
  "servers": {
    "realssh": {
      "type": "stdio",
      "command": "realssh-mcp"
    }
  }
}
```

Then run **MCP: List Servers** to verify the server is active.

## Tools

### `ssh_execute`

Execute a command on a remote server via SSH.

**Parameters:**
- `host` (string, **required**): SSH server hostname or IP address
- `command` (string, **required**): Command to execute on the remote server
- `username` (string, optional): SSH username. Defaults to the current OS user
- `port` (number, optional): SSH server port (default: 22)
- `timeout` (number, optional): Command timeout in milliseconds (default: 30000)
- `agentForward` (boolean, optional): Enable SSH agent forwarding `-A` (default: false)
- `extraArgs` (string[], optional): Extra SSH arguments (e.g., `["-o", "StrictHostKeyChecking=no"]`)

**Example:**
```json
{
  "host": "prod-web-01",
  "command": "df -h"
}
```

```json
{
  "host": "192.168.1.100",
  "username": "deploy",
  "command": "systemctl status nginx"
}
```

### `ssh_test`

Test SSH connectivity to a remote host (runs `echo ok` and checks the response).

**Parameters:**
- `host` (string, **required**): SSH server hostname or IP address
- `username` (string, optional): SSH username
- `port` (number, optional): SSH server port (default: 22)
- `extraArgs` (string[], optional): Extra SSH arguments

## Host configuration

Hosts, aliases, jump hosts, and identity files are configured in `~/.ssh/config` — not in the MCP server. This is intentional: the OS `ssh` binary reads that file natively.

Example `~/.ssh/config`:
```sshconfig
Host prod
    HostName prod.example.com
    User deploy
    ProxyJump bastion

Host bastion
    HostName bastion.example.com
    User admin
    IdentityFile ~/.ssh/bastion_ed25519
```

With the above config, `"host": "prod"` works with no extra parameters.

## Security considerations

- Commands are executed on remote systems with the privileges of the SSH user — ensure proper access controls on the remote side.
- `BatchMode=yes` is set by default, preventing the `ssh` process from hanging on interactive prompts.
- Host and username inputs are validated to prevent SSH option injection.
- Command output may contain sensitive data; treat it accordingly.

## License

MIT

