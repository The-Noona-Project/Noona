import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, IconButton, Modal, Text as OneUIText } from '@textkernel/oneui';
import { useLocation, useNavigate } from 'react-router-dom';
import { getIconPath } from './icons.js';
import { useServiceInstallation } from '../state/serviceInstallationContext.tsx';
import { useOneUITheme } from '../theme/index.jsx';
import tokens from '../theme/tokens.js';
import useBreakpointValue from '../utils/useBreakpointValue.ts';
import useDisclosureState from '../utils/useDisclosureState.ts';
import '../style.css';

function NavigationIcon({ name }) {
  const path = getIconPath(name);
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="app-nav__icon">
      <path fill="currentColor" d={path} />
    </svg>
  );
}

function NavigationList({ onNavigate, activePath }) {
  const { navigationItems, ensureLoaded } = useServiceInstallation();

  useEffect(() => {
    ensureLoaded().catch(() => {});
  }, [ensureLoaded]);

  return (
    <div className="app-nav__list" role="navigation" aria-label="Moon navigation">
      {navigationItems.map((item) => {
        const isActive = activePath === item.path;
        return (
          <Button
            key={item.path}
            onClick={() => onNavigate(item.path)}
            context={isActive ? 'primary' : 'secondary'}
            variant={isActive ? 'filled' : 'ghost'}
            isBlock
            className="app-nav__button"
          >
            <span className="app-nav__button-content">
              <NavigationIcon name={item.icon} />
              <span className="app-nav__text">
                <span className="app-nav__title">{item.title}</span>
                <OneUIText size="small" context="neutral" className="app-nav__description">
                  {item.description}
                </OneUIText>
              </span>
            </span>
          </Button>
        );
      })}
    </div>
  );
}

export default function Header({ title, children }) {
  const location = useLocation();
  const navigate = useNavigate();
  const isDesktop = useBreakpointValue({ base: false, lg: true }) ?? false;
  const { colorMode, toggleColorMode } = useOneUITheme();
  const { isOpen, onOpen, onClose } = useDisclosureState(false);
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
      <div className="app-sidebar__content" role="menu">
        <div className="app-sidebar__hero">
          <p className="app-sidebar__title">Noona</p>
          <p className="app-sidebar__subtitle">Control your services</p>
        </div>
        <Button
          context="secondary"
          variant="ghost"
          isBlock
          className="app-nav__button"
          onClick={toggleColorMode}
        >
          <span className="app-nav__button-content">
            <NavigationIcon name="mdi-theme-light-dark" />
            <span className="app-nav__title">
              Toggle {colorMode === 'light' ? 'Dark' : 'Light'} Mode
            </span>
          </span>
        </Button>
        <div className="app-sidebar__divider" />
        <NavigationList onNavigate={handleNavigate} activePath={location.pathname} />
      </div>
    ),
    [colorMode, handleNavigate, location.pathname, toggleColorMode],
  );

  return (
    <div className="app-shell" style={{ backgroundColor: tokens.colors.surfaceMuted }}>
      {isDesktop && sidebarOpen && (
        <aside className="app-sidebar">{sidebarContent}</aside>
      )}
      <div className="app-shell__content">
        <header className="app-header">
          <div className="app-header__left">
            {!isDesktop ? (
              <IconButton
                aria-label="Open navigation"
                context="secondary"
                variant="ghost"
                onClick={onOpen}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path fill="currentColor" d={getIconPath('mdi-menu')} />
                </svg>
              </IconButton>
            ) : (
              <IconButton
                aria-label={sidebarOpen ? 'Collapse navigation' : 'Expand navigation'}
                context="secondary"
                variant="ghost"
                onClick={() => setSidebarOpen((value) => !value)}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path fill="currentColor" d={getIconPath('mdi-menu')} />
                </svg>
              </IconButton>
            )}
            <img src="/logo.svg" alt="Noona logo" className="app-logo" />
            <h1 className="app-heading">{title ?? 'Noona'}</h1>
          </div>
          <IconButton
            aria-label="Toggle color mode"
            context="secondary"
            variant="ghost"
            onClick={toggleColorMode}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="currentColor"
                d={getIconPath(colorMode === 'light' ? 'mdi-moon-waning-crescent' : 'mdi-weather-sunny')}
              />
            </svg>
          </IconButton>
        </header>
        <main className="app-main">{children}</main>
      </div>

      {!isDesktop && (
        <Modal
          isOpen={isOpen}
          onRequestClose={onClose}
          contentLabel="Navigation"
          className="app-modal"
          overlayClassName="app-modal__overlay"
        >
          <div className="app-modal__header">
            <h2>Navigation</h2>
            <IconButton
              aria-label="Close navigation"
              context="secondary"
              variant="ghost"
              onClick={onClose}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path fill="currentColor" d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" />
              </svg>
            </IconButton>
          </div>
          {sidebarContent}
        </Modal>
      )}
    </div>
  );
}
