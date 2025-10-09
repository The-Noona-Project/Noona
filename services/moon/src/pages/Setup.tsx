import React from 'react';
import {
  Alert,
  AlertIcon,
  Box,
  Button,
  Heading,
  HStack,
  Spinner,
  Stack,
  Text,
} from '@chakra-ui/react';
import SetupStepper from '../setup/components/SetupStepper.tsx';
import ServiceSelectionGrid from '../setup/components/ServiceSelectionGrid.tsx';
import EnvironmentEditor from '../setup/components/EnvironmentEditor.tsx';
import DiscordSetupForm from '../setup/components/DiscordSetupForm.tsx';
import InstallerLogPanel from '../setup/components/InstallerLogPanel.tsx';
import { useSetupSteps } from '../setup/useSetupSteps.ts';

export default function SetupPage(): JSX.Element {
  const {
    steps,
    currentStep,
    selectStep,
    goNext,
    goPrevious,
    canGoNext,
    canGoPrevious,
    nextLabel,
    services,
    selected,
    selectionErrors,
    toggleService,
    envSections,
    updateEnvValue,
    detectRaven,
    detectingRaven,
    ravenDetectionError,
    discord,
    install,
    loadInstallationLogs,
    installationLogs,
    selectedLogService,
    setSelectedLogService,
    serviceLogs,
    loadServiceLogs,
  } = useSetupSteps();

  const selectedServices = React.useMemo(
    () => services.filter((service) => selected.has(service.name)),
    [services, selected],
  );

  const handleNext = React.useCallback(async () => {
    await goNext();
  }, [goNext]);

  const portalSelected = selected.has('noona-portal');

  const renderStepContent = () => {
    switch (currentStep.id) {
      case 'select':
        return (
          <ServiceSelectionGrid
            services={services}
            selected={selected}
            selectionErrors={selectionErrors}
            onToggle={toggleService}
          />
        );
      case 'configure':
        return (
          <EnvironmentEditor
            sections={envSections}
            onChange={updateEnvValue}
            onDetectRaven={detectRaven}
            detectingRaven={detectingRaven}
            ravenDetectionError={ravenDetectionError}
          />
        );
      case 'discord':
        return <DiscordSetupForm discord={discord} isVisible={portalSelected} />;
      case 'install':
        return (
          <Stack spacing={4} data-testid="install-step">
            {!install.started && (
              <Alert status="info" borderRadius="md" data-testid="installer-instructions">
                <AlertIcon />
                Click “{nextLabel}” to begin installing the selected services.
              </Alert>
            )}
            <InstallerLogPanel
              install={install}
              installationLogs={installationLogs}
              onLoadInstallation={loadInstallationLogs}
              selectedService={selectedLogService}
              onSelectService={setSelectedLogService}
              serviceLogs={serviceLogs}
              onLoadServiceLogs={loadServiceLogs}
              services={selectedServices}
            />
          </Stack>
        );
      case 'logs':
        return (
          <InstallerLogPanel
            install={install}
            installationLogs={installationLogs}
            onLoadInstallation={loadInstallationLogs}
            selectedService={selectedLogService}
            onSelectService={setSelectedLogService}
            serviceLogs={serviceLogs}
            onLoadServiceLogs={loadServiceLogs}
            services={selectedServices}
          />
        );
      default:
        return (
          <Box textAlign="center" py={12}>
            <Spinner size="lg" />
          </Box>
        );
    }
  };

  return (
    <Stack spacing={8} data-testid="setup-page">
      <Stack spacing={2}>
        <Heading size="lg">Moon Setup Wizard</Heading>
        <Text color="gray.600">
          Follow the guided setup to install and verify each Noona service.
        </Text>
      </Stack>

      <SetupStepper steps={steps} currentStepId={currentStep.id} onSelect={selectStep} />

      <Box>{renderStepContent()}</Box>

      <HStack justify="space-between">
        <Button onClick={goPrevious} isDisabled={!canGoPrevious} data-testid="setup-back">
          Back
        </Button>
        <Button
          colorScheme="purple"
          onClick={handleNext}
          isDisabled={!canGoNext}
          data-testid="setup-next"
        >
          {nextLabel}
        </Button>
      </HStack>
    </Stack>
  );
}
