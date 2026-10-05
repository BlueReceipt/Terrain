import { toast, undoLast } from './actions.ts';
import { strings } from './strings.ts';

/** The toast after an action (§5.4): what happened, and Undo, until the next action or 6 seconds. */
export function Toast() {
  const current = toast.value;
  if (!current) return null;
  return (
    <div class="toast" role="status" key={current.id}>
      <span class="grow">{current.message}</span>
      {current.undoEventId && (
        <button
          type="button"
          class="button toast-undo"
          onClick={() => {
            const id = current.undoEventId;
            if (id) void undoLast(id);
          }}
        >
          {strings.toast.undo}
        </button>
      )}
    </div>
  );
}
