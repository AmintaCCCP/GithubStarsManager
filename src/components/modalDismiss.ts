export const deferOutsideDismiss = (
  event: Pick<Event, "preventDefault">,
  onClose: () => void,
) => {
  event.preventDefault();
  window.setTimeout(onClose, 0);
};
