import React, { useEffect, useMemo } from 'react';
import { Button } from '@textkernel/oneui';
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
    <div className="stack home-page">
      <section className="home-hero">
        <img src="/logo.svg" alt="Noona" className="home-hero__logo" />
        <h1>Welcome to Noona</h1>
        <p>Explore the control surfaces for every service or jump straight into the setup wizard.</p>
        {hasPendingSetup && (
          <Button context="primary" size="large" data-testid="launch-setup" onClick={() => navigate('/setup')}>
            Launch Setup Wizard
          </Button>
        )}
      </section>

      <div className="home-cards">
        {serviceCards.map((card) => (
          <article className="home-card" key={card.path}>
            <div className="home-card__header">
              <svg className="home-card__icon" viewBox="0 0 24 24" aria-hidden="true">
                <path fill="currentColor" d={getIconPath(card.icon)} />
              </svg>
              <h3>{card.title}</h3>
            </div>
            <p className="home-card__body">{card.summary}</p>
            <Button
              variant="outlined"
              context="primary"
              isBlock
              disabled={card.disabled}
              title={card.disabled ? card.tooltip : undefined}
              data-testid={`service-link-${card.path}`}
              onClick={() => !card.disabled && navigate(card.path)}
            >
              View {card.title}
            </Button>
          </article>
        ))}
      </div>
    </div>
  );
}
