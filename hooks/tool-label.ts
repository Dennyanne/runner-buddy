// What a character is doing, in a few words, from a tool call: the tool and
// the one detail that says what it is working on.
//   Edit register.tsx · $ npm test · Grep TODO · Fetch docs.anthropic.com
export function toolLabel(tool: string, input: Readonly<Record<string, unknown>>): string {
  const text = (key: string) => {
    const value = input[key]
    return typeof value === 'string' ? value.trim() : ''
  }
  const fileName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path
  const firstLine = (value: string) => value.split('\n')[0]?.trim() ?? ''

  switch (tool) {
    case 'Bash':
    case 'PowerShell': {
      const command = firstLine(text('command'))
      return command ? `$ ${command}` : tool
    }
    case 'Read':
    case 'Edit':
    case 'Write':
    case 'MultiEdit':
    case 'NotebookEdit': {
      const path = text('file_path') || text('notebook_path')
      return path ? `${tool} ${fileName(path)}` : tool
    }
    case 'Grep':
    case 'Glob': {
      const pattern = firstLine(text('pattern'))
      return pattern ? `${tool} ${pattern}` : tool
    }
    case 'WebFetch': {
      try {
        return `Fetch ${new URL(text('url')).hostname}`
      } catch {
        return 'Fetch'
      }
    }
    case 'WebSearch': {
      const query = firstLine(text('query'))
      return query ? `Search ${query}` : 'Search'
    }
    case 'Agent':
    case 'Task': {
      const description = firstLine(text('description'))
      return description ? `Agent ${description}` : 'Agent'
    }
  }
  // mcp__server__tool reads as its last part.
  if (tool.startsWith('mcp__')) return tool.split('__').filter(Boolean).pop() ?? tool
  return tool
}
