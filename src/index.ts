#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { spawn } from 'child_process';
import { z } from "zod";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

// Input schema for SSH connection parameters
const SSHExecuteSchema = z.object({
  host: z.string().describe("SSH server hostname or IP address (e.g., 'dev234' or '192.168.1.100')"),
  port: z.number().default(22).describe("SSH server port (default: 22)"),
  username: z.string().describe("SSH username (e.g., 'username')"),
  command: z.string().describe("Command to execute on the remote server"),
  timeout: z.number().default(30000).describe("Command timeout in milliseconds (default: 30000)"),
  agentForward: z.boolean().default(false).describe("Enable SSH agent forwarding (default: false)"),
  extraArgs: z.array(z.string()).optional().describe("Extra SSH arguments (e.g., ['-o', 'StrictHostKeyChecking=no'])")
});

type SSHExecuteParams = z.infer<typeof SSHExecuteSchema>;

// Create the MCP server
const server = new McpServer({
  name: "alolite-ssh-mcp",
  version: "1.0.0"
}, {
  capabilities: {
    tools: {
      listChanged: true
    }
  }
});

/**
 * Validate SSH connection parameters to prevent argument injection
 */
function validateSSHParams(params: SSHExecuteParams): void {
  // Prevent host from being interpreted as an SSH flag
  if (params.host.startsWith('-')) {
    throw new Error(`Invalid host: "${params.host}"`);
  }
  // Prevent username from being interpreted as an SSH flag
  if (params.username.startsWith('-')) {
    throw new Error(`Invalid username: "${params.username}"`);
  }
}

/**
 * Execute a command on a remote SSH server by spawning the system ssh binary.
 * This delegates auth entirely to the OS: ssh-agent, ProxyCommand, ~/.ssh/config, etc.
 */
function executeSSHCommand(params: SSHExecuteParams): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve, reject) => {
    validateSSHParams(params);

    const args: string[] = [
      // Explicitly end option parsing before the destination
      '-p', String(params.port),
      // Disable pseudo-terminal allocation (we're running a non-interactive command)
      '-T',
      // Prevent hanging on password/passphrase prompts – auth is handled by the OS/agent
      '-o', 'BatchMode=yes',
    ];

    if (params.agentForward) {
      args.push('-A');
    }

    if (params.extraArgs && params.extraArgs.length > 0) {
      args.push(...params.extraArgs);
    }

    // Use -- to ensure the destination is not parsed as an option
    args.push('--', `${params.username}@${params.host}`, params.command);

    const child = spawn('ssh', args, {
      // Pass through the full environment so SSH_AUTH_SOCK, SSH_AGENT_PID,
      // and any ProxyCommand variables are available
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
    child.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`SSH command timed out after ${params.timeout}ms`));
    }, params.timeout);

    child.on('close', (code: number | null) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code });
    });

    child.on('error', (err: Error) => {
      clearTimeout(timer);
      reject(new Error(`Failed to spawn ssh: ${err.message}`));
    });
  });
}

// Register the SSH execute tool
server.registerTool(
  "ssh_execute",
  {
    description: "Execute a command on a remote server via SSH and return the output. Uses the system SSH binary so ssh-agent, ProxyCommand, and ~/.ssh/config are honoured automatically.",
    inputSchema: SSHExecuteSchema.shape
  },
  async (params: SSHExecuteParams): Promise<CallToolResult> => {
    try {
      const result = await executeSSHCommand(params);
      
      const response = {
        command: params.command,
        host: `${params.username}@${params.host}:${params.port}`,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        success: result.exitCode === 0
      };

      return {
        content: [
          {
            type: "text",
            text: `SSH Command Execution Result:

Host: ${response.host}
Command: ${response.command}
Exit Code: ${response.exitCode}
Success: ${response.success}

=== STDOUT ===
${response.stdout || '(no output)'}

=== STDERR ===
${response.stderr || '(no errors)'}
`
          }
        ],
        isError: result.exitCode !== 0
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      return {
        content: [
          {
            type: "text",
            text: `SSH Command Failed: ${errorMessage}`
          }
        ],
        isError: true
      };
    }
  }
);

// Register SSH connectivity test tool
server.registerTool(
  "ssh_test",
  {
    description: "Test SSH connectivity to a remote host. Verifies that the system SSH binary can reach the host using the current agent/config.",
    inputSchema: {
      host: z.string().describe("SSH server hostname or IP address"),
      port: z.number().default(22).describe("SSH server port (default: 22)"),
      username: z.string().describe("SSH username"),
      extraArgs: z.array(z.string()).optional().describe("Extra SSH arguments")
    }
  },
  async (params: { host: string; port: number; username: string; extraArgs?: string[] }): Promise<CallToolResult> => {
    try {
      const result = await executeSSHCommand({
        ...params,
        command: 'echo ok',
        timeout: 10000,
        agentForward: false,
      });

      const reachable = result.exitCode === 0 && result.stdout.trim() === 'ok';
      return {
        content: [
          {
            type: "text",
            text: reachable
              ? `SSH connectivity OK: ${params.username}@${params.host}:${params.port}`
              : `SSH connectivity FAILED: ${params.username}@${params.host}:${params.port}\n${result.stderr || result.stdout}`
          }
        ],
        isError: !reachable
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `SSH test failed: ${errorMessage}` }],
        isError: true
      };
    }
  }
);

// Start the server
async function main() {
  const transport = new StdioServerTransport();

  process.on('SIGINT', () => process.exit(0));
  process.on('SIGTERM', () => process.exit(0));

  await server.connect(transport);
  console.error("SSH MCP Server running on stdio (system ssh)");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});

