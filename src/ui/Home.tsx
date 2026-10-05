import { pickSample } from './flow.ts';
import { ImportButton, RestoreButton } from './ImportButton.tsx';
import { offersSample } from './sample.ts';
import { strings } from './strings.ts';

/**
 * The first screen when no campaign exists yet; a new phone restores from here. On the public demo
 * address it also offers the poutine sample.
 */
export function Home() {
  const sample = offersSample(location.hostname);
  return (
    <main class="home">
      <p class="home-sentence">{sample ? strings.home.sampleSentence : strings.home.noCampaign}</p>
      {sample && (
        <button type="button" class="button primary" onClick={() => void pickSample()}>
          {strings.home.trySample}
        </button>
      )}
      <ImportButton label={strings.home.importFile} primary={!sample} />
      <RestoreButton />
    </main>
  );
}
