import { isPublicDemo } from './demo.ts';
import { pickSample } from './flow.ts';
import { ImportButton, RestoreButton } from './ImportButton.tsx';
import { MyMapsLink } from './MyMapsLink.tsx';
import { strings } from './strings.ts';

/**
 * The first screen when no campaign exists yet; a new phone restores from here. On the public demo
 * address it also offers the poutine sample and My Maps links.
 */
export function Home() {
  const demo = isPublicDemo(location.hostname);
  return (
    <main class="home">
      <p class="home-sentence">{demo ? strings.home.sampleSentence : strings.home.noCampaign}</p>
      {demo && (
        <button type="button" class="button primary" onClick={() => void pickSample()}>
          {strings.home.trySample}
        </button>
      )}
      {demo && <MyMapsLink />}
      <ImportButton label={strings.home.importFile} primary={!demo} />
      <RestoreButton />
    </main>
  );
}
