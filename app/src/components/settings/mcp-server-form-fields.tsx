import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import type { McpTransport } from "@/lib/mcp-management";

export function McpServerFormFields({
  name,
  onNameChange,
  transport,
  transports,
  onTransportChange,
  target,
  onTargetChange,
  args,
  onArgsChange,
  tokenEnvVar,
  onTokenEnvVarChange,
  tokenProviderLabels,
  pending,
  onSubmit,
}: {
  name: string;
  onNameChange: (value: string) => void;
  transport: McpTransport;
  transports: McpTransport[];
  onTransportChange: (value: McpTransport) => void;
  target: string;
  onTargetChange: (value: string) => void;
  args: string;
  onArgsChange: (value: string) => void;
  tokenEnvVar: string;
  onTokenEnvVarChange: (value: string) => void;
  tokenProviderLabels?: string;
  pending: boolean;
  onSubmit: () => void;
}) {
  const valid = Boolean(name.trim() && target.trim());
  return (
    <form
      className="grid gap-2 sm:grid-cols-[minmax(7rem,0.7fr)_minmax(7rem,0.5fr)_minmax(12rem,1.5fr)_auto]"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid) onSubmit();
      }}
    >
      <Input
        inputSize="md"
        value={name}
        onChange={(event) => onNameChange(event.target.value)}
        placeholder="Server name"
        aria-label="MCP server name"
      />
      <Select
        inputSize="md"
        value={transport}
        onChange={(event) => onTransportChange(event.target.value as McpTransport)}
        aria-label="MCP transport"
      >
        {transports.map((value) => (
          <option key={value} value={value}>
            {value.toUpperCase()}
          </option>
        ))}
      </Select>
      <Input
        inputSize="md"
        type={transport === "stdio" ? "text" : "url"}
        value={target}
        onChange={(event) => onTargetChange(event.target.value)}
        placeholder={
          transport === "stdio" ? "Command (for example npx)" : "https://example.com/mcp"
        }
        aria-label={transport === "stdio" ? "MCP server command" : "MCP server URL"}
      />
      <Button type="submit" size="sm" disabled={!valid || pending}>
        {pending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Plus className="h-3.5 w-3.5" />
        )}
        Add
      </Button>
      {transport === "stdio" ? (
        <Textarea
          value={args}
          onChange={(event) => onArgsChange(event.target.value)}
          placeholder="Arguments, one per line (optional)"
          aria-label="MCP server command arguments"
          className="sm:col-span-3"
        />
      ) : null}
      {tokenProviderLabels && transport === "http" ? (
        <Input
          inputSize="md"
          value={tokenEnvVar}
          onChange={(event) => onTokenEnvVarChange(event.target.value)}
          placeholder={`${tokenProviderLabels} bearer-token environment variable (optional)`}
          aria-label="Bearer-token environment variable"
          className="sm:col-span-2"
        />
      ) : null}
    </form>
  );
}
