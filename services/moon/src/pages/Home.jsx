import React, { useEffect, useMemo } from 'react';
import {
  Box,
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  Heading,
  Icon,
  SimpleGrid,
  Stack,
  Text,
} from '@chakra-ui/react';
import { useNavigate } from 'react-router-dom';
import { getIconPath } from '../components/icons.js';
import {
  getRequiredServiceForPath,
  useServiceInstallation,
} from '../state/serviceInstallationContext.tsx';

const SERVICE_PAGES = [
  {
    title: 'Warden',
    summary:
      'Orchestrator for the entire stack. Builds Docker images, provisions containers, enforces boot order, performs health checks, and manages rolling updates across master and node deployments.',
    path: '/warden',
    icon: 'mdi-shield-crown',
  },
  {
    title: 'Vault',
    summary:
      'Authentication and data access gateway. Issues JWTs to services, brokers reads/writes to MongoDB and Redis, and secures internal APIs.',
    path: '/vault',
    icon: 'mdi-safe-square',
  },
  {
    title: 'Portal',
    summary:
      "External integrations hub. Handles Discord command logic, listens for guild events, and bridges to Kavita's APIs.",
    path: '/portal',
    icon: 'mdi-transit-connection-variant',
  },
  {
    title: 'Sage',
    summary:
      'Monitoring and logging backbone using Prometheus for metrics collection and Grafana for visualization.',
    path: '/sage',
    icon: 'mdi-chart-box-outline',
  },
  {
    title: 'Moon Service',
    summary:
      'Web-based control center built with React. Provides dashboards for admins and readers, Discord authentication, AI chat, request management, and service status.',
    path: '/moon-service',
    icon: 'mdi-moon-waning-crescent',
  },
  {
    title: 'Raven',
    summary:
      'Custom Java-based scraper/downloader. Automates content acquisition, metadata enrichment, and CBZ packaging.',
    path: '/raven',
    icon: 'mdi-crow',
  },
  {
    title: 'Oracle',
    summary:
      'AI assistant layer powered by LangChain, LocalAI/AnythingLLM for conversational insights and recommendations.',
    path: '/oracle',
    icon: 'mdi-crystal-ball',
  },
];

export default function HomePage() {
  const navigate = useNavigate();
  const { ensureLoaded, hasPendingSetup, isServiceInstalled, loading } = useServiceInstallation();

  useEffect(() => {
    ensureLoaded().catch(() => {});
  }, [ensureLoaded]);

  const serviceCards = useMemo(() => {
    return SERVICE_PAGES.map((service) => {
      const requiredService = getRequiredServiceForPath(service.path);
      const installed = isServiceInstalled(requiredService);
      const disabled = loading || (!!requiredService && !installed);
      let tooltip = '';

      if (loading) {
        tooltip = 'Checking installation status…';
      } else if (disabled) {
        tooltip = 'Service installation is still pending.';
      }

      return {
        ...service,
        requiredService,
        installed,
        disabled,
        tooltip,
      };
    });
  }, [isServiceInstalled, loading]);

  return (
    <Stack spacing={12} align="center">
      <Card maxW="xl" textAlign="center" py={10} px={8} shadow="xl">
        <CardHeader pb={0}>
          <Stack spacing={4} align="center">
            <Box as="img" src="/logo.svg" alt="Noona" boxSize="100px" />
            <Heading size="lg">Welcome to Noona</Heading>
            <Text fontSize="md" color="gray.600">
              Explore the control surfaces for every service or jump straight into the setup wizard.
            </Text>
          </Stack>
        </CardHeader>
        <CardFooter pt={6} justifyContent="center">
          {hasPendingSetup && (
            <Button
              colorScheme="purple"
              size="lg"
              data-testid="launch-setup"
              onClick={() => navigate('/setup')}
            >
              Launch Setup Wizard
            </Button>
          )}
        </CardFooter>
      </Card>

      <SimpleGrid columns={{ base: 1, md: 2, xl: 3 }} spacing={6} width="100%" maxW="6xl">
        {serviceCards.map((card) => (
          <Card key={card.path} height="100%" display="flex" flexDirection="column" shadow="md">
            <CardHeader>
              <Stack spacing={4}>
                <Icon viewBox="0 0 24 24" boxSize="48px" color="purple.400">
                  <path fill="currentColor" d={getIconPath(card.icon)} />
                </Icon>
                <Heading size="md">{card.title}</Heading>
              </Stack>
            </CardHeader>
            <CardBody flex="1">
              <Text color="gray.600">{card.summary}</Text>
            </CardBody>
            <CardFooter pt={0}>
              <Button
                width="100%"
                variant="outline"
                colorScheme="purple"
                isDisabled={card.disabled}
                title={card.disabled ? card.tooltip : undefined}
                data-testid={`service-link-${card.path}`}
                onClick={() => !card.disabled && navigate(card.path)}
              >
                View {card.title}
              </Button>
            </CardFooter>
          </Card>
        ))}
      </SimpleGrid>
    </Stack>
  );
}
