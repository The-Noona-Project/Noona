import { ChangeEvent } from 'react';

export const ALL_SERVICES_OPTION = '__all__';

interface ServiceSelectProps {
    id: string;
    label: string;
    value: string[];
    onChange: (value: string[]) => void;
    options: string[];
    helpText?: string;
    size?: number;
    includeAllOption?: boolean;
}

const normalizeSelection = (value: string[]): string[] => {
    if (!Array.isArray(value)) {
        return [];
    }
    return Array.from(new Set(value.filter(Boolean)));
};

const ServiceSelect = ({
    id,
    label,
    value,
    onChange,
    options,
    helpText,
    size = 6,
    includeAllOption = true
}: ServiceSelectProps) => {
    const handleChange = (event: ChangeEvent<HTMLSelectElement>) => {
        const nextValues = Array.from(event.target.selectedOptions).map((option) => option.value);
        onChange(normalizeSelection(nextValues));
    };

    return (
        <label className="oneui-field">
            <span className="oneui-field__label">{label}</span>
            <select id={id} multiple size={size} value={value} onChange={handleChange}>
                {includeAllOption && (
                    <option value={ALL_SERVICES_OPTION}>All services</option>
                )}
                {options.map((option) => (
                    <option key={option} value={option}>
                        {option}
                    </option>
                ))}
            </select>
            {helpText && <span className="help-text">{helpText}</span>}
        </label>
    );
};

export default ServiceSelect;
