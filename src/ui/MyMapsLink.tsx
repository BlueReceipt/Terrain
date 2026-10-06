import { useState } from 'preact/hooks';
import { myMapsId } from '../domain/mymaps.ts';
import { pickMyMapsLink } from './flow.ts';
import { strings } from './strings.ts';

/**
 * The demo's "Open a My Maps link", on the first screen and in Settings once a campaign is open:
 * the button opens the link box in its place.
 */
export function MyMapsLink() {
  const [open, setOpen] = useState(false);
  return open ? (
    <LinkForm
      onCancel={() => {
        setOpen(false);
      }}
    />
  ) : (
    <button
      type="button"
      class="button"
      onClick={() => {
        setOpen(true);
      }}
    >
      {strings.home.openLink}
    </button>
  );
}

/** The demo's link box: the map's link or its embed code, opened through the demo's relay. */
function LinkForm({ onCancel }: { onCancel: () => void }) {
  const [text, setText] = useState('');
  const [invalid, setInvalid] = useState(false);
  return (
    <form
      class="link-form"
      onSubmit={(event) => {
        event.preventDefault();
        const id = myMapsId(text);
        if (id) void pickMyMapsLink(id);
        else setInvalid(true);
      }}
    >
      <label class="field">
        <span>{strings.home.linkLabel}</span>
        <input
          class="text-input"
          type="text"
          inputMode="url"
          enterKeyHint="go"
          autoComplete="off"
          autoFocus
          value={text}
          aria-describedby="link-hint"
          aria-invalid={invalid}
          onInput={(event) => {
            setText(event.currentTarget.value);
            setInvalid(false);
          }}
        />
      </label>
      <p id="link-hint" class="muted">
        {strings.home.linkHint}
      </p>
      {invalid && <p role="alert">{strings.home.linkInvalid}</p>}
      <div class="actions">
        <button type="submit" class="button primary">
          {strings.home.linkOpen}
        </button>
        <button type="button" class="button" onClick={onCancel}>
          {strings.cancel}
        </button>
      </div>
    </form>
  );
}
