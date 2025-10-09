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
                    <Heading size="sm">Selected services</Heading>
                    <Text fontSize="sm" color="gray.600">
                      Review which services will be installed.
                    </Text>
                  </Stack>
                </CardHeader>
                <CardBody>
                  {selectedServices.length > 0 ? (
                    <Stack spacing={4} divider={<StackDivider borderColor="gray.100" />}>
                      {selectedServices.map((service) => (
                        <Stack key={service.name} spacing={1} data-testid={`selected-service-${service.name}`}>
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
                  ) : (
                    <Text fontSize="sm" color="gray.500">
                      No services selected yet. Choose services to see them listed here.
                    </Text>
                  )}
                </CardBody>
              </Card>
            </Stack>
          </GridItem>
        </SimpleGrid>
      </Stack>
    </Container>
  );
}
