import {
  createHashRouter,
  createRoutesFromElements,
  Route,
  Navigate,
  Params,
} from 'react-router-dom';

import { DrawerOutlet, Icon } from 'renderer/components';
import MidiMessageManagerProvider from './contexts/MidiMessageManager';

import Layout from './views/Layout';
import Home from './views/Home';
import ChordDisplay from './views/ChordDisplay';
import ChordQuiz from './views/ChordQuiz';
import ScaleQuiz from './views/ScaleQuiz';
import ScaleDegrees from './views/ScaleDegrees';
import RhythmGame from './views/RhythmGame';
import CircleOfFifths from './views/CircleOfFifths';

import settingsRoutes from './views/Settings';
import CircleOfFifthsSettings from './views/Settings/CircleOfFifthsSettings';
import ChordQuizSettings from './views/Settings/ChordQuizSettings';
import ScaleQuizSettings from './views/Settings/ScaleQuizSettings';
import ScaleDegreesSettings from './views/Settings/ScaleDegreesSettings';
import RhythmGameSettings from './views/Settings/RhythmGameSettings';

import packageJSON from '../../package.json';
import icon from '../../assets/icon.svg';
import ChordDisplayNamespaceSettings from './views/Settings/ChordDisplaySettings/ChordDisplayModuleSettings';
import ChordDictionary from './views/ChordDictionary';
import ChordDictionaryDetail from './views/ChordDictionary/Detail';

const router = createHashRouter(
  createRoutesFromElements(
    <Route
      path="/"
      handle={{
        title: packageJSON.build.productName,
        icon: <img src={icon} width={32} height={32} alt="" />,
      }}
      element={<Layout />}
    >
      <Route index element={<Home />} />
      <Route
        path="chords/:moduleId"
        handle={{
          title: (params: Params) => `Chord Display (${params.moduleId})`,
          icon: <Icon name="music" />,
          hasSettings: true,
        }}
        element={
          <ChordDisplay source="internal">
            <DrawerOutlet aria-label="Chord Display Settings" placement="right" size="lg" />
          </ChordDisplay>
        }
      >
        <Route path="settings" element={<ChordDisplayNamespaceSettings parentPath="../.." />} />
      </Route>
      <Route
        path="circle-of-fifths"
        handle={{
          title: 'Circle of Fifths',
          icon: <Icon name="circle-of-fifths" />,
          hasSettings: true,
        }}
        element={
          <MidiMessageManagerProvider namespace="circle-of-fifths" source="internal">
            <CircleOfFifths />
            <DrawerOutlet aria-label="Circle of fifths Settings" placement="right" size="lg" />
          </MidiMessageManagerProvider>
        }
      >
        <Route path="settings" element={<CircleOfFifthsSettings />} />
      </Route>
      <Route
        path="quiz"
        handle={{ title: 'Chord Quiz', icon: <Icon name="quiz" />, hasSettings: true }}
        element={
          <MidiMessageManagerProvider namespace="chord-quiz" source="internal">
            <ChordQuiz />
            <DrawerOutlet aria-label="Chord Quiz Settings" placement="right" size="lg" />
          </MidiMessageManagerProvider>
        }
      >
        <Route path="settings" element={<ChordQuizSettings />} />
      </Route>
      <Route
        path="scale-quiz"
        handle={{ title: 'Scale Quiz', icon: <Icon name="quiz" />, hasSettings: true }}
        element={
          <MidiMessageManagerProvider namespace="scale-quiz" source="internal">
            <ScaleQuiz />
            <DrawerOutlet aria-label="Scale Quiz Settings" placement="right" size="lg" />
          </MidiMessageManagerProvider>
        }
      >
        <Route path="settings" element={<ScaleQuizSettings />} />
      </Route>
      <Route
        path="scale-degrees"
        handle={{ title: 'Scale Degrees', icon: <Icon name="quiz" />, hasSettings: true }}
        element={
          <MidiMessageManagerProvider namespace="scale-degrees" source="internal">
            <ScaleDegrees />
            <DrawerOutlet aria-label="Scale Degrees Settings" placement="right" size="lg" />
          </MidiMessageManagerProvider>
        }
      >
        <Route path="settings" element={<ScaleDegreesSettings />} />
      </Route>
      <Route
        path="rhythm-game"
        handle={{ title: 'Rhythm Game', icon: <Icon name="music" />, hasSettings: true }}
        element={
          <MidiMessageManagerProvider namespace="rhythm-game" source="internal">
            <RhythmGame />
            <DrawerOutlet aria-label="Rhythm Game Settings" placement="right" size="lg" />
          </MidiMessageManagerProvider>
        }
      >
        <Route path="settings" element={<RhythmGameSettings />} />
      </Route>
      <Route
        path="chord-dictionary"
        handle={{
          title: 'Chord Dictionary',
          icon: <Icon name="dictionary" />,
          hasSettings: false,
        }}
        element={
          <MidiMessageManagerProvider namespace="chord-dictionary" source="internal">
            <ChordDictionary />
          </MidiMessageManagerProvider>
        }
      >
        <Route index element={<ChordDictionaryDetail />} />
        <Route
          path=":chordName"
          handle={{
            title: (params: Params) => (
              <span style={{ textTransform: 'none' }}>{params.chordName}</span>
            ),
            icon: <Icon name="music" />,
          }}
          element={<ChordDictionaryDetail />}
        />
      </Route>
      {settingsRoutes()}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Route>
  )
);

export default router;
