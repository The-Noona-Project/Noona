import { ReactNode } from 'react';

interface ActionModalProps {
    title: string;
    subtitle?: string;
    onClose: () => void;
    footer?: ReactNode;
    children: ReactNode;
}

const ActionModal = ({ title, subtitle, onClose, footer, children }: ActionModalProps) => {
    return (
        <div className="action-modal__backdrop" role="presentation">
            <div className="action-modal" role="dialog" aria-modal="true" aria-labelledby="action-modal-title">
                <header className="action-modal__header">
                    <div>
                        <p className="eyebrow">Flow</p>
                        <h3 id="action-modal-title">{title}</h3>
                        {subtitle && <p className="muted">{subtitle}</p>}
                    </div>
                    <button type="button" className="ghost" onClick={onClose} aria-label="Close dialog">
                        ×
                    </button>
                </header>
                <div className="action-modal__body">{children}</div>
                {footer && <div className="action-modal__footer">{footer}</div>}
            </div>
        </div>
    );
};

export default ActionModal;
