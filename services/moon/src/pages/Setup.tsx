import React from 'react';
import { Box, Card, CardBody, Container, GridItem, Heading, SimpleGrid, Spinner, Stack, Text } from '@chakra-ui/react';
import SetupStepper from '../setup/components/SetupStepper.tsx';
import EnvironmentEditor from '../setup/components/EnvironmentEditor.tsx';
import DiscordSetupForm from '../setup/components/DiscordSetupForm.tsx';
import VerificationPanel from '../setup/components/VerificationPanel.tsx';
import FoundationPanel from '../setup/components/FoundationPanel.tsx';
import RavenConfigurationPanel from '../setup/components/RavenConfigurationPanel.tsx';
import { useSetupSteps } from '../setup/useSetupSteps.ts';
import SetupActionFooter from '../setup/components/SetupActionFooter.tsx';
import SetupContextPanel from '../setup/components/SetupContextPanel.tsx';
import SetupTimeline from '../setup/components/SetupTimeline.tsx';

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
    foundationSections,
    foundationState,
    envSections,
    ravenSections,
    updateEnvValue,
    environmentError,
    portalError,
    raven,
    detectRaven,
    checkRavenHealth,
    discord,
    install,
    verification,
    refreshVerification,
    runVerificationChecks,
    completeSetup,
    wizardState,
    wizardLoading,
    wizardError,
    refreshWizard,
  } = useSetupSteps();

  const foundationServices = React.useMemo(
    () => foundationSections.map((section) => section.service),
    [foundationSections],
  );

  const logServices = React.useMemo(() => {
    const foundationNames = new Set(foundationServices.map((service) => service.name));
    return services.filter((service) => !foundationNames.has(service.name));
  }, [services, foundationServices]);

  const wizardSteps = React.useMemo(() => {
    if (!wizardState) {
      return [];
    }

    return [
      { key: 'foundation', label: 'Foundation services', state: wizardState.foundation },
      { key: 'portal', label: 'Portal', state: wizardState.portal },
      { key: 'raven', label: 'Raven', state: wizardState.raven },
      { key: 'verification', label: 'Verification', state: wizardState.verification },
    ];
  }, [wizardState]);

  const handleRefreshWizard = React.useCallback(async () => {
    await Promise.allSettled([refreshWizard(), refreshVerification()]);
  }, [refreshWizard, refreshVerification]);

  const handleNext = React.useCallback(async () => {
    await goNext();
  }, [goNext]);

  const renderStepContent = () => {
    const activeEnvironmentError =
      currentStep.id === 'portal' ? portalError || environmentError : environmentError;

    switch (currentStep.id) {
      case 'foundation':
        return (
          <FoundationPanel
            sections={foundationSections}
            onChange={updateEnvValue}
            state={foundationState}
          />
        );
      case 'portal':
        return (
          <Stack spacing={6}>
            <EnvironmentEditor
              sections={envSections}
              onChange={updateEnvValue}
              error={activeEnvironmentError}
            />
            <DiscordSetupForm discord={discord} />
          </Stack>
        );
      case 'raven':
        return (
          <RavenConfigurationPanel
            sections={ravenSections}
            onChange={updateEnvValue}
            environmentError={environmentError}
            raven={raven}
            onDetect={detectRaven}
            onCheckHealth={checkRavenHealth}
          />
        );
      case 'verification':
        return (
          <VerificationPanel
            install={install}
            verification={verification}
            wizardState={wizardState}
            wizardLoading={wizardLoading}
            onRefresh={refreshVerification}
            onRunChecks={runVerificationChecks}
            onComplete={completeSetup}
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
    <Container maxW="6xl" py={{ base: 6, md: 10 }} data-testid="setup-page">
      <Stack spacing={{ base: 6, md: 8 }}>
        <Stack spacing={3}>
          <Heading size="lg">Moon Setup Wizard</Heading>
          <Text color="gray.600">
            Follow the guided setup to install and verify each Noona service.
          </Text>
        </Stack>

        <Card variant="outline" borderColor="gray.200">
          <CardBody>
            <SetupStepper steps={steps} currentStepId={currentStep.id} onSelect={selectStep} />
          </CardBody>
        </Card>

        <SimpleGrid columns={{ base: 1, xl: 3 }} spacing={{ base: 6, md: 8 }} alignItems="stretch">
          <GridItem colSpan={{ base: 1, xl: 2 }}>
            <SetupContextPanel
              title={currentStep.title}
              description={currentStep.description}
              footer={
                <SetupActionFooter
                  onBack={goPrevious}
                  onNext={handleNext}
                  canGoBack={canGoPrevious}
                  canGoNext={canGoNext}
                  nextLabel={nextLabel}
                />
              }
            >
              {renderStepContent()}
            </SetupContextPanel>
          </GridItem>

          <GridItem colSpan={{ base: 1, xl: 1 }}>
            <SetupTimeline
              foundationServices={foundationServices}
              additionalServices={logServices}
              wizardSteps={wizardSteps}
              wizardState={wizardState}
              wizardLoading={wizardLoading}
              wizardError={wizardError}
              onRefresh={handleRefreshWizard}
            />
          </GridItem>
        </SimpleGrid>
      </Stack>
    </Container>
  );
}
