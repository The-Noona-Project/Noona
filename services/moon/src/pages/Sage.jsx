import React from 'react';
import { Heading, Stack, Text } from '@chakra-ui/react';

export default function SagePage() {
  return (
    <Stack spacing={4} data-testid="sage-page">
      <Heading size="lg">Sage</Heading>
      <Text color="gray.600">
        View observability dashboards, connect Prometheus targets, and review alerting policies that
        keep your deployment healthy.
      </Text>
    </Stack>
  );
}
