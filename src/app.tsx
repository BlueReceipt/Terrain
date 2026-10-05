import { screen } from './ui/flow.ts';
import { Home } from './ui/Home.tsx';
import { ImportReport } from './ui/ImportReport.tsx';
import { ColumnMapping, Failed, PinColors, Reading } from './ui/ImportScreens.tsx';
import { MapScreen } from './ui/MapScreen.tsx';
import { Restore, RestoreFailed } from './ui/RestoreScreens.tsx';
import { SettingsScreen } from './ui/SettingsScreen.tsx';
import { UpdateBar } from './ui/UpdateBar.tsx';

function Screen() {
  const now = screen.value;
  switch (now.name) {
    case 'starting':
      return null;
    case 'home':
      return <Home />;
    case 'reading':
      return <Reading fileName={now.fileName} />;
    case 'failed':
      return <Failed reason={now.reason} />;
    case 'mapping':
      return <ColumnMapping parsed={now.parsed} roles={now.roles} missing={now.missing} />;
    case 'colors':
      return (
        <PinColors
          parsed={now.parsed}
          roles={now.roles}
          colorMap={now.colorMap}
          unmatched={now.unmatched}
        />
      );
    case 'report':
      return <ImportReport plan={now.plan} saving={now.saving} saveFailed={now.saveFailed} />;
    case 'campaign':
      return <MapScreen />;
    case 'settings':
      return <SettingsScreen />;
    case 'restore':
      return <Restore backup={now.backup} restoring={now.restoring} />;
    case 'restoreFailed':
      return <RestoreFailed reason={now.reason} />;
  }
}

export function App() {
  return (
    <>
      <UpdateBar />
      <Screen />
    </>
  );
}
