// The app's live data and a single way to change it (with Undo).
import { load, save, newId } from './store.js';
import { toast } from './ui.js';

export const app = {
  state: load(),
  view: { tab: 'home', mode: 'month', anchor: null },
  render: () => {},
};

export function persist() {
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
