/// <reference types="vitest" />
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';

type FetchHandlers = Partial<Record<'build' | 'start' | 'push' | 'pull' | 'clean', (options?: RequestInit) => void>>;

const clickQuickActionButton = async (title: string, actionLabel: RegExp) => {
    const headings = screen.getAllByRole('heading', { name: title });
    const targetHeading = headings.find((heading) => heading.closest('.summary-card'));
    const card = targetHeading?.closest('.summary-card');
    expect(card).not.toBeNull();
    if (card) {
        const actionButton = within(card).getByRole('button', { name: actionLabel });
        await userEvent.click(actionButton);
    }
};

const createStreamResponse = (): Response =>
    ({
        ok: true,
        status: 200,
        body: {
            getReader: () => ({
                read: async () => ({ done: true, value: undefined as Uint8Array | undefined })
            })
        },
        json: async () => ({}),
        headers: new Headers()
    } as unknown as Response);

const installFetchMock = (handlers: FetchHandlers = {}) => {
    const servicesPayload = { services: ['warden', 'portal'], ok: true };
    const streamResponse = createStreamResponse();

    global.fetch = vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();

        if (url.startsWith('/api/services')) {
            return { ok: true, status: 200, json: async () => servicesPayload } as unknown as Response;
        }

        if (url.startsWith('/api/settings')) {
            return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
        }

        if (url.startsWith('/api/build')) {
            handlers.build?.(options);
            return streamResponse;
        }

        if (url.startsWith('/api/start')) {
            handlers.start?.(options);
            return streamResponse;
        }

        if (url.startsWith('/api/push')) {
            handlers.push?.(options);
            return streamResponse;
        }

        if (url.startsWith('/api/pull')) {
            handlers.pull?.(options);
            return streamResponse;
        }

        if (url.startsWith('/api/clean')) {
            handlers.clean?.(options);
            return streamResponse;
        }

        return streamResponse;
    }) as unknown as typeof fetch;
};

describe('Deployment panel quick flows', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('opens the build dialog and prompts to start Warden after submission', async () => {
        const buildCall = vi.fn();
        const startCall = vi.fn();
        installFetchMock({ build: buildCall, start: startCall });

        render(<App />);

        await screen.findByText(/Deployment Console/i);
        await clickQuickActionButton('Build', /Start build/i);

        const buildDialog = await screen.findByRole('dialog', { name: /Build services/i });
        const concurrencyInput = within(buildDialog).getByPlaceholderText(/\{"workers":2\}/i);
        await userEvent.clear(concurrencyInput);
        fireEvent.change(concurrencyInput, { target: { value: '{"workers":4}' } });
        await userEvent.click(within(buildDialog).getByLabelText(/Use --no-cache/i));

        await userEvent.click(within(buildDialog).getByRole('button', { name: /Dispatch build/i }));

        await waitFor(() => expect(buildCall).toHaveBeenCalled());
        const buildPayload = JSON.parse((buildCall.mock.calls[0]?.[0]?.body as string) || '{}');
        expect(buildPayload.useNoCache).toBe(true);
        expect(buildPayload.concurrency).toEqual({ workers: 4 });

        await screen.findByRole('dialog', { name: /Build dispatched/i });
        await userEvent.click(screen.getByRole('button', { name: /Start Warden now/i }));
        await waitFor(() => expect(startCall).toHaveBeenCalled());
        const startPayload = JSON.parse((startCall.mock.calls[0]?.[0]?.body as string) || '{}');
        expect(startPayload.services).toEqual(['warden']);
    });

    it('routes push and clean quick actions through option dialogs', async () => {
        const pushCall = vi.fn();
        const cleanCall = vi.fn();
        installFetchMock({ push: pushCall, clean: cleanCall });

        render(<App />);

        await screen.findByText(/Deployment Console/i);

        await clickQuickActionButton('Push', /^Push images$/i);
        const pushDialog = await screen.findByRole('dialog', { name: /Push images/i });
        expect(pushCall).not.toHaveBeenCalled();
        await userEvent.click(within(pushDialog).getByRole('button', { name: /^Push images$/i }));
        await waitFor(() => expect(pushCall).toHaveBeenCalled());

        await clickQuickActionButton('Clean', /Run cleanup/i);
        const cleanDialog = await screen.findByRole('dialog', { name: /Clean resources/i });
        expect(cleanCall).not.toHaveBeenCalled();
        await userEvent.click(within(cleanDialog).getByRole('button', { name: /Remove resources/i }));
        await waitFor(() => expect(cleanCall).toHaveBeenCalled());
    });
});
