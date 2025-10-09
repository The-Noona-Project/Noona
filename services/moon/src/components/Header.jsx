import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Divider,
  Drawer,
  DrawerBody,
  DrawerCloseButton,
  DrawerContent,
  DrawerHeader,
  DrawerOverlay,
  Flex,
  Heading,
  HStack,
  Icon,
  IconButton,
  Image,
  Stack,
  Text,
  useBreakpointValue,
  useColorMode,
  useDisclosure,
} from '@chakra-ui/react';
import { MoonIcon, SunIcon } from '@chakra-ui/icons';
import { useLocation, useNavigate } from 'react-router-dom';
import { getIconPath } from './icons.js';
import { useServiceInstallation } from '../state/serviceInstallationContext.tsx';

function NavigationIcon({ name }) {
  const path = getIconPath(name);
  return (
    <Icon viewBox="0 0 24 24" boxSize="1.25rem">
      <path fill="currentColor" d={path} />
    </Icon>
  );
}

function NavigationList({ onNavigate, activePath }) {
  const { navigationItems, ensureLoaded } = useServiceInstallation();

  useEffect(() => {
    ensureLoaded().catch(() => {});
  }, [ensureLoaded]);

  return (
    <Stack spacing={1} role="navigation" aria-label="Moon navigation">
      {navigationItems.map((item) => {
        const isActive = activePath === item.path;
        return (
          <Button
            key={item.path}
            onClick={() => onNavigate(item.path)}
            variant={isActive ? 'solid' : 'ghost'}
            colorScheme={isActive ? 'purple' : undefined}
            justifyContent="flex-start"
            leftIcon={<NavigationIcon name={item.icon} />}
            py={3}
            px={3}
            height="auto"
            textAlign="left"
          >
            <Box>
              <Text fontWeight="semibold">{item.title}</Text>
              <Text fontSize="sm" color="gray.500" noOfLines={2}>
                {item.description}
              </Text>
            </Box>
          </Button>
        );
      })}
    </Stack>
  );
}

export default function Header({ title, children }) {
  const location = useLocation();
  const navigate = useNavigate();
  const isDesktop = useBreakpointValue({ base: false, lg: true }) ?? false;
  const { colorMode, toggleColorMode } = useColorMode();
  const { isOpen, onOpen, onClose } = useDisclosure();
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window === 'undefined') {
      return true;
    }
    const stored = window.localStorage.getItem('noona-drawer');
    return stored !== 'false';
  });

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('noona-drawer', sidebarOpen ? 'true' : 'false');
    }
  }, [sidebarOpen]);

  useEffect(() => {
    if (!isDesktop) {
      onClose();
    }
  }, [location.pathname, isDesktop, onClose]);

  const handleNavigate = useCallback(
    (path) => {
      navigate(path);
      if (isDesktop) {
        setSidebarOpen(false);
      } else {
        onClose();
      }
    },
    [isDesktop, navigate, onClose],
  );

  const sidebarContent = useMemo(
    () => (
      <Box px={3} py={4} role="menu">
        <Stack spacing={4} height="100%">
          <Box textAlign="center">
            <Text fontSize="lg" fontWeight="bold">
              Noona
            </Text>
            <Text fontSize="sm" color="gray.500">
              Control your services
            </Text>
          </Box>
          <Button
            variant="ghost"
            justifyContent="flex-start"
            leftIcon={<NavigationIcon name="mdi-theme-light-dark" />}
            onClick={toggleColorMode}
          >
            Toggle {colorMode === 'light' ? 'Dark' : 'Light'} Mode
          </Button>
          <Divider />
          <NavigationList onNavigate={handleNavigate} activePath={location.pathname} />
        </Stack>
      </Box>
    ),
    [colorMode, handleNavigate, location.pathname, toggleColorMode],
  );

  return (
    <Flex minH="100vh" bg="gray.50" _dark={{ bg: 'gray.900' }}>
      {isDesktop && sidebarOpen && (
        <Box
          as="aside"
          width="320px"
          borderRightWidth="1px"
          borderColor="gray.200"
          _dark={{ borderColor: 'whiteAlpha.300' }}
          display="flex"
        >
          {sidebarContent}
        </Box>
      )}

      <Flex direction="column" flex="1" minH="100vh">
        <Flex
          as="header"
          align="center"
          justify="space-between"
          px={6}
          py={4}
          borderBottomWidth="1px"
          borderColor="gray.200"
          _dark={{ borderColor: 'whiteAlpha.300', bg: 'gray.800' }}
          bg="white"
          position="sticky"
          top="0"
          zIndex="docked"
        >
          <HStack spacing={4} align="center">
            {!isDesktop && (
              <IconButton
                aria-label="Open navigation"
                icon={
                  <Icon viewBox="0 0 24 24">
                    <path fill="currentColor" d={getIconPath('mdi-menu')} />
                  </Icon>
                }
                variant="ghost"
                onClick={onOpen}
              />
            )}
            {isDesktop && (
              <IconButton
                aria-label={sidebarOpen ? 'Collapse navigation' : 'Expand navigation'}
                icon={
                  <Icon viewBox="0 0 24 24">
                    <path fill="currentColor" d={getIconPath('mdi-menu')} />
                  </Icon>
                }
                variant="ghost"
                onClick={() => setSidebarOpen((value) => !value)}
              />
            )}
            <Image src="/logo.svg" alt="Noona logo" boxSize="40px" />
            <Heading size="md">{title ?? 'Noona'}</Heading>
          </HStack>

          <IconButton
            aria-label="Toggle color mode"
            icon={colorMode === 'light' ? <MoonIcon /> : <SunIcon />}
            variant="ghost"
            onClick={toggleColorMode}
          />
        </Flex>

        <Box as="main" flex="1" px={{ base: 4, md: 6 }} py={{ base: 6, md: 8 }}>
          {children}
        </Box>
      </Flex>

      <Drawer placement="left" onClose={onClose} isOpen={!isDesktop && isOpen} size="xs">
        <DrawerOverlay />
        <DrawerContent>
          <DrawerCloseButton />
          <DrawerHeader borderBottomWidth="1px">Navigation</DrawerHeader>
          <DrawerBody>{sidebarContent}</DrawerBody>
        </DrawerContent>
      </Drawer>
    </Flex>
  );
}
