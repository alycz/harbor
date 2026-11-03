import { describe, expect, it } from 'vitest';

describe('pi-mcp in workerd', () => {
  it('imports the client and the Streamable HTTP transport', async () => {
    const { McpClient, StreamableHttpTransport } = await import('@earendil-works/pi-mcp');
    const client = new McpClient({ name: 'harbor', version: '0.0.0' });
    const transport = new StreamableHttpTransport({ url: 'https://mcp.example.invalid/mcp', openGetStream: false });
    expect(client).toBeDefined();
    expect(transport).toBeDefined();
  });
});
