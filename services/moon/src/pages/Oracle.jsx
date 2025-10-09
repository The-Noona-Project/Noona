import React from 'react';
import { Heading, Stack, Text } from '@chakra-ui/react';

export default function OraclePage() {
  return (
    <Stack spacing={4} data-testid="oracle-page">
      <Heading size="lg">Oracle</Heading>
      <Text color="gray.600">
        Connect the AI assistant layer, manage embeddings, and review chat transcripts to tune the
        conversational experience.
      </Text>
    </Stack>
  );
}
