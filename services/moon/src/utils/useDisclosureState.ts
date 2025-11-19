import { useCallback, useState } from 'react';

export interface DisclosureState {
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
  onToggle: () => void;
}

export function useDisclosureState(initialState = false): DisclosureState {
  const [isOpen, setIsOpen] = useState(initialState);

  const onOpen = useCallback(() => {
    setIsOpen(true);
  }, []);

  const onClose = useCallback(() => {
    setIsOpen(false);
  }, []);

  const onToggle = useCallback(() => {
    setIsOpen((value) => !value);
  }, []);

  return { isOpen, onOpen, onClose, onToggle };
}

export default useDisclosureState;
