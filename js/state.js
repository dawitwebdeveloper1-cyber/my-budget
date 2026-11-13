// The app's live data and a single way to change it (with Undo).
import { save, newId, freshState } from './store.js';
import { toast } from './ui.js';
import { hasVault, isUnlocked, saveEncrypted } from './vault.js';

export const app = {
  state: freshState(),
  view: { tab: 'home', mode: 'month', anchor: null },
  render: () => {},
  sample: false, // looking around with example data: nothing is saved
};

// Saves on this device: encrypted once a passcode is set, never in plain form after that.
// Example data is never saved.
export function persist() {
  if (app.sample) return;
  if (hasVault()) {
    if (isUnlocked()) saveEncrypted(app.state).catch(() => toast("Couldn't save on this device"));
    return;
  }
  if (!save(app.state)) toast("Couldn't save on this device");
}

// Apply a change, save it, redraw, and offer Undo.
export function change(mutate, message, { undo = true } = {}) {
  const before = structuredClone(app.state);
  mutate(app.state);
  persist();
  app.render();
  if (message) {
    toast(message, undo ? {
      label: 'Undo',
      run: () => { app.state = before; persist(); app.render(); toast('Undone'); },
    } : undefined);
  }
}

export { newId };
