# Moon UI Agent Guide

## Core Philosophy

- You are a design engineer working inside Moon. Use Once UI for layout, spacing, surface treatment, and typography.
- Reuse Moon's existing product components before creating new abstractions.
- Prefer composition over custom styling. Reach for SCSS modules only when Once UI props and light inline styles are no
  longer enough.
- Keep changes scoped to the current feature. Do not redesign unrelated areas while touching a page.

## Preferred Once UI Palette

These are the Once UI primitives already used across Moon and should be the default starting point:

- `Column`, `Row`, `Flex`: primary layout primitives. Prefer `Column` and `Row`; use `Flex` only when the direction or
  wrapping behavior is not cleanly expressed with the other two.
- `Card`: default surface for sections, forms, empty states, warnings, and grouped controls.
- `Heading`, `Text`: default text primitives. Build hierarchy with variants before adding custom styles.
- `Button`, `ToggleButton`: primary and secondary actions, tab-like toggles, and compact controls.
- `Input`: text, numeric, URL, password, and config-edit form fields.
- `Badge`: compact status, counters, and metadata chips.
- `SmartLink`: internal and external text links, clickable cards, and detail links.
- `Spinner`: loading states inside cards, panels, and page-level blockers.
- `Line`: visual separators in dense setup and detail flows.
- `Fade`: edge fades and chrome treatments like the sticky header.
- `Meta`: route metadata in `src/app/**/page.tsx` files. Do not use it inside client components.

## Preferred Moon Patterns

- Page shells usually follow `Column maxWidth="l" horizontal="center" gap="24" paddingY="24"`.
- Status panels should usually be a `Card` with a `Heading` and one or two `Text` blocks.
- Loading states should center a `Spinner` in a `Row fillWidth horizontal="center" paddingY="64"`.
- Section groups inside large pages should usually be stacked `Card` blocks inside a `Column fillWidth gap="16"` or
  `gap="24"`.
- Use `Badge` rows for compact metadata instead of inventing custom pills.
- Use `SmartLink` for linked cards or visible URLs instead of manually wiring click handlers on text.

## Layout And Styling Rules

- Do not default to raw `<div>` wrappers. Use `Column`, `Row`, or `Flex` unless a plain element is clearly required.
- Prefer semantic layout props over CSS: `gap`, `padding`, `margin`, `horizontal`, `vertical`, `center`, `fillWidth`,
  `fillHeight`, `maxWidth`.
- Use Once UI color tokens only. Do not add hex colors.
- Prefer `background` and `onBackground` token pairs for surfaces and text.
- Components should usually be fluid by default. Use `fillWidth` often; avoid hard-coded widths unless the UI needs a
  fixed control.
- Use responsive overrides only when the layout actually changes on smaller screens. Do not add breakpoint objects by
  default.
- Inline styles are acceptable for small layout gaps like `flexWrap`, grid templates, min sizes, and overflow behavior.
- If you need pseudo-selectors, multiple state classes, or overlay-specific styling, create an SCSS module.

## Reuse Existing Moon Components First

Before creating anything new, scan `src/components/noona/`, `src/components/noona/settings/`, and `src/components/`.

Use these existing components when they fit:

- `AuthGate`: gate full pages or sections behind login and optional Moon permissions.
- `SetupModeGate`: guard pages that only make sense after setup is complete.
- `SetupWizardGate`: guard setup-only pages and flows.
- `SettingsNavigation`: use for the `/settings/*` route family instead of rebuilding settings side navigation.
- `Header`, `Footer`, `Providers`, `RouteGuard`: app shell primitives exported from `src/components/index.ts`.
- `FooterKavitaButton`: use when you need the shared Kavita-launch affordance in shell/footer contexts.

## How To Use Moon Components

- Keep gate components high in the tree. A page should usually wrap its content once with `SetupModeGate` and/or
  `AuthGate` instead of repeating auth checks in every card.
- Keep product-specific navigation logic inside the feature component that owns it. Example: settings navigation belongs
  in `src/components/noona/settings/`.
- Reuse shared helpers and feature components when the interaction already exists elsewhere. Do not duplicate fetch
  logic, permission logic, or service-link logic.
- When an existing component is close but too rigid, extend it or extract a shared subcomponent instead of cloning the
  full implementation.

## When To Create A New Component

Create a new component when at least one of these is true:

- A page section is large enough that it obscures the page's top-level flow.
- The same card, control group, or layout pattern appears more than once.
- A unit has a clear product meaning such as `SettingsNavigation`, `DownloadsAddModal`, or a service settings panel.
- A UI block needs its own loading, empty, or error handling and is easier to reason about in isolation.

Do not extract components just to make files shorter if the result creates prop-drilling noise without reuse or clarity.

## New Component Placement

- Put shared app-shell components in `src/components/`.
- Put Moon product components in `src/components/noona/`.
- Put feature-scoped reusable components in a feature folder such as `src/components/noona/settings/`.
- If you create a reusable component folder, add an `index.ts` barrel export.
- Keep route files in `src/app/**/page.tsx` thin. They should mainly set metadata, resolve params, and render the page
  component.

## New Component Guidelines

- Use TypeScript and functional components.
- Add `"use client"` only when the component uses hooks, browser APIs, or client-only navigation.
- Prefer presentational components with explicit props. Keep heavy data fetching and orchestration in page-level or
  container components unless the component truly owns the workflow.
- Reusable components should usually expose the outer layout props of their wrapper so parents can adjust spacing and
  sizing.
- Keep component names product-specific and descriptive. Avoid vague names like `Panel`, `Widget`, or `Thing`.
- Model common states explicitly: loading, empty, success, error, disabled.
- Add accessible labels and dialog semantics where needed.
- Do not hardcode route strings, service names, or permission logic in multiple places when a shared helper already
  exists.

## Reusable Component Shape

When making a reusable wrapper, build it from Once UI primitives and keep the outside customizable.

Typical pattern:

- Use a `Column` or `Row` as the outer wrapper.
- Spread supported wrapper props on that outer element.
- Keep internal defaults opinionated but small.
- Only add an SCSS module if the component has real styling complexity.

## File And Naming Guidance

- Page-sized components may stay as `HomePage.tsx`, `LibrariesPage.tsx`, `SettingsPage.tsx`, and similar route-aligned
  names.
- Feature components should use domain names like `SettingsNavigation.tsx`, `DownloadsAddModal.tsx`, or
  `ServiceHealthCard.tsx`.
- If a page grows multiple distinct panels, split them into named components instead of keeping one very large file.

## Accessibility And Interaction

- Buttons must describe the action clearly.
- Dialog-like surfaces should set the expected ARIA attributes.
- Avoid clickable non-interactive text when `Button` or `SmartLink` is a better fit.
- Loading and error states should remain readable without relying on color alone.

## Documentation Addendum

- Keep [README.md](README.md) updated when main tabs, route groups, or API proxy flows change.
- The Moon README should keep a short `## Quick Navigation` section with markdown links to key routes, components, and
  API folders.
- If you add or move major Moon pages such as `/libraries`, `/downloads`, `/settings`, or `/setupwizard`, update
  both [README.md](README.md) and the root [../../README.md](../../README.md).
