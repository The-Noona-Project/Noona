import { ReactNode } from 'react';

import { StreamEntry, ContainerLogEvent } from '../types';
import { formatProgressEvent, formatTable } from '../utils/formatters';

const HOST_SERVICE_URL_PATTERN = /host_service_url="?([^"\s]+)"?/i;

const toLocalhostUrl = (value?: string | null): string | null => {
    if (!value) return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    const hasProtocol = /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmed);
    const candidate = hasProtocol ? trimmed : `http://${trimmed.replace(/^\/+/, '')}`;
    try {
        const url = new URL(candidate);
        if (!url.hostname) return null;
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            return null;
        }
        url.hostname = 'localhost';
        return url.toString();
    } catch (error) {
        return null;
    }
};

const renderContainerLogEvent = ({ service, line }: ContainerLogEvent = {}): ReactNode => {
    const text = typeof line === 'string' ? line : line ?? '';
    const match = typeof text === 'string' ? text.match(HOST_SERVICE_URL_PATTERN) : null;

    if (!match) {
        return <>{service ? `${service}: ` : ''}{text}</>;
    }

    const [fullMatch, rawUrl] = match;
    const before = text.slice(0, match.index);
    const after = text.slice((match.index ?? 0) + fullMatch.length);
    const normalized = toLocalhostUrl(rawUrl);
    const href = normalized || rawUrl;

    return (
        <>
            {service && `${service}: `}
            {before}
            <a href={href} target="_blank" rel="noreferrer noopener">
                {normalized || rawUrl}
            </a>
            {after}
        </>
    );
};

const getEntryClass = (entry: StreamEntry): string | undefined => {
    if (entry.type === 'log') {
        if (entry.level === 'success') return 'status-ok';
        if (entry.level === 'warn') return 'status-warn';
        if (entry.level === 'error') return 'status-error';
        return 'status-info';
    }
    if (entry.type === 'error') {
        return 'status-error';
    }
    return undefined;
};

const resolveMessage = (entry: StreamEntry): ReactNode => {
    if (entry.type === 'log') {
        return entry.message ?? '';
    }
    if (entry.type === 'error') {
        return entry.message ?? JSON.stringify(entry);
    }
    if (entry.type === 'container-log') {
        return renderContainerLogEvent(entry.event as ContainerLogEvent);
    }
    if (entry.type === 'progress') {
        return formatProgressEvent(entry.event as Record<string, unknown>);
    }
    if (entry.type === 'table') {
        return (
            <pre>
                {formatTable(entry.data as Record<string, unknown>[], entry.columns)}
            </pre>
        );
    }
    if (typeof entry.message === 'string') {
        return entry.message;
    }
    return JSON.stringify(entry);
};

interface LogPanelProps {
    entries: StreamEntry[];
}

const LogPanel = ({ entries }: LogPanelProps) => {
    if (!entries.length) {
        return (
            <div className="log-panel" id="stream-output">
                <p className="muted">Dispatch a command to stream structured output.</p>
            </div>
        );
    }

    return (
        <div className="log-panel" id="stream-output">
            {entries.map((entry, index) => {
                const entryClass = getEntryClass(entry);
                const className = entryClass ? `log-entry ${entryClass}` : 'log-entry';
                return (
                    <div className={className} key={`${entry.action}-${index}`}>
                        <span className="log-context">[{entry.action ?? 'event'}]</span>
                        <span className="log-message">{resolveMessage(entry)}</span>
                    </div>
                );
            })}
        </div>
    );
};

export default LogPanel;
