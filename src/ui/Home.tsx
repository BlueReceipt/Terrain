import { ImportButton, RestoreButton } from './ImportButton.tsx';
import { strings } from './strings.ts';

/** The first screen when no campaign exists yet; a new phone restores from here. */
export function Home() {
  return (
    <main class="home">
      <p class="home-sentence">{strings.home.noCampaign}</p>
      <ImportButton label={strings.home.importFile} />
      <RestoreButton />
    </main>
  );
}
