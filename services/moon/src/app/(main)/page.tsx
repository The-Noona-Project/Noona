"use client";

import { useMemo } from "react";
import {
  Heading,
  Text,
  Button,
  Column,
  Badge,
  Line,
  LetterFx,
} from "@once-ui-system/core";

import { WizardProvider, useWizardModel } from "./wizard/model";
import { WizardStepKey } from "./wizard/types";

const statusTone: Record<string, string> = {
  pending: "neutral-weak",
  "in-progress": "accent-weak",
  complete: "positive-strong",
  error: "negative-strong",
  skipped: "neutral-weak",
};

const StepCard = ({ stepId }: { stepId: WizardStepKey }) => {
  const { metadata, wizard, currentStep, setCurrentStep, validationErrors } = useWizardModel();
  const step = metadata?.steps.find((entry) => entry.id === stepId);
  const state = wizard?.[stepId];
  const errors = validationErrors[stepId] ?? [];

  if (!step || !state) return null;

  const tone = statusTone[state.status] ?? "neutral-weak";

  return (
    <div
      style={{
        border: currentStep === stepId ? "1px solid var(--once-color-accent)" : "1px solid var(--once-color-border)",
        borderRadius: "12px",
        padding: "16px",
        background: "var(--once-color-surface)",
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        gap: "8px",
      }}
      onClick={() => setCurrentStep(stepId)}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "center" }}>
        <Heading variant="heading-strong-m">{step.title}</Heading>
        <Badge
          textVariant="label-default-s"
          border="neutral-alpha-strong"
          onBackground={tone}
          vertical="center"
          gap="8"
        >
          {state.status}
        </Badge>
      </div>
      <Text onBackground="neutral-weak">{step.description}</Text>
      {state.detail && (
        <Text variant="body-default-s" onBackground="neutral-medium">
          {state.detail}
        </Text>
      )}
      {state.error && (
        <Text variant="body-default-s" onBackground="negative-strong">
          {state.error}
        </Text>
      )}
      {errors.length > 0 && (
        <div style={{ borderTop: "1px solid var(--once-color-border)", paddingTop: "8px" }}>
          <Text variant="label-default-s" onBackground="negative-strong">
            Validation errors
          </Text>
          <ul style={{ margin: "4px 0 0", paddingLeft: "16px" }}>
            {errors.map((item) => (
              <li key={item}>
                <Text variant="body-default-s" onBackground="negative-strong">
                  {item}
                </Text>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

const ServiceGroup = ({
  title,
  description,
  services,
}: {
  title: string;
  description: string;
  services: { name: string; category?: string | null; required?: boolean }[];
}) => (
  <div
    style={{
      border: "1px dashed var(--once-color-border)",
      borderRadius: "12px",
      padding: "12px",
      display: "flex",
      flexDirection: "column",
      gap: "8px",
    }}
  >
    <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
      <Heading variant="label-strong-m">{title}</Heading>
      <Line vert background="neutral-alpha-strong" />
      <Text variant="body-default-s" onBackground="neutral-weak">
        {description}
      </Text>
    </div>
    {services.length === 0 ? (
      <Text variant="body-default-s" onBackground="neutral-weak">
        Nothing to configure here yet.
      </Text>
    ) : (
      <ul style={{ margin: 0, paddingLeft: "18px", display: "grid", gap: "4px" }}>
        {services.map((service) => (
          <li key={service.name}>
            <Text variant="body-default-s">
              {service.name}
              {service.required ? " (required)" : ""}
              {service.category ? ` — ${service.category}` : ""}
            </Text>
          </li>
        ))}
      </ul>
    )}
  </div>
);

const NdjsonEventLog = () => {
  const { ndjsonEvents } = useWizardModel();

  if (ndjsonEvents.length === 0) return null;

  return (
    <div
      style={{
        border: "1px solid var(--once-color-border)",
        borderRadius: "12px",
        padding: "12px",
        display: "flex",
        flexDirection: "column",
        gap: "6px",
      }}
    >
      <Heading variant="label-strong-m">Streaming events</Heading>
      {ndjsonEvents.map((event, index) => (
        <div key={`${event.type}-${index}`} style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <Text variant="label-default-s" onBackground="neutral-weak">
            {event.type}
          </Text>
          {event.error && (
            <Text variant="body-default-s" onBackground="negative-strong">
              {event.error}
            </Text>
          )}
          {event.data && (
            <Text variant="body-default-s" onBackground="neutral-weak">
              {JSON.stringify(event.data)}
            </Text>
          )}
        </div>
      ))}
    </div>
  );
};

const WizardShell = () => {
  const { metadata, wizard, progress, stepSelections, refresh, error } = useWizardModel();

  const percent = useMemo(() => {
    if (progress?.percent != null) return progress.percent;
    const steps = metadata?.steps ?? [];
    if (!wizard || steps.length === 0) return null;
    const completed = steps.filter((step) => wizard[step.id].status === "complete").length;
    return Math.round((completed / steps.length) * 100);
  }, [metadata?.steps, progress?.percent, wizard]);

  return (
    <Column fillWidth padding="l" gap="l" style={{ minHeight: "100vh" }}>
      <Column maxWidth="xl" gap="m">
        <Badge
          textVariant="code-default-s"
          border="neutral-alpha-medium"
          onBackground="neutral-medium"
          vertical="center"
          gap="16"
        >
          <Line vert background="neutral-alpha-strong" />
          <Text marginX="4">
            <LetterFx trigger="instant">Setup wizard</LetterFx>
          </Text>
        </Badge>
        <Heading variant="display-strong-l">Deploy Noona with confidence</Heading>
        <Text variant="heading-default-m" onBackground="neutral-weak">
          Follow the guided steps to configure core services, add-ons, and verification checks. The UI now tracks backend wizard
          endpoints, NDJSON streams, and validation issues per step.
        </Text>
        <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
          <Button onClick={() => refresh()}>Refresh wizard state</Button>
          {percent != null && (
            <Badge textVariant="label-default-s" border="neutral-alpha-strong" onBackground="neutral-weak">
              {percent}% complete
            </Badge>
          )}
        </div>
        {error && (
          <Text variant="body-default-s" onBackground="negative-strong">
            {error}
          </Text>
        )}
      </Column>

      <Column gap="m">
        <Heading variant="heading-strong-m">Steps</Heading>
        <div style={{ display: "grid", gap: "12px", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
          {metadata?.steps.map((entry) => (
            <StepCard key={entry.id} stepId={entry.id} />
          ))}
        </div>
      </Column>

      <Column gap="m">
        <Heading variant="heading-strong-m">Service context</Heading>
        <div style={{ display: "grid", gap: "12px", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
          <ServiceGroup
            title="Foundation"
            description="Required services and base infrastructure"
            services={stepSelections.foundation}
          />
          <ServiceGroup
            title="Add-ons"
            description="Optional workloads mapped to their wizard step"
            services={stepSelections.addons}
          />
          <ServiceGroup
            title="Verification"
            description="Health checks and post-install validation targets"
            services={stepSelections.verification}
          />
        </div>
      </Column>

      <NdjsonEventLog />
    </Column>
  );
};

export default function Home() {
  return (
    <WizardProvider>
      <WizardShell />
    </WizardProvider>
  );
}
