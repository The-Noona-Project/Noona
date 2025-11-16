import React from 'react';
import { Button, HStack } from '@chakra-ui/react';

export interface SetupActionFooterProps {
  onBack: () => void;
  onNext: () => void | Promise<void>;
  canGoBack: boolean;
  canGoNext: boolean;
  nextLabel: string;
}

export default function SetupActionFooter({
  onBack,
  onNext,
  canGoBack,
  canGoNext,
  nextLabel,
}: SetupActionFooterProps): JSX.Element {
  return (
    <HStack justify="space-between" w="full" flexWrap="wrap" spacing={3}>
      <Button onClick={onBack} isDisabled={!canGoBack} data-testid="setup-back">
        Back
      </Button>
      <Button colorScheme="purple" onClick={onNext} isDisabled={!canGoNext} data-testid="setup-next">
        {nextLabel}
      </Button>
    </HStack>
  );
}
