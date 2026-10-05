import { useState } from 'preact/hooks';
import { myMapsId } from '../domain/mymaps.ts';
import { isPublicDemo } from './demo.ts';
import { pickMyMapsLink, pickSample } from './flow.ts';
import { ImportButton, RestoreButton } from './ImportButton.tsx';
import { strings } from './strings.ts';

/**
 * The first screen when no campaign exists yet; a new phone restores from here. On the public demo
 * address it also offers the poutine sample and My Maps links.
 */
export function Home() {
  const demo = isPublicDemo(location.hostname);
  const [linkOpen, setLinkOpen] = useState(false);
  return (
    <main class="home">
      <p class="home-sentence">{demo ? strings.home.sampleSentence : strings.home.noCampaign}</p>
      {demo && (
        <button type="button" class="button primary" onClick={() => void pickSample()}>
          {strings.home.trySample}
        </button>
      )}
      {demo &&
        (linkOpen ? (
          <LinkForm
            onCancel={() => {
              setLinkOpen(false);
            }}
          />
        ) : (
          <button
            type="button"
            class="button"
            onClick={() => {
              setLinkOpen(true);
            }}
          >
            {strings.home.openLink}
          </button>
        ))}
      <ImportButton label={strings.home.importFile} primary={!demo} />
      <RestoreButton />
    </main>
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
