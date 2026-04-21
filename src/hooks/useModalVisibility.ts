import { useState, useEffect } from 'react';

export function useModalVisibility() {
  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => {
    const handleModalOpen = () => setIsModalOpen(true);
    const handleModalClose = () => setIsModalOpen(false);

    window.addEventListener('gsm:modal-open', handleModalOpen);
    window.addEventListener('gsm:modal-close', handleModalClose);
    return () => {
      window.removeEventListener('gsm:modal-open', handleModalOpen);
      window.removeEventListener('gsm:modal-close', handleModalClose);
    };
  }, []);

  return isModalOpen;
}
