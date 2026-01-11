import { Box, Text } from "ink";

interface TableProps<T extends Record<string, unknown>> {
  data: T[];
}

export function Table<T extends Record<string, unknown>>({ data }: TableProps<T>) {
  if (data.length === 0) {
    return <Text color="gray">No data</Text>;
  }

  const headers = Object.keys(data[0]!);

  // Calculate column widths
  const widths: Record<string, number> = {};
  for (const header of headers) {
    widths[header] = header.length;
  }
  for (const row of data) {
    for (const header of headers) {
      const value = String(row[header] ?? "");
      widths[header] = Math.max(widths[header]!, value.length);
    }
  }

  const pad = (str: string, len: number) => str.padEnd(len);

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box>
        {headers.map((header, i) => (
          <Box key={header} marginRight={i < headers.length - 1 ? 2 : 0}>
            <Text bold color="cyan">
              {pad(header, widths[header]!)}
            </Text>
          </Box>
        ))}
      </Box>

      {/* Separator */}
      <Box>
        {headers.map((header, i) => (
          <Box key={header} marginRight={i < headers.length - 1 ? 2 : 0}>
            <Text color="gray">{"-".repeat(widths[header]!)}</Text>
          </Box>
        ))}
      </Box>

      {/* Rows */}
      {data.map((row, rowIndex) => (
        <Box key={rowIndex}>
          {headers.map((header, i) => (
            <Box key={header} marginRight={i < headers.length - 1 ? 2 : 0}>
              <Text>{pad(String(row[header] ?? ""), widths[header]!)}</Text>
            </Box>
          ))}
        </Box>
      ))}
    </Box>
  );
}
