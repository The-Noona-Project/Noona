import React from 'react';
import {
  Alert,
  AlertIcon,
  Badge,
  Box,
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  Container,
  GridItem,
  Heading,
  HStack,
  SimpleGrid,
  Spinner,
  Stack,
  StackDivider,
  Text,
} from '@chakra-ui/react';
import SetupStepper from '../setup/components/SetupStepper.tsx';
import EnvironmentEditor from '../setup/components/EnvironmentEditor.tsx';
import DiscordSetupForm from '../setup/components/DiscordSetupForm.tsx';
import InstallerLogPanel from '../setup/components/InstallerLogPanel.tsx';
import FoundationPanel from '../setup/components/FoundationPanel.tsx';
import RavenConfigurationPanel from '../setup/components/RavenConfigurationPanel.tsx';
import { useSetupSteps } from '../setup/useSetupSteps.ts';
import type { WizardStepStatus } from '../setup/api.ts';

const WIZARD_STATUS_COLORS: Record<WizardStepStatus, string> = {
  pending: 'gray',
  'in-progress': 'blue',
  complete: 'green',
  error: 'red',
  skipped: 'gray',
};

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
    loadInstallationLogs,
    installationLogs,
    selectedLogService,
    setSelectedLogService,
    serviceLogs,
    loadServiceLogs,
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
    await refreshWizard();
  }, [refreshWizard]);

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
          <InstallerLogPanel
            install={install}
            installationLogs={installationLogs}
            onLoadInstallation={loadInstallationLogs}
            selectedService={selectedLogService}
            onSelectService={setSelectedLogService}
            serviceLogs={serviceLogs}
            onLoadServiceLogs={loadServiceLogs}
            services={logServices}
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
            <Card variant="outline" borderColor="gray.200" h="full">
              <CardHeader borderBottomWidth="1px" borderColor="gray.100">
                <Stack spacing={1}>
                  <Text fontSize="sm" color="gray.500" textTransform="uppercase" letterSpacing="wide">
                    Current Step
                  </Text>
                  <Heading size="md">{currentStep.title}</Heading>
                  <Text color="gray.600">{currentStep.description}</Text>
                </Stack>
              </CardHeader>
              <CardBody>{renderStepContent()}</CardBody>
              <CardFooter borderTopWidth="1px" borderColor="gray.100">
                <HStack justify="space-between" w="full" flexWrap="wrap" spacing={3}>
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
              </CardFooter>
            </Card>
          </GridItem>

          <GridItem colSpan={{ base: 1, xl: 1 }}>
            <Stack spacing={6} h="full">
              <Card variant="outline" borderColor="gray.200" h="full">
                <CardHeader borderBottomWidth="1px" borderColor="gray.100">
                  <Stack spacing={1}>
                    <Heading size="sm">Core services</Heading>
                    <Text fontSize="sm" color="gray.600">
                      Review foundation and additional installation targets.
                    </Text>
                  </Stack>
                </CardHeader>
                <CardBody>
                  <Stack spacing={4} divider={<StackDivider borderColor="gray.100" />}>
                    {foundationServices.length > 0 ? (
                      <Stack spacing={2}>
                        <Heading size="xs" textTransform="uppercase" color="gray.500">
                          Foundation
                        </Heading>
                        <Stack spacing={3}>
                          {foundationServices.map((service) => (
                            <Stack key={service.name} spacing={1} data-testid={`foundation-service-${service.name}`}>
                              <Text fontWeight="semibold">{service.displayName}</Text>
                              <Text fontSize="sm" color="gray.600">
                                {service.description}
                              </Text>
                            </Stack>
                          ))}
                        </Stack>
                      </Stack>
                    ) : null}
                    {logServices.length > 0 ? (
                      <Stack spacing={2}>
                        <Heading size="xs" textTransform="uppercase" color="gray.500">
                          Additional services
                        </Heading>
                        <Stack spacing={3}>
                          {logServices.map((service) => (
                            <Stack key={service.name} spacing={1} data-testid={`install-service-${service.name}`}>
                              <HStack justify="space-between" align="flex-start">
                                <Text fontWeight="semibold">{service.displayName}</Text>
                                {service.recommended && (
                                  <Badge colorScheme="purple" variant="subtle">
                                    Recommended
                                  </Badge>
                                )}
                              </HStack>
                              <Text fontSize="sm" color="gray.600">
                                {service.description}
                              </Text>
                            </Stack>
                          ))}
                        </Stack>
                      </Stack>
                    ) : null}
                    {foundationServices.length === 0 && logServices.length === 0 ? (
                      <Text fontSize="sm" color="gray.500">
                        Service information will appear once discovery completes.
                      </Text>
                    ) : null}
                  </Stack>
                </CardBody>
              </Card>
              <Card variant="outline" borderColor="gray.200">
                <CardHeader borderBottomWidth="1px" borderColor="gray.100">
                  <Stack spacing={1}>
                    <Heading size="sm">Wizard status</Heading>
                    <Text fontSize="sm" color="gray.600">
                      Track setup milestones across foundation, portal, raven, and verification steps.
                    </Text>
                  </Stack>
                </CardHeader>
                <CardBody>
                  {wizardError ? (
                    <Alert status="error" borderRadius="md" mb={wizardState ? 4 : 0} data-testid="wizard-state-error">
                      <AlertIcon />
                      {wizardError}
                    </Alert>
                  ) : null}
                  {wizardLoading && !wizardState ? (
                    <HStack justify="center" py={4}>
                      <Spinner size="sm" />
                    </HStack>
                  ) : wizardState ? (
                    <Stack spacing={3} divider={<StackDivider borderColor="gray.100" />}>
                      {wizardSteps.map((item) => (
                        <Stack key={item.key} spacing={1} data-testid={`wizard-step-${item.key}`}>
                          <HStack justify="space-between" align="flex-start">
                            <Text fontWeight="semibold">{item.label}</Text>
                            <Badge
                              colorScheme={WIZARD_STATUS_COLORS[item.state.status] ?? 'gray'}
                              textTransform="capitalize"
                            >
                              {item.state.status}
                            </Badge>
                          </HStack>
                          {item.state.error ? (
                            <Text fontSize="sm" color="red.500">
                              {item.state.error}
                            </Text>
                          ) : item.state.detail ? (
                            <Text fontSize="sm" color="gray.600">
                              {item.state.detail}
                            </Text>
                          ) : null}
                        </Stack>
                      ))}
                    </Stack>
                  ) : (
                    <Text fontSize="sm" color="gray.600">
                      Wizard progress will appear once an installation run begins.
                    </Text>
                  )}
                </CardBody>
                <CardFooter borderTopWidth="1px" borderColor="gray.100">
                  <Button size="sm" onClick={handleRefreshWizard} isLoading={wizardLoading}>
                    Refresh status
                  </Button>
                </CardFooter>
              </Card>
            </Stack>
          </GridItem>
        </SimpleGrid>
      </Stack>
    </Container>
  );
}
