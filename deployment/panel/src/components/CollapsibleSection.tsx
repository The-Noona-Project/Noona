import { ReactNode } from 'react';

interface CollapsibleSectionProps {
    title: string;
    children: ReactNode;
    defaultOpen?: boolean;
    meta?: ReactNode;
    className?: string;
}

const CollapsibleSection = ({
    title,
    children,
    defaultOpen = false,
    meta,
    className
}: CollapsibleSectionProps) => {
    return (
        <details className={`oneui-card collapsible-card${className ? ` ${className}` : ''}`} open={defaultOpen}>
            <summary>
                <h2>{title}</h2>
                <span className="collapsible-spacer" aria-hidden="true" />
                {meta && <div className="collapsible-meta">{meta}</div>}
                <span className="collapsible-indicator" aria-hidden="true" />
            </summary>
            <div className="collapsible-content">{children}</div>
        </details>
    );
};

export default CollapsibleSection;
