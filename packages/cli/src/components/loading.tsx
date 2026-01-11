import { Box, Text } from "ink";
import Spinner from "ink-spinner";

interface LoadingProps {
  message: string;
  submessage?: string;
}

export function Loading({ message, submessage }: LoadingProps) {
  return (
    <Box alignItems="center" flexDirection="column" justifyContent="center" padding={2}>
      <Box>
        <Text color="green">
          <Spinner type="dots" />
        </Text>
        <Text> {message}</Text>
      </Box>
      {submessage && (
        <Box marginTop={1}>
          <Text color="gray">{submessage}</Text>
        </Box>
      )}
    </Box>
  );
}
